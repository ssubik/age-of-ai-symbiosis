import { createHash } from 'node:crypto';
import path from 'node:path';
import type { GameCommand, ServerMessage } from '@age/shared';
import { Game } from '../game/room';
import { JsonHomeRepository, type HomeRepository } from './repository';

interface HomeConnection {
  id: number;
  name: string;
  color: string;
  clientId: string;
  send: (message: ServerMessage) => void;
}

interface ActiveHome {
  connectionId: number;
  profileId: string;
  game: Game;
  timer: ReturnType<typeof setInterval>;
  send: (message: ServerMessage) => void;
}

export class HomeManager {
  /** Keyed by connection id; at most one entry per profile (see `enter`). */
  private active = new Map<number, ActiveHome>();
  /** Serializes enter/leave per profile so two tabs never load the same save twice. */
  private transitions = new Map<string, Promise<void>>();

  constructor(
    private readonly repository: HomeRepository = new JsonHomeRepository(
      process.env.HOME_DATA_DIR ?? path.resolve(process.cwd(), 'server/profiles'),
    ),
  ) {}

  static profileId(clientId: string): string {
    return createHash('sha256').update(`age-of-ai-home:v1:${clientId}`).digest('hex');
  }

  private serialize(profileId: string, work: () => Promise<void>): Promise<void> {
    const previous = this.transitions.get(profileId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.transitions.set(profileId, next);
    return next.finally(() => {
      if (this.transitions.get(profileId) === next) this.transitions.delete(profileId);
    });
  }

  async enter(connection: HomeConnection): Promise<void> {
    const profileId = HomeManager.profileId(connection.clientId);
    await this.serialize(profileId, async () => {
      await this.stopSession(connection.id);
      // Same profile open elsewhere (second tab, or reconnect before the old
      // socket closed): save and close that session so this one loads its state.
      for (const other of [...this.active.values()]) {
        if (other.profileId !== profileId) continue;
        await this.stopSession(other.connectionId);
        other.send({ type: 'error', code: 'err.home_taken_over' });
        other.send({ type: 'leftRoom' });
      }
      const loaded = await this.repository.load(profileId);
      const game = new Game(
        [{ id: connection.id, name: connection.name, color: connection.color }],
        (id, message) => { if (id === connection.id) connection.send(message); },
        () => undefined,
        'normal',
        'classic',
        'symbiosis',
        profileId,
        { session: 'home', homeState: loaded.save ?? undefined },
      );
      const timer = setInterval(() => { void this.persist(connection.id); }, 5_000);
      timer.unref?.();
      this.active.set(connection.id, { connectionId: connection.id, profileId, game, timer, send: connection.send });
      // Record the offline catch-up now rather than at the first periodic save.
      await this.persist(connection.id);
      connection.send({
        type: 'gameStart', map: game.map, players: game.toPlayerInfos(), you: connection.id,
        fog: false, experience: 'symbiosis', session: 'home',
      });
      if (loaded.recoveredFromBackup) connection.send({ type: 'error', code: 'err.home_recovered' });
      game.start();
    });
  }

  command(playerId: number, command: GameCommand): void {
    this.active.get(playerId)?.game.enqueueCommand(playerId, command);
  }

  pause(playerId: number, paused: boolean): void {
    this.active.get(playerId)?.game.setPaused(playerId, paused);
  }

  ping(playerId: number, x: number, y: number): void {
    this.active.get(playerId)?.game.signalPing(playerId, x, y);
  }

  has(playerId: number): boolean { return this.active.has(playerId); }

  private async persist(playerId: number): Promise<void> {
    const active = this.active.get(playerId);
    if (!active) return;
    try {
      await this.repository.save(active.game.captureHomeState(active.profileId));
    } catch (error) {
      console.error('[home] periodic save failed', error);
    }
  }

  private async stopSession(playerId: number): Promise<void> {
    const active = this.active.get(playerId);
    if (!active) return;
    this.active.delete(playerId);
    clearInterval(active.timer);
    active.game.stop();
    await this.repository.save(active.game.captureHomeState(active.profileId));
  }

  async leave(playerId: number): Promise<void> {
    const active = this.active.get(playerId);
    if (!active) return;
    await this.serialize(active.profileId, () => this.stopSession(playerId));
  }
}
