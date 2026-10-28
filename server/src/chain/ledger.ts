import { createHash } from 'node:crypto';
import type { ChainBlock, ChainSnap, ChainTx, ChainTxKind } from '@age/shared';

const ZERO = `0x${'0'.repeat(64)}`;

function sha256(text: string): string {
  return `0x${createHash('sha256').update(text).digest('hex')}`;
}

export function merkleRoot(hashes: string[]): string {
  if (hashes.length === 0) return ZERO;
  let level = hashes;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256(level[i] + (level[i + 1] ?? level[i])));
    level = next;
  }
  return level[0];
}

/** Deterministic, server-authoritative hash chain of match contribution events.
 *  Pure bookkeeping: it never feeds back into simulation rules. */
export class MatchLedger {
  private readonly blocks: ChainBlock[] = [];
  private readonly confirmed: ChainTx[] = [];
  private pending: ChainTx[] = [];
  private seq = 0;

  constructor(readonly matchSalt: string) {
    const genesis = this.makeTx(0, 'genesis', -1, `genesis:${matchSalt}`, 0);
    this.pending.push(genesis);
    this.seal(0);
  }

  get height(): number {
    return this.blocks.length - 1;
  }

  get head(): string {
    return this.blocks[this.blocks.length - 1].hash;
  }

  private makeTx(tick: number, kind: ChainTxKind, playerId: number, label: string, amount: number): ChainTx {
    const hash = sha256(`${this.matchSalt}|${this.seq++}|${tick}|${kind}|${playerId}|${label}|${amount}`);
    return { hash, tick, kind, playerId, label, amount };
  }

  record(tick: number, kind: ChainTxKind, playerId: number, label: string, amount: number): ChainTx {
    const tx = this.makeTx(tick, kind, playerId, label, amount);
    this.pending.push(tx);
    return tx;
  }

  seal(tick: number): ChainBlock {
    const prevHash = this.blocks.length > 0 ? this.head : ZERO;
    const height = this.blocks.length;
    const txRoot = merkleRoot(this.pending.map((tx) => tx.hash));
    const hash = sha256(`${height}|${tick}|${prevHash}|${txRoot}|${this.pending.length}`);
    const block: ChainBlock = { height, tick, hash, prevHash, txRoot, txCount: this.pending.length };
    for (const tx of this.pending) {
      tx.block = height;
      this.confirmed.push(tx);
    }
    this.pending = [];
    this.blocks.push(block);
    return block;
  }

  snapshot(): ChainSnap {
    return {
      height: this.height,
      head: this.head,
      pending: this.pending.length,
      blocks: this.blocks.slice(-6).reverse(),
      txs: [...this.pending.slice(-10).reverse(), ...this.confirmed.slice(-10).reverse()].slice(0, 10),
    };
  }

  /** Recomputes every link; true only when the whole chain is intact. */
  verify(): boolean {
    let prev = ZERO;
    let txIndex = 0;
    for (const b of this.blocks) {
      const txs = this.confirmed.slice(txIndex, txIndex + b.txCount);
      txIndex += b.txCount;
      if (b.prevHash !== prev) return false;
      if (merkleRoot(txs.map((t) => t.hash)) !== b.txRoot) return false;
      if (sha256(`${b.height}|${b.tick}|${b.prevHash}|${b.txRoot}|${b.txCount}`) !== b.hash) return false;
      prev = b.hash;
    }
    return true;
  }

  export(): { blocks: ChainBlock[]; txs: ChainTx[] } {
    return { blocks: this.blocks.map((b) => ({ ...b })), txs: this.confirmed.map((t) => ({ ...t })) };
  }
}
