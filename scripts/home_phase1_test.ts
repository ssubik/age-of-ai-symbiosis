// Phase 1 exit path for the persistent Home (master spec §10): lawful unlocks,
// physical construction, Hub L1->L2, Drone Factory, restart without duplication,
// multi-builder aggregation and one live session per profile.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BuildingType, ServerMessage } from '../shared/src';
import { AGE_COSTS, BUILD_RATE, BUILDING_DEFS } from '../shared/src/constants';
import { Game } from '../server/src/game/room';
import { HomeManager } from '../server/src/home/manager';
import { JsonHomeRepository } from '../server/src/home/repository';
import type { Building } from '../server/src/game/state';
import type { HomeSaveV1 } from '../server/src/home/types';

type Internals = {
  step(): void;
  nextId: number;
  validFootprint(x: number, y: number, size: number): boolean;
  blockFootprint(x: number, y: number, size: number): void;
  developmentPointsOf(playerId: number): number;
};

const member = { id: 3, name: 'Phase One', color: '#39c6e8' };
const profileId = 'b'.repeat(64);
let clock = 1_900_000_000_000;

function newHome(homeState?: HomeSaveV1): Game {
  return new Game([member], () => undefined, () => undefined, 'normal', 'classic', 'symbiosis', profileId, {
    session: 'home', homeState, now: () => clock,
  });
}

function hubOf(game: Game): Building {
  const hub = [...game.buildings.values()].find((b) => b.type === 'town_center');
  assert.ok(hub);
  return hub!;
}

/** Nearest legal footprint around the Hub, so builders have a short real path. */
function siteNearHub(game: Game, type: BuildingType): { x: number; y: number } {
  const internals = game as unknown as Internals;
  const hub = hubOf(game);
  const size = BUILDING_DEFS[type].size;
  for (let r = 4; r < 30; r++) {
    for (let y = hub.tileY - r; y <= hub.tileY + r; y++) {
      for (let x = hub.tileX - r; x <= hub.tileX + r; x++) {
        if (Math.max(Math.abs(x - hub.tileX), Math.abs(y - hub.tileY)) !== r) continue;
        // Leave a one-tile margin so footprints never seal a builder in.
        if (internals.validFootprint(x - 1, y - 1, size + 2)) return { x, y };
      }
    }
  }
  throw new Error(`no site for ${type}`);
}

function builders(game: Game): number[] {
  return [...game.units.values()].filter((u) => u.owner === member.id).map((u) => u.id);
}

function buildAndFinish(game: Game, type: BuildingType): Building {
  const internals = game as unknown as Internals;
  const site = siteNearHub(game, type);
  const before = new Set(game.buildings.keys());
  game.enqueueCommand(member.id, { kind: 'build', unitIds: builders(game), building: type, tileX: site.x, tileY: site.y });
  internals.step();
  const placed = [...game.buildings.values()].find((b) => !before.has(b.id));
  assert.ok(placed, `${type} must be placed`);
  for (let i = 0; i < 6_000 && placed!.progress < 1; i++) internals.step();
  assert.equal(placed!.progress, 1, `${type} must be completed by physical builders`);
  return placed!;
}

function stepUntil(game: Game, done: () => boolean, max = 6_000): void {
  const internals = game as unknown as Internals;
  for (let i = 0; i < max && !done(); i++) internals.step();
  assert.ok(done(), 'condition not reached in time');
}

