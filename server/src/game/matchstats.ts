import type {
  BuildingType,
  CommanderDecision,
  MatchEvent,
  MatchEventKind,
  MatchReport,
  PlayerMatchStats,
  ResourceType,
  UnitType,
} from '@age/shared';

/** Seconds between army-strength samples (and turning-point checks). */
const SAMPLE_TICKS = 100;
/** Units lost by both sides inside one sample window that make an engagement "major". */
const MAJOR_ENGAGEMENT_LOSSES = 8;
const MAX_EVENTS = 240;

type Counters = Omit<PlayerMatchStats, 'playerId' | 'name' | 'color' | 'isBot' | 'won' | 'zonesControlled' | 'commander'>;

const zeroRes = (): Record<ResourceType, number> => ({ energy: 0, alloys: 0, compute: 0 });
const pretty = (type: string): string => type.replace(/_/g, ' ');

/** Structured, server-side match telemetry. Game calls the hooks; nothing here
 *  affects simulation state, so the report can never change a match result. */
export class MatchStats {
  private readonly counters = new Map<number, Counters>();
  private readonly events: MatchEvent[] = [];
  private readonly samples: MatchReport['strength'] = [];
  private contact = false;
  private leader = -1;
  private windowLosses = 0;
  private coreWarned = new Set<number>();
  private milestone = new Map<number, number>();

  constructor(players: { id: number; name: string }[], private readonly tps: number) {
    for (const p of players) this.counters.set(p.id, {
      gathered: zeroRes(), spent: zeroRes(), unitsProduced: 0, unitsLost: 0, enemyUnitsKilled: 0,
      structuresBuilt: 0, structuresLost: 0, enemyStructuresDestroyed: 0, peakArmy: 0,
      producedByType: {}, lostByType: {}, destroyedByType: {},
    });
    this.event(0, 'match_start', -1, `Match started: ${players.map((p) => p.name).join(' vs ')}.`);
  }

  private event(tick: number, kind: MatchEventKind, playerId: number, text: string): void {
    if (this.events.length >= MAX_EVENTS) return;
    this.events.push({ tick, kind, playerId, text });
  }

  gathered(owner: number, resource: ResourceType, amount: number): void {
    const c = this.counters.get(owner);
    if (c && amount > 0) c.gathered[resource] += amount;
  }

  spent(owner: number, cost: Partial<Record<ResourceType, number>>): void {
    const c = this.counters.get(owner);
    if (!c) return;
    for (const [key, value] of Object.entries(cost) as [ResourceType, number][]) c.spent[key] += value ?? 0;
  }

  trained(owner: number, type: UnitType, tick: number, name: string): void {
    const c = this.counters.get(owner);
    if (!c) return;
    c.unitsProduced++;
    c.producedByType[type] = (c.producedByType[type] ?? 0) + 1;
    const military = c.unitsProduced - (c.producedByType.villager ?? 0);
    const next = this.milestone.get(owner) ?? 10;
    if (type !== 'villager' && military >= next) {
      this.milestone.set(owner, next + 10);
      this.event(tick, 'unit_milestone', owner, `${name}: combat unit #${next} fielded.`);
    }
  }

  structureBuilt(owner: number): void {
    const c = this.counters.get(owner);
    if (c) c.structuresBuilt++;
  }

  unitLost(owner: number, type: UnitType, killer: number | undefined, tick: number, names: Map<number, string>): void {
    const c = this.counters.get(owner);
    if (c) {
      c.unitsLost++;
      c.lostByType[type] = (c.lostByType[type] ?? 0) + 1;
    }
    if (killer !== undefined && killer !== owner) {
      const k = this.counters.get(killer);
      if (k) k.enemyUnitsKilled++;
      if (!this.contact) {
        this.contact = true;
        this.event(tick, 'first_contact', killer, `First blood: ${names.get(killer) ?? 'A player'} destroyed a ${pretty(type)}.`);
      }
    }
    this.windowLosses++;
  }

  structureLost(owner: number, type: BuildingType, killer: number | undefined, tick: number, names: Map<number, string>): void {
    const c = this.counters.get(owner);
    if (c) c.structuresLost++;
    if (killer !== undefined && killer !== owner) {
      const k = this.counters.get(killer);
      if (k) {
        k.enemyStructuresDestroyed++;
        k.destroyedByType[type] = (k.destroyedByType[type] ?? 0) + 1;
      }
    }
    this.event(tick, 'structure_destroyed', owner, `${names.get(owner) ?? 'A player'} lost a ${pretty(type)}${killer !== undefined && killer !== owner ? ` to ${names.get(killer) ?? 'the enemy'}` : ''}.`);
  }

  coreDamaged(owner: number, ratio: number, tick: number, name: string): void {
    if (ratio > 0.5 || this.coreWarned.has(owner)) return;
    this.coreWarned.add(owner);
    this.event(tick, 'core_threatened', owner, `Command Core of ${name} fell below half integrity.`);
  }

  ageUp(owner: number, age: number, tick: number, name: string): void {
    this.event(tick, 'age_up', owner, `${name} advanced to age ${age}.`);
  }

  commander(owner: number, decision: CommanderDecision, name: string): void {
    // Only orders that move the army appear on the timeline; economy chatter stays in the log.
    if (decision.objective === 'production' || decision.objective === 'prioritize_resource' || decision.outcome === 'suggested') return;
    this.event(decision.tick, 'commander', owner, `${name} · ${decision.commander}: ${decision.action}.`);
  }

  defeated(owner: number, tick: number, name: string): void {
    this.event(tick, 'defeat', owner, `${name} was defeated.`);
  }

