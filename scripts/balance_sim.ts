// Progression simulator (Phase 5 tuning): a steady, sensible player grows a
// fresh city to City Level 5 using only the economy (no raid income). Time
// advances in fixed steps through the game's own offline catch-up, so a week
// of play runs in seconds. Prints when each level was reached.
//
// Usage: npx tsx scripts/balance_sim.ts [stepMinutes=10] [maxDays=30]
import type { BuildingType, Resources, ResourceType } from '../shared/src';
import {
  BUILDING_DEFS, HOME_BUILDING_CITY_LEVEL, HOME_CITY_LEVELS, HOME_MAX_LEVEL, HOME_PRODUCTION_PER_HOUR,
  homeResearchCost, homeUpgradeCost,
} from '../shared/src/constants';
import { Game } from '../server/src/game/room';
import type { HomeSave } from '../server/src/home/types';

const STEP_MIN = Number(process.argv[2] ?? 10);
const MAX_DAYS = Number(process.argv[3] ?? 30);
const member = { id: 1, name: 'Sim', color: '#39c6e8' };
const profile = '5'.repeat(64);
let clock = 2_400_000_000_000;
const start = clock;
const now = () => clock;

type G = Game & {
  step(): void; validFootprint(x: number, y: number, s: number): boolean;
  cityLevelBlockers(id: number, target: number): string[]; developmentPointsOf(id: number): number;
  powerOf(id: number): { supply: number; draw: number }; storageCapsOf(id: number): Resources;
};
const make = (homeState?: HomeSave) => new Game([member], () => undefined, () => undefined, 'normal', 'classic', 'symbiosis', profile, { session: 'home', homeState, now }) as G;

let g = make();
const P = () => g.players.get(member.id)!;
const mine = () => [...g.buildings.values()].filter((b) => b.owner === member.id);
const builders = () => [...g.units.values()].filter((u) => u.owner === member.id && ['designer', 'robot', 'drone'].includes(u.type)).map((u) => u.id);
const busy = () => mine().some((b) => b.progress < 1 || b.upgradeTargetLevel !== undefined);
const afford = (cost: Partial<Resources>) => (Object.entries(cost) as [ResourceType, number][]).every(([k, v]) => P().resources[k] >= v);
const cmd = (c: Parameters<Game['enqueueCommand']>[1]) => { g.enqueueCommand(member.id, c); g.step(); };

function site(type: BuildingType): { x: number; y: number } | null {
  const hub = mine().find((b) => b.type === 'town_center')!;
  const size = BUILDING_DEFS[type].size;
  for (let r = 3; r < 40; r++) {
    for (let y = hub.tileY - r; y <= hub.tileY + r; y++) {
      for (let x = hub.tileX - r; x <= hub.tileX + r; x++) {
        if (Math.max(Math.abs(x - hub.tileX), Math.abs(y - hub.tileY)) === r && g.validFootprint(x, y, size)) return { x, y };
      }
    }
  }
  return null;
}

/** Places a building if legal and affordable. */
function build(type: BuildingType): boolean {
  if (P().age < (HOME_BUILDING_CITY_LEVEL[type] ?? BUILDING_DEFS[type].ageReq)) return false;
  if (!afford(BUILDING_DEFS[type].cost)) return false;
  const s = site(type);
  if (!s) return false;
  cmd({ kind: 'build', unitIds: builders(), building: type, tileX: s.x, tileY: s.y });
  return true;
}

/** Upgrades the lowest-level building of a type, if allowed and affordable. */
function upgrade(type: BuildingType): boolean {
  const b = mine().filter((x) => x.type === type && x.progress >= 1).sort((a, z) => (a.level ?? 1) - (z.level ?? 1))[0];
  if (!b) return false;
  const next = (b.level ?? 1) + 1;
  if (next > (HOME_MAX_LEVEL[type] ?? 1) || next > P().age) return false;
  if (!afford(homeUpgradeCost(type, next))) return false;
  cmd({ kind: 'upgradeBuilding', buildingId: b.id });
  return mine().some((x) => x.upgradeTargetLevel !== undefined);
}

const PRODUCER: Record<ResourceType, BuildingType> = { energy: 'farm', alloys: 'lumber_camp', compute: 'mining_camp' };
const DEV_FILLERS: BuildingType[] = ['house', 'farm', 'mill', 'lumber_camp', 'mining_camp', 'solar_array', 'data_center', 'watch_tower', 'point_turret', 'sensor_tower', 'mech_forge', 'missile_foundry', 'aerospace_hangar'];