async function exitPath(): Promise<void> {
  const game = newHome();
  const internals = game as unknown as Internals;
  const player = game.players.get(member.id)!;
  assert.equal(player.age, 1, 'new profile starts at City Level 1');
  player.resources = { food: 3_000, wood: 3_000, gold: 3_000, stone: 3_000 };

  // Drone Factory is not legal at Level 1.
  const factorySite = siteNearHub(game, 'drone_factory');
  const count = game.buildings.size;
  game.enqueueCommand(member.id, { kind: 'build', unitIds: builders(game), building: 'drone_factory', tileX: factorySite.x, tileY: factorySite.y });
  internals.step();
  assert.equal(game.buildings.size, count, 'Drone Factory must be locked at City Level 1');

  // Hub refuses to upgrade from unfinished prerequisites.
  game.enqueueCommand(member.id, { kind: 'advanceAge' });
  internals.step();
  assert.equal(hubOf(game).upgradeTargetLevel, undefined, 'Hub cannot upgrade without workshop and generator');

  // Wall spam is capped in development value.
  const base = internals.developmentPointsOf(member.id);
  for (let i = 0; i < 80; i++) {
    const id = internals.nextId++;
    game.buildings.set(id, { id, owner: member.id, type: 'wall', tileX: 0, tileY: 0, hp: 1, progress: 1, queue: [] });
  }
  assert.equal(internals.developmentPointsOf(member.id), base + 50, 'wall development is capped');
  for (const [id, b] of game.buildings) if (b.type === 'wall') game.buildings.delete(id);

  buildAndFinish(game, 'robotics_workshop');
  buildAndFinish(game, 'solar_array');

  // Hub L1 -> L2 is a physical construction project; cost is paid exactly once.
  const foodBefore = player.resources.food;
  game.enqueueCommand(member.id, { kind: 'advanceAge' });
  internals.step();
  const hub = hubOf(game);
  assert.equal(hub.upgradeTargetLevel, 2, 'Hub upgrade starts');
  assert.equal(player.age, 1, 'level does not change before the upgrade is built');
  game.enqueueCommand(member.id, { kind: 'advanceAge' });
  internals.step();
  const paid = foodBefore - player.resources.food;
  assert.ok(Math.abs(paid - (AGE_COSTS[2]!.food ?? 0)) < 5, `Hub upgrade cost deducted once (paid ${paid})`);
  assert.equal(hub.progress, 1, 'the Hub keeps working while it upgrades');
  stepUntil(game, () => player.age === 2);
  assert.equal(hub.level, 2);
  assert.equal(player.age, 2, 'City Level 2 after Hub construction completes');
  assert.equal(hub.upgradeTargetLevel, undefined);

  const factory = buildAndFinish(game, 'drone_factory');

  // Quit and relaunch at the same instant: exact resources, sites and buildings.
  const temp = await mkdtemp(path.join(os.tmpdir(), 'age-home-p1-'));
  try {
    const repo = new JsonHomeRepository(temp);
    await repo.save(game.captureHomeState(profileId));
    const restored = newHome((await repo.load(profileId)).save!);
    const p2 = restored.players.get(member.id)!;
    assert.equal(p2.age, 2);
    assert.deepEqual(p2.resources, player.resources, 'resources identical after relaunch');
    assert.deepEqual(
      [...restored.buildings.values()].map((b) => [b.id, b.type, b.tileX, b.tileY, b.progress]).sort(),
      [...game.buildings.values()].map((b) => [b.id, b.type, b.tileX, b.tileY, b.progress]).sort(),
      'buildings identical after relaunch',
    );
    assert.equal(restored.buildings.get(factory.id)?.type, 'drone_factory');
    assert.equal(
      [...restored.buildings.values()].filter((b) => b.type === 'town_center').length, 1,
      'no duplicated Hub after relaunch',
    );
    restored.enqueueCommand(member.id, { kind: 'advanceAge' });
    (restored as unknown as Internals).step();
    assert.equal(p2.age, 2, 'L2 does not re-complete or advance further from Phase 1');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function multiBuilderRate(): void {
  const game = newHome();
  const internals = game as unknown as Internals;
  game.players.get(member.id)!.resources = { food: 3_000, wood: 3_000, gold: 3_000, stone: 3_000 };
  const units = [...game.units.values()];
  const robot = units.find((u) => u.type === 'robot')!;
  const drone = units.find((u) => u.type === 'drone')!;
  const site = siteNearHub(game, 'house');
  game.enqueueCommand(member.id, { kind: 'build', unitIds: [robot.id, drone.id], building: 'house', tileX: site.x, tileY: site.y });
  internals.step();
  const house = [...game.buildings.values()].find((b) => b.type === 'house' && b.progress < 1)!;
  stepUntil(game, () => robot.state === 'building' && drone.state === 'building');
  const before = house.progress;
  internals.step();
  const delta = house.progress - before;
  assert.ok(delta > 0, 'arrived builders work');
  // Both draw power identically, so the shared efficiency factor cancels in the ratio.
  const expected = (BUILD_RATE.robot! + 0.6 * BUILD_RATE.drone!) / BUILD_RATE.robot!;
  game.enqueueCommand(member.id, { kind: 'stop', unitIds: [drone.id] });
  internals.step();
  const soloBefore = house.progress;
  internals.step();
  const soloDelta = house.progress - soloBefore;
  assert.ok(Math.abs(delta / soloDelta - expected) < 1e-6, `aggregate/solo ratio ${delta / soloDelta} must equal ${expected}`);
}

async function singleSessionPerProfile(): Promise<void> {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'age-home-mgr-'));
  try {
    const manager = new HomeManager(new JsonHomeRepository(temp));
    const inbox = new Map<number, ServerMessage[]>([[1, []], [2, []]]);
    const conn = (id: number) => ({ id, name: 'Tab', color: '#fff', clientId: 'same-browser', send: (m: ServerMessage) => inbox.get(id)!.push(m) });
    await Promise.all([manager.enter(conn(1)), manager.enter(conn(2))]);
    assert.equal(manager.has(1), false, 'older tab is closed');
    assert.equal(manager.has(2), true, 'newer tab owns the Home');
    assert.ok(inbox.get(1)!.some((m) => m.type === 'leftRoom'), 'older tab is told to leave');
    await manager.leave(2);
    assert.equal(manager.has(2), false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await exitPath();
  multiBuilderRate();
  await singleSessionPerProfile();
  console.log('home phase 1: ok');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
