import assert from 'node:assert/strict';
import type { ServerMessage } from '../shared/src/protocol.ts';
import { recommend } from '../client/src/game/advisor.ts';

const classicRoom: ServerMessage = {
  type: 'roomState', roomId: 'ABC123', players: [], mode: 'normal', fog: false,
  terrain: 'classic', broadcast: true,
};
assert.equal(classicRoom.type, 'roomState', 'legacy room state remains valid without experience');

const symbiosisRoom: ServerMessage = { ...classicRoom, experience: 'symbiosis' };
assert.equal(symbiosisRoom.experience, 'symbiosis');

const observation = {
  energy: 250, alloys: 350, compute: 100,
  population: 3, populationCap: 5, villagers: 3, age: 1, idleVillagers: 3,
};
assert.deepEqual(recommend(observation), recommend(observation), 'advisor must be deterministic');
assert.equal(recommend(observation).id, 'housing', 'population safety has highest priority');
assert.equal(recommend({ ...observation, populationCap: 10 }).id, 'workers');
assert.equal(recommend({ ...observation, populationCap: 10, villagers: 6, energy: 90 }).id, 'energy');

console.log('symbiosis compatibility and advisor determinism: PASS');
