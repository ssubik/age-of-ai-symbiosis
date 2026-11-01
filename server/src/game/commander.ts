import {
  DEFAULT_POLICY,
  type BuildingType,
  type CommanderAutonomy,
  type CommanderDecision,
  type CommanderDecisionKind,
  type CommanderPersona,
  type CommanderPolicy,
  type CommanderRecord,
  type CommanderView,
  type ResourceType,
  type StrategicObjective,
  type UnitType,
} from '@age/shared';

/** What Game observed this decision cycle. Pure data: the brain never reads Game. */
export interface CommanderFacts {
  tick: number;
  core?: { id: number; x: number; y: number };
  /** Command Core hit points, 0..1 (1 when there is no core). */
  coreHealth: number;
  enemyCore?: { id: number; x: number; y: number };
  recentAttack?: { x: number; y: number };
  armySize: number;
  /** Mean hit-point ratio of the combat force, 0..1. */
  armyHealth: number;
  /** Own army power / enemy army power (both hp × dps). Large when the enemy has no army. */
  strengthRatio: number;
  /** Own army power / everything defending the enemy core: army, armed workers,
   *  and defensive structures including garrison arrows. Gates assaults. */
  assaultRatio: number;
  /** Mean distance of the army from the Command Core, in tiles. */
  armySpread: number;
  hostilesNearBase: number;
  idleWorkers: number;
  /** Stockpile that is lowest relative to how much the economy spends of it. */
  lowestResource: ResourceType;
  /** A demand-weighted stockpile far above another, with workers to spare on it. */
  surplus?: { from: ResourceType; to: ResourceType; ratio: number };
  /** Nearest resource zone outside the base with no friendly structure. */
  expansion?: { x: number; y: number };
  /** Game's evaluation of the objective under execution, if any. */
  active?: ObjectiveStatus;
}

export interface ObjectiveStatus {
  state: 'running' | 'completed' | 'failed';
  detail: string;
}

/** What Game must do this cycle. `start` dispatches the force; `reinforce`
 *  sends only idle, uncommitted units to an objective already under way. */
export interface CommanderStep {
  start?: { objective: StrategicObjective; source: 'player' | 'commander'; decisionId: number };
  reinforce?: StrategicObjective;
  /** Worker-priority decision, executed immediately alongside the army track. */
  economy?: { objective: Extract<StrategicObjective, { kind: 'prioritize_resource' }>; decisionId: number };
}

interface Candidate {
  objective: StrategicObjective;
  score: number;
  /** Assisted autonomy executes low-risk candidates without asking. */
  lowRisk: boolean;
  observation: string;
  action: string;
  reason: string;
  expected: string;
}

interface ActiveObjective {
  objective: StrategicObjective;
  source: 'player' | 'commander';
  sinceTick: number;
  decision: CommanderDecision;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const pct = (value: number): string => `${Math.round(clamp01(value) * 100)}%`;

/** Ticks between commander-initiative evaluations (5 s at 10 ticks/s). */
export const COMMANDER_THINK_TICKS = 50;
/** An objective that has not resolved after this long is reported as failed. */
export const OBJECTIVE_TIMEOUT_TICKS = 1500;
const SUGGESTION_REPEAT_TICKS = 300;
const SWITCH_MARGIN = 0.35;
const REBALANCE_TICKS = 600;
const VIEW_DECISIONS = 6;
const HISTORY_DECISIONS = 200;

const WEIGHTS: Record<CommanderPersona, { attack: number; defend: number; economy: number; prepare: number; expand: number }> = {
  vanguard: { attack: 1.0, defend: 0.55, economy: 0.35, prepare: 0.75, expand: 0.6 },
  sentinel: { attack: 0.45, defend: 1.0, economy: 0.45, prepare: 0.55, expand: 0.25 },
  architect: { attack: 0.4, defend: 0.65, economy: 1.0, prepare: 0.5, expand: 0.7 },
};

const RESOURCE_LABEL: Record<ResourceType, string> = { energy: 'energy', alloys: 'alloys', compute: 'compute' };

/** Deterministic, allocation-light strategic utility layer. It emits ordinary
 * objectives; Game remains responsible for validating and executing commands. */
export class CommanderBrain {
  private persona: CommanderPersona = 'vanguard';
  // Manual by default: ordinary rooms behave exactly as before until the player
  // (or the skirmish launcher) grants the commander authority.
  private autonomy: CommanderAutonomy = 'manual';
  private policy: CommanderPolicy = { ...DEFAULT_POLICY.vanguard };
  private order?: StrategicObjective;
  private active?: ActiveObjective;
  private decisions: CommanderDecision[] = [];
  private nextDecisionId = 1;
  private lastThinkTick = -Infinity;
  private lastSuggestion?: { kind: CommanderDecisionKind; tick: number };
  private lastProductionLog = -Infinity;
  private lastRebalance = -Infinity;
  private pendingProduction: string[] = [];
  private record: CommanderRecord = {
    decisions: 0, playerOrders: 0, completed: 0, failed: 0, superseded: 0, suggestions: 0, unitsQueued: 0, structuresQueued: 0,
  };

