import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BUILDING_DEFS } from '../shared/src/constants';
import { Game } from '../server/src/game/room';
import { JsonHomeRepository } from '../server/src/home/repository';
import type { Building } from '../server/src/game/state';

async function main(): Promise<void> {
let clock = 1_800_000_000_000;
const profileId = 'a'.repeat(64);
const member = { id: 7, name: 'Builder', color: '#39c6e8' };
const game = new Game([member], () => undefined, () => undefined, 'normal', 'classic', 'symbiosis', profileId, {
  session: 'home', now: () => clock,
});
const internals = game as unknown as {
  step(): void;
  nextId: number;
  validFootprint(x: number, y: number, size: number): boolean;
  blockFootprint(x: number, y: number, size: number): void;
};

assert.equal(game.homeMode, true);
assert.deepEqual([...game.units.values()].map((u) => u.type).sort(), ['designer', 'drone', 'robot']);
assert.ok([...game.buildings.values()].some((b) => b.type === 'mill' && b.progress === 1));
const civicHub = [...game.buildings.values()].find((b) => b.type === 'town_center');
assert.ok(civicHub);
assert.ok(Math.abs(civicHub!.tileX + BUILDING_DEFS.town_center.size / 2 - game.grid.size / 2) <= 1, 'new Home hub is centered in the urban district');
assert.ok([...game.nodes.values()].every((node) => Math.max(Math.abs(node.tileX - game.grid.size / 2), Math.abs(node.tileY - game.grid.size / 2)) >= 10), 'engineered resources preserve a clear construction core');

function freeSite(size: number): { x: number; y: number } {
  for (let y = 2; y < game.grid.size - size - 2; y++) {
    for (let x = 2; x < game.grid.size - size - 2; x++) if (internals.validFootprint(x, y, size)) return { x, y };
  }
  throw new Error('no free construction site');
}

const solarSite = freeSite(BUILDING_DEFS.solar_array.size);
const solar: Building = {
  id: internals.nextId++, owner: member.id, type: 'solar_array', tileX: solarSite.x, tileY: solarSite.y,
  hp: 22, progress: 0, queue: [],
};
game.buildings.set(solar.id, solar);
internals.blockFootprint(solar.tileX, solar.tileY, BUILDING_DEFS.solar_array.size);
for (let i = 0; i < 20; i++) internals.step();
assert.equal(solar.progress, 0, 'an unassigned site must never build itself');

const robot = [...game.units.values()].find((u) => u.type === 'robot');
assert.ok(robot);
game.enqueueCommand(member.id, { kind: 'build', unitIds: [robot!.id], building: 'solar_array', tileX: solar.tileX, tileY: solar.tileY });
for (let i = 0; i < 1_200 && solar.progress === 0; i++) internals.step();
assert.ok(solar.progress > 0, 'the physical robot must travel to and advance the site');
game.enqueueCommand(member.id, { kind: 'stop', unitIds: [robot!.id] });
internals.step();
const pausedSolarProgress = solar.progress;

const farmSite = freeSite(BUILDING_DEFS.farm.size);
const farm: Building = {
  id: internals.nextId++, owner: member.id, type: 'farm', tileX: farmSite.x, tileY: farmSite.y,
  hp: BUILDING_DEFS.farm.hp, progress: 1, queue: [], foodLeft: 0,
};
game.buildings.set(farm.id, farm);
internals.blockFootprint(farm.tileX, farm.tileY, BUILDING_DEFS.farm.size);
game.players.get(member.id)!.resources.energy = 0;

const temp = await mkdtemp(path.join(os.tmpdir(), 'age-home-'));
try {
  const repo = new JsonHomeRepository(temp);
  await repo.save(game.captureHomeState(profileId));
  const loaded = await repo.load(profileId);
  assert.ok(loaded.save);
  clock += 10 * 60 * 60 * 1000;
  const restored = new Game([member], () => undefined, () => undefined, 'normal', 'classic', 'symbiosis', profileId, {
    session: 'home', homeState: loaded.save!, now: () => clock,
  });
  assert.equal(restored.players.get(member.id)!.resources.energy, 1_600, 'offline production is capped at eight hours');
  assert.equal(restored.buildings.get(solar.id)!.progress, pausedSolarProgress, 'offline work requires an assigned builder');
  await repo.save(restored.captureHomeState(profileId));
  assert.ok((await repo.load(profileId)).save?.revision);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('home persistence: ok');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