function act(): string {
  const p = P();
  const next = p.age + 1;
  if (next > 5) return 'done';
  // Research runs alongside construction.
  const req = HOME_CITY_LEVELS[next];
  if (req?.research && (g.progression.research[req.research.unit] ?? 0) < req.research.level && !g.progression.researching
    && afford(homeResearchCost(req.research.unit, (g.progression.research[req.research.unit] ?? 0) + 1))) {
    cmd({ kind: 'unitResearch', unit: req.research.unit });
  }
  if (busy()) return 'building';
  cmd({ kind: 'stop', unitIds: builders() });
  const blockers = g.cityLevelBlockers(member.id, next);
  if (blockers.length === 0) {
    if (afford(req.cost)) { cmd({ kind: 'advanceAge' }); return 'hub'; }
    return grow(req.cost) ? 'grow' : 'save';
  }
  for (const need of req.buildings) {
    const have = mine().filter((b) => need.types.includes(b.type) && b.progress >= 1);
    if (have.some((b) => (b.level ?? 1) >= need.level)) continue;
    const type = need.types[0];
    if (have.length === 0) return build(type) ? `build ${type}` : grow(BUILDING_DEFS[type].cost) ? 'grow' : 'save';
    return upgrade(have[0].type) ? `upgrade ${have[0].type}` : grow(homeUpgradeCost(have[0].type, (have[0].level ?? 1) + 1)) ? 'grow' : 'save';
  }
  const grid = g.powerOf(member.id);
  if (grid.supply < req.minSupply || grid.draw > grid.supply) return upgrade('solar_array') || build('solar_array') ? 'power' : 'save';
  if (blockers.some((b) => b.includes('development'))) {
    for (const t of DEV_FILLERS) if (!mine().some((b) => b.type === t) && build(t)) return `dev ${t}`;
    for (const t of DEV_FILLERS) if (upgrade(t)) return `dev+ ${t}`;
    return 'save';
  }
  return 'wait';
}

/** Adds production for the resource most short of `target`. */
function grow(target: Partial<Resources>): boolean {
  const p = P();
  const caps = g.storageCapsOf(member.id);
  const short = (Object.entries(target) as [ResourceType, number][])
    .map(([k, v]) => ({ k, gap: v - p.resources[k], overCap: v > caps[k] }))
    .filter((x) => x.gap > 0).sort((a, z) => z.gap - a.gap)[0];
  if (!short) return false;
  // Storage first if the goal does not even fit.
  if (short.overCap) return upgrade(PRODUCER[short.k]) || build(PRODUCER[short.k]);
  const type = PRODUCER[short.k];
  const count = mine().filter((b) => b.type === type).length;
  return count < 4 ? build(type) : upgrade(type);
}

function advance(minutes: number): void {
  const save = g.captureHomeState(profile);
  clock += minutes * 60_000;
  g = make(save);
}

const reached: Record<number, number> = {};
const actions = new Map<string, number>();
let lastLevel = P().age;
for (let i = 0; i < (MAX_DAYS * 24 * 60) / STEP_MIN; i++) {
  const a = act();
  if (a === 'done') break;
  actions.set(a.split(' ')[0], (actions.get(a.split(' ')[0]) ?? 0) + 1);
  advance(STEP_MIN);
  if (P().age > lastLevel) { lastLevel = P().age; reached[lastLevel] = (clock - start) / 3_600_000; }
}
const fmt = (h?: number) => (h === undefined ? 'not reached' : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);
console.log(`step ${STEP_MIN} min, horizon ${MAX_DAYS} days, economy only (no raid income)`);
for (let l = 2; l <= 5; l++) console.log(`City Level ${l}: ${fmt(reached[l])}`);
const p = P();
console.log(`final: L${p.age}, ${mine().length} buildings, dev ${g.developmentPointsOf(member.id)}, resources ${JSON.stringify(Object.fromEntries(Object.entries(p.resources).map(([k, v]) => [k, Math.round(v)])))}`);
console.log(`hourly production: ${JSON.stringify((() => { const r: Record<string, number> = {}; for (const b of mine()) for (const [k, v] of Object.entries(HOME_PRODUCTION_PER_HOUR[b.type] ?? {})) r[k] = (r[k] ?? 0) + (v as number) * (1 + 0.5 * ((b.level ?? 1) - 1)); return r; })())}`);
console.log(`steps by action: ${[...actions].map(([k, v]) => `${k}=${v}`).join(' ')}`);