  get currentPersona(): CommanderPersona { return this.persona; }
  get currentAutonomy(): CommanderAutonomy { return this.autonomy; }
  get currentPolicy(): CommanderPolicy { return { ...this.policy }; }
  get activeObjective(): ActiveObjective | undefined { return this.active; }

  configure(persona: CommanderPersona, autonomy: CommanderAutonomy): void {
    // Choosing a personality adopts its default posture; sliders refine it afterwards.
    if (persona !== this.persona) this.policy = { ...DEFAULT_POLICY[persona] };
    this.persona = persona;
    this.autonomy = autonomy;
  }

  setPolicy(policy: CommanderPolicy): void {
    this.policy = { risk: clamp01(policy.risk), aggression: clamp01(policy.aggression), spendLimit: clamp01(policy.spendLimit) };
  }

  /** Explicit player order. It takes effect on the next step at any autonomy. */
  issue(objective: StrategicObjective): void {
    this.order = structuredClone(objective);
    this.record.playerOrders++;
    if (this.active) this.resolve('superseded', 'Replaced by a new player order.', this.active.sinceTick);
  }

  cancel(tick: number): void {
    this.order = undefined;
    if (this.active?.source === 'player') this.resolve('superseded', 'Cancelled by the player.', tick);
  }

  view(): CommanderView {
    return {
      persona: this.persona,
      autonomy: this.autonomy,
      policy: { ...this.policy },
      ...(this.order ? { objective: structuredClone(this.order) } : {}),
      ...(this.active ? {
        active: {
          objective: structuredClone(this.active.objective),
          source: this.active.source,
          sinceTick: this.active.sinceTick,
          decisionId: this.active.decision.id,
        },
      } : {}),
      decisions: this.decisions.slice(-VIEW_DECISIONS).map((decision) => ({ ...decision })),
      record: { ...this.record },
    };
  }

  /** Full decision history for the post-battle report. */
  history(): CommanderDecision[] { return this.decisions.map((decision) => ({ ...decision })); }
  stats(): CommanderRecord { return { ...this.record }; }

  /** One decision cycle. Called every second; initiative is rate-limited inside. */
  step(facts: CommanderFacts): CommanderStep | null {
    if (this.active) {
      const status = facts.active;
      if (status && status.state !== 'running') {
        this.resolve(status.state, status.detail, facts.tick);
      } else if (facts.tick - this.active.sinceTick > OBJECTIVE_TIMEOUT_TICKS) {
        this.resolve('failed', 'Timed out before the objective was achieved.', facts.tick);
      }
    }

    if (this.order && !this.active) {
      const objective = this.order;
      return { start: this.begin(this.forOrder(objective, facts), 'player', facts.tick) };
    }

    // A fresh attack is answered at the next one-second cycle, not the next five-second one.
    const defending = this.active?.objective.kind === 'defend_area' || this.active?.objective.kind === 'protect_core';
    const urgent = !!facts.recentAttack && !defending && this.autonomy !== 'manual' && this.active?.source !== 'player';
    const thinking = urgent || facts.tick - this.lastThinkTick >= COMMANDER_THINK_TICKS;
    if (!thinking) return null;
    this.lastThinkTick = facts.tick;
    if (this.autonomy === 'manual') return this.active ? { reinforce: this.active.objective } : null;

    const all = this.candidates(facts).filter((candidate) => candidate.score > 0.05);
    // Worker priorities run on their own track: they resolve at once and never
    // compete with, or displace, what the army is doing.
    const economy = this.economyStep(all.filter((c) => c.objective.kind === 'prioritize_resource'), facts.tick);
    const army = this.armyStep(all.filter((c) => c.objective.kind !== 'prioritize_resource'), facts.tick);
    return economy || army ? { ...army, ...(economy ? { economy } : {}) } : null;
  }

