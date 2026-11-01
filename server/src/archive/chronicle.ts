import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChainBlock, ChainTx, ElonEvent, MatchReport, Standing } from '@age/shared';
import type { FacilityRecord } from '../game/room';
import type { Resources } from '@age/shared';

export interface MatchChronicle {
  schema: 'age-of-symbiosis/chronicle-v1';
  matchId: string;
  finishedTick: number;
  winnerName: string;
  players: { id: number; name: string; elon: number; age: number; defeated: boolean; buildings: number; units: number; resources: Resources }[];
  activity: {
    buildingsConstructed: FacilityRecord[];
    unitsTrained: ElonEvent[];
    agesReached: ElonEvent[];
    battles: unknown[];
    councilRecommendations: unknown[];
  };
  elonEvents: ElonEvent[];
  /** WATT stewardship table: standing + stewardship + reliability recognition. */
  standings?: Standing[];
  /** Developer shortcuts were used during this match. */
  dev?: boolean;
  /** Symbiosis match ledger: every block and transaction, plus its verified head. */
  ledger?: { head: string; height: number; verified: boolean; blocks: ChainBlock[]; txs: ChainTx[] };
  /** Post-battle intelligence: per-player stats, timeline, strength samples, commander decisions. */
  report?: MatchReport;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortValue(v)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function archiveHash(chronicle: MatchChronicle): string {
  return `sha256:${createHash('sha256').update(canonicalJson(chronicle)).digest('hex')}`;
}

export function humanSummary(c: MatchChronicle): string {
  const table = c.standings?.length
    ? c.standings.map((r) => `${r.rank}. ${r.name}: score ${r.score} = standing ${r.standing} + stewardship ${r.stewardship} + reliability bonus ${r.bonus} (${(r.reliabilityPpm / 10000).toFixed(2)}% of ${r.declaredNeed} declared need served)`).join('\n')
    : [...c.players].sort((a, b) => b.elon - a.elon || a.id - b.id).map((p) => `- ${p.name}: ELON ${p.elon}, age ${p.age}${p.defeated ? ', defeated' : ''}`).join('\n');
  return `Age of Symbiosis match ${c.matchId}\nWinner: ${c.winnerName || 'none'}\nFinished tick: ${c.finishedTick}\n\nStewardship record\n${table}\n\nFacilities completed: ${c.activity.buildingsConstructed.length}\nWorkers trained: ${c.activity.unitsTrained.length}\nAges reached: ${c.activity.agesReached.length}\nELON events: ${c.elonEvents.length}\n${c.ledger ? `Ledger: ${c.ledger.height + 1} blocks, head ${c.ledger.head}, ${c.ledger.verified ? 'verified' : 'BROKEN'}\n` : ''}${c.report ? `\nWhat decided it\n${c.report.insights.map((line) => `- ${line}`).join('\n')}\n` : ''}`;
}

export function archiveDir(baseDir = process.env.MATCH_ARCHIVE_DIR || 'archives'): string {
  return path.resolve(baseDir);
}

export function safeMatchId(matchId: string): string {
  return matchId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export async function writeProof(matchId: string, proof: unknown, baseDir?: string): Promise<void> {
  const dir = archiveDir(baseDir);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${safeMatchId(matchId)}.proof.json`), `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
}

export async function writeChronicle(c: MatchChronicle, baseDir?: string): Promise<{ jsonPath: string; summaryPath: string; hash: string }> {
  const dir = archiveDir(baseDir);
  await mkdir(dir, { recursive: true });
  const safeId = safeMatchId(c.matchId);
  const jsonPath = path.join(dir, `${safeId}.json`);
  const summaryPath = path.join(dir, `${safeId}.txt`);
  await Promise.all([
    writeFile(jsonPath, `${canonicalJson(c)}\n`, 'utf8'),
    writeFile(summaryPath, humanSummary(c), 'utf8'),
  ]);
  return { jsonPath, summaryPath, hash: archiveHash(c) };
}