  /** Called once per tick. Samples army strength and detects turning points. */
  sample(tick: number, strength: Map<number, { power: number; size: number }>, names: Map<number, string>): void {
    for (const [id, s] of strength) {
      const c = this.counters.get(id);
      if (c) c.peakArmy = Math.max(c.peakArmy, s.size);
    }
    if (tick % SAMPLE_TICKS !== 0) return;
    const values: Record<number, number> = {};
    for (const [id, s] of strength) values[id] = Math.round(s.power);
    this.samples.push({ tick, values });
    if (this.windowLosses >= MAJOR_ENGAGEMENT_LOSSES) {
      this.event(tick, 'major_engagement', -1, `Major engagement: ${this.windowLosses} units destroyed in ten seconds.`);
    }
    this.windowLosses = 0;
    const ranked = [...strength].sort((a, b) => b[1].power - a[1].power || a[0] - b[0]);
    const [top, second] = ranked;
    // A lead must be clear (25 %) to count, so trading blows does not spam the timeline.
    if (top && top[1].power > 0 && (!second || top[1].power > second[1].power * 1.25) && top[0] !== this.leader) {
      if (this.leader !== -1 || tick > 0) {
        this.event(tick, 'military_lead', top[0], `${names.get(top[0]) ?? 'A player'} took the military lead.`);
      }
      this.leader = top[0];
    }
  }

  report(input: {
    tick: number;
    winnerId: number;
    players: { id: number; name: string; color: string; isBot: boolean; won: boolean; zonesControlled: number; commander?: PlayerMatchStats['commander'] }[];
  }): MatchReport {
    const players: PlayerMatchStats[] = input.players.map((p) => ({
      playerId: p.id, name: p.name, color: p.color, isBot: p.isBot, won: p.won, zonesControlled: p.zonesControlled,
      ...this.counters.get(p.id)!,
      ...(p.commander ? { commander: p.commander } : {}),
    }));
    const winner = input.players.find((p) => p.id === input.winnerId);
    const timeline = [...this.events];
    if (winner) timeline.push({ tick: input.tick, kind: 'victory', playerId: winner.id, text: `${winner.name} destroyed the enemy Command Core and won.` });
    return {
      durationTicks: input.tick,
      ticksPerSecond: this.tps,
      winnerId: input.winnerId,
      players,
      timeline,
      strength: this.samples.slice(-120),
      insights: insightsFor(players, input.winnerId, timeline, this.tps),
    };
  }
}

const total = (r: Record<ResourceType, number>): number => r.energy + r.alloys + r.compute;

/** Plain-language, rule-based explanation of the result. Deterministic. */
export function insightsFor(players: PlayerMatchStats[], winnerId: number, timeline: MatchEvent[], tps: number): string[] {
  const winner = players.find((p) => p.playerId === winnerId);
  const losers = players.filter((p) => p.playerId !== winnerId);
  if (!winner || losers.length === 0) return ['The match ended without a decisive victory.'];
  const loser = losers.reduce((a, b) => (total(b.gathered) > total(a.gathered) ? b : a));
  const out: string[] = [];
  const gW = total(winner.gathered);
  const gL = total(loser.gathered);
  if (gW > gL * 1.15) out.push(`Economy: ${winner.name} gathered ${Math.round((gW / Math.max(1, gL) - 1) * 100)}% more resources, which funded a larger army.`);
  else if (gL > gW * 1.15) out.push(`Economy: ${loser.name} out-gathered the winner by ${Math.round((gL / Math.max(1, gW) - 1) * 100)}% but did not convert it into military pressure.`);
  else out.push('Economy: both sides gathered within 15% of each other; the fight was decided on the battlefield.');

  const kd = (p: PlayerMatchStats): number => p.enemyUnitsKilled / Math.max(1, p.unitsLost);
  if (kd(winner) > kd(loser) * 1.3) out.push(`Engagements: ${winner.name} traded efficiently, destroying ${winner.enemyUnitsKilled} units for ${winner.unitsLost} lost.`);
  if (winner.peakArmy > loser.peakArmy * 1.3) out.push(`Army size: ${winner.name} peaked at ${winner.peakArmy} combat units against ${loser.peakArmy}.`);
  const siege = (winner.producedByType.siege_mech ?? 0) + (winner.producedByType.rocket_launcher ?? 0);
  if (siege > 0) out.push(`Siege: ${siege} siege unit(s) helped break the enemy's structures.`);
  if (loser.structuresLost > 0 && (loser.producedByType.villager ?? 0) > (loser.unitsProduced - (loser.producedByType.villager ?? 0)) * 3) {
    out.push(`Defense: ${loser.name} invested heavily in workers but fielded too few defenders to protect them.`);
  }
  const lead = timeline.find((event) => event.kind === 'military_lead' && event.playerId === winnerId);
  if (lead) out.push(`Turning point: ${winner.name} took the military lead at ${clock(lead.tick, tps)} and did not let go.`);
  const c = winner.commander;
  if (c && c.record.decisions > 0) {
    out.push(`Commander (${winner.name}): ${c.persona} at ${c.autonomy} autonomy completed ${c.record.completed} of ${c.record.completed + c.record.failed + c.record.superseded} resolved objectives.`);
  }
  const lc = loser.commander;
  if (lc && lc.record.failed > lc.record.completed) {
    out.push(`Commander (${loser.name}): ${lc.persona} failed more objectives (${lc.record.failed}) than it completed (${lc.record.completed}) — consider a different personality or a lower risk tolerance.`);
  }
  return out;
}

export function clock(tick: number, tps: number): string {
  const s = Math.floor(tick / tps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