  /** Records what Game did for an economy-track decision. */
  resolveEconomy(decisionId: number, detail: string, tick: number): void {
    const decision = this.decisions.find((d) => d.id === decisionId);
    if (!decision || decision.outcome !== 'active') return;
    const failed = detail.startsWith('No ');
    decision.outcome = failed ? 'failed' : 'completed';
    decision.result = detail;
    decision.resolvedTick = tick;
    this.record[failed ? 'failed' : 'completed']++;
  }

  private economyStep(candidates: Candidate[], tick: number): CommanderStep['economy'] {
    const best = candidates[0];
    if (!best) return undefined;
    if (!this.executes(best)) {
      this.suggest(best, tick);
      return undefined;
    }
    const objective = best.objective as Extract<StrategicObjective, { kind: 'prioritize_resource' }>;
    if (objective.from) this.lastRebalance = tick;
    const decision = this.push({
      tick, commander: this.persona, objective: objective.kind, source: 'commander',
      observation: best.observation, action: best.action, reason: best.reason, expected: best.expected, outcome: 'active',
    });
    return { objective: structuredClone(objective), decisionId: decision.id };
  }

  private armyStep(candidates: Candidate[], tick: number): Omit<CommanderStep, 'economy'> | null {
    const reinforce = this.active ? { reinforce: this.active.objective } : null;
    if (this.active?.source === 'player') return reinforce;
    const top = candidates[0];
    if (!top) return reinforce;
    // Assisted: recommend the best plan, but still carry out the best low-risk one.
    if (!this.executes(top) && !(this.active && top.objective.kind === this.active.objective.kind)) this.suggest(top, tick);
    const best = candidates.find((candidate) => this.executes(candidate));
    if (!best) return reinforce;

    if (this.active) {
      if (best.objective.kind === this.active.objective.kind) return reinforce;
      const current = candidates.find((candidate) => candidate.objective.kind === this.active!.objective.kind)?.score ?? 0;
      if (best.score < current + SWITCH_MARGIN) return reinforce;
      this.resolve('superseded', `Superseded: ${best.action.toLowerCase()}.`, tick);
    }

    return { start: this.begin(best, 'commander', tick) };
  }

  /** Records a production cycle. Entries are merged into one decision every 20 s. */
  noteProduction(tick: number, queued: string[], units: number, structures: number, executed: boolean, reason: string): void {
    if (executed) {
      this.record.unitsQueued += units;
      this.record.structuresQueued += structures;
    }
    this.pendingProduction.push(...queued);
    if (this.pendingProduction.length === 0 || tick - this.lastProductionLog < 200) return;
    this.lastProductionLog = tick;
    const counts = new Map<string, number>();
    for (const item of this.pendingProduction) counts.set(item, (counts.get(item) ?? 0) + 1);
    this.pendingProduction = [];
    const summary = [...counts].map(([item, n]) => `${n}× ${item}`).join(', ');
    this.push({
      tick,
      commander: this.persona,
      objective: 'production',
      source: 'commander',
      observation: reason,
      action: executed ? `Queued ${summary}` : `Recommend queuing ${summary}`,
      reason: `${this.label()} production doctrine within a ${pct(this.policy.spendLimit)} spending limit.`,
      expected: 'A larger force or economy within the next minute.',
      outcome: executed ? 'completed' : 'suggested',
      ...(executed ? { result: 'Orders accepted by production buildings.', resolvedTick: tick } : {}),
    });
    if (!executed) this.record.suggestions++;
  }

