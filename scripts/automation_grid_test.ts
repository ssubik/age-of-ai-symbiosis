import assert from 'node:assert/strict';
import { BUILDING_DEFS, isFlyingUnit, powerEfficiency, TILE_WATER, UNIT_DEFS } from '../shared/src/index.ts';
import type { ServerMessage } from '../shared/src/index.ts';
import { Game } from '../server/src/game/room.ts';
import { createUnit, type Building } from '../server/src/game/state.ts';
import { MatchLedger } from '../server/src/chain/ledger.ts';
import { encodeCommitWithLedger, RpcProofAdapter } from '../server/src/proofs/index.ts';

const member = [{ id: 1, name: 'Human', color: '#fff' }];
const site = (id: number, owner = 1): Building => ({ id, owner, type: 'house', tileX: 2, tileY: 2, hp: 25, progress: 0, queue: [] });

async function main(): Promise<void> {
  // --- Classic stays Classic ---
  const classic = new Game(member, () => {}, () => {}, 'normal', 'classic', 'classic');
  const ci = classic as any;
  const cp = classic.players.get(1)!;
  cp.resources = { food: 9999, wood: 9999, gold: 9999, stone: 9999 };
  const villager = [...classic.units.values()].find((u) => u.owner === 1)!;
  const before = classic.buildings.size;
  classic.enqueueCommand(1, { kind: 'build', unitIds: [villager.id], building: 'robotics_workshop', tileX: 5, tileY: 5 });
  ci.step();
  assert.equal(classic.buildings.size, before, 'Classic rejects Symbiosis buildings');
  assert.equal(classic.ledger, null, 'Classic has no ledger');
  let classicSnap: ServerMessage | null = null;
  const classic2 = new Game(member, (_id, msg) => { if (msg.type === 'snapshot') classicSnap = msg; }, () => {});
  (classic2 as any).step(); (classic2 as any).step();
  assert.ok(classicSnap && !('chain' in (classicSnap as any)) && (classicSnap as any).players[0].power === undefined, 'Classic snapshots carry no Symbiosis fields');

  // --- Robots build faster than villagers ---
  const game = new Game(member, () => {}, () => {}, 'normal', 'classic', 'symbiosis', 'test-salt');
  const gi = game as any;
  for (const u of [...game.units.values()]) game.units.delete(u.id);
  const ticks = 20;
  const progressWith = (type: 'villager' | 'robot', id: number): number => {
    const b = site(id);
    game.buildings.set(b.id, b);
    const u = createUnit(id + 1, 1, type, 1.5, 1.5);
    u.buildTargetId = b.id;
    u.state = 'building';
    game.units.set(u.id, u);
    for (let i = 0; i < ticks; i++) gi.step();
    game.units.delete(u.id);
    game.buildings.delete(b.id);
    return b.progress;
  };
  const vp = progressWith('villager', 800_000);
  const rp = progressWith('robot', 800_010);
  assert.ok(Math.abs(rp / vp - 1.8) < 0.01, `robot builds 1.8x a villager (got ${(rp / vp).toFixed(2)})`);

  // --- Congested grid slows automation ---
  const grid = game.powerOf(1);
  assert.equal(grid.supply, 2, 'Town Center provides base power');
  const crew = [1, 2, 3, 4].map((n) => createUnit(810_000 + n, 1, 'robot', 1.5, 1.5));
  for (const u of crew) game.units.set(u.id, u);
  const congested = site(820_000);
  game.buildings.set(congested.id, congested);
  crew[0].buildTargetId = congested.id;
  crew[0].state = 'building';
  for (let i = 0; i < ticks; i++) gi.step();
  assert.deepEqual(game.powerOf(1), { supply: 2, draw: 4 });
  assert.ok(Math.abs(congested.progress / rp - 0.5) < 0.02, 'draw 4 on supply 2 halves robot output');
  const solar = { ...site(830_000), type: 'solar_array' as const, progress: 1, hp: BUILDING_DEFS.solar_array.hp };
  game.buildings.set(solar.id, solar);
  gi.step();
  assert.deepEqual(game.powerOf(1), { supply: 6, draw: 4 }, 'solar array adds 4 supply');
  assert.equal(powerEfficiency(6, 4), 1);
  assert.equal(powerEfficiency(0, 10), 0.3, 'efficiency floor');

  // --- Drones fly over water ---
  const river = new Game(member, () => {}, () => {}, 'normal', 'river', 'symbiosis');
  const n = river.map.size;
  let water = -1;
  for (let i = 0; i < river.map.tiles.length && water < 0; i++) if (river.map.tiles[i] === TILE_WATER) water = i;
  assert.ok(water >= 0, 'river map has water');
  const wx = water % n;
  const wy = Math.floor(water / n);
  const drone = createUnit(900_001, 1, 'drone', wx + 0.5, wy + 0.5);
  const tc = [...river.buildings.values()].find((b) => b.owner === 1)!;
  drone.x = tc.tileX - 1.5;
  drone.y = tc.tileY - 1.5;
  river.units.set(drone.id, drone);
  river.enqueueCommand(1, { kind: 'move', unitIds: [drone.id], x: wx, y: wy });
  (river as any).step();
  assert.equal(drone.state, 'moving', 'drone accepts an over-water destination');
  for (let i = 0; i < 2000 && drone.state !== 'idle'; i++) (river as any).step();
  assert.equal(river.map.tiles[Math.floor(drone.y) * n + Math.floor(drone.x)], TILE_WATER, 'drone hovers over water');
  for (const [type, id] of [['attack_drone', 900_011], ['fighter', 900_012]] as const) {
    const air = createUnit(id, 1, type, tc.tileX - 1.5, tc.tileY - 1.5);
    river.units.set(air.id, air);
    river.enqueueCommand(1, { kind: 'move', unitIds: [air.id], x: wx, y: wy });
    (river as any).step();
    assert.equal(air.state, 'moving', `${type} accepts an over-water destination`);
    assert.equal(isFlyingUnit(type), true, `${type} uses the air grid`);
  }
  assert.ok(UNIT_DEFS.rocket_launcher.range > UNIT_DEFS.fighter.range, 'rocket launcher owns the longest strategic range');

  // --- Ledger: facility provenance, sealing, integrity ---
  const proofGame = new Game(member, () => {}, () => {}, 'normal', 'classic', 'symbiosis', 'proof');
  let snap: any = null;
  (proofGame as any).send = (_id: number, msg: ServerMessage) => { if (msg.type === 'snapshot') snap = msg; };
  const house = { ...site(950_000), progress: 1, hp: BUILDING_DEFS.house.hp };
  proofGame.buildings.set(house.id, house);
  for (let i = 0; i < 50; i++) (proofGame as any).step();
  const ledger = proofGame.ledger!;
  assert.equal(ledger.height, 1, 'one block sealed after 50 ticks (plus genesis)');
  assert.ok(ledger.verify(), 'chain verifies');
  const snapHouse = snap.buildings.find((b: any) => b.id === house.id);
  assert.match(snapHouse.proof, /^0x[0-9a-f]{64}$/, 'completed facility carries a provenance hash');
  assert.ok(snap.chain.txs.some((t: any) => t.hash === snapHouse.proof && t.kind === 'facility'));
  const exported = proofGame.ledgerExport()!;
  assert.ok(exported.verified && exported.blocks.length === exported.height + 1);
  const a = new MatchLedger('same');
  const b = new MatchLedger('same');
  a.record(5, 'labor', 1, 'trained:robot', 2); a.seal(50);
  b.record(5, 'labor', 1, 'trained:robot', 2); b.seal(50);
  assert.equal(a.head, b.head, 'ledger is deterministic');
  (a as any).confirmed[1].amount = 999;
  (a as any).confirmed[1].hash = '0xdeadbeef';
  assert.equal(a.verify(), false, 'tampering breaks verification');

  // --- RPC adapter (mocked Anvil) ---
  const head = `0x${'ab'.repeat(32)}`;
  const data = encodeCommitWithLedger('room-1', `sha256:${'cd'.repeat(32)}`, { head, height: 7 });
  assert.equal(data.length, 2 + 8 + 64 * 4, 'four ABI words after the selector');
  assert.ok(data.startsWith('0x97ae7cb4') && data.endsWith('7'.padStart(64, '0')));
  const calls: string[] = [];
  const fakeFetch = (async (_url: string, init: { body: string }) => {
    const { method } = JSON.parse(init.body);
    calls.push(method);
    const result = ({
      eth_accounts: ['0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'],
      eth_chainId: '0x7a69',
      eth_sendTransaction: '0xfeed',
      eth_getTransactionReceipt: { status: '0x1', blockNumber: '0x2a' },
    } as Record<string, unknown>)[method];
    return { json: async () => ({ result }) };
  }) as unknown as typeof fetch;
  const receipt = await new RpcProofAdapter('http://x', '0xregistry', fakeFetch, 1).submit('room-1', `sha256:${'cd'.repeat(32)}`, undefined, { head, height: 7 });
  assert.equal(receipt.status, 'confirmed');
  assert.equal(receipt.blockNumber, 42);
  assert.equal(receipt.chainId, 31337);
  assert.deepEqual(calls, ['eth_accounts', 'eth_chainId', 'eth_sendTransaction', 'eth_getTransactionReceipt']);

  console.log('Automation, power grid, drones, ledger, and RPC proof: PASS');
}

void main().catch((e) => { console.error(e); process.exit(1); });
