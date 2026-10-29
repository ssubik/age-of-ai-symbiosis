// Phase 2 for the persistent Home (master spec §5, §10, §11): Drone Factory
// queue, resource payment once, cancel refunds, Army Camp capacity blocking,
// physical departure/docking, and restart/offline queue work without duplicates.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BuildingType, Resources } from '../shared/src';
import { BUILDING_DEFS, HOME_CAMP_SPACE, UNIT_DEFS } from '../shared/src/constants';
import { Game } from '../server/src/game/room';
import { JsonHomeRepository } from '../server/src/home/repository';
import { createUnit, type Building } from '../server/src/game/state';
import type { HomeSaveV1 } from '../server/src/home/types';

type Internals = {
  step(): void;
  nextId: number;
  validFootprint(x: number, y: number, size: number): boolean;
  blockFootprint(x: number, y: number, size: number): void;
  armyUsedOf(playerId: number): number;
  armyCapacityOf(playerId: number): number;
  popOf(playerId: number): number;
};

const member = { id: 5, name: 'Phase Two', color: '#39c6e8' };
const profileId = 'c'.repeat(64);
const rich: Resources = { food: 1_500, wood: 1_500, gold: 1_400, stone: 1_400 };
const droneCost = UNIT_DEFS.attack_drone.cost;
let clock = 2_000_000_000_000;

function newHome(homeState?: HomeSaveV1): Game {
  return new Game([member], () => undefined, () => undefined, 'normal', 'classic', 'symbiosis', profileId, {
    session: 'home', homeState, now: () => clock,
  });
}

const io = (game: Game) => game as unknown as Internals;

/** Places a completed building next to the Hub (setup only; Phase 1 covers construction). */
function addCompleted(game: Game, type: BuildingType): Building {
  const hub = [...game.buildings.values()].find((b) => b.type === 'town_center')!;
  const size = BUILDING_DEFS[type].size;
  for (let r = 4; r < 40; r++) {
    for (let y = hub.tileY - r; y <= hub.tileY + r; y++) {
      for (let x = hub.tileX - r; x <= hub.tileX + r; x++) {
        if (Math.max(Math.abs(x - hub.tileX), Math.abs(y - hub.tileY)) !== r) continue;
        if (!io(game).validFootprint(x - 1, y - 1, size + 2)) continue;
        const b: Building = { id: io(game).nextId++, owner: member.id, type, tileX: x, tileY: y, hp: BUILDING_DEFS[type].hp, progress: 1, queue: [] };
        game.buildings.set(b.id, b);
        io(game).blockFootprint(x, y, size);
        return b;
      }
    }
  }
  throw new Error(`no site for ${type}`);
}

/** City Level 2 with a powered Drone Factory, as Phase 1 leaves it. */
function levelTwoHome(): { game: Game; factory: Building } {
  const game = newHome();
  const player = game.players.get(member.id)!;
  player.age = 2;
  player.resources = { ...rich };
  addCompleted(game, 'robotics_workshop');
  for (let i = 0; i < 4; i++) addCompleted(game, 'solar_array');
  return { game, factory: addCompleted(game, 'drone_factory') };
}

/** Passive Home production adds fractions each tick; payments and refunds are whole numbers. */
function near(actual: number, expected: number, message: string): void {
  assert.ok(Math.abs(actual - expected) < 1, `${message} (got ${actual}, expected ~${expected})`);
}

function drones(game: Game): number {
  return [...game.units.values()].filter((u) => u.type === 'attack_drone').length;
}

function stepUntil(game: Game, done: () => boolean, max = 4_000): void {
  for (let i = 0; i < max && !done(); i++) io(game).step();
  assert.ok(done(), 'condition not reached in time');
}

function train(game: Game, factory: Building, n = 1): void {
  for (let i = 0; i < n; i++) game.enqueueCommand(member.id, { kind: 'train', buildingId: factory.id, unit: 'attack_drone' });
  io(game).step();
}

