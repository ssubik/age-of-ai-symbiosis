import { createHash } from 'node:crypto';
import path from 'node:path';
import { canRaidTransition, RAID_NEXT_SCOUT_GOLD } from '@age/shared';
import type { GameCommand, HomeRaidView, LedgerAction, RaidAction, RaidArmy, RaidOutcome, RaidReport, ServerMessage } from '@age/shared';
import { Game } from '../game/room';
import {
  abandonBeforeDeploy, emptyArmy, newRaidRecord, RaidTransitionError, reserveDeadline,
  resolveInterrupted, settleRaid, ticksUntil, transition,
} from '../raid/orchestrator';
import { MemorySnapshotRegistry, type SnapshotRegistry } from '../raid/registry';
import { LocalProofAdapter, proofAdapterFromEnv, RpcProofAdapter, safelySubmitProof, type ProofAdapter } from '../proofs';
import { recordTx } from './ledger';
import { createRaidGame } from '../raid/sim';
import { deployZone } from '../raid/snapshot';
import { JsonHomeRepository, type HomeRepository } from './repository';
import type { DefenseDelivery, RaidSessionRecord } from './types';

interface HomeConnection {
  id: number;
  name: string;
  color: string;
  clientId: string;
  send: (message: ServerMessage) => void;
}

interface ActiveHome {
  connection: HomeConnection;
  profileId: string;
  game: Game;
  timer: ReturnType<typeof setInterval>;
  /** Which world this connection is looking at; the other one stays silent. */
  view: 'home' | 'raid';
  raidGame: Game | null;
  raidTimer: ReturnType<typeof setInterval> | null;
  /** Report shown on the raid result screen until the player returns home. */
  lastReport: RaidReport | null;
}

const RAID_KEYS: readonly (keyof RaidArmy)[] = ['attack_drone', 'fighter', 'rocket_launcher', 'siege_mech', 'stealth_bomber', 'plasma_tank', 'iron_guardian', 'aegis_valkyrie'];

export class HomeManager {
  /** Keyed by connection id; at most one entry per profile (see `enter`). */
  private active = new Map<number, ActiveHome>();
  /** Serializes enter/leave/raid per profile so state changes never interleave. */
  private transitions = new Map<string, Promise<void>>();

  constructor(
    private readonly repository: HomeRepository = new JsonHomeRepository(
      process.env.HOME_DATA_DIR ?? path.resolve(process.cwd(), 'server/profiles'),
    ),
    private readonly now: () => number = Date.now,
    private readonly registry: SnapshotRegistry = new MemorySnapshotRegistry(),
    private readonly proofs: ProofAdapter = proofAdapterFromEnv(),
  ) {}

  private chainMode(): { mode: 'disabled' | 'local' | 'rpc'; contract?: string } {
    if (this.proofs instanceof RpcProofAdapter) return { mode: 'rpc', contract: this.proofs.contract };
    if (this.proofs instanceof LocalProofAdapter) return { mode: 'local' };
    return { mode: 'disabled' };
  }

  private sendLedger(active: ActiveHome): void {
    const { mode, contract } = this.chainMode();
    const view = active.game.ledgerView(mode, contract);
    if (view) active.connection.send({ type: 'ledger', view });
  }

  /** City ledger page: open, settle playable ELON, or retry an anchor. */
  async ledger(playerId: number, action: LedgerAction): Promise<void> {
    const active = this.active.get(playerId);
    if (!active) return;
    let toAnchor: string | null = null;
    await this.serialize(active.profileId, async () => {
      if (this.active.get(playerId) !== active) return;
      if (action.kind === 'settle') {
        const id = `s${(active.game.chain?.ledger.seq ?? 0).toString(36)}-${this.now().toString(36)}`;
        const result = active.game.settleElon(id);
        if (result.error) { active.connection.send({ type: 'error', code: result.error }); return; }
        await this.persist(playerId);
        toAnchor = id;
      } else if (action.kind === 'anchor') {
        const s = active.game.chain?.settlements.find((x) => x.id === action.id);
        if (s && (s.status === 'failed' || s.status === 'pending')) toAnchor = s.id;
      }
      this.sendLedger(active);
    });
    if (toAnchor) await this.anchorSettlement(active, toAnchor);
  }

