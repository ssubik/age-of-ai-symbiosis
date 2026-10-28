import assert from 'node:assert/strict';
import { AGE_COSTS, UNIT_DEFS } from '../shared/src/index.ts';
import { Game } from '../server/src/game/room.ts';
import { createUnit, type Building } from '../server/src/game/state.ts';

const members = [
  { id: 1, name: 'Command', color: '#5cf' },
  { id: 2, name: 'Space', color: '#f65' },
];
const game = new Game(members, () => {}, () => {}, 'normal', 'river', 'symbiosis');
const g = game as any;
const command = game.players.get(1)!;
const space = game.players.get(2)!;
for (const p of [command, space]) {
  p.age = 4;
  p.resources = { food: 9999, wood: 9999, gold: 9999, stone: 9999 };
}

g.cmdChooseCityPath(1, 'command');
assert.equal(command.ageResearch?.path, 'command');
assert.equal(command.resources.food, 9999 - (AGE_COSTS[5].food ?? 0));
command.ageResearch!.elapsed = 70;
g.step();
assert.equal(command.age, 5);
assert.equal(command.cityPath, 'command');

g.cmdChooseCityPath(2, 'space');
space.ageResearch!.elapsed = 70;
g.step();
assert.equal(space.cityPath, 'space');
g.step(); // next authoritative grid cycle observes the completed specialization
assert.ok(game.powerOf(2).supply >= 12, 'Space Gateway adds 10 power above Town Center supply');

const attacker = createUnit(990_001, 1, 'attack_drone', 20, 20);
const protectedTarget = createUnit(990_002, 2, 'villager', 21, 20);
game.units.set(attacker.id, attacker);
game.units.set(protectedTarget.id, protectedTarget);
g.cmdAttack(1, [attacker.id], protectedTarget.id);
assert.equal(attacker.state, 'idle', 'Space city is protected from Command-city attack orders');

space.cityPath = 'command';
g.cmdAttack(1, [attacker.id], protectedTarget.id);
assert.equal(attacker.state, 'movingToAttack', 'war is enabled between two Command cities');

const workshop = (id: number, owner: number): Building => ({
  id, owner, type: 'robotics_workshop', tileX: 30 + owner * 4, tileY: 30,
  hp: 650, progress: 1, queue: [],
});
const commandWorkshop = workshop(991_001, 1);
const spaceWorkshop = workshop(991_002, 2);
game.buildings.set(commandWorkshop.id, commandWorkshop);
game.buildings.set(spaceWorkshop.id, spaceWorkshop);
g.cmdTrain(1, commandWorkshop.id, 'fighter');
assert.equal(commandWorkshop.queue[0]?.unit, 'fighter');
space.cityPath = 'space';
g.cmdTrain(2, spaceWorkshop.id, 'fighter');
assert.equal(spaceWorkshop.queue.length, 0, 'Space Gateway cannot train offensive strike units');
assert.equal(UNIT_DEFS.rocket_launcher.range, 7.5);

console.log('City progression, specialization, protection, and warfare gates: PASS');
