import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { HomeLoadResult, HomeSave } from './types';

export interface HomeRepository {
  load(profileId: string): Promise<HomeLoadResult>;
  save(record: HomeSave): Promise<void>;
}

function safeProfileId(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('invalid home profile id');
  return value;
}

/** Ordered schema migrations, oldest first. Each takes version N to N+1. */
const MIGRATIONS: Record<number, (record: Record<string, unknown>) => Record<string, unknown>> = {
  1: (v1) => ({ ...v1, version: 2, raid: { trophies: 0, scoutCounter: 0, active: null, reports: [], settled: [] } }),
  2: (v2) => {
    // Phase 1 stored a Hub upgrade as an unfinished site; it now stays complete
    // with its own upgrade progress.
    const buildings = (v2.buildings as Record<string, unknown>[] | undefined)?.map((b) => (
      b.upgradeTargetLevel !== undefined && typeof b.progress === 'number' && b.progress < 1
        ? { ...b, upgradeProgress: b.progress, progress: 1 }
        : b
    ));
    return {
      ...v2,
      version: 3,
      buildings,
      raid: { ...(v2.raid as object), outbox: [] },
      progression: { research: {}, shieldUntil: 0, defenseReports: [], publishedSignature: '' },
    };
  },
  // The city ledger starts (with a genesis block) the first time the save loads.
  3: (v3) => ({ ...v3, version: 4, chain: null }),
};
const CURRENT_VERSION = 4;

export function migrateHomeSave(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  let record = raw as Record<string, unknown>;
  while (typeof record.version === 'number' && record.version < CURRENT_VERSION && MIGRATIONS[record.version]) {
    record = MIGRATIONS[record.version](record);
  }
  return record;
}

function validate(input: unknown): HomeSave {
  const raw = migrateHomeSave(input);
  if (!raw || typeof raw !== 'object') throw new Error('home save is not an object');
  const record = raw as HomeSave;
  if (record.version !== CURRENT_VERSION) throw new Error(`unsupported home save version: ${String((record as { version?: unknown }).version)}`);
  safeProfileId(record.profileId);
  if (!Number.isInteger(record.revision) || record.revision < 0) throw new Error('invalid home revision');
  if (!Number.isFinite(record.savedAt) || !Number.isFinite(record.tick) || !Number.isFinite(record.nextId)) throw new Error('invalid home clocks');
  if (!record.map || !Number.isInteger(record.map.size) || record.map.size < 8 || record.map.tiles.length !== record.map.size * record.map.size) throw new Error('invalid home map');
  if (!record.player || !record.player.resources || !Array.isArray(record.player.techs)) throw new Error('invalid home player');
  if (!Array.isArray(record.buildings) || !Array.isArray(record.units) || !Array.isArray(record.nodes) || !Array.isArray(record.sheep)) throw new Error('invalid home entities');
  for (const value of Object.values(record.player.resources)) if (!Number.isFinite(value) || value < 0) throw new Error('invalid home resources');
  const raid = record.raid;
  if (!raid || !Number.isFinite(raid.trophies) || !Array.isArray(raid.reports) || !Array.isArray(raid.settled)) throw new Error('invalid home raid ledger');
  if (raid.active && (!raid.active.snapshot || !Array.isArray(raid.active.reserved) || !Array.isArray(raid.active.deploys))) throw new Error('invalid active raid');
  if (!Array.isArray(raid.outbox)) throw new Error('invalid raid outbox');
  const progression = record.progression;
  if (record.chain !== null && (typeof record.chain !== 'object' || !record.chain.ledger || !Array.isArray(record.chain.ledger.blocks) || !Array.isArray(record.chain.settlements))) throw new Error('invalid city ledger');
  if (!progression || typeof progression.research !== 'object' || !Number.isFinite(progression.shieldUntil) || !Array.isArray(progression.defenseReports)) throw new Error('invalid home progression');
  return structuredClone(record);
}

export class JsonHomeRepository implements HomeRepository {
  private queues = new Map<string, Promise<void>>();

  constructor(private readonly directory: string) {}

  private file(profileId: string): string {
    return path.join(this.directory, `${safeProfileId(profileId)}.json`);
  }

  private async read(file: string): Promise<HomeSave | null> {
    try {
      return validate(JSON.parse(await readFile(file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async load(profileId: string): Promise<HomeLoadResult> {
    await this.queues.get(profileId)?.catch(() => undefined);
    const file = this.file(profileId);
    try {
      return { save: await this.read(file), recoveredFromBackup: false };
    } catch (primaryError) {
      try {
        const backup = await this.read(`${file}.bak`);
        if (backup) return { save: backup, recoveredFromBackup: true };
      } catch {
        // Report the primary corruption because it names the file players expect.
      }
      throw primaryError;
    }
  }

  async save(record: HomeSave): Promise<void> {
    const clean = validate(record);
    const key = clean.profileId;
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      await mkdir(this.directory, { recursive: true });
      const file = this.file(key);
      const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temp, `${JSON.stringify(clean, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      try {
        await unlink(`${file}.bak`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      try {
        await rename(file, `${file}.bak`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await rename(temp, file);
    });
    this.queues.set(key, next);
    try {
      await next;
    } finally {
      if (this.queues.get(key) === next) this.queues.delete(key);
    }
  }
}