function paymentAndBlocking(): void {
  const { game, factory } = levelTwoHome();
  const player = game.players.get(member.id)!;
  const elon = player.elonBalance;

  train(game, factory);
  assert.equal(factory.queue.length, 1);
  near(player.resources.wood, rich.wood - droneCost.wood!, 'wood deducted once at queue time');
  near(player.resources.gold, rich.gold - droneCost.gold!, 'gold deducted once at queue time');
  assert.ok(player.elonBalance >= elon, 'Home manufacturing never spends ELON');
  assert.deepEqual(factory.queue[0].paid, droneCost, 'payment recorded on the job');

  // No Army Camp: the finished unit waits inside the factory with an explicit reason.
  stepUntil(game, () => factory.trainBlocked !== undefined);
  assert.equal(factory.trainBlocked, 'no_camp');
  assert.equal(drones(game), 0, 'no unit exists while blocked');
  assert.equal(factory.queue.length, 1);
  const before = { ...player.resources };
  game.enqueueCommand(member.id, { kind: 'cancelTrain', buildingId: factory.id, index: 0 });
  io(game).step();
  assert.equal(factory.queue.length, 1, 'finished units cannot be cancelled');
  assert.ok(player.resources.wood <= before.wood + 1 && player.resources.gold <= before.gold + 1, 'no refund for finished units');

  // Building a camp unblocks the factory: the unit departs and docks physically.
  const camp = addCompleted(game, 'army_camp');
  io(game).step();
  assert.equal(factory.trainBlocked, undefined);
  assert.equal(factory.queue.length, 0);
  const drone = [...game.units.values()].find((u) => u.type === 'attack_drone')!;
  assert.ok(drone, 'unit created exactly once on release');
  const size = BUILDING_DEFS.army_camp.size;
  const nearCamp = () => drone.x >= camp.tileX - 2 && drone.x <= camp.tileX + size + 2 && drone.y >= camp.tileY - 2 && drone.y <= camp.tileY + size + 2;
  stepUntil(game, () => nearCamp() && drone.path.length === 0);

  // Combat units live in camps, not houses.
  const housing = io(game).popOf(member.id);
  assert.equal(housing, [...game.units.values()].filter((u) => u.type !== 'attack_drone').length, 'army does not use housing');

  // Fill the shared pool to capacity, then one more finished unit must block.
  const capacity = io(game).armyCapacityOf(member.id);
  assert.equal(capacity, BUILDING_DEFS.army_camp.armyCapacity);
  while (io(game).armyUsedOf(member.id) < capacity) {
    const id = io(game).nextId++;
    game.units.set(id, createUnit(id, member.id, 'attack_drone', camp.tileX - 1.5, camp.tileY + 0.5));
  }
  train(game, factory);
  stepUntil(game, () => factory.trainBlocked !== undefined);
  assert.equal(factory.trainBlocked, 'camp_full');
  for (let i = 0; i < 50; i++) io(game).step();
  assert.equal(io(game).armyUsedOf(member.id), capacity, 'camp capacity is never exceeded');
  assert.equal(HOME_CAMP_SPACE.attack_drone, 1);
}

