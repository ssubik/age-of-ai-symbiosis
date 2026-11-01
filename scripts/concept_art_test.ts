import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { CONCEPT_BUILDINGS, CONCEPT_UNITS } from '../client/src/game/sprites';

for (const [id, def] of [...Object.entries(CONCEPT_BUILDINGS), ...Object.entries(CONCEPT_UNITS)]) {
  if (!def) continue;
  assert.ok(existsSync(`client/public/sprites/machine-v3/${def.file}`), `${id} sprite exists`);
  assert.ok(def.scale > 0, `${id} has a positive runtime scale`);
}

for (const id of ['town_center', 'solar_array', 'mining_camp', 'data_center', 'drone_factory', 'point_turret']) {
  assert.ok(CONCEPT_BUILDINGS[id as keyof typeof CONCEPT_BUILDINGS], `${id} has concept art`);
}
for (const id of ['villager', 'robot', 'attack_drone', 'fighter', 'siege_mech', 'iron_guardian', 'aegis_valkyrie']) {
  assert.ok(CONCEPT_UNITS[id as keyof typeof CONCEPT_UNITS], `${id} has concept art`);
}

console.log(`concept art: ${Object.keys(CONCEPT_BUILDINGS).length} building mappings, ${Object.keys(CONCEPT_UNITS).length} unit mappings`);
