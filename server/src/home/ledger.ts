// City ledger: an append-only, hash-chained log of a Home's events (builds,
// upgrades, manufacturing, research, raids, defense, ELON accrual and
// settlement). Blocks commit to their transactions through a Merkle root and
// to the previous block through its hash, exactly like the match ledger.
//
// The state is plain JSON so it lives inside the Home save (one atomic write
// with the economy it describes) and can be appended to while the owner is
// offline (defense deliveries). Only the most recent window is retained;
// verification recomputes every retained link and root.

import { createHash } from 'node:crypto';
import type { ElonSettlement, HomeLedgerBlock, HomeLedgerKind, HomeLedgerTx } from '@age/shared';
import { merkleRoot } from '../chain/ledger';

const ZERO = `0x${'0'.repeat(64)}`;
export const LEDGER_MAX_BLOCKS = 300;
export const LEDGER_MAX_TXS = 600;
export const LEDGER_MAX_SETTLEMENTS = 50;

function sha256(text: string): string {
  return `0x${createHash('sha256').update(text).digest('hex')}`;
}

export interface HomeLedgerState {
  salt: string;
  seq: number;
  /** Height of the next block to seal. */
  nextHeight: number;
  head: string;
  blocks: HomeLedgerBlock[];
  txs: HomeLedgerTx[];
  pending: HomeLedgerTx[];
}

export interface HomeChainState {
  ledger: HomeLedgerState;
  settledTotal: number;
  settlements: ElonSettlement[];
}

const txHash = (salt: string, tx: Omit<HomeLedgerTx, 'hash' | 'block'>) =>
  sha256(`${salt}|${tx.seq}|${tx.at}|${tx.kind}|${tx.label}|${tx.amount}`);
const blockHash = (b: Omit<HomeLedgerBlock, 'hash'>) => sha256(`${b.height}|${b.at}|${b.prevHash}|${b.txRoot}|${b.txCount}`);

export function newChainState(salt: string, at: number): HomeChainState {
  const ledger: HomeLedgerState = { salt, seq: 0, nextHeight: 0, head: ZERO, blocks: [], txs: [], pending: [] };
  recordTx(ledger, at, 'genesis', 'City ledger opened', 0);
  sealBlock(ledger, at);
  return { ledger, settledTotal: 0, settlements: [] };
}

export function recordTx(l: HomeLedgerState, at: number, kind: HomeLedgerKind, label: string, amount: number): HomeLedgerTx {
  const body = { seq: l.seq++, at, kind, label: label.slice(0, 120), amount: Math.round(amount * 100) / 100 };
  const tx: HomeLedgerTx = { ...body, hash: txHash(l.salt, body) };
  l.pending.push(tx);
  return tx;
}

/** Seals pending transactions into a block (no-op when nothing is pending). */
export function sealBlock(l: HomeLedgerState, at: number): HomeLedgerBlock | null {
  if (l.pending.length === 0) return null;
  const body = { height: l.nextHeight++, at, prevHash: l.head, txRoot: merkleRoot(l.pending.map((t) => t.hash)), txCount: l.pending.length };
  const block: HomeLedgerBlock = { ...body, hash: blockHash(body) };
  for (const tx of l.pending) { tx.block = block.height; l.txs.push(tx); }
  l.pending = [];
  l.head = block.hash;
  l.blocks.push(block);
  if (l.blocks.length > LEDGER_MAX_BLOCKS) l.blocks.splice(0, l.blocks.length - LEDGER_MAX_BLOCKS);
  // Retained transactions only for retained blocks, and bounded.
  const oldest = l.blocks[0].height;
  l.txs = l.txs.filter((t) => (t.block ?? oldest) >= oldest);
  if (l.txs.length > LEDGER_MAX_TXS) l.txs.splice(0, l.txs.length - LEDGER_MAX_TXS);
  return block;
}

/** Recomputes every retained block hash and link, every transaction hash, and
 *  the Merkle root of every block whose transactions are all retained. */
export function verifyLedger(l: HomeLedgerState): boolean {
  for (let i = 0; i < l.blocks.length; i++) {
    const b = l.blocks[i];
    if (blockHash(b) !== b.hash) return false;
    if (i > 0 && b.prevHash !== l.blocks[i - 1].hash) return false;
    const txs = l.txs.filter((t) => t.block === b.height);
    if (txs.length === b.txCount && merkleRoot(txs.map((t) => t.hash)) !== b.txRoot) return false;
  }
  for (const t of [...l.txs, ...l.pending]) {
    if (txHash(l.salt, t) !== t.hash) return false;
  }
  return l.blocks.length === 0 || l.blocks[l.blocks.length - 1].hash === l.head;
}