  /** Anchors the ledger head of a settlement through the chain adapter. The
   *  ELON is already settled in the ledger; this only records where it is proven. */
  private async anchorSettlement(active: ActiveHome, id: string): Promise<void> {
    const s = active.game.chain?.settlements.find((x) => x.id === id);
    if (!s) return;
    const digest = createHash('sha256').update(`${active.profileId}|${s.id}|${s.amount}|${s.ledgerHead}`).digest('hex');
    const result = await safelySubmitProof(this.proofs, `home-settlement:${active.profileId.slice(0, 16)}:${s.id}`, digest, undefined, { head: s.ledgerHead, height: s.ledgerHeight });
    s.status = result.status;
    s.transactionHash = result.transactionHash;
    s.chainId = result.chainId;
    s.blockNumber = result.blockNumber;
    s.contract = result.contract;
    s.error = result.error;
    await this.persist(active.connection.id);
    if (this.active.get(active.connection.id) === active) this.sendLedger(active);
  }

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
        await this.stopSession(other.connection.id);
        other.connection.send({ type: 'error', code: 'err.home_taken_over' });
        other.connection.send({ type: 'leftRoom' });
      }
      const loaded = await this.repository.load(profileId);
      const holder: { active?: ActiveHome } = {};
      const game = new Game(
        [{ id: connection.id, name: connection.name, color: connection.color }],
        (id, message) => { if (id === connection.id && holder.active?.view !== 'raid') connection.send(message); },
        () => undefined,
        'normal',
        'classic',
        'symbiosis',
        profileId,
        { session: 'home', homeState: loaded.save ?? undefined, now: this.now },
      );
      // A raid interrupted by a restart finishes deterministically before Home opens.
      resolveInterrupted(game, this.now(), 'RECOVERY_REQUIRED');
      const timer = setInterval(() => { void this.persist(connection.id); }, 5_000);
      timer.unref?.();
      const active: ActiveHome = { connection, profileId, game, timer, view: 'home', raidGame: null, raidTimer: null, lastReport: null };
      holder.active = active;
      this.active.set(connection.id, active);
      // Record the offline catch-up now rather than at the first periodic save.
      await this.persist(connection.id);
      this.sendHomeStart(active);
      if (loaded.recoveredFromBackup) connection.send({ type: 'error', code: 'err.home_recovered' });
      game.start();
    });
  }

  command(playerId: number, command: GameCommand): void {
    const active = this.active.get(playerId);
    // No direct control during a raid (spec §6.3); keeps replays deterministic.
    if (active?.view === 'home') active.game.enqueueCommand(playerId, command);
  }

  pause(playerId: number, paused: boolean): void {
    const active = this.active.get(playerId);
    if (active?.view === 'home') active.game.setPaused(playerId, paused);
  }

  ping(playerId: number, x: number, y: number): void {
    const active = this.active.get(playerId);
    if (active?.view === 'home') active.game.signalPing(playerId, x, y);
  }

  has(playerId: number): boolean { return this.active.has(playerId); }

  /** Developer slash command against the live Home (then saved and republished). */
  async devCommand(playerId: number, text: string): Promise<string> {
    const active = this.active.get(playerId);
    if (!active || active.view !== 'home') return 'Dev commands run in your city view.';
    const result = active.game.devCommand(playerId, text);
    await this.persist(playerId);
    active.game.pushSnapshot();
    return result;
  }

  /** Test/inspection hook: the live Home simulation for a connection. */
  homeGame(playerId: number): Game | undefined { return this.active.get(playerId)?.game; }
  raidGame(playerId: number): Game | undefined { return this.active.get(playerId)?.raidGame ?? undefined; }

  async raid(playerId: number, action: RaidAction): Promise<void> {
    const active = this.active.get(playerId);
    if (!active) return;
    await this.serialize(active.profileId, async () => {
      if (this.active.get(playerId) !== active) return;
      try {
        this.applyRaidAction(active, action);
      } catch (error) {
        if (!(error instanceof RaidTransitionError)) throw error;
        // Stale or duplicate request (double click, late packet): reject, change nothing.
        active.connection.send({ type: 'error', code: 'err.raid_stale' });
        return;
      }
      await this.persist(playerId);
    });
  }

  private applyRaidAction(active: ActiveHome, action: RaidAction): void {
    const home = active.game;
    const now = this.now();
    const record = home.raidData.active;
    const error = (code: string) => active.connection.send({ type: 'error', code });
    switch (action.kind) {
      case 'scout': {
        if (record) { error('err.raid_busy'); return; }
        home.raidData.active = newRaidRecord(home, active.profileId, now, this.registry.entries());
        this.openRaidView(active);
        return;
      }
      case 'next': {
        if (!record) return;
        transition(record, 'SCOUTING');
        if (!home.spendHomeGold(RAID_NEXT_SCOUT_GOLD)) { error('err.no_resources'); return; }
        home.raidData.active = newRaidRecord(home, active.profileId, now, this.registry.entries());
        this.openRaidView(active);
        return;
      }
      case 'reserve': {
        if (!record) return;
        if (record.state === 'SCOUTING' && now > record.offer.expiresAt) { this.expireScout(active, record); return; }
        if (!canRaidTransition(record.state, 'ARMY_RESERVED')) throw new RaidTransitionError(record.state, 'ARMY_RESERVED');
        const army = emptyArmy();
        for (const key of RAID_KEYS) army[key] = Math.max(0, Math.floor(Number(action.army?.[key]) || 0));
        // All-or-nothing: units leave Home only if every requested one exists.
        const units = Object.values(army).some((n) => n > 0) ? home.takeForRaid(army) : null;
        if (!units) { error('err.raid_not_manufactured'); return; }
        transition(record, 'ARMY_RESERVED');
        record.reserved = units;
        record.reservedArmy = army;
        // Research is pinned now; later Home research never changes this raid or its replay.
        record.research = {};
        for (const key of RAID_KEYS) {
          const level = home.progression.research[key] ?? 0;
          if (level > 0) record.research[key] = level;
        }
        record.deadline = reserveDeadline(now);
        active.raidGame?.setRaidReserve(army, ticksUntil(record.deadline, now), record.research);
        this.refreshRaidView(active);
        return;
      }
      case 'deploy': {
        const raid = active.raidGame;
        if (!record || !raid || (record.state !== 'ARMY_RESERVED' && record.state !== 'IN_PROGRESS')) { error('err.raid_stale'); return; }
        if (!RAID_KEYS.includes(action.unit)) return;
        const first = record.state === 'ARMY_RESERVED';
        if (first) {
          const maxTicks = ticksUntil(record.deadline ?? now, now);
          if (maxTicks <= 0) { this.cancelReservation(active, record); return; }
          raid.setRaidReserve(record.reservedArmy, maxTicks, record.research);
          record.maxTicks = maxTicks;
        }
        const tick = raid.tickNow;
        const rejected = raid.raidDeploy(action.unit, action.x, action.y);
        if (rejected) { error(rejected); return; }
        // The unit is consumed now, once, in the same record that logs the event.
        const index = record.reserved.findIndex((u) => u.type === action.unit);
        const [unit] = record.reserved.splice(index, 1);
        record.deploys.push({ tick, unit: action.unit, x: action.x, y: action.y, homeUnitId: unit.id });
        if (first) {
          transition(record, 'IN_PROGRESS');
          // Attacking breaks your own shield (spec §6.6).
          if (home.progression.shieldUntil > now) home.progression.shieldUntil = now;
          raid.start();
        }
        this.refreshRaidView(active);
        return;
      }
      case 'surrender': {
        if (!record) return;
        if (record.state === 'ARMY_RESERVED' || record.state === 'SCOUTING') { this.cancelReservation(active, record); return; }
        if (record.state !== 'IN_PROGRESS') return;
        const at = active.raidGame?.raidSurrender();
        if (at !== undefined) record.surrenderAt = at;
        return;
      }
      case 'cancel': {
        if (record && (record.state === 'SCOUTING' || record.state === 'ARMY_RESERVED')) this.cancelReservation(active, record);
        else if (!record) this.openHomeView(active);
        return;
      }
      case 'return': {
        if (record && record.state !== 'SETTLED') return; // raid still live: stay on it
        this.openHomeView(active);
        return;
      }
    }
  }

  private cancelReservation(active: ActiveHome, record: RaidSessionRecord): void {
    abandonBeforeDeploy(active.game, record, 'CANCELLED_BEFORE_DEPLOY');
    this.openHomeView(active);
  }

  private expireScout(active: ActiveHome, record: RaidSessionRecord): void {
    abandonBeforeDeploy(active.game, record, 'SCOUT_EXPIRED');
    active.connection.send({ type: 'error', code: 'err.raid_scout_expired' });
    this.openHomeView(active);
  }

  private viewOf(active: ActiveHome, record: RaidSessionRecord | null): HomeRaidView | null {
    const now = this.now();
    const shown = record ?? null;
    const report = active.lastReport ?? undefined;
    const snapshot = shown?.snapshot;
    if (!snapshot) return null;
    return {
      state: shown.state,
      opponent: shown.defenderProfileId ? 'player' : 'bot',
      label: snapshot.label,
      cityLevel: snapshot.cityLevel,
      ...(shown.state === 'SCOUTING' ? { expiresIn: Math.max(0, Math.ceil((shown.offer.expiresAt - now) / 1000)) } : {}),
      nextScoutGold: RAID_NEXT_SCOUT_GOLD,
      available: active.game.homeArmy(),
      reward: { ...shown.offer.reward },
      trophies: { win: shown.offer.trophiesWin, loss: shown.offer.trophiesLoss },
      zone: deployZone(snapshot),
      ...(report && report.raidId === shown.id ? { report } : {}),
    };
  }

  private refreshRaidView(active: ActiveHome, settled?: RaidSessionRecord): void {
    const view = this.viewOf(active, settled ?? active.game.raidData.active);
    if (!view || !active.raidGame) return;
    active.raidGame.setRaidView(view);
    active.raidGame.pushSnapshot();
  }

  private openRaidView(active: ActiveHome): void {
    const record = active.game.raidData.active;
    if (!record) return;
    this.closeRaidGame(active);
    active.lastReport = null;
    const { connection } = active;
    const raidGame = createRaidGame(
      record.snapshot,
      { id: connection.id, name: connection.name, color: connection.color },
      (id, message) => { if (id === connection.id && active.view === 'raid' && active.raidGame === raidGame) connection.send(message); },
      (outcome) => this.onRaidEnd(active, record, outcome),
    );
    active.raidGame = raidGame;
    active.view = 'raid';
    connection.send({
      type: 'gameStart', map: raidGame.map, players: raidGame.toPlayerInfos(), you: connection.id,
      fog: false, experience: 'symbiosis', session: 'raid',
    });
    this.refreshRaidView(active);
    active.raidTimer = setInterval(() => { void this.raidClock(active); }, 1_000);
    active.raidTimer.unref?.();
  }

  /** Once a second: countdowns, scout expiry and unused-reservation timeout. */
  private async raidClock(active: ActiveHome): Promise<void> {
    await this.serialize(active.profileId, async () => {
      if (this.active.get(active.connection.id) !== active || active.view !== 'raid') return;
      const record = active.game.raidData.active;
      const now = this.now();
      if (record?.state === 'SCOUTING' && now > record.offer.expiresAt) this.expireScout(active, record);
      else if (record?.state === 'ARMY_RESERVED' && now > (record.deadline ?? now)) this.cancelReservation(active, record);
      else if (record && record.state !== 'IN_PROGRESS') this.refreshRaidView(active);
      else return;
      await this.persist(active.connection.id);
    });
  }

  /** Live raid finished inside a raid tick: settle exactly once, show the report. */
  private onRaidEnd(active: ActiveHome, record: RaidSessionRecord, outcome: RaidOutcome): void {
    if (record.state !== 'IN_PROGRESS') return;
    record.outcome = outcome;
    transition(record, 'SETTLING');
    active.lastReport = settleRaid(active.game, record, this.now());
    this.refreshRaidView(active, record);
    void this.persist(active.connection.id);
  }

  private closeRaidGame(active: ActiveHome): void {
    if (active.raidTimer) clearInterval(active.raidTimer);
    active.raidTimer = null;
    active.raidGame?.stop();
    active.raidGame = null;
  }

  private openHomeView(active: ActiveHome): void {
    this.closeRaidGame(active);
    active.view = 'home';
    this.sendHomeStart(active);
  }

  private sendHomeStart(active: ActiveHome): void {
    const { game, connection } = active;
    connection.send({
      type: 'gameStart', map: game.map, players: game.toPlayerInfos(), you: connection.id,
      fog: false, experience: 'symbiosis', session: 'home',
    });
    game.pushSnapshot();
  }

  private async persist(playerId: number): Promise<void> {
    const active = this.active.get(playerId);
    if (!active) return;
    try {
      await this.repository.save(active.game.captureHomeState(active.profileId));
      await this.publishDefense(active);
    } catch (error) {
      console.error('[home] periodic save failed', error);
    }
    // Not awaited: deliveries take the defender's lock, never inside our own.
    if (active.game.raidData.outbox.length) void this.flushOutbox(active);
  }

  /** Publishes a new immutable snapshot when the confirmed layout changed, and
   *  keeps matchmaking metadata (trophies, shield) current. */
  private async publishDefense(active: ActiveHome): Promise<void> {
    const { game } = active;
    const signature = game.defenseSignature();
    if (signature !== game.progression.publishedSignature) {
      const ownerKey = createHash('sha256').update(`age-of-ai-defense:${active.profileId}`).digest('hex');
      const snapshot = game.captureDefenseSnapshot(`${game.homeName}'s City`, ownerKey);
      if (!snapshot) return;
      await this.registry.publish({
        profileId: active.profileId, snapshot, cityLevel: snapshot.cityLevel,
        trophies: game.raidData.trophies, shieldUntil: game.progression.shieldUntil, publishedAt: this.now(),
      });
      game.progression.publishedSignature = signature;
      game.progression.publishedSnapshotId = snapshot.id;
      return;
    }
    await this.registry.updateMeta(active.profileId, { trophies: game.raidData.trophies, shieldUntil: game.progression.shieldUntil });
  }

  private flushing = new Set<string>();

  /** Delivers defender reports/shields; each entry leaves the outbox only after it landed. */
  private async flushOutbox(active: ActiveHome): Promise<void> {
    if (this.flushing.has(active.profileId)) return;
    this.flushing.add(active.profileId);
    try {
      for (const delivery of [...active.game.raidData.outbox]) {
        try {
          await this.deliverDefense(delivery);
        } catch (error) {
          console.error('[home] defense delivery failed; will retry', error);
          return;
        }
        const outbox = active.game.raidData.outbox;
        const index = outbox.findIndex((d) => d.report.raidId === delivery.report.raidId);
        if (index >= 0) outbox.splice(index, 1);
      }
      if (this.active.get(active.connection.id) === active) {
        await this.repository.save(active.game.captureHomeState(active.profileId));
      }
    } finally {
      this.flushing.delete(active.profileId);
    }
  }

  /** Idempotent by raid id: a report already present is not applied again. */
  async deliverDefense(delivery: DefenseDelivery): Promise<void> {
    const apply = (progression: { defenseReports: DefenseDelivery['report'][]; shieldUntil: number }): number => {
      if (!progression.defenseReports.some((r) => r.raidId === delivery.report.raidId)) {
        progression.defenseReports.unshift(delivery.report);
        progression.defenseReports.length = Math.min(progression.defenseReports.length, 20);
        progression.shieldUntil = Math.max(progression.shieldUntil, delivery.shieldUntil);
      }
      return progression.shieldUntil;
    };
    let shieldUntil: number | undefined;
    const online = [...this.active.values()].find((a) => a.profileId === delivery.defenderProfileId);
    const label = `${delivery.report.attacker} raided you: ${delivery.report.stars}★ ${delivery.report.destruction}%`;
    if (online) {
      if (!online.game.progression.defenseReports.some((r) => r.raidId === delivery.report.raidId)) online.game.recordHomeEvent('defense', label);
      shieldUntil = apply(online.game.progression);
      await this.repository.save(online.game.captureHomeState(online.profileId));
    } else {
      await this.serialize(delivery.defenderProfileId, async () => {
        const loaded = await this.repository.load(delivery.defenderProfileId);
        if (!loaded.save) return; // defender profile no longer exists: nothing to tell
        if (loaded.save.chain && !loaded.save.progression.defenseReports.some((r) => r.raidId === delivery.report.raidId)) {
          recordTx(loaded.save.chain.ledger, this.now(), 'defense', label, 0);
        }
        shieldUntil = apply(loaded.save.progression);
        await this.repository.save(loaded.save);
      });
    }
    if (shieldUntil !== undefined) await this.registry.updateMeta(delivery.defenderProfileId, { shieldUntil });
  }

  private async stopSession(playerId: number): Promise<void> {
    const active = this.active.get(playerId);
    if (!active) return;
    this.active.delete(playerId);
    clearInterval(active.timer);
    this.closeRaidGame(active);
    active.game.stop();
    // Leaving mid-raid: finish it from the recorded deployments, then save once.
    resolveInterrupted(active.game, this.now(), 'EXPIRED_DURING_RAID');
    await this.repository.save(active.game.captureHomeState(active.profileId));
  }

  async leave(playerId: number): Promise<void> {
    const active = this.active.get(playerId);
    if (!active) return;
    await this.serialize(active.profileId, () => this.stopSession(playerId));
  }
}
