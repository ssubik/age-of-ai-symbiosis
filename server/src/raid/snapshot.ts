import { createHash } from 'node:crypto';
import { BUILDING_DEFS, footprintOnRoad, HOME_MAX_LEVEL, MAP_SIZE, urbanPlanForHub } from '@age/shared';
import type { BuildingType, DefenseSnapshot, RaidDeployZone } from '@age/shared';

/** v2: building levels and Sensor Towers (Phase 4). v3: urban plan (no buildings on roads). */
export const SNAPSHOT_VERSION = 3;

/** Original bot outpost names; seeded so the same seed always names the same base. */
const NAMES = ['Kestrel', 'Basalt', 'Juniper', 'Cobalt', 'Meridian', 'Halcyon', 'Quarry', 'Vesper', 'Lumen', 'Talus'];

/** Structures per defender City Level, cumulative. Order is placement priority. */
const LEVEL_LAYOUT: readonly BuildingType[][] = [
  [],
  ['town_center', 'house', 'house', 'farm', 'mill', 'lumber_camp', 'watch_tower', 'point_turret'],
  ['robotics_workshop', 'solar_array', 'solar_array', 'anti_air', 'point_turret'],
  ['drone_factory', 'army_camp', 'watch_tower', 'anti_air', 'point_turret', 'mining_camp', 'sensor_tower'],
  ['wind_turbine', 'anti_air', 'point_turret', 'house', 'data_center'],
  ['point_turret', 'anti_air', 'watch_tower', 'design_studio'],
];

const DEFENSES: ReadonlySet<BuildingType> = new Set(['watch_tower', 'point_turret', 'anti_air']);

/** mulberry32: tiny deterministic PRNG for layout only (never used in combat). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function snapshotChecksum(snapshot: Omit<DefenseSnapshot, 'checksum'> | DefenseSnapshot): string {
  const { checksum: _ignored, ...body } = snapshot as DefenseSnapshot;
  void _ignored;
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export function verifySnapshot(snapshot: DefenseSnapshot): boolean {
  return snapshotChecksum(snapshot) === snapshot.checksum;
}

/** Deterministic, legal bot base for sparse matchmaking (spec §6.1). The Hub sits
 * at the map centre, the economy rings it and defenses take the outer ring. */
export function botSnapshot(seed: number, cityLevel: number): DefenseSnapshot {
  const level = Math.max(1, Math.min(5, Math.floor(cityLevel)));
  const level0 = level;
  const random = rng(seed);
  const types = LEVEL_LAYOUT.slice(1, level + 1).flat();
  const center = Math.floor(MAP_SIZE / 2);
  const occupied = new Set<number>();
  const key = (x: number, y: number) => y * MAP_SIZE + x;
  // A one-tile margin around every footprint keeps ground routes open.
  // The Hub is placed first at the centre; every later footprint keeps off its roads.
  const hubTile = center - Math.floor(BUILDING_DEFS.town_center.size / 2);
  const plan = urbanPlanForHub(hubTile, hubTile);
  const fits = (x: number, y: number, size: number) => {
    if (x < 2 || y < 2 || x + size > MAP_SIZE - 2 || y + size > MAP_SIZE - 2) return false;
    if (footprintOnRoad(plan, x, y, size)) return false;
    for (let dy = -1; dy <= size; dy++) for (let dx = -1; dx <= size; dx++) if (occupied.has(key(x + dx, y + dy))) return false;
    return true;
  };
  const claim = (x: number, y: number, size: number) => {
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) occupied.add(key(x + dx, y + dy));
  };

  const buildings: DefenseSnapshot['buildings'] = [];
  let nextId = 1000;
  for (const type of types) {
    const size = BUILDING_DEFS[type].size;
    // Defenses start further out so they screen the economy.
    const minRadius = type === 'town_center' ? 0 : DEFENSES.has(type) ? 6 : 3;
    const offset = Math.floor(random() * 8);
    let placed = false;
    for (let r = minRadius; r < 24 && !placed; r++) {
      const ring: { x: number; y: number }[] = [];
      for (let y = center - r; y <= center + r; y++) {
        for (let x = center - r; x <= center + r; x++) {
          if (Math.max(Math.abs(x - center), Math.abs(y - center)) === r) ring.push({ x, y });
        }
      }
      for (let i = 0; i < ring.length && !placed; i++) {
        const p = ring[(i + offset * Math.max(1, Math.floor(ring.length / 8))) % ring.length];
        const x = p.x - Math.floor(size / 2);
        const y = p.y - Math.floor(size / 2);
        if (!fits(x, y, size)) continue;
        claim(x, y, size);
        // From City Level 3, defenses and camps carry levels (capped by type).
        const level = Math.min(HOME_MAX_LEVEL[type] ?? 1, DEFENSES.has(type) || type === 'army_camp' ? Math.max(1, level0 - 1) : 1);
        buildings.push({ id: nextId++, type, tileX: x, tileY: y, ...(level > 1 ? { level } : {}) });
        placed = true;
      }
    }
    if (!placed) throw new Error(`bot layout could not place ${type}`);
  }

  // A sparse grove for depth; trees never sit on the margin around structures.
  const trees: DefenseSnapshot['trees'] = [];
  for (let i = 0; i < 18; i++) {
    const angle = random() * Math.PI * 2;
    const dist = 13 + random() * 6;
    const x = Math.round(center + Math.cos(angle) * dist);
    const y = Math.round(center + Math.sin(angle) * dist);
    if (!fits(x, y, 1)) continue;
    claim(x, y, 1);
    trees.push({ id: nextId++, tileX: x, tileY: y });
  }

  const body: Omit<DefenseSnapshot, 'checksum'> = {
    id: `bot-v${SNAPSHOT_VERSION}-l${level}-${(seed >>> 0).toString(16)}`,
    version: SNAPSHOT_VERSION,
    kind: 'bot',
    label: `${NAMES[seed % NAMES.length]} Outpost`,
    cityLevel: level,
    seed: seed >>> 0,
    buildings,
    trees,
  };
  return { ...body, checksum: snapshotChecksum(body) };
}

/** Perimeter band around the base footprint where troops may be placed. */
export function deployZone(snapshot: DefenseSnapshot): RaidDeployZone {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const b of snapshot.buildings) {
    const size = BUILDING_DEFS[b.type].size;
    minX = Math.min(minX, b.tileX); minY = Math.min(minY, b.tileY);
    maxX = Math.max(maxX, b.tileX + size); maxY = Math.max(maxY, b.tileY + size);
  }
  const clamp = (v: number) => Math.max(1, Math.min(MAP_SIZE - 2, v));
  return {
    ix0: clamp(minX - 3), iy0: clamp(minY - 3), ix1: clamp(maxX + 3), iy1: clamp(maxY + 3),
    x0: clamp(minX - 10), y0: clamp(minY - 10), x1: clamp(maxX + 10), y1: clamp(maxY + 10),
  };
}

export function inDeployZone(zone: RaidDeployZone, x: number, y: number): boolean {
  const inOuter = x >= zone.x0 && x < zone.x1 && y >= zone.y0 && y < zone.y1;
  const inInner = x >= zone.ix0 && x < zone.ix1 && y >= zone.iy0 && y < zone.iy1;
  return inOuter && !inInner;
}
