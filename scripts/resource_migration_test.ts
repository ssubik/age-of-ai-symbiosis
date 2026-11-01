// Energy / Alloys / Compute migration: legacy saves load losslessly and keep
// every hash. Real profiles are COPIED to a temp dir; originals are never written.
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonHomeRepository, migrateHomeSave, migrateLegacyResources } from '../server/src/home/repository';
import { verifyLedger } from '../server/src/home/ledger';
import { Game } from '../server/src/game/room';
import type { HomeSave } from '../server/src/home/types';

// ---- unit: the record rewrite
assert.deepEqual(migrateLegacyResources({ food: 10, wood: 20, gold: 30, stone: 40 }), { energy: 10, alloys: 60, compute: 30 });
assert.deepEqual(migrateLegacyResources({ wood: 5 }), { alloys: 5 });
assert.deepEqual(migrateLegacyResources({ carryType: 'stone', carryAmount: 3 }), { carryType: 'alloys', carryAmount: 3 });
assert.deepEqual(migrateLegacyResources({ gatherResource: 'gold' }), { gatherResource: 'compute' });
const sheep = { id: 1, owner: -1, x: 2, y: 3, food: 100, path: [] };
assert.deepEqual(migrateLegacyResources(sheep), sheep, 'sheep meat is not a stockpile');
const farm = { id: 2, type: 'farm', foodLeft: 300, queue: [{ unit: 'robot', progress: 0, paid: { wood: 60, gold: 40 } }] };
assert.deepEqual(migrateLegacyResources(farm), { ...farm, queue: [{ unit: 'robot', progress: 0, paid: { alloys: 60, compute: 40 } }] });
assert.deepEqual(migrateLegacyResources({ label: 'gold', note: 'wood' }), { label: 'gold', note: 'wood' }, 'free text is untouched');

// ---- synthetic v4 envelope: version bump and hashed data untouched
const chain = { ledger: { salt: 's', seq: 2, blocks: [{ height: 0, hash: 'abc', txs: [{ seq: 0, kind: 'genesis', label: 'gold rush', amount: 5, hash: 'h' }] }] }, settlements: [] };
const v4 = { version: 4, player: { resources: { food: 1, wood: 2, gold: 3, stone: 4 } }, storageCaps: { food: 2000, wood: 2000, gold: 1500, stone: 1500 }, chain, raid: { reports: [{ reward: { food: 5, wood: 6, gold: 7, stone: 8 }, earned: { food: 5, wood: 6, gold: 7, stone: 8 } }] } };
const v5 = migrateHomeSave(structuredClone(v4)) as Record<string, any>;
assert.equal(v5.version, 5);
assert.deepEqual(v5.player.resources, { energy: 1, alloys: 6, compute: 3 });
assert.deepEqual(v5.storageCaps, { energy: 2000, alloys: 3500, compute: 1500 });
assert.deepEqual(v5.raid.reports[0].reward, { energy: 5, alloys: 14, compute: 7 });
assert.deepEqual(v5.chain, chain, 'the city ledger is byte-identical');

// ---- real saves on this machine (skipped when there are none)
const source = path.resolve('server/profiles');
const files = existsSync(source) ? readdirSync(source).filter((f) => /^[0-9a-f]{64}\.json$/.test(f)) : [];
async function realSaves(): Promise<number> {
const dir = mkdtempSync(path.join(tmpdir(), 'age-migrate-'));
let checked = 0;
try {
  for (const file of files) {
    const before = JSON.parse(readFileSync(path.join(source, file), 'utf8'));
    if (before.version !== 4) continue;
    copyFileSync(path.join(source, file), path.join(dir, file));
    const { save } = await new JsonHomeRepository(dir).load(file.replace('.json', ''));
    assert.ok(save, `${file} loads`);
    const r = before.player.resources;
    assert.deepEqual(save!.player.resources, { energy: r.food, alloys: r.wood + r.stone, compute: r.gold }, `${file}: stockpile conserved`);
    if (save!.chain) assert.ok(verifyLedger(save!.chain.ledger), `${file}: city ledger still verifies`);
    // The migrated city runs.
    const game = new Game([{ id: 1, name: 'Mayor', color: '#39c6e8' }], () => undefined, () => undefined, 'normal', 'classic', 'symbiosis', save!.profileId, { session: 'home', homeState: save as HomeSave, now: () => save!.savedAt + 1000 }) as Game & { step(): void };
    for (let i = 0; i < 600; i++) game.step();
    const after = game.players.get(1)!.resources;
    assert.deepEqual(Object.keys(after).sort(), ['alloys', 'compute', 'energy'], `${file}: live city uses the new economy`);
    checked++;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
return checked;
}

realSaves().then((checked) => console.log(`resource migration: ok (${checked} real save(s) migrated and run)`), (error) => { console.error(error); process.exit(1); });
