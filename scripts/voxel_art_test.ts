// Construction stages of the voxel art derive only from authoritative progress
// (master spec §3.4): 0-15 foundation, 15-55 frame, 55-90 walls, 90-100 power-up.
import assert from 'node:assert/strict';
import { constructionStage, hasVoxelArt, shade } from '../client/src/game/voxel.ts';

assert.equal(constructionStage(0), 'foundation');
assert.equal(constructionStage(0.149), 'foundation');
assert.equal(constructionStage(0.15), 'frame');
assert.equal(constructionStage(0.549), 'frame');
assert.equal(constructionStage(0.55), 'walls');
assert.equal(constructionStage(0.899), 'walls');
assert.equal(constructionStage(0.9), 'powerup');
assert.equal(constructionStage(1), 'complete');
assert.equal(constructionStage(Number.NaN), 'complete', 'malformed progress never shows a fake site');
assert.ok(hasVoxelArt('town_center') && hasVoxelArt('drone_factory') && hasVoxelArt('army_camp'));
assert.ok(!hasVoxelArt('point_turret'), 'dedicated defense painters keep their art');
assert.equal(shade('#808080', 0), '#808080');
assert.equal(shade('#000000', 1), '#ffffff');
console.log('voxel art stages: PASS');
