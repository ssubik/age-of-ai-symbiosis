import assert from 'node:assert/strict';
import { BUILDING_DEFS } from '../shared/src/index.ts';
import { Game } from '../server/src/game/room.ts';
import { createUnit, type Building } from '../server/src/game/state.ts';

const messages: any[] = [];
const game = new Game([
  { id: 1, name: 'Kathmandu Command', color: '#5cf' },
  { id: 2, name: 'Rival Command', color: '#f65' },
], (_id, message) => messages.push(message), () => {}, 'normal', 'classic', 'symbiosis');
const g = game as any;
game.units.clear();
game.buildings.clear();

for (const player of game.players.values()) {
  player.age = 5;
  player.cityPath = 'command';
  player.resources = { food: 1000, wood: 1000, gold: 1000, stone: 1000 };
}

assert.deepEqual(BUILDING_DEFS.drone_factory.trains, ['attack_drone']);
assert.deepEqual(BUILDING_DEFS.aerospace_hangar.trains, ['fighter', 'stealth_bomber']);
assert.deepEqual(BUILDING_DEFS.missile_foundry.trains, ['rocket_launcher', 'plasma_tank']);
assert.deepEqual(BUILDING_DEFS.mech_forge.trains, ['siege_mech']);
assert.deepEqual(BUILDING_DEFS.exosuit_lab.trains, ['iron_guardian']);
assert.deepEqual(BUILDING_DEFS.aerospace_hangar.trains, ['fighter', 'stealth_bomber']);
assert.deepEqual(BUILDING_DEFS.missile_foundry.trains, ['rocket_launcher', 'plasma_tank']);
assert.deepEqual(BUILDING_DEFS.mech_forge.trains, ['siege_mech']);
assert.deepEqual(BUILDING_DEFS.exosuit_lab.trains, ['iron_guardian']);

const building = (id: number, type: Building['type'], tileX: number, tileY: number): Building => ({
  id, owner: 2, type, tileX, tileY, hp: BUILDING_DEFS[type].hp, progress: 1, queue: [],
});
game.buildings.set(100, building(100, 'town_center', 28, 28));
game.buildings.set(101, building(101, 'house', 33, 28));
game.units.set(201, createUnit(201, 1, 'attack_drone', 10, 10));
game.units.set(202, createUnit(202, 1, 'attack_drone', 11, 10));
game.units.set(203, createUnit(203, 1, 'fighter', 12, 10));

g.cmdScoutRaid(1, 2);
let raid = g.raids.get(1);
assert.equal(raid.phase, 'scouting');

g.cmdSetRaidArmy(1, { attack_drone: 2, fighter: 1, rocket_launcher: 0, siege_mech: 0, stealth_bomber: 0, plasma_tank: 0, iron_guardian: 0 });
g.cmdStartRaid(1);
assert.equal(raid.phase, 'deploying');

g.cmdDeployRaid(1, 'attack_drone', 20, 20);
assert.equal(raid.deployed, 0, 'deployment inside the map is rejected');

g.cmdDeployRaid(1, 'attack_drone', 1, 20);
assert.equal(raid.deployed, 1, 'deployment at the map boundary succeeds');
const deployed = [...game.units.values()][0];
assert.equal(deployed?.state, 'movingToAttack');
assert.ok(deployed?.attackTargetId === 100 || deployed?.attackTargetId === 101, 'unit autonomously chooses a defensive city target');

game.buildings.delete(101);
g.updateRaids();
assert.ok(raid.destruction > 0, 'destroyed facilities increase destruction');
assert.ok(raid.events.some((event: any) => event.kind === 'destroy'), 'destruction is saved in the replay timeline');

game.buildings.delete(100);
g.updateRaids();
assert.equal(raid.phase, 'result');
assert.equal(raid.stars, 3);
assert.ok(raid.loot.food > 0 && game.players.get(1)!.resources.food > 1000, 'loot transfers to the attacker');

g.applyCommand(1, { kind: 'showRaidReplay' });
raid = g.raids.get(1);
assert.equal(raid.phase, 'replay');
assert.ok(raid.events.some((event: any) => event.kind === 'finish'), 'completed result remains available for replay');

console.log('Scout, army, edge deployment, autonomous battle, stars, loot, and replay: PASS');
