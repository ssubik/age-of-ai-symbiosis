// WATT Arena stewardship scoring. Pure accounting over authoritative state:
// nothing here feeds back into simulation rules or victory.
//
//   score = ELON standing + stewardship value + reliability recognition
//
// - Standing is earned by serving needs each cycle (plus labor and ages).
// - Stewardship counts each standing, completed facility once; it disappears
//   when the facility is destroyed or deleted.
// - Reliability is the share of declared need served across the whole match;
//   a perfect record is worth RELIABILITY_BONUS_MAX ELON.
import { BUILDING_DEFS } from '@age/shared';
import type { BuildingType, Resources, Standing } from '@age/shared';

export const RELIABILITY_BONUS_MAX = 50;

/** Facility stewardship weight: a fixed share of its build cost. */
export function stewardshipValue(type: BuildingType): number {
  const cost = BUILDING_DEFS[type].cost as Partial<Resources>;
  const total = (cost.food ?? 0) + (cost.wood ?? 0) + (cost.gold ?? 0) + (cost.stone ?? 0);
  return Math.max(1, Math.ceil(total / 25));
}

export interface NeedSample {
  key: 'housing' | 'work' | 'power';
  declared: number;
  served: number;
  /** One ELON per this many units served. */
  perElon: number;
}

/** ELON earned for one cycle of need: at least 1 when fully met. */
export function needElon(n: NeedSample): number {
  if (n.declared <= 0) return 0;
  const met = n.served >= n.declared;
  return Math.max(met ? 1 : 0, Math.floor(n.served / n.perElon));
}

export function reliabilityPpm(served: number, declared: number): number {
  if (declared <= 0) return 1_000_000;
  return Math.min(1_000_000, Math.round((served / declared) * 1_000_000));
}

export function reliabilityBonus(ppm: number): number {
  return Math.round((ppm / 1_000_000) * RELIABILITY_BONUS_MAX * 100) / 100;
}

export function rankStandings(rows: Omit<Standing, 'rank'>[]): Standing[] {
  return [...rows]
    .sort((a, b) => b.score - a.score || a.playerId - b.playerId)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}
