import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Game } from '../server/src/game/room.ts';
import { createUnit } from '../server/src/game/state.ts';
import { archiveHash, canonicalJson, writeChronicle, type MatchChronicle } from '../server/src/archive/chronicle.ts';
import { needElon, rankStandings, reliabilityBonus, stewardshipValue } from '../server/src/game/stewardship.ts';
import { DisabledProofAdapter, safelySubmitProof, type ProofAdapter } from '../server/src/proofs/index.ts';

async function main(): Promise<void> {
const game = new Game([{ id: 1, name: 'Human', color: '#fff' }], () => {}, () => {});
const internal = game as any;
const player = game.players.get(1)!;
const firstBuilding = [...game.buildings.values()][0];
const startStewardship = game.standings()[0].stewardship;
game.buildings.set(999_001, { ...firstBuilding, id: 999_001, type: 'house', progress: 1, owner: 1, queue: [] });
internal.step();
assert.equal(player.elon, 0, 'a completed facility earns no standing (counted once, as stewardship)');
assert.equal(game.standings()[0].stewardship, startStewardship + stewardshipValue('house'), 'house adds stewardship while standing');
game.buildings.delete(999_001);
assert.equal(game.standings()[0].stewardship, startStewardship, 'destroyed/deleted facilities stop counting');

game.units.set(999_002, createUnit(999_002, 1, 'villager', 5, 5));
internal.step();
assert.equal(player.elon, 1, 'new worker posts one labor point');
player.age = 2;
internal.step();
assert.equal(player.elon, 6, 'age reached posts five obligation points');

for (const u of game.units.values()) if (u.owner === 1) { u.state = 'idle'; u.path = []; }
const before = player.elon;
while (internal.tick % 50 !== 49) internal.step();
for (const u of game.units.values()) if (u.owner === 1) u.state = 'idle';
internal.step();
const s1 = game.standings()[0];
assert.ok(s1.declaredNeed > s1.servedNeed, 'idle villagers are declared but unserved labor');
assert.ok(s1.reliabilityPpm < 1_000_000, 'unserved need lowers reliability');
assert.ok(player.elon > before, 'housing served still earns standing');
assert.equal(s1.score, Math.round((s1.standing + s1.stewardship + s1.bonus) * 100) / 100, 'score = standing + stewardship + bonus');
assert.equal(needElon({ key: 'work', declared: 3, served: 3, perElon: 4 }), 1, 'a fully met need is always worth at least 1');
assert.equal(needElon({ key: 'work', declared: 3, served: 2, perElon: 4 }), 0, 'a partly met small need earns nothing');
assert.equal(reliabilityBonus(1_000_000), 50, 'perfect reliability is worth 50 ELON');
assert(game.elonEvents.every((event) => Number.isInteger(event.amount)), 'all postings are integers');
assert.equal(game.elonEvents.reduce((sum, event) => sum + event.amount, 0), player.elon, 'event ledger balances to standing');
const ranked = rankStandings([
  { playerId: 2, name: 'B', standing: 10, facilities: 1, stewardship: 5, reliabilityPpm: 1e6, declaredNeed: 1, servedNeed: 1, bonus: 50, score: 65 },
  { playerId: 1, name: 'A', standing: 10, facilities: 1, stewardship: 5, reliabilityPpm: 1e6, declaredNeed: 1, servedNeed: 1, bonus: 50, score: 65 },
]);
assert.deepEqual(ranked.map((r) => r.playerId), [1, 2], 'ties break on player id');

const chronicle: MatchChronicle = {
  schema: 'age-of-symbiosis/chronicle-v1', matchId: 'test-1', finishedTick: 4, winnerName: 'Human',
  players: game.contributionSummary().players, elonEvents: game.elonEvents,
  activity: { buildingsConstructed: [], unitsTrained: game.elonEvents.slice(0, 1), agesReached: game.elonEvents.slice(1, 2), battles: [], councilRecommendations: [] },
  standings: game.standings(),
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
assert.equal(player.elon, game.standings()[0].standing, 'failed proof submission cannot affect standing');

console.log('Stewardship scoring, ELON invariants, deterministic archive, and proof isolation: PASS');
}

void main();
