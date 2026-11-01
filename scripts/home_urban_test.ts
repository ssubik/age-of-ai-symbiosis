// Urban planning at Home: roads are no-build, resources and bot bases keep off
// them, /perfectbase fills every plot of the whole map, and published snapshots
// stay a raidable core with a deployment band.
import assert from 'node:assert/strict';
import type { BuildingType, ServerMessage } from '../shared/src';
import { BUILDING_DEFS, MAP_SIZE } from '../shared/src/constants';
import { footprintOnRoad, isRoadTile, urbanPlanForHub, urbanPlots } from '../shared/src/urban';
import { Game } from '../server/src/game/room';
import { botSnapshot, deployZone } from '../server/src/raid/snapshot';

const member = { id: 4, name: 'Planner', color: '#39c6e8' };
const errors: string[] = [];
const game = new Game([member], (_id, m: ServerMessage) => { if (m.type === 'error') errors.push(m.code); }, () => undefined,
  'normal', 'classic', 'symbiosis', 'f'.repeat(64), { session: 'home' });
const internals = game as unknown as { step(): void };
const hub = [...game.buildings.values()].find((b) => b.type === 'town_center')!;
const plan = urbanPlanForHub(hub.tileX, hub.tileY);

// Geometry: the Hub sits inside a plot; every plot is a clean 7×7 interior.
assert.equal(footprintOnRoad(plan, hub.tileX, hub.tileY, 3), false, 'Hub is inside a plot');
for (const plot of urbanPlots(plan, MAP_SIZE)) assert.equal(footprintOnRoad(plan, plot.x, plot.y, 7), false, 'plots are road-free');

// Map generation and bootstrap respect roads.
for (const n of game.nodes.values()) assert.ok(!isRoadTile(plan, n.tileX, n.tileY), `resource on road at ${n.tileX},${n.tileY}`);
for (const b of game.buildings.values()) assert.ok(!footprintOnRoad(plan, b.tileX, b.tileY, BUILDING_DEFS[b.type].size), `${b.type} on road`);

// Placement: a road site is rejected with a clear reason; a plot site is accepted.
game.players.get(member.id)!.resources = { energy: 9000, alloys: 18000, compute: 9000 };
const robot = [...game.units.values()].find((u) => u.type === 'robot')!;
const roadX = plan.originX + 18; // a road column two blocks away
const before = game.buildings.size;
game.enqueueCommand(member.id, { kind: 'build', unitIds: [robot.id], building: 'house', tileX: roadX, tileY: hub.tileY + 10 });
internals.step();
assert.equal(game.buildings.size, before, 'house on a road is refused');
assert.ok(errors.includes('err.on_road'), 'player is told why');
game.enqueueCommand(member.id, { kind: 'build', unitIds: [robot.id], building: 'wall', tileX: roadX + 1, tileY: hub.tileY + 3 });
internals.step();
assert.equal(game.buildings.size, before, 'walls are refused on roads too');
// A free plot on the Hub's row, two blocks east (clear of bootstrap buildings and resources).
const plot = urbanPlots(plan, MAP_SIZE).find((p) => p.x >= hub.tileX + 12 && p.y <= hub.tileY && p.y + 7 > hub.tileY
  && ![...game.nodes.values()].some((n) => n.tileX >= p.x && n.tileX < p.x + 7 && n.tileY >= p.y && n.tileY < p.y + 7))!;
assert.ok(plot, 'a free plot exists on the Hub row');
game.enqueueCommand(member.id, { kind: 'build', unitIds: [robot.id], building: 'house', tileX: plot.x + 1, tileY: plot.y + 1 });
internals.step();
assert.equal(game.buildings.size, before + 1, 'house inside a plot is accepted');

// /perfectbase fills the whole map, still obeying the plan.
const msg = game.devCommand(member.id, '/perfectbase');
assert.match(msg, /Perfect city ready/);
const all = [...game.buildings.values()];
for (const b of all) assert.ok(!footprintOnRoad(plan, b.tileX, b.tileY, BUILDING_DEFS[b.type].size), `perfect city put ${b.type} on a road`);
const xs = all.map((b) => b.tileX); const ys = all.map((b) => b.tileY);
assert.ok(Math.min(...xs) < 15 && Math.max(...xs) > MAP_SIZE - 20, 'city spans the map horizontally');
assert.ok(Math.min(...ys) < 15 && Math.max(...ys) > MAP_SIZE - 20, 'city spans the map vertically');
const plots = urbanPlots(plan, MAP_SIZE);
const used = plots.filter((p) => all.some((b) => b.tileX >= p.x && b.tileX < p.x + 7 && b.tileY >= p.y && b.tileY < p.y + 7));
assert.ok(used.length / plots.length > 0.9, `most plots built (${used.length}/${plots.length})`);
assert.equal(game.players.get(member.id)!.age, 5);
const types = new Set<BuildingType>(all.map((b) => b.type));
for (const t of ['drone_factory', 'army_camp', 'mill', 'house', 'anti_air', 'solar_array'] as BuildingType[]) assert.ok(types.has(t), `zone includes ${t}`);

// The published snapshot is the raidable core, with a real deployment band.
const snap = game.captureDefenseSnapshot("Planner's City", 'k'.repeat(64))!;
assert.ok(snap.buildings.length > 20 && snap.buildings.length < all.length, `core snapshot (${snap.buildings.length} of ${all.length})`);
const zone = deployZone(snap);
assert.ok(zone.x0 < zone.ix0 && zone.x1 > zone.ix1 && zone.y0 < zone.iy0 && zone.y1 > zone.iy1, 'deployment band exists');

// Bot outposts follow the same plan around their own Hub.
for (let level = 1; level <= 5; level++) {
  const bot = botSnapshot(777 + level, level);
  const bh = bot.buildings.find((b) => b.type === 'town_center')!;
  const bp = urbanPlanForHub(bh.tileX, bh.tileY);
  for (const b of bot.buildings) assert.ok(!footprintOnRoad(bp, b.tileX, b.tileY, BUILDING_DEFS[b.type].size), `bot L${level} ${b.type} on road`);
}
console.log(`home urban planning: ok (${all.length} buildings, ${used.length}/${plots.length} plots)`);
