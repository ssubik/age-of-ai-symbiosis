import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ElonEvent } from '@age/shared';
import type { Resources } from '@age/shared';

export interface MatchChronicle {
  schema: 'age-of-symbiosis/chronicle-v1';
  matchId: string;
  finishedTick: number;
  winnerName: string;
  players: { id: number; name: string; elon: number; age: number; defeated: boolean; buildings: number; units: number; resources: Resources }[];
  activity: {
    buildingsConstructed: ElonEvent[];
    unitsTrained: ElonEvent[];
    agesReached: ElonEvent[];
    battles: unknown[];
    councilRecommendations: unknown[];
  };
  elonEvents: ElonEvent[];
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
  const standings = [...c.players].sort((a, b) => b.elon - a.elon || a.id - b.id)
    .map((p) => `- ${p.name}: ELON ${p.elon}, age ${p.age}${p.defeated ? ', defeated' : ''}`).join('\n');
  return `Age of Symbiosis match ${c.matchId}\nWinner: ${c.winnerName || 'none'}\nFinished tick: ${c.finishedTick}\n\nContribution standing\n${standings}\n\nFacilities completed: ${c.activity.buildingsConstructed.length}\nWorkers trained: ${c.activity.unitsTrained.length}\nAges reached: ${c.activity.agesReached.length}\nELON events: ${c.elonEvents.length}\n`;
}

export async function writeChronicle(c: MatchChronicle, baseDir = process.env.MATCH_ARCHIVE_DIR || 'archives'): Promise<{ jsonPath: string; summaryPath: string; hash: string }> {
  const dir = path.resolve(baseDir);
  await mkdir(dir, { recursive: true });
  const safeId = c.matchId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const jsonPath = path.join(dir, `${safeId}.json`);
  const summaryPath = path.join(dir, `${safeId}.txt`);
  await Promise.all([
    writeFile(jsonPath, `${canonicalJson(c)}\n`, 'utf8'),
    writeFile(summaryPath, humanSummary(c), 'utf8'),
  ]);
  return { jsonPath, summaryPath, hash: archiveHash(c) };
}
