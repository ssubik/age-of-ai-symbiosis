// Raid domain rules shared by the live HomeManager flow, restart recovery and
// tests. Every function mutates only the Home `Game` and its raid ledger, so
// the next Home save captures the whole transaction atomically.
import { createHash } from 'node:crypto';
import {
  canRaidTransition,
  HOME_SHIELD_HOURS,
  RAID_TROPHY_TOLERANCES,
  RAID_DURATION_SECONDS,
  RAID_LOSS_REWARD_SHARE,
  RAID_REWARD_BY_LEVEL,
  RAID_RULES_VERSION,
  RAID_SCOUT_TTL_SECONDS,
  RAID_TROPHIES,
  TICK_MS,
} from '@age/shared';
import type { RaidArmy, RaidOutcome, RaidReplay, RaidReport, RaidSessionState, Resources } from '@age/shared';
import type { Game } from '../game/room';
import type { RaidSessionRecord } from '../home/types';
import type { PublishedDefense } from './registry';
import { botSnapshot, verifySnapshot } from './snapshot';
import { simulateRaid } from './sim';

export class RaidTransitionError extends Error {
  constructor(from: RaidSessionState, to: RaidSessionState) {
    super(`illegal raid transition ${from} -> ${to}`);
  }
}

export function transition(record: RaidSessionRecord, to: RaidSessionState): void {
  if (!canRaidTransition(record.state, to)) throw new RaidTransitionError(record.state, to);
  record.state = to;
}

export function emptyArmy(): RaidArmy {
  return { attack_drone: 0, fighter: 0, rocket_launcher: 0, siege_mech: 0, stealth_bomber: 0, plasma_tank: 0, iron_guardian: 0, aegis_valkyrie: 0 };
}

function seedFor(profileId: string, counter: number): number {
  return createHash('sha256').update(`age-of-ai-raid:v1:${profileId}:${counter}`).digest().readUInt32BE(0);
}

/** Spec §6.1 matchmaking: City Level ±1, unshielded, trophy tolerance widening
 *  step by step; deterministic pick by seed. Null means "use a bot". */
export function pickOpponent(entries: PublishedDefense[], profileId: string, level: number, trophies: number, now: number, seed: number): PublishedDefense | null {
  const eligible = entries
    .filter((e) => e.profileId !== profileId && Math.abs(e.cityLevel - level) <= 1 && e.shieldUntil <= now && verifySnapshot(e.snapshot))
    .sort((a, z) => (a.profileId < z.profileId ? -1 : a.profileId > z.profileId ? 1 : 0));
  for (const tolerance of RAID_TROPHY_TOLERANCES) {
    const pool = eligible.filter((e) => Math.abs(e.trophies - trophies) <= tolerance);
    if (pool.length) return pool[seed % pool.length];
  }
  return null;
}

/** A fresh scout offer: a published player defense when one fits, otherwise a
 *  deterministic bot base within ±1 City Level (spec §6.1). */
export function newRaidRecord(home: Game, profileId: string, now: number, published: PublishedDefense[] = []): RaidSessionRecord {
  const counter = home.raidData.scoutCounter++;
  const seed = seedFor(profileId, counter);
  const opponent = pickOpponent(published, profileId, home.homeLevel, home.raidData.trophies, now, seed);
  const level = opponent ? opponent.snapshot.cityLevel : Math.max(1, Math.min(5, home.homeLevel + (seed % 3) - 1));
  return {
    id: `${profileId.slice(0, 12)}-${counter}`,
    state: 'SCOUTING',
    rulesVersion: RAID_RULES_VERSION,
    createdAt: now,
    snapshot: opponent ? structuredClone(opponent.snapshot) : botSnapshot(seed, level),
    ...(opponent ? { defenderProfileId: opponent.profileId } : {}),
    offer: {
      reward: { ...RAID_REWARD_BY_LEVEL[level] },
      trophiesWin: RAID_TROPHIES.win,
      trophiesLoss: RAID_TROPHIES.loss,
      expiresAt: now + RAID_SCOUT_TTL_SECONDS * 1000,
    },
    reserved: [],
    reservedArmy: emptyArmy(),
    research: {},
    deploys: [],
  };
}

export function ticksUntil(deadline: number, now: number): number {
  return Math.max(0, Math.floor((deadline - now) / TICK_MS));
}

export function reserveDeadline(now: number): number {
  return now + RAID_DURATION_SECONDS * 1000;
}

export function replayOf(record: RaidSessionRecord): RaidReplay {
  return {
    rulesVersion: record.rulesVersion,
    snapshotId: record.snapshot.id,
    snapshotChecksum: record.snapshot.checksum,
    maxTicks: record.maxTicks ?? 0,
    reserved: { ...record.reservedArmy },
    research: { ...record.research },
    deploys: record.deploys.map((d) => ({ ...d })),
    ...(record.surrenderAt !== undefined ? { surrenderAt: record.surrenderAt } : {}),
  };
}

/** Bounded, system-funded reward from the pinned offer (spec §6.5): scales with
 *  destruction; a zero-star raid earns RAID_LOSS_REWARD_SHARE of that. */
export function rewardFor(offer: Resources, outcome: RaidOutcome): Resources {
  const scale = (outcome.destruction / 100) * (outcome.stars > 0 ? 1 : RAID_LOSS_REWARD_SHARE);
  return { energy: Math.floor(offer.energy * scale), alloys: Math.floor(offer.alloys * scale), compute: Math.floor(offer.compute * scale) };
}

