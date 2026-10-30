// City ledger and ELON settlement, plus the city-only Home map.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { MatchCommitment, ServerMessage } from '../shared/src';
import { TILE_GRASS, TILE_WATER } from '../shared/src/constants';
import { Game } from '../server/src/game/room';
import { verifyLedger } from '../server/src/home/ledger';
import { HomeManager } from '../server/src/home/manager';
import { JsonHomeRepository, migrateHomeSave } from '../server/src/home/repository';
import type { ProofAdapter } from '../server/src/proofs';

let clock = 2_300_000_000_000;
const now = () => clock;
const member = { id: 6, name: 'Ledger', color: '#39c6e8' };
const newHome = () => new Game([member], () => undefined, () => undefined, 'normal', 'classic', 'symbiosis', 'a1'.repeat(32), { session: 'home', now });
const step = (g: Game, n: number) => { for (let i = 0; i < n; i++) (g as unknown as { step(): void }).step(); };

async function ledgerRules(): Promise<void> {
  const g = newHome();
  // City only: no forests, mines, herds or water.
  assert.equal(g.nodes.size, 0, 'no resource nodes at Home');
  assert.equal(g.sheep.size, 0, 'no sheep at Home');
  assert.ok(g.chain && verifyLedger(g.chain.ledger), 'genesis ledger verifies');
  assert.equal(g.chain!.ledger.nextHeight, 1);

  // Events and ELON accrual seal into a block once a minute of game time.
  g.recordHomeEvent('build', 'house completed');
  const p = g.players.get(member.id)!;
  p.elonBalance += 5.75; // accrual on top of the starting balance
  step(g, 600);
  const l = g.chain!.ledger;
  assert.equal(l.pending.length, 0, 'pending events sealed');
  assert.ok(l.txs.some((t) => t.kind === 'build') && l.txs.some((t) => t.kind === 'elon'), 'build and ELON accrual logged');
  assert.ok(verifyLedger(l));

  // Settlement: whole ELON only, exactly once, sealed with its own block.
  const before = p.elonBalance;
  const res = g.settleElon('s-test');
  assert.ok(res.settlement, 'settlement created');
  assert.equal(res.settlement!.amount, Math.floor(before));
  assert.ok(Math.abs(p.elonBalance - (before - Math.floor(before))) < 1e-9, 'fraction stays playable');
  assert.equal(g.chain!.settledTotal, Math.floor(before));
  assert.equal(res.settlement!.ledgerHead, g.chain!.ledger.head, 'settlement anchors the sealing block');
  assert.equal(g.settleElon('again').error, 'err.nothing_to_settle', 'cannot settle under 1 ELON');
  assert.ok(verifyLedger(g.chain!.ledger));

  // Tampering with any logged entry breaks verification.
  const copy = structuredClone(g.chain!.ledger);
  copy.txs[1].label = 'forged';
  assert.equal(verifyLedger(copy), false, 'edited entry detected');
  const copy2 = structuredClone(g.chain!.ledger);
  copy2.blocks[1].prevHash = copy2.blocks[0].prevHash;
  assert.equal(verifyLedger(copy2), false, 'broken link detected');

  // Save round trip keeps the exact chain.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'age-ledger-'));
  try {
    const repo = new JsonHomeRepository(dir);
    await repo.save(g.captureHomeState('a1'.repeat(32)));
    const loaded = (await repo.load('a1'.repeat(32))).save!;
    const g2 = new Game([member], () => undefined, () => undefined, 'normal', 'classic', 'symbiosis', 'a1'.repeat(32), { session: 'home', now, homeState: loaded });
    assert.equal(g2.chain!.ledger.head, g.chain!.ledger.head, 'ledger head survives restart');
    assert.equal(g2.chain!.settledTotal, g.chain!.settledTotal);
    assert.ok(verifyLedger(g2.chain!.ledger));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // Older wilderness saves come back as clean city ground.
  const old = g.captureHomeState('a1'.repeat(32));
  old.map.tiles[10] = TILE_WATER;
  old.nodes = [{ id: 99_999, type: 'tree', tileX: 3, tileY: 3, amount: 100 }];
  const g3 = new Game([member], () => undefined, () => undefined, 'normal', 'classic', 'symbiosis', 'a1'.repeat(32), { session: 'home', now, homeState: old });
  assert.equal(g3.nodes.size, 0, 'old forests removed');
  assert.ok(g3.map.tiles.every((t) => t === TILE_GRASS), 'old water becomes city ground');

  // v3 saves gain a ledger on first load.
  const v3 = { ...g.captureHomeState('a1'.repeat(32)), version: 3 } as Record<string, unknown>;
  delete v3.chain;
  const migrated = migrateHomeSave(v3) as { version: number; chain: unknown };
  assert.equal(migrated.version, 4);
  assert.equal(migrated.chain, null);
}

async function settlementThroughManager(): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'age-ledger-mgr-'));
  let fail = true;
  const adapter: ProofAdapter = {
    async submit(matchId, archiveHash, archivePath, ledger): Promise<MatchCommitment> {
      if (fail) throw new Error('rpc down');
      return { matchId, archiveHash, archivePath, status: 'confirmed', transactionHash: '0xabc', chainId: 31337, blockNumber: 7, ledgerHead: ledger?.head, ledgerHeight: ledger?.height };
    },
  };
  try {
    const inbox: ServerMessage[] = [];
    const manager = new HomeManager(new JsonHomeRepository(dir), now, undefined, adapter);
    await manager.enter({ id: 31, name: 'Settler', color: '#fff', clientId: 'ledger-client', send: (m) => inbox.push(m) });
    const g = manager.homeGame(31)!;
    g.stop();
    await manager.ledger(31, { kind: 'open' });
    const first = inbox.filter((m) => m.type === 'ledger').at(-1) as Extract<ServerMessage, { type: 'ledger' }>;
    assert.ok(first && first.view.verified && first.view.height >= 0, 'ledger page opens with a verified chain');

    g.players.get(31)!.elonBalance = 12.4;
    await manager.ledger(31, { kind: 'settle' });
    const s = g.chain!.settlements[0];
    assert.equal(s.amount, 12);
    assert.equal(s.status, 'failed', 'a failed anchor is reported, not hidden');
    assert.equal(g.chain!.settledTotal, 12, 'ELON settled once in the ledger');

    fail = false;
    await manager.ledger(31, { kind: 'anchor', id: s.id });
    assert.equal(s.status, 'confirmed', 'retry anchors on chain');
    assert.equal(s.transactionHash, '0xabc');
    assert.equal(g.chain!.settledTotal, 12, 'retrying never settles twice');
    const last = inbox.filter((m) => m.type === 'ledger').at(-1) as Extract<ServerMessage, { type: 'ledger' }>;
    assert.equal(last.view.settlements[0].status, 'confirmed', 'page receives the new status');
    await manager.leave(31);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await ledgerRules();
  await settlementThroughManager();
  console.log('home ledger: ok');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
