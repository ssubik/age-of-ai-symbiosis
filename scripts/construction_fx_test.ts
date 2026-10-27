import assert from 'node:assert/strict';
import { constructionFxPlan } from '../client/src/game/constructionFx.ts';

const start = constructionFxPlan(7, 0);
assert.equal(start.active, true);
assert.equal(start.human, false);

const active = constructionFxPlan(7, 0.65);
assert.deepEqual(active, constructionFxPlan(7, 0.65), 'plan must be deterministic');
assert.equal(active.human, true);
assert.equal(active.robot, true);
assert.equal(active.drone, true);
assert.equal(active.crane, true);
assert.equal(active.welding, true);

const complete = constructionFxPlan(7, 1);
assert.equal(complete.active, false);
assert.equal(complete.human, false);
assert.equal(complete.robot, false);
assert.equal(complete.drone, false);
assert.equal(complete.crane, false);
assert.equal(complete.welding, false);

const malformed = constructionFxPlan(7, Number.NaN);
assert.equal(malformed.active, false, 'malformed progress must fail closed');

console.log('construction FX lifecycle: PASS');
