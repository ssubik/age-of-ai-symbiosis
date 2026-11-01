// The five layers of the AI industry: ages, layer gates and the energy → compute dependency.
import assert from 'node:assert/strict';
import { AGE_NAMES, LAYER_GATE, LAYER_OUTPUT, layerGateMet, type BuildingType } from '../shared/src';
import { Game } from '../server/src/game/room';
import type { Building } from '../server/src/game/state';

assert.deepEqual(AGE_NAMES.slice(1), ['Energy Grid', 'Compute Layer', 'AI Factories', 'Model Layer', 'Applications']);
assert.ok(!layerGateMet(1, ['barracks', 'house']), 'Compute needs Energy');
assert.ok(layerGateMet(1, ['solar_array']));
assert.ok(!layerGateMet(2, ['solar_array']), 'AI Factories need Compute');
assert.ok(layerGateMet(2, ['data_center']));
assert.ok(layerGateMet(3, ['robotics_workshop']) && layerGateMet(4, ['design_studio']));
assert.ok(layerGateMet(5, []), 'nothing gates the last layer');
for (const gate of Object.values(LAYER_GATE)) assert.ok(gate.length > 0);

type G = Game & { step(): void; buildings: Map<number, Building>; nextId: number; powerOf(id: number): { supply: number; draw: number } };
const game = new Game(
  [{ id: 1, name: 'A', color: '#4ad' }, { id: 2, name: 'B', color: '#d54' }],
  () => undefined, () => undefined, 'normal', 'classic', 'symbiosis', 'layers', { skirmish: true, mapSeed: 99 },
) as G;
const core = [...game.buildings.values()].find((b) => b.owner === 1 && b.type === 'town_center')!;
const place = (type: BuildingType, dx: number): Building => {
  const b = { id: game.nextId++, owner: 1, type, tileX: core.tileX + dx, tileY: core.tileY - 6, hp: 500, progress: 1, queue: [] } as unknown as Building;
  game.buildings.set(b.id, b);
  return b;
};
const p = game.players.get(1)!;
const minute = (): { energy: number; compute: number } => {
  const before = { ...p.resources };
  for (let i = 0; i < 600; i++) game.step();
  return { energy: p.resources.energy - before.energy, compute: p.resources.compute - before.compute };
};

// Energy layer: a generator yields energy with nobody gathering.
const solar = place('solar_array', 0);
const gen = minute();
assert.ok(Math.abs(gen.energy - LAYER_OUTPUT.solar_array!.energy!) < 1, `solar array yields ~${LAYER_OUTPUT.solar_array!.energy}/min (got ${gen.energy.toFixed(1)})`);

// Compute layer: a Compute Node yields compute and draws grid power.
const node = place('data_center', 3);
game.step();
assert.equal(game.powerOf(1).draw, 2, 'the Compute Node draws power');
const powered = minute();
assert.ok(Math.abs(powered.compute - LAYER_OUTPUT.data_center!.compute!) < 1, `powered node yields full compute (got ${powered.compute.toFixed(1)})`);

// Overload the grid (and lose the generator): compute output drops.
place('data_center', 6);
place('data_center', 9);
game.buildings.delete(solar.id);
game.step();
const grid = game.powerOf(1);
assert.ok(grid.draw > grid.supply, 'three nodes on the core alone overload the grid');
const starved = minute();
assert.ok(starved.compute < 3 * LAYER_OUTPUT.data_center!.compute! * 0.6, `an overloaded grid starves compute (got ${starved.compute.toFixed(1)} from 3 nodes)`);
assert.equal(starved.energy, 0, 'no generator, no passive energy');

// Rebuild generation: output recovers.
place('solar_array', 12);
place('solar_array', 15);
const restored = minute();
assert.ok(restored.compute > starved.compute * 1.4, `restored power restores compute (${starved.compute.toFixed(1)} → ${restored.compute.toFixed(1)})`);
void node;

console.log('layers: ok');