function cancelRefunds(): void {
  const { game, factory } = levelTwoHome();
  const player = game.players.get(member.id)!;
  addCompleted(game, 'army_camp');
  train(game, factory, 2);
  for (let i = 0; i < 20; i++) io(game).step();
  assert.ok(factory.queue[0].progress > 0 && factory.queue[0].progress < 1, 'head job started');
  assert.equal(factory.queue[1].progress, 0, 'second job unstarted');
  const afterQueue = { ...player.resources };

  game.enqueueCommand(member.id, { kind: 'cancelTrain', buildingId: factory.id, index: 1 });
  io(game).step();
  near(player.resources.wood, afterQueue.wood + droneCost.wood!, 'unstarted job refunds 100%');
  near(player.resources.gold, afterQueue.gold + droneCost.gold!, 'unstarted job refunds 100% gold');

  const afterFirst = { ...player.resources };
  game.enqueueCommand(member.id, { kind: 'cancelTrain', buildingId: factory.id, index: 0 });
  io(game).step();
  near(player.resources.wood, afterFirst.wood + Math.floor(droneCost.wood! * 0.5), 'started job refunds 50%');
  near(player.resources.gold, afterFirst.gold + Math.floor(droneCost.gold! * 0.5), 'started job refunds 50% gold');
  assert.equal(factory.queue.length, 0);
  assert.equal(drones(game), 0, 'cancelled jobs never produce units');

  // Refunds never exceed storage capacity.
  train(game, factory);
  player.resources.gold = 1_500; // base gold cap
  game.enqueueCommand(member.id, { kind: 'cancelTrain', buildingId: factory.id, index: 0 });
  io(game).step();
  assert.equal(player.resources.gold, 1_500, 'refund clamps to storage cap');
}

async function restartAndOffline(): Promise<void> {
  const { game, factory } = levelTwoHome();
  addCompleted(game, 'army_camp');
  train(game, factory, 3);
  for (let i = 0; i < 30; i++) io(game).step();
  const spent = { ...game.players.get(member.id)!.resources };
  const queued = factory.queue.map((q) => q.progress);

  const temp = await mkdtemp(path.join(os.tmpdir(), 'age-home-p2-'));
  try {
    const repo = new JsonHomeRepository(temp);
    await repo.save(game.captureHomeState(profileId));

    // Same-instant relaunch: queue, progress and paid costs survive exactly.
    const same = newHome((await repo.load(profileId)).save!);
    const sameFactory = same.buildings.get(factory.id)!;
    assert.deepEqual(sameFactory.queue.map((q) => q.progress), queued, 'queue progress survives restart');
    near(same.players.get(member.id)!.resources.wood, spent.wood, 'no re-deduction or refund on restart');
    assert.equal(drones(same), 0);

    // One hour offline: all three jobs finish under the frozen power factor and dock.
    clock += 60 * 60 * 1000;
    const later = newHome((await repo.load(profileId)).save!);
    const laterFactory = later.buildings.get(factory.id)!;
    assert.equal(laterFactory.queue.length, 0, 'offline queue work completes');
    assert.equal(drones(later), 3, 'each paid job produced exactly one unit');
    assert.ok(io(later).armyUsedOf(member.id) <= io(later).armyCapacityOf(member.id));

    // A second relaunch of the post-offline state must not duplicate the army.
    await repo.save(later.captureHomeState(profileId));
    const again = newHome((await repo.load(profileId)).save!);
    assert.equal(drones(again), 3, 'no duplicated units across restarts');
    const ids = [...again.units.values()].filter((u) => u.type === 'attack_drone').map((u) => u.id);
    assert.equal(new Set(ids).size, 3, 'unit identities are unique');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }

  // Offline production blocks at capacity instead of bypassing it.
  const full = levelTwoHome();
  const camp = addCompleted(full.game, 'army_camp');
  while (io(full.game).armyUsedOf(member.id) < io(full.game).armyCapacityOf(member.id) - 1) {
    const id = io(full.game).nextId++;
    full.game.units.set(id, createUnit(id, member.id, 'attack_drone', camp.tileX - 1.5, camp.tileY + 0.5));
  }
  train(full.game, full.factory, 3);
  const save = full.game.captureHomeState(profileId);
  clock += 2 * 60 * 60 * 1000;
  const restored = newHome(save);
  const f = restored.buildings.get(full.factory.id)!;
  assert.equal(io(restored).armyUsedOf(member.id), io(restored).armyCapacityOf(member.id), 'offline fills to capacity only');
  assert.equal(f.queue.length, 2, 'remaining paid jobs stay queued');
  assert.equal(f.trainBlocked, 'camp_full');
}

async function main(): Promise<void> {
  paymentAndBlocking();
  cancelRefunds();
  await restartAndOffline();
  console.log('home phase 2: ok');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
