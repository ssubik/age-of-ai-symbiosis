import assert from 'node:assert/strict';
import { BUILDING_DEFS, ELON_UNIT_COST } from '../shared/src/index.ts';
import { Game } from '../server/src/game/room.ts';
import { createUnit, type Building } from '../server/src/game/state.ts';

const game = new Game([{ id: 1, name: 'Builder', color: '#5cf' }], () => {}, () => {}, 'normal', 'river', 'symbiosis');
const g = game as any;
game.buildings.clear();
game.units.clear();
const player = game.players.get(1)!;
player.age = 2;
player.elonBalance = 0;

const put = (id: number, type: Building['type'], x: number): Building => {
  const b: Building = { id, owner: 1, type, tileX: x, tileY: 20, hp: BUILDING_DEFS[type].hp, progress: 1, queue: [] };
  game.buildings.set(id, b);
  return b;
};
put(100, 'data_center', 20);
put(101, 'elon_vault', 24);
put(102, 'army_camp', 28);
const factory = put(103, 'drone_factory', 32);

assert.deepEqual(BUILDING_DEFS.town_center.trains, ['villager'], 'Civic Hub creates human builders');
assert.deepEqual(BUILDING_DEFS.design_studio.trains, ['designer'], 'Design Studio creates human designers');
assert.deepEqual(BUILDING_DEFS.robotics_workshop.trains, ['robot', 'drone'], 'Autonomous Systems Lab creates builder robots');
assert.deepEqual(BUILDING_DEFS.mech_forge.trains, ['siege_mech'], 'Mech Forge creates attack robots');

assert.equal(g.elonPerMinuteOf(1), 6);
assert.equal(g.elonCapacityOf(1), 700);
assert.equal(g.armyCapacityOf(1), 10);
for (let i = 0; i < 10; i++) g.generateElon();
assert.equal(Math.round(player.elonBalance), 1, 'ELON generators add currency over time');

player.elonBalance = 100;
g.cmdTrain(1, factory.id, 'attack_drone');
assert.equal(factory.queue[0]?.unit, 'attack_drone');
assert.equal(player.elonBalance, 100 - ELON_UNIT_COST.attack_drone!, 'factory spends ELON');
assert.equal(g.trainTimeFor(factory), 14, 'factory uses base manufacturing time without designers');
const designer = createUnit(500, 1, 'designer', 10, 10);
game.units.set(designer.id, designer);
assert.equal(g.trainTimeFor(factory), 14 * .92, 'a human designer accelerates weapon manufacturing by 8%');
g.cmdCancelTrain(1, factory.id, 0);
assert.equal(player.elonBalance, 100, 'cancelling refunds ELON');

game.buildings.delete(102);
g.cmdTrain(1, factory.id, 'attack_drone');
assert.equal(factory.queue.length, 0, 'an Army Hangar is required for capacity');

console.log('CoC economy: generators, vault, factory spending, refund, and army capacity: PASS');