  private executes(candidate: Candidate): boolean {
    return this.autonomy === 'autonomous' || (this.autonomy === 'assisted' && candidate.lowRisk);
  }

  private label(): string { return this.persona[0].toUpperCase() + this.persona.slice(1); }

  private push(decision: Omit<CommanderDecision, 'id'>): CommanderDecision {
    const full: CommanderDecision = { id: this.nextDecisionId++, ...decision };
    this.decisions.push(full);
    if (this.decisions.length > HISTORY_DECISIONS) this.decisions.splice(0, this.decisions.length - HISTORY_DECISIONS);
    this.record.decisions++;
    return full;
  }

  private begin(candidate: Candidate, source: 'player' | 'commander', tick: number): CommanderStep['start'] {
    const decision = this.push({
      tick,
      commander: this.persona,
      objective: candidate.objective.kind,
      source,
      observation: candidate.observation,
      action: candidate.action,
      reason: candidate.reason,
      expected: candidate.expected,
      outcome: 'active',
    });
    this.active = { objective: structuredClone(candidate.objective), source, sinceTick: tick, decision };
    if (candidate.objective.kind === 'prioritize_resource' && candidate.objective.from) this.lastRebalance = tick;
    this.lastThinkTick = tick;
    return { objective: structuredClone(candidate.objective), source, decisionId: decision.id };
  }

  private resolve(outcome: 'completed' | 'failed' | 'superseded', result: string, tick: number): void {
    const active = this.active;
    if (!active) return;
    active.decision.outcome = outcome;
    active.decision.result = result;
    active.decision.resolvedTick = tick;
    this.record[outcome]++;
    if (active.source === 'player') this.order = undefined;
    this.active = undefined;
  }

  private suggest(candidate: Candidate, tick: number): void {
    const last = this.lastSuggestion;
    if (last && last.kind === candidate.objective.kind && tick - last.tick < SUGGESTION_REPEAT_TICKS) return;
    this.lastSuggestion = { kind: candidate.objective.kind, tick };
    this.record.suggestions++;
    this.push({
      tick,
      commander: this.persona,
      objective: candidate.objective.kind,
      source: 'commander',
      observation: candidate.observation,
      action: `Recommend: ${candidate.action}`,
      reason: `${candidate.reason} Needs your authorization at ${this.autonomy} autonomy.`,
      expected: candidate.expected,
      outcome: 'suggested',
      proposal: structuredClone(candidate.objective),
    });
  }

  private forOrder(objective: StrategicObjective, facts: CommanderFacts): Candidate {
    const base = {
      objective,
      score: 2,
      lowRisk: true,
      observation: `Player order received. Army ${facts.armySize} units at ${pct(facts.armyHealth)} integrity; strength ratio ${facts.strengthRatio.toFixed(1)}.`,
      reason: 'Player orders override commander initiative at every autonomy level.',
    };
    switch (objective.kind) {
      case 'defend_area':
        return { ...base, action: 'Secure the designated sector with the full combat force', expected: 'Hostiles near the sector are destroyed or driven off.' };
      case 'protect_core':
        return { ...base, action: 'Pull every combat unit back to guard the Command Core', expected: 'No hostile remains within reach of the Command Core.' };
      case 'attack_target':
        return { ...base, action: 'Concentrate force on the selected target', expected: 'The target is destroyed.' };
      case 'capture_zone':
        return { ...base, action: 'Move to and hold the selected resource zone', expected: 'The force holds the zone.' };
      case 'prioritize_resource':
        return { ...base, action: `Shift idle and spare workers to ${RESOURCE_LABEL[objective.resource]}`, expected: `${RESOURCE_LABEL[objective.resource]} income rises within a minute.` };
      case 'prepare_offensive':
        return { ...base, action: 'Assemble the army at the Command Core', expected: 'A concentrated force ready to strike.' };
      case 'retreat_regroup':
        return { ...base, action: 'Break contact and regroup at the Command Core', expected: 'Surviving units reach the base.' };
    }
  }

