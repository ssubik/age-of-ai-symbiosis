import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { HomeLoadResult, HomeSaveV1 } from './types';

export interface HomeRepository {
  load(profileId: string): Promise<HomeLoadResult>;
  save(record: HomeSaveV1): Promise<void>;
}

function safeProfileId(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('invalid home profile id');
  return value;
}

function validate(raw: unknown): HomeSaveV1 {
  if (!raw || typeof raw !== 'object') throw new Error('home save is not an object');
  const record = raw as HomeSaveV1;
  if (record.version !== 1) throw new Error(`unsupported home save version: ${String((record as { version?: unknown }).version)}`);
  safeProfileId(record.profileId);
  if (!Number.isInteger(record.revision) || record.revision < 0) throw new Error('invalid home revision');
  if (!Number.isFinite(record.savedAt) || !Number.isFinite(record.tick) || !Number.isFinite(record.nextId)) throw new Error('invalid home clocks');
  if (!record.map || !Number.isInteger(record.map.size) || record.map.size < 8 || record.map.tiles.length !== record.map.size * record.map.size) throw new Error('invalid home map');
  if (!record.player || !record.player.resources || !Array.isArray(record.player.techs)) throw new Error('invalid home player');
  if (!Array.isArray(record.buildings) || !Array.isArray(record.units) || !Array.isArray(record.nodes) || !Array.isArray(record.sheep)) throw new Error('invalid home entities');
  for (const value of Object.values(record.player.resources)) if (!Number.isFinite(value) || value < 0) throw new Error('invalid home resources');
  return structuredClone(record);
}

export class JsonHomeRepository implements HomeRepository {
  private queues = new Map<string, Promise<void>>();

  constructor(private readonly directory: string) {}

  private file(profileId: string): string {
    return path.join(this.directory, `${safeProfileId(profileId)}.json`);
  }

  private async read(file: string): Promise<HomeSaveV1 | null> {
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

  async save(record: HomeSaveV1): Promise<void> {
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