/** Applies a finished raid to Home exactly once. Re-running it for an already
 *  settled key returns the stored report and changes nothing. */
export function settleRaid(home: Game, record: RaidSessionRecord, now: number): RaidReport {
  const existing = home.raidData.reports.find((r) => r.raidId === record.id);
  if (home.raidData.settled.includes(record.id) && existing) {
    if (record.state === 'SETTLING') transition(record, 'SETTLED');
    if (home.raidData.active?.id === record.id) home.raidData.active = null;
    return existing;
  }
  if (record.state !== 'SETTLING' || !record.outcome) throw new Error(`raid ${record.id} is not ready to settle`);
  const outcome = record.outcome;
  // Undeployed reserved troops come home; deployed ones were consumed at deploy time.
  const returned = record.reserved.length;
  home.returnFromRaid(record.reserved);
  record.reserved = [];
  const earned = rewardFor(record.offer.reward, outcome);
  const reward = home.grantRaidReward(earned);
  const before = home.raidData.trophies;
  const delta = outcome.stars > 0
    ? Math.max(1, Math.round((record.offer.trophiesWin * outcome.stars) / 3))
    : -record.offer.trophiesLoss;
  home.raidData.trophies = Math.max(0, before + delta);
  const report: RaidReport = {
    raidId: record.id,
    label: record.snapshot.label,
    cityLevel: record.snapshot.cityLevel,
    stars: outcome.stars,
    destruction: outcome.destruction,
    reason: outcome.reason,
    reward,
    earned,
    trophiesDelta: home.raidData.trophies - before,
    deployed: record.deploys.length,
    returned,
    settledAt: now,
    outcomeChecksum: outcome.checksum,
    replay: replayOf(record),
  };
  home.recordRaidSettlement(record.id, report);
  home.markMilestone('firstRaid');
  home.recordHomeEvent('raid', `Raid on ${report.label}: ${report.stars}★ ${report.destruction}%`,
    report.reward.energy + report.reward.alloys + report.reward.compute);
  // A player defender learns about it (and gets a shield) via the outbox, in
  // this same atomic save; delivery is retried until it lands (spec §6.6).
  if (record.defenderProfileId) {
    const hours = HOME_SHIELD_HOURS[outcome.stars] ?? 0;
    home.raidData.outbox.push({
      defenderProfileId: record.defenderProfileId,
      report: {
        raidId: record.id, attacker: home.homeName, stars: outcome.stars, destruction: outcome.destruction,
        attackerReward: { ...reward }, shieldSeconds: hours * 3600, at: now,
      },
      shieldUntil: hours > 0 ? now + hours * 3_600_000 : 0,
    });
  }
  transition(record, 'SETTLED');
  if (home.raidData.active?.id === record.id) home.raidData.active = null;
  return report;
}

/** Ends a raid that never deployed: every reserved unit goes home. */
export function abandonBeforeDeploy(home: Game, record: RaidSessionRecord, to: 'CANCELLED_BEFORE_DEPLOY' | 'SCOUT_EXPIRED'): void {
  transition(record, to);
  home.returnFromRaid(record.reserved);
  record.reserved = [];
  if (home.raidData.active?.id === record.id) home.raidData.active = null;
}

/** Outcome for an interrupted raid. A snapshot that fails verification cannot
 *  be replayed; it settles as a zero-destruction timeout so nothing is minted. */
function recoveredOutcome(record: RaidSessionRecord): RaidOutcome {
  try {
    return simulateRaid(record.snapshot, replayOf(record));
  } catch (error) {
    console.error(`[raid] ${record.id} could not be replayed; settling as no destruction`, error);
    return { endTick: record.maxTicks ?? 0, reason: 'timer', destruction: 0, stars: 0, hubDestroyed: false, checksum: 'unreplayable' };
  }
}

/** Brings any interrupted raid to a terminal state (disconnect or restart).
 *  In-progress raids finish by deterministic re-simulation of the recorded
 *  deployments, which is exactly what the live raid would have produced with
 *  no further input. Returns the report when a settlement happened. */
export function resolveInterrupted(home: Game, now: number, via: 'EXPIRED_DURING_RAID' | 'RECOVERY_REQUIRED'): RaidReport | null {
  const record = home.raidData.active;
  if (!record) return null;
  switch (record.state) {
    case 'SCOUTING':
      abandonBeforeDeploy(home, record, now > record.offer.expiresAt ? 'SCOUT_EXPIRED' : 'CANCELLED_BEFORE_DEPLOY');
      return null;
    case 'ARMY_RESERVED':
      abandonBeforeDeploy(home, record, 'CANCELLED_BEFORE_DEPLOY');
      return null;
    case 'IN_PROGRESS':
      transition(record, via);
      record.outcome ??= recoveredOutcome(record);
      transition(record, 'SETTLING');
      return settleRaid(home, record, now);
    case 'EXPIRED_DURING_RAID':
    case 'RECOVERY_REQUIRED':
      record.outcome ??= recoveredOutcome(record);
      transition(record, 'SETTLING');
      return settleRaid(home, record, now);
    case 'SETTLING':
      return settleRaid(home, record, now);
    default:
      home.raidData.active = null;
      return null;
  }
}