  /** Utility candidates, best first. Pure and deterministic for identical facts. */
  candidates(facts: CommanderFacts): Candidate[] {
    const w = WEIGHTS[this.persona];
    const { risk, aggression } = this.policy;
    const attackW = w.attack * (0.5 + aggression);
    const defendW = w.defend * (1.5 - aggression);
    const health = clamp01(facts.armyHealth);
    const ratio = Math.max(0, facts.strengthRatio);
    const assault = Math.max(0, facts.assaultRatio);
    // Risk lowers the strength advantage needed before attacking (1.5× → 0.5×).
    const threshold = 1.5 - risk;
    const edge = clamp01(0.5 + (assault - threshold));
    const mass = Math.min(1, facts.armySize / 6);
    const name = this.label();
    const list: Candidate[] = [];

    if (facts.core && facts.armySize > 0 && health < 0.5 - 0.3 * risk && ratio < 1) list.push({
      objective: { kind: 'retreat_regroup' }, score: 1.3 + (1 - health), lowRisk: true,
      observation: `Army integrity fell to ${pct(health)} against a stronger force (ratio ${ratio.toFixed(1)}).`,
      action: 'Retreat surviving combat units to the Command Core',
      reason: 'Preserving the army has higher utility than continuing a losing engagement.',
      expected: 'Survivors reach the base and recover under its defenses.',
    });
    if (facts.core && facts.hostilesNearBase > 0 && facts.coreHealth < 0.7) list.push({
      objective: { kind: 'protect_core' }, score: 1.7 + (1 - facts.coreHealth), lowRisk: true,
      observation: `The Command Core is at ${pct(facts.coreHealth)} with ${facts.hostilesNearBase} hostile unit(s) nearby.`,
      action: 'Recall every combat unit to protect the Command Core',
      reason: 'Losing the Command Core loses the match.',
      expected: 'Attackers around the Command Core are destroyed.',
    });
    if (facts.recentAttack) list.push({
      objective: { kind: 'defend_area', x: facts.recentAttack.x, y: facts.recentAttack.y },
      score: defendW * 0.9 + 0.5 + Math.min(0.5, facts.hostilesNearBase * 0.1), lowRisk: true,
      observation: `Hostile fire detected inside the base perimeter; ${facts.hostilesNearBase} hostile unit(s) near the base.`,
      action: `Redirect ${facts.armySize} combat unit(s) to the threatened sector`,
      reason: `${name} doctrine rates infrastructure defense at ${defendW.toFixed(2)}.`,
      expected: 'The incursion is destroyed before it damages more structures.',
    });
    // Risk tolerance is a hard gate: below the threshold the commander never attacks.
    if (facts.enemyCore && facts.armySize >= 3 && assault >= threshold) list.push({
      objective: { kind: 'attack_target', targetId: facts.enemyCore.id },
      score: attackW * (0.4 + edge * 0.6) * mass, lowRisk: false,
      observation: `Assault ratio ${assault.toFixed(1)} (army vs. enemy army and core defenses) against a ${threshold.toFixed(1)} risk threshold; ${facts.armySize} units ready.`,
      action: 'Launch an assault on the enemy Command Core',
      reason: `${name} doctrine values offensive pressure at ${attackW.toFixed(2)} when the force has the edge.`,
      expected: 'The enemy Command Core falls or the enemy army is drawn into a favorable fight.',
    });
    if (facts.expansion && facts.armySize >= 2 && !facts.recentAttack) list.push({
      objective: { kind: 'capture_zone', x: facts.expansion.x, y: facts.expansion.y },
      score: w.expand * (0.5 + aggression * 0.5) * Math.min(1, facts.armySize / 4) * (ratio >= 1 ? 0.75 : 0.35), lowRisk: false,
      observation: `An uncontested resource zone lies ${Math.round(Math.hypot(facts.expansion.x - (facts.core?.x ?? 0), facts.expansion.y - (facts.core?.y ?? 0)))} tiles from the core.`,
      action: 'Secure the nearest unclaimed resource zone',
      reason: `${name} doctrine values territorial expansion at ${w.expand.toFixed(2)}.`,
      expected: 'The army holds the zone so it can be worked safely.',
    });
    if (facts.core && facts.armySize >= 2 && (facts.armySpread > 9 || (aggression >= 0.6 && assault < threshold && ratio >= 1 && facts.armySpread > 6))) list.push({
      objective: { kind: 'prepare_offensive' },
      score: w.prepare * (0.5 + aggression) * 0.6 * (1 - edge * 0.5), lowRisk: false,
      observation: `The army is dispersed (mean ${facts.armySpread.toFixed(0)} tiles from the core).`,
      action: 'Concentrate the army at the Command Core',
      reason: 'A concentrated force wins engagements that a scattered one loses.',
      expected: 'All combat units assemble and are ready for the next order.',
    });
    if (facts.idleWorkers > 0) list.push({
      objective: { kind: 'prioritize_resource', resource: facts.lowestResource },
      score: w.economy * Math.min(1, facts.idleWorkers / 3) * 0.9 + 0.1, lowRisk: true,
      observation: `${facts.idleWorkers} worker(s) idle; ${RESOURCE_LABEL[facts.lowestResource]} is the weakest stockpile.`,
      action: `Put idle workers on ${RESOURCE_LABEL[facts.lowestResource]}`,
      reason: `${name} doctrine rates economy at ${w.economy.toFixed(2)}; idle labor is pure waste.`,
      expected: `${RESOURCE_LABEL[facts.lowestResource]} income rises.`,
    });
    // Rebalancing moves busy workers, so it waits a minute between moves to let income settle.
    if (facts.surplus && facts.idleWorkers === 0 && facts.tick - this.lastRebalance >= REBALANCE_TICKS) {
      const { from, to, ratio } = facts.surplus;
      list.push({
        objective: { kind: 'prioritize_resource', resource: to, from }, score: w.economy * 0.6 + 0.15, lowRisk: true,
        observation: `${RESOURCE_LABEL[from]} is ${ratio.toFixed(1)}× over need while ${RESOURCE_LABEL[to]} limits production.`,
        action: `Shift a third of the ${RESOURCE_LABEL[from]} workers to ${RESOURCE_LABEL[to]}`,
        reason: 'Stockpiles that are not spent do not win battles; the bottleneck resource does.',
        expected: `${RESOURCE_LABEL[to]} stops limiting production within a minute.`,
      });
    }
    list.sort((a, b) => b.score - a.score || a.objective.kind.localeCompare(b.objective.kind));
    return list;
  }
}

// ---------------------------------------------------------------- production

export interface ProductionFacts {
  age: number;
  villagers: number;
  military: number;
  towers: number;
  /** Free population slots. */
  popRoom: number;
  popCapped: boolean;
  houseInProgress: boolean;
  structuresInProgress: number;
  underAttack: boolean;
  /** Completed buildings able to train, with their current queue length. */
  producers: { id: number; type: BuildingType; queue: number }[];
  townCenterId?: number;
  townCenterQueue: number;
  has: Partial<Record<BuildingType, number>>;
  /** Wild food nodes plus completed farms still producing. */
  foodSources: number;
  /** Age-up requirements are met and affordable right now. */
  canAdvance: boolean;
  /** Age-up buildings are in place; only resources are missing. */
  ageReady: boolean;
  /** Next building still needed before the age can advance. */
  ageBuildingNeeded?: BuildingType;
}

export type ProductionIntent =
  | { kind: 'train'; buildingId: number; unit: UnitType }
  | { kind: 'build'; building: BuildingType }
  | { kind: 'advance_age' };

interface Doctrine {
  /** Worker target for the current age. */
  villagers: (age: number) => number;
  units: UnitType[];
  perCycle: number;
  towers: (age: number) => number;
  barracks: number;
  /** Workers and combat units required before researching the next age. */
  ageAt: number;
  ageArmy: number;
}

const DOCTRINE: Record<CommanderPersona, Doctrine> = {
  vanguard: { villagers: (age) => 14 + 2 * age, units: ['knight', 'swordsman', 'attack_drone', 'siege_mech', 'archer'], perCycle: 3, towers: () => 0, barracks: 2, ageAt: 15, ageArmy: 6 },
  sentinel: { villagers: (age) => 16 + 3 * age, units: ['archer', 'swordsman', 'siege_mech', 'knight', 'attack_drone'], perCycle: 2, towers: (age) => 1 + age, barracks: 1, ageAt: 13, ageArmy: 3 },
  architect: { villagers: (age) => 14 + 6 * age, units: ['knight', 'swordsman', 'archer', 'siege_mech', 'attack_drone'], perCycle: 2, towers: (age) => (age >= 3 ? 1 : 0), barracks: 1, ageAt: 10, ageArmy: 0 },
};

const TRAINED_AT: Partial<Record<UnitType, BuildingType>> = {
  swordsman: 'barracks', archer: 'archery_range', knight: 'stable', attack_drone: 'drone_factory', siege_mech: 'mech_forge',
};

/** Ordered spending wishes for one production cycle. Game checks legality and
 *  the spending limit, executing intents in order until the budget runs out. */
export function planProduction(persona: CommanderPersona, f: ProductionFacts): ProductionIntent[] {
  const d = DOCTRINE[persona];
  const out: ProductionIntent[] = [];
  const militaryShare = persona === 'architect' ? f.villagers / 2 : Infinity;
  if (f.popRoom <= 2 && !f.popCapped && !f.houseInProgress) out.push({ kind: 'build', building: 'house' });
  // Technology first for the Architect; the others advance once their economy is in place.
  const wantsAge = f.villagers >= d.ageAt && f.military >= d.ageArmy && !f.underAttack;
  if (wantsAge && f.canAdvance) out.push({ kind: 'advance_age' });
  if (f.townCenterId !== undefined && f.villagers < d.villagers(f.age) && f.townCenterQueue < 2 && f.popRoom > 0 && !(persona === 'vanguard' && f.underAttack)) {
    out.push({ kind: 'train', buildingId: f.townCenterId, unit: 'villager' });
  }
  // Construction wishes in doctrine order; at most two sites are open at once.
  const builds: BuildingType[] = [];
  const wantTower = f.age >= 2 && f.towers < d.towers(f.age);
  // The Sentinel's towers come before everything else, even over the site limit.
  if (persona === 'sentinel' && wantTower) out.push({ kind: 'build', building: 'watch_tower' });
  if ((f.has.barracks ?? 0) < d.barracks && f.villagers >= 8) builds.push('barracks');
  // Food is the bottleneck resource: roughly 45% of workers need a farm or bush.
  if (f.foodSources < Math.ceil(f.villagers * 0.45)) builds.push(f.has.mill ? 'farm' : 'mill');
  // Drop sites shorten every gathering trip; the Architect builds them first.
  if (persona === 'architect' && f.villagers >= 5) {
    const site = (['lumber_camp', 'mill', 'mining_camp'] as const).find((type) => !f.has[type]);
    if (site) builds.unshift(site);
  }
  // The next layer's building unlocks everything after it, so it gets the first site.
  if (wantsAge && f.ageBuildingNeeded) builds.unshift(f.ageBuildingNeeded);
  if (persona !== 'sentinel' && wantTower) builds.push('watch_tower');
  if (persona === 'sentinel' && f.age >= 2 && !f.has.archery_range && f.has.barracks) builds.push('archery_range');
  const slots = Math.max(0, 2 - f.structuresInProgress);
  for (const building of [...new Set(builds)].slice(0, slots)) out.push({ kind: 'build', building });
  let trained = 0;
  // Saving for the next age: hold military spending once a minimum army stands.
  const saving = wantsAge && f.ageReady && !f.canAdvance && f.military >= Math.max(4, d.ageArmy * 2) && !f.underAttack;
  if (!saving && (f.military < militaryShare || f.underAttack)) {
    for (const unit of d.units) {
      const at = TRAINED_AT[unit];
      for (const producer of f.producers) {
        if (trained >= d.perCycle) break;
        if (producer.type !== at || producer.queue >= 2) continue;
        out.push({ kind: 'train', buildingId: producer.id, unit });
        trained++;
      }
    }
  }
  return out;
}
