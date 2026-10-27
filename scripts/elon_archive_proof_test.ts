import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Game } from '../server/src/game/room.ts';
import { createUnit } from '../server/src/game/state.ts';
import { archiveHash, canonicalJson, writeChronicle, type MatchChronicle } from '../server/src/archive/chronicle.ts';
import { DisabledProofAdapter, safelySubmitProof, type ProofAdapter } from '../server/src/proofs/index.ts';

async function main(): Promise<void> {
const game = new Game([{ id: 1, name: 'Human', color: '#fff' }], () => {}, () => {});
const internal = game as any;
const player = game.players.get(1)!;
const firstBuilding = [...game.buildings.values()][0];
game.buildings.set(999_001, { ...firstBuilding, id: 999_001, type: 'house', progress: 1, owner: 1, queue: [] });
internal.step();
assert.equal(player.elon, 2, 'completed house posts exactly two obligation points');
internal.step();
assert.equal(player.elon, 2, 'same facility cannot post twice');

game.units.set(999_002, createUnit(999_002, 1, 'villager', 5, 5));
internal.step();
assert.equal(player.elon, 3, 'new worker posts one labor point');
player.age = 2;
internal.step();
assert.equal(player.elon, 8, 'age reached posts five obligation points');
assert(game.elonEvents.every((event) => Number.isInteger(event.amount)), 'all postings are integers');
assert.equal(game.elonEvents.reduce((sum, event) => sum + event.amount, 0), player.elon, 'event ledger balances to standing');

const chronicle: MatchChronicle = {
  schema: 'age-of-symbiosis/chronicle-v1', matchId: 'test-1', finishedTick: 4, winnerName: 'Human',
  players: game.contributionSummary().players, elonEvents: game.elonEvents,
  activity: { buildingsConstructed: game.elonEvents.slice(0, 1), unitsTrained: game.elonEvents.slice(1, 2), agesReached: game.elonEvents.slice(2), battles: [], councilRecommendations: [] },
};
assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }), 'canonical key order');
assert.equal(archiveHash(chronicle), archiveHash(structuredClone(chronicle)), 'archive hash deterministic');
const dir = await mkdtemp(path.join(tmpdir(), 'symbiosis-archive-'));
const written = await writeChronicle(chronicle, dir);
assert.equal(await readFile(written.jsonPath, 'utf8'), `${canonicalJson(chronicle)}\n`);

const disabled = await safelySubmitProof(new DisabledProofAdapter(), chronicle.matchId, written.hash, written.jsonPath);
assert.equal(disabled.status, 'disabled', 'blockchain disabled by default');
const failing: ProofAdapter = { submit: async () => { throw new Error('offline'); } };
const failed = await safelySubmitProof(failing, chronicle.matchId, written.hash);
assert.equal(failed.status, 'failed');
assert.equal(player.elon, 8, 'failed proof submission cannot affect gameplay standing');

console.log('ELON invariants, deterministic archive, and proof isolation: PASS');
}

void main();
