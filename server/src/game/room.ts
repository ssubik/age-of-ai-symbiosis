// Simulação de uma partida: estado, tick loop e aplicação de comandos.
// Autoritativo — o cliente só manda intenções (GameCommand) e recebe snapshots.

import {
  AGE_COSTS,
  AGE_RESEARCH_TIME,
  BUILDING_DEFS,
  buildingsToAdvance,
  countsForAgeUp,
  FARM_FOOD,
  GATHER_RATE,
  MAX_AGE,
  NODE_DEFS,
  POP_CAP_MAX,
  SNAPSHOT_TICKS,
  STARTING_RESOURCES,
  BATTLE_STARTING_RESOURCES,
  BATTLE_STARTING_AGE,
  TECH_DEFS,
  MARKET_PRICE_MAX,
  MARKET_PRICE_MIN,
  MARKET_PRICE_STEP,
  MARKET_START_PRICE,
  TICK_MS,
  TICK_RATE,
  LAYER_GATE,
  LAYER_OUTPUT,
  BUILDING_POWER_DRAW,
  layerGateMet,
  DEFENSE_DEFS,
  GARRISON_CAP,
  buildingRange,
  buildingAttack,
  TRADE_LOT,
  TRAIN_QUEUE_MAX,
  UNIT_AGE_REQ,
  UNIT_DEFS,
  isNavalUnit,
  BOAT_SEPARATION,
  FISH_BOAT_CARRY,
  TILE_GRASS,
  TILE_WATER,
  TRANSPORT_CAP,
  SHEEP_CONVERT_RANGE,
  SHEEP_CONVERT_EVERY_TICKS,
  SHEEP_DECAY_PER_S,
  SHEEP_FATTEN_PER_S,
  SHEEP_FOOD,
  SHEEP_FOOD_MAX,
  SHEEP_WILD_OWNER,
  SHEEP_SPEED,
  carryCapacity,
  gatherMultiplier,
  techBonus,
  tradeBuyCost,
  tradeSellGain,
  BUILD_RATE,
  CHAIN_BLOCK_TICKS,
  POWER_DRAW,
  SYMBIOSIS_UNITS,
  SYMBIOSIS_COMBAT_UNITS,
  TOWN_CENTER_POWER,
  isBuilderUnit,
  isFlyingUnit,
  powerEfficiency,
  ELON_UNIT_COST,
  HOME_BASE_STORAGE,
  HOME_CAMP_SPACE,
  HOME_STARTED_JOB_REFUND,
  RAID_MAX_REPORTS,
  RAID_MAX_SETTLED_KEYS,
  HOME_BUILDING_CITY_LEVEL,
  HOME_CITY_LEVELS,
  HOME_MAX_LEVEL,
  HOME_RESEARCH_MAX,
  HOME_UNIT_RESEARCH,
  HOME_UNIT_UNLOCK,
  homeResearchCost,
  homeUpgradeCost,
  homeUpgradeTime,
  buildingMaxHp,
  levelScale,
  DEFENSE_POWER_FLOOR,
  footprintOnRoad,
  urbanPlanForHub,
  urbanPlots,
  HOME_RESEARCH_MAX as RESEARCH_MAX_LEVEL,
  HOME_DEVELOPMENT,
  HOME_LEVEL_POINTS,
  HOME_OFFLINE_CAP_SECONDS,
  HOME_PRODUCTION_PER_HOUR,
  HOME_STORAGE_PER_DEPOT,
} from '@age/shared';
import type {
  BotDifficulty,
  BuildingSnap,
  BuildingType,
  CityPath,
  GameCommand,
  GameMode,
  ElonEvent,
  ExperienceMode,
  Standing,
  MapData,
  PowerSnap,
  MarketPrices,
  NodeSnap,
  PlayerInfo,
  PlayerSnap,
  ResourceType,
  Resources,
  ServerMessage,
  SheepSnap,
  TerrainKind,
  UnitSnap,
  UnitType,
  RaidArmy,
  RaidEvent,
  RaidSnap,
  HomeRaidView,
  HomeStatusSnap,
  DefenseSnapshot,
  RaidDeployZone,
  RaidEndReason,
  RaidOutcome,
  RaidPhase,
  RaidReport,
  CommanderAutonomy,
  CommanderPersona,
  CommanderPolicy,
  MatchReport,
  StrategicObjective,
} from '@age/shared';
import { DIFFICULTY, commanderBuild, nextAgeRequirement, runBotAI } from './ai';
import { generateHomeMap, generateMap } from './mapgen';
import { collectSpreadTiles, findPath, idx, isWalkable, nearestWalkableTile, ringTiles, type Grid } from './path';
import { MatchLedger } from '../chain/ledger';
import { needElon, rankStandings, reliabilityBonus, reliabilityPpm, stewardshipValue, type NeedSample } from './stewardship';
import { createUnit, type Building, type GamePlayer, type ResNode, type Sheep, type Unit } from './state';
import type { HomeProgression, HomeRaidData, HomeSave } from '../home/types';
import { CommanderBrain, planProduction, type CommanderFacts, type ObjectiveStatus, type ProductionFacts } from './commander';
import { MatchStats } from './matchstats';
import { inDeployZone, snapshotChecksum } from '../raid/snapshot';
import { newChainState, recordTx, sealBlock, verifyLedger, LEDGER_MAX_SETTLEMENTS, type HomeChainState } from '../home/ledger';
import { createHash } from 'node:crypto';

/** Relative spending on each resource across a typical match (stockpile weighting). */
const RESOURCE_DEMAND: Record<ResourceType, number> = { energy: 1, alloys: 0.95, compute: 0.6 };

/** Units the player ordered directly stay out of commander initiative this long (30 s). */
const PLAYER_HOLD_TICKS = 300;
/** Tiles around the Command Core that count as "the base". */
const BASE_RADIUS = 16;
/** Radius of a defended sector. */
const DEFEND_RADIUS = 10;

/** Book-keeping for the commander objective under execution. */
interface CommanderRun {
  startTick: number;
  unitIds: Set<number>;
  lost: number;
  detail?: string;
  /** Buildings the commander garrisoned workers into; emptied when the threat clears. */
  sheltered?: number[];
}

/** First 30 s of a match: need cycles are not sampled (see sampleNeeds). */
const NEED_GRACE_TICKS = 300;

interface QueuedCmd {
  playerId: number;
  cmd: GameCommand;
}

interface ActiveRaid extends RaidSnap {
  startedTick?: number;
  initialBuildings: Set<number>;
  initialHp: number;
  raidUnits: Set<number>;
  awardedStars: Set<number>;
  recordedDestroyed: Set<number>;
}

export interface RoomMember {
  id: number;
  name: string;
  color: string;
  isBot?: boolean;
  difficulty?: BotDifficulty; // só bots
  team?: number; // 0/ausente = sozinho; 1/2 = time
}

export interface FacilityRecord {
  tick: number;
  playerId: number;
  buildingId: number;
  type: BuildingType;
  stewardship: number;
}

export type SendFn = (playerId: number, msg: ServerMessage) => void;

export interface GameOptions {
  session?: 'arena' | 'home' | 'raid';
  /** Vertical-slice 1v1: warfare is open from the first minute (no Level-5 gate). */
  skirmish?: boolean;
  /** Fixed arena map seed (tests, replays). Random when omitted. */
  mapSeed?: number;
  homeState?: HomeSave;
  now?: () => number;
  /** Raid session: the pinned defense and its legal deployment band. */
  raid?: { snapshot: DefenseSnapshot; zone: RaidDeployZone; onEnd?: (outcome: RaidOutcome) => void };
}

/** Live state of an isolated raid simulation (session 'raid'). */
interface RaidSim {
  attacker: number;
  defender: number;
  zone: RaidDeployZone;
  /** Reserved units not yet placed, by type. */
  reserve: RaidArmy;
  initialArmy: RaidArmy;
  deployed: number;
  /** Simulation length in ticks from the first deployment (tick 0). */
  maxTicks: number;
  surrenderAt?: number;
  /** Buildings that count toward destruction (walls excluded). */
  scored: number[];
  hubId?: number;
  destruction: number;
  stars: number;
  hubDestroyed: boolean;
  outcome?: RaidOutcome;
  onEnd?: (outcome: RaidOutcome) => void;
  /** Home-raid HUD context set by the orchestrator. */
  view?: HomeRaidView;
  /** Attacker research levels (pinned at reservation; part of the replay). */
  research: Partial<Record<keyof RaidArmy, number>>;
  /** Defender grid factor from the snapshot, floored at DEFENSE_POWER_FLOOR. */
  defensePower: number;
}

export class Game {
  readonly grid: Grid;
  /** Grade dos BARCOS: bloqueia grama; água funda e raso são passáveis. */
  readonly navalGrid: Grid;
  /** Flying units (drones): open sky, only map bounds limit them. */
  readonly airGrid: Grid;
  readonly map: MapData;
  readonly symbiosis: boolean;
  /** Symbiosis public match ledger (absent in Classic). */
  readonly ledger: MatchLedger | null;
  /** Ledger tx hash attesting each completed facility. */
  private readonly facilityProofs = new Map<number, string>();
  /** Per-tick grid state for each player (recomputed once per tick). */
  private power = new Map<number, PowerSnap>();
  /** True once any developer shortcut was used: the record is not comparable. */
  private dev = false;
  units = new Map<number, Unit>();
  buildings = new Map<number, Building>();
  nodes = new Map<number, ResNode>();
  sheep = new Map<number, Sheep>();
  players = new Map<number, GamePlayer>();
  private nextId: number;
  private tick = 0;
  private paused = false;
  private queue: QueuedCmd[] = [];
  /** Última vez que a BASE (prédio) de cada jogador levou dano — p/ aliados protetores. */
  readonly recentAttacks = new Map<number, { x: number; y: number; tick: number }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ended = false;
  readonly botIds = new Set<number>();
  /** Quem está só ASSISTINDO. Fica FORA de `players` de propósito: espectador
   *  não tem vaga, não conta pra vitória, não recebe comando e não pode ser
   *  atacado. A única coisa que ele ganha é uma cópia do snapshot — e uma cópia
   *  MAGRA, sem a economia de ninguém (ver `broadcastSnapshot`). */
  readonly spectators = new Set<number>();
  /** Preços do mercado (ouro por lote de 100) — da SALA, movem com as trocas. */
  private marketPrices: MarketPrices = { energy: MARKET_START_PRICE, alloys: MARKET_START_PRICE };
  readonly elonEvents: ElonEvent[] = [];
  readonly facilityLog: FacilityRecord[] = [];
  private knownCompletedBuildings = new Set<number>();
  private knownUnits = new Set<number>();
  private knownAges = new Map<number, number>();
  private raids = new Map<number, ActiveRaid>();
  private nextRaidId = 1;
  private commanders = new Map<number, CommanderBrain>();
  private commanderRuns = new Map<number, CommanderRun>();
  /** Resource that last blocked a doctrine purchase; steers worker priority. */
  private commanderShortfall = new Map<number, { resource: ResourceType; tick: number }>();
  /** unit id → tick of the player's last direct order to it. */
  private playerTouched = new Map<number, number>();
  /** Skirmish: warfare is open from the start instead of gated on Level 5. */
  private readonly openWarfare: boolean = false;
  /** Arena-only structured telemetry for the post-battle report. */
  private stats: MatchStats | null = null;
  private finalReport?: MatchReport;
  readonly homeMode: boolean;
  readonly raidMode: boolean;
  private raidSim: RaidSim | null = null;
  /** Persistent raid ledger of a Home (trophies, active session, reports). */
  raidData: HomeRaidData = { trophies: 0, scoutCounter: 0, active: null, reports: [], settled: [], outbox: [] };
  /** City ledger and ELON settlement record (Home only). */
  chain: HomeChainState | null = null;
  private readonly homeSalt: string;
  /** ELON balance already reported to the ledger (the next block logs the difference). */
  private elonLogged = 0;
  /** Persistent Home progression: unit research, shield, defense inbox. */
  progression: HomeProgression = { research: {}, shieldUntil: 0, defenseReports: [], publishedSignature: '' };
  private homeRevision = 0;
  private homeOfflineAppliedSeconds = 0;
  private homeProductionCollectedAt = 0;
  private readonly now: () => number;

  constructor(
    members: RoomMember[],
    private readonly send: SendFn,
    private readonly onGameOver: (winner: number, winnerName: string) => void,
    mode: GameMode = 'normal',
    terrain: TerrainKind = 'classic',
    experience: ExperienceMode = 'symbiosis',
    matchSalt = `${Date.now()}`,
    options: GameOptions = {},
  ) {
    // One game, one city system. `experience` remains in the constructor only
    // so older clients/tests remain wire-compatible; Classic no longer exists.
    void experience;
    this.symbiosis = true;
    this.homeMode = options.session === 'home';
    this.raidMode = options.session === 'raid';
    this.now = options.now ?? Date.now;
    this.homeSalt = matchSalt;
    this.ledger = this.homeMode || this.raidMode ? null : new MatchLedger(matchSalt);
    const homeSeed = Number.parseInt(matchSalt.slice(0, 8), 16);
    const gen = this.homeMode
      ? generateHomeMap(Number.isFinite(homeSeed) ? homeSeed : undefined)
      : generateMap(members.length, options.mapSeed, terrain);
    this.grid = gen.grid;
    this.map = { size: gen.grid.size, tiles: gen.grid.tiles };
    this.nextId = gen.nextId;

    // Grade NAVAL: barcos andam onde NÃO é grama (água funda + raso). Compartilha
    // os tiles com a grade terrestre; só o `blocked` difere. Prédios em terra já
    // ficam bloqueados pela grama; o Porto (na água) e os bancos de peixe entram
    // aqui (e são mantidos em blockFootprint/unblockFootprint/depleção de nó).
    const navalBlocked = new Uint8Array(gen.grid.size * gen.grid.size);
    for (let i = 0; i < gen.grid.tiles.length; i++) {
      // barco navega SÓ na água FUNDA; grama e o VAU (banco de areia) bloqueiam
      // (o vau é uma travessia de TERRA — barco não passa por cima).
      if (gen.grid.tiles[i] !== TILE_WATER) navalBlocked[i] = 1;
    }
    for (const n of gen.nodes) {
      if (n.type === 'fish') navalBlocked[idx(n.tileX, n.tileY, gen.grid.size)] = 1;
    }
    this.navalGrid = { size: gen.grid.size, tiles: gen.grid.tiles, blocked: navalBlocked };
    this.airGrid = { size: gen.grid.size, tiles: gen.grid.tiles, blocked: new Uint8Array(gen.grid.size * gen.grid.size) };

    const battle = mode === 'batalha';
    const baseRes = battle ? BATTLE_STARTING_RESOURCES : STARTING_RESOURCES;
    members.forEach((m) => {
      // Muito difícil (Titã): o bot começa com um bônus de recursos.
      const mult = m.isBot && m.difficulty ? DIFFICULTY[m.difficulty].resourceMult : 1;
      this.players.set(m.id, {
        id: m.id,
        name: m.name,
        color: m.color,
        resources: { energy: Math.round(baseRes.energy * mult), alloys: Math.round(baseRes.alloys * mult), compute: Math.round(baseRes.compute * mult) },
        defeated: false,
        age: battle ? BATTLE_STARTING_AGE : 1,
        techs: new Set<string>(),
        difficulty: m.difficulty,
        team: m.team,
        elon: 0,
        elonBalance: 100,
        needDeclared: 0,
        needServed: 0,
      });
      if (m.isBot) this.botIds.add(m.id);
      this.commanders.set(m.id, new CommanderBrain());
    });
    if (!this.homeMode && !this.raidMode) this.stats = new MatchStats(members, TICK_RATE);
    this.openWarfare = !!options.skirmish && !this.homeMode && !this.raidMode;

    // Unidades/prédios gerados vêm com owner = índice do jogador (0..n-1); remapeia para playerId real.
    for (const b of gen.buildings) {
      const owner = members[b.owner]?.id;
      if (owner === undefined) continue;
      b.owner = owner;
      this.buildings.set(b.id, b);
    }
    for (const u of gen.units) {
      const owner = members[u.owner]?.id;
      if (owner === undefined) continue;
      u.owner = owner;
      this.units.set(u.id, u);
    }
    for (const n of gen.nodes) this.nodes.set(n.id, n);
    for (const s of gen.sheep) this.sheep.set(s.id, s); // selvagens (owner -1), sem remap
    for (const b of this.buildings.values()) if (b.progress >= 1) this.knownCompletedBuildings.add(b.id);
    for (const u of this.units.values()) this.knownUnits.add(u.id);
    for (const p of this.players.values()) this.knownAges.set(p.id, p.age);
    if (this.homeMode) {
      const member = members[0];
      if (member && options.homeState) this.restoreHomeState(options.homeState, member.id, member.name, member.color);
      else if (member) this.bootstrapHome(member.id);
      this.recomputePower();
    }
    if (this.raidMode && options.raid && members.length >= 2) {
      this.setupRaid(options.raid.snapshot, options.raid.zone, members[0].id, members[1].id, options.raid.onEnd);
    }
  }

  start(): void {
    this.timer = setInterval(() => this.step(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  enqueueCommand(playerId: number, cmd: GameCommand): void {
    // Espectador não joga. Na prática os comandos dele já morreriam sozinhos
    // (não é dono de nada, e `ownedUnits` devolveria lista vazia), mas a trava é
    // explícita: assim ninguém precisa AUDITAR cada comando novo pra saber se
    // vazou algum caminho que não checa posse.
    if (this.spectators.has(playerId)) return;
    this.queue.push({ playerId, cmd });
  }

  /** true se os dois jogadores são ALIADOS (mesmo jogador, ou mesmo time > 0).
   *  Sem time (0/undefined) = "cada um por si". Usado por combate/torres/IA. */
  allied(a: number, b: number): boolean {
    if (a === b) return true;
    const ta = this.players.get(a)?.team ?? 0;
    const tb = this.players.get(b)?.team ?? 0;
    return ta > 0 && ta === tb;
  }

  /** Pausa/retoma a partida para TODOS (qualquer jogador, tecla P). Enquanto
   *  pausada, o `step` não avança nada (nem snapshots) — todo mundo congela
   *  igual. Sem timer nem votação: quem quiser retomar aperta P (social). */
  setPaused(playerId: number, paused: boolean): void {
    if (this.ended || this.paused === paused) return;
    this.paused = paused;
    const by = this.players.get(playerId)?.name ?? '';
    for (const p of this.players.values()) this.send(p.id, { type: 'gamePaused', paused, by });
  }

  /** Estado atual do pause (p/ reenviar a quem reconecta no meio da pausa). */
  get isPaused(): boolean {
    return this.paused;
  }

  /** Tick atual (p/ a IA medir "há quanto tempo" — ex.: socorro a aliados). */
  get tickNow(): number {
    return this.tick;
  }

  /** Sinaliza (ping) um ponto do mapa — só os ALIADOS do autor recebem (inclui
   *  o próprio; em FFA cai só nele mesmo). Usa a cor do autor no marcador. */
  signalPing(playerId: number, x: number, y: number): void {
    const author = this.players.get(playerId);
    if (!author || this.ended) return;
    const n = this.grid.size;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= n || y >= n) return;
    for (const p of this.players.values()) {
      if (this.allied(playerId, p.id)) this.send(p.id, { type: 'ping', x, y, color: author.color });
    }
  }

  /** Marca um jogador como derrotado (desconexão) e remove suas entidades. */
  markDefeated(playerId: number): void {
    if (this.homeMode || this.raidMode) return;
    const p = this.players.get(playerId);
    if (!p || p.defeated) return;
    p.defeated = true;
    this.stats?.defeated(playerId, this.tick, p.name);
    this.removeAllEntitiesOf(playerId);
    this.checkVictory();
  }

  private removeAllEntitiesOf(playerId: number): void {
    for (const [id, u] of this.units) {
      if (u.owner === playerId) this.units.delete(id);
    }
    for (const [id, b] of this.buildings) {
      if (b.owner === playerId) {
        this.unblockFootprint(b.tileX, b.tileY, BUILDING_DEFS[b.type].size);
        this.buildings.delete(id);
      }
    }
    // Ovelhas do derrotado voltam a ser selvagens (neutras) — não somem.
    for (const s of this.sheep.values()) {
      if (s.owner === playerId) {
        s.owner = SHEEP_WILD_OWNER;
        s.path = [];
      }
    }
  }

  private errorTo(playerId: number, code: string, params?: Record<string, string | number>): void {
    this.send(playerId, { type: 'error', code, params });
  }

  // ---------------- Tick ----------------

  private step(): void {
    if (this.ended || this.paused) return; // pausada: congela tudo (sem avanço, sem snapshot)
    const dt = TICK_MS / 1000;
    this.tick++;

    // IA dos bots (~1x/s): enfileira comandos que são aplicados neste mesmo tick.
    if (this.botIds.size > 0 && this.tick % 10 === 0) {
      for (const id of this.botIds) {
        const bp = this.players.get(id);
        if (bp && !bp.defeated) runBotAI(this, id);
      }
    }
    if (!this.homeMode && !this.raidMode && this.tick % 10 === 0) {
      this.updateCommanders();
      this.sampleMatchStats();
    }

    this.applyQueuedCommands();
    this.updateRaids();
    if (this.tick % 10 === 0) this.generateElon();
    if (this.tick % 10 === 0 && !this.homeMode && !this.raidMode) this.generateLayerOutput();

    if (this.symbiosis) this.recomputePower();
    for (const u of this.units.values()) this.updateUnit(u, dt);
    this.freeTrappedUnits();
    this.separateIdleUnits(dt);
    this.updateSheep(dt);
    this.updateTowers(dt);
    for (const b of this.buildings.values()) this.updateBuildingTraining(b, dt);
    if (this.homeMode) this.updateHomeProduction(dt);
    if (this.homeMode) this.updateHomeResearch(dt);
    if (this.homeMode && this.tick % 600 === 0) this.sealHomeLedger();
    if (this.raidSim) this.updateRaidSim();

    // pesquisa de era em andamento
    for (const p of this.players.values()) {
      // Migration for already-running/saved level-5 cities created under the
      // removed Command-vs-Space branch.
      if (p.age >= 5) p.cityPath = 'command';
      if (p.defeated || !p.ageResearch) continue;
      p.ageResearch.elapsed += dt;
      if (p.ageResearch.elapsed >= (AGE_RESEARCH_TIME[p.ageResearch.target] ?? 0)) {
        p.age = p.ageResearch.target;
        if (p.age >= 5) p.cityPath = 'command';
        p.ageResearch = undefined;
        this.stats?.ageUp(p.id, p.age, this.tick, p.name);
      }
    }

    // pesquisa de tecnologias nos prédios
    for (const b of this.buildings.values()) {
      if (!b.research) continue;
      const tech = TECH_DEFS.find((t) => t.id === b.research!.id);
      if (!tech) { b.research = undefined; continue; }
      b.research.elapsed += dt;
      if (b.research.elapsed >= tech.time) {
        this.completeTech(b.owner, tech.id);
        b.research = undefined;
      }
    }

    this.recordContributionEvents();
    if (this.tick % CHAIN_BLOCK_TICKS === 0) {
      // Grace period: nobody can give their first orders before the opening
      // cycles, so idle starting villagers must not cost reliability.
      if (this.tick >= NEED_GRACE_TICKS) this.sampleNeeds();
      this.ledger?.seal(this.tick);
    }

    this.checkVictory();

    if (this.tick % SNAPSHOT_TICKS === 0) this.broadcastSnapshot();
  }

  private broadcastSnapshot(): void {
    const unitsSnap: UnitSnap[] = [];
    for (const u of this.units.values()) unitsSnap.push(this.unitToSnap(u));
    const buildingsSnap: BuildingSnap[] = [];
    for (const b of this.buildings.values()) buildingsSnap.push(this.buildingToSnap(b));
    const nodesSnap: NodeSnap[] = [];
    for (const n of this.nodes.values()) nodesSnap.push({ id: n.id, type: n.type, tileX: n.tileX, tileY: n.tileY, amount: n.amount });
    const sheepSnap: SheepSnap[] = [];
    for (const s of this.sheep.values()) sheepSnap.push({ id: s.id, owner: s.owner, x: s.x, y: s.y, food: s.food });
    const playersSnap: PlayerSnap[] = [];
    for (const p of this.players.values()) {
      playersSnap.push({
        id: p.id,
        resources: { ...p.resources },
        pop: this.popOf(p.id),
        popCap: this.popCapOf(p.id),
        defeated: p.defeated,
        age: p.age,
        ageProgress: p.ageResearch
          ? Math.min(1, p.ageResearch.elapsed / (AGE_RESEARCH_TIME[p.ageResearch.target] || 1))
          : this.homeMode
            ? [...this.buildings.values()].find((b) => b.owner === p.id && b.type === 'town_center' && b.upgradeTargetLevel !== undefined)?.upgradeProgress
            : undefined,
        cityPath: p.cityPath,
        pathResearch: p.ageResearch?.path,
        techs: [...p.techs],
        elon: p.elon,
        elonBalance: Math.floor(p.elonBalance),
        elonCapacity: this.elonCapacityOf(p.id),
        elonPerMinute: this.elonPerMinuteOf(p.id),
        armyUsed: this.armyUsedOf(p.id),
        armyCapacity: this.armyCapacityOf(p.id),
        elonEvents: this.elonEvents.filter((e) => e.playerId === p.id).slice(-5),
        ...(!this.homeMode && !this.raidMode ? { commander: this.commanders.get(p.id)?.view() } : {}),
        ...(this.symbiosis ? { power: { ...this.powerOf(p.id) }, score: this.liveScore(p.id) } : {}),
      });
    }
    const common = {
      type: 'snapshot',
      tick: this.tick,
      units: unitsSnap,
      buildings: buildingsSnap,
      nodes: nodesSnap,
      sheep: sheepSnap,
      players: playersSnap,
      market: { ...this.marketPrices },
      // Quem está jogando merece saber que está sendo observado.
      ...(this.spectators.size > 0 ? { spectators: this.spectators.size } : {}),
      ...(this.ledger ? { chain: this.ledger.snapshot() } : {}),
      ...(this.homeMode ? { home: this.homeStatus() } : {}),
    } as const;
    for (const p of this.players.values()) {
      const raid = this.raids.get(p.id);
      const raidView = this.raidSim?.attacker === p.id ? this.raidSimSnap() : raid ? this.raidSnap(raid) : undefined;
      this.send(p.id, { ...common, ...(raidView ? { raid: raidView } : {}) });
    }

    // ESPECTADORES: mesma partida, pacote MAGRO. Sai a economia (recursos, techs,
    // progresso de era, preços do mercado) — o espectador vê a ação, não os
    // números. Isso é no SERVIDOR de propósito: o dado não sai daqui, então nem
    // um cliente modificado consegue ler o ouro de quem está jogando.
    //
    // Montado SÓ se houver alguém assistindo: sem espectador, custo zero (mesma
    // regra dos temporizadores sob demanda da coleção de jogos).
    //
    // São 2 serializações no TOTAL, não uma por pessoa — o `safeSend` memoriza o
    // JSON por objeto de mensagem. Medido: ~200 µs a mais por snapshot com
    // alguém assistindo, ou 0,1% de um núcleo. (Dava pra colar os dois JSON à
    // mão e serializar as listas grandes uma única vez, mas montar JSON na mão
    // por 0,1% de CPU não vale o risco de gerar texto inválido.)
    if (this.spectators.size === 0) return;
    const magro: ServerMessage = {
      type: 'snapshot',
      tick: this.tick,
      units: unitsSnap,
      buildings: buildingsSnap,
      nodes: nodesSnap,
      sheep: sheepSnap,
      players: playersSnap.map((p) => ({
        id: p.id, pop: p.pop, popCap: p.popCap, defeated: p.defeated, age: p.age,
      })),
      ...(this.ledger ? { chain: this.ledger.snapshot() } : {}),
    };
    for (const id of this.spectators) this.send(id, magro);
  }

  private addElon(playerId: number, category: ElonEvent['category'], amount: number, reason: string, sourceId?: number): void {
    if (!Number.isInteger(amount) || amount === 0) return;
    const player = this.players.get(playerId);
    if (!player) return;
    player.elon += amount;
    this.elonEvents.push({ tick: this.tick, playerId, category, amount, reason, sourceId });
    if (this.ledger) {
      const facility = reason.startsWith('completed:');
      const tx = this.ledger.record(this.tick, facility ? 'facility' : category, playerId, reason, amount);
      if (facility && sourceId !== undefined) this.facilityProofs.set(sourceId, tx.hash);
    }
  }

  private elonCapacityOf(playerId: number): number {
    let cap = 200;
    for (const b of this.buildings.values()) if (b.owner === playerId && b.progress >= 1) cap += BUILDING_DEFS[b.type].elonCapacity ?? 0;
    return cap;
  }

  private elonPerMinuteOf(playerId: number): number {
    let rate = 0;
    for (const b of this.buildings.values()) if (b.owner === playerId && b.progress >= 1) rate += BUILDING_DEFS[b.type].elonPerMinute ?? 0;
    return rate;
  }

  /** Arena: generators yield Energy; Compute Nodes yield Compute at the grid's efficiency. */
  private generateLayerOutput(): void {
    for (const b of this.buildings.values()) {
      const output = LAYER_OUTPUT[b.type];
      if (!output || b.progress < 1) continue;
      const p = this.players.get(b.owner);
      if (!p || p.defeated) continue;
      const grid = this.powerOf(b.owner);
      for (const [key, perMinute] of Object.entries(output) as [ResourceType, number][]) {
        const amount = (perMinute / 60) * (key === 'compute' ? powerEfficiency(grid.supply, grid.draw) : 1);
        p.resources[key] += amount;
        this.stats?.gathered(p.id, key, amount);
      }
    }
  }

  private generateElon(): void {
    for (const p of this.players.values()) {
      if (p.defeated) continue;
      const rate = this.elonPerMinuteOf(p.id);
      p.elonBalance = Math.min(this.elonCapacityOf(p.id), p.elonBalance + rate / 60);
    }
  }

  private armyCapacityOf(playerId: number): number {
    let cap = 0;
    for (const b of this.buildings.values()) {
      if (b.owner !== playerId || b.progress < 1) continue;
      // Home camps grow +50% per level; an upgrade only counts once finished.
      cap += Math.round((BUILDING_DEFS[b.type].armyCapacity ?? 0) * (this.homeMode ? levelScale(b.level, 0.5) : 1));
    }
    return cap;
  }

  private armyUsedOf(playerId: number): number {
    let used = 0;
    for (const u of this.units.values()) if (u.owner === playerId && SYMBIOSIS_COMBAT_UNITS.has(u.type)) used += this.armySpaceOf(u.type);
    return used;
  }

  /** Factory upgrades add two queue slots per level at Home (spec §5). */
  private queueSlotsOf(b: Building): number {
    return this.homeMode ? TRAIN_QUEUE_MAX + 2 * ((b.level ?? 1) - 1) : TRAIN_QUEUE_MAX;
  }

  /** Home measures the army in Army Camp space (spec §5); Arena keeps unit pop. */
  private armySpaceOf(type: UnitType): number {
    return this.homeMode ? HOME_CAMP_SPACE[type] ?? UNIT_DEFS[type].pop : UNIT_DEFS[type].pop;
  }

  private armyCommittedOf(playerId: number): number {
    let used = this.armyUsedOf(playerId);
    for (const b of this.buildings.values()) {
      if (b.owner !== playerId) continue;
      for (const item of b.queue) if (SYMBIOSIS_COMBAT_UNITS.has(item.unit)) used += UNIT_DEFS[item.unit].pop;
    }
    return used;
  }

  /** Detects safe, completed authoritative outcomes exactly once. */
  private recordContributionEvents(): void {
    for (const b of this.buildings.values()) {
      if (b.progress < 1 || this.knownCompletedBuildings.has(b.id)) continue;
      this.knownCompletedBuildings.add(b.id);
      this.stats?.structureBuilt(b.owner);
      // Counted once, as stewardship value while it stands — never as standing.
      this.facilityLog.push({ tick: this.tick, playerId: b.owner, buildingId: b.id, type: b.type, stewardship: stewardshipValue(b.type) });
      if (this.ledger) {
        const tx = this.ledger.record(this.tick, 'facility', b.owner, `completed:${b.type}`, stewardshipValue(b.type));
        this.facilityProofs.set(b.id, tx.hash);
      }
    }
    for (const u of this.units.values()) {
      if (this.knownUnits.has(u.id)) continue;
      this.knownUnits.add(u.id);
      if (u.type === 'villager') this.addElon(u.owner, 'labor', 1, 'trained:villager', u.id);
      else if (u.type === 'designer') this.addElon(u.owner, 'labor', 2, 'trained:designer', u.id);
      else if (SYMBIOSIS_UNITS.has(u.type)) this.addElon(u.owner, 'labor', 2, `trained:${u.type}`, u.id);
    }
    for (const p of this.players.values()) {
      const previous = this.knownAges.get(p.id) ?? p.age;
      if (p.age > previous) this.addElon(p.id, 'obligation', (p.age - previous) * 5, `reached:age-${p.age}`);
      this.knownAges.set(p.id, p.age);
    }
  }

  get devMatch(): boolean {
    return this.dev;
  }

  /** Developer shortcuts for testing. The lobby only routes allowlisted
   *  browsers here; the result is a private reply for that player. */
  devCommand(playerId: number, input: string): string {
    const p = this.players.get(playerId);
    if (!p || p.defeated || this.ended) return 'You are not an active player in this match.';
    const [rawCmd = '', arg] = input.trim().replace(/^\//, '').split(/\s+/);
    const n = arg === undefined ? undefined : Number(arg);
    if (arg !== undefined && !Number.isFinite(n)) return `Not a number: ${arg}`;
    switch (rawCmd.toLowerCase()) {
      case 'age': {
        const target = Math.floor(n ?? p.age + 1);
        if (target < 1 || target > MAX_AGE) return `Age must be 1–${MAX_AGE}.`;
        if (target <= p.age) return `Already at age ${p.age}.`;
        p.age = target;
        p.ageResearch = undefined;
        this.dev = true;
        return `Age set to ${target}.`;
      }
      case 'res': {
        const amount = Math.floor(n ?? 5000);
        if (amount < 1 || amount > 1_000_000) return 'Amount must be 1–1000000.';
        for (const k of Object.keys(p.resources) as ResourceType[]) p.resources[k] += amount;
        this.dev = true;
        return `+${amount} food, wood, gold, and stone.`;
      }
      case 'build': {
        let done = 0;
        for (const b of this.buildings.values()) {
          if (b.owner !== playerId || b.progress >= 1) continue;
          b.progress = 1;
          b.hp = BUILDING_DEFS[b.type].hp;
          if (b.type === 'farm') b.foodLeft = FARM_FOOD;
          done++;
        }
        if (done > 0) this.dev = true;
        return done > 0 ? `${done} construction site(s) completed.` : 'No construction sites to finish.';
      }
      case 'power': {
        if (!this.symbiosis) return 'The power grid only exists in Symbiosis matches.';
        const amount = Math.floor(n ?? 50);
        if (amount < 0 || amount > 10_000) return 'Amount must be 0–10000.';
        p.devPower = amount;
        if (amount > 0) this.dev = true;
        return amount > 0 ? `Grid supply +${amount}.` : 'Dev grid supply removed.';
      }
      case 'perfectbase':
      case 'maxbase':
        return this.homeMode ? this.createPerfectCity(playerId) : this.createPerfectBase(playerId);
      default:
        return 'Dev commands: /perfectbase, /age [n], /res [n], /build, /power [n], /whoami';
    }
  }

  /** Developer showcase for a Home: fills EVERY plot of the map with a zoned,
   *  max-level city that obeys the urban plan (no road is ever built on). The
   *  ring of plots around the Hub decides the zone: civic defenses at the Hub,
   *  then industry, economy, housing, and alternating power/food/housing
   *  further out, with a defended rim. Existing buildings and resource nodes
   *  are kept; any slot they occupy is simply skipped. */
  private createPerfectCity(playerId: number): string {
    const p = this.players.get(playerId);
    const hub = [...this.buildings.values()].find((b) => b.owner === playerId && b.type === 'town_center');
    if (!p || !hub) return 'A Civic Hub is required before creating a perfect city.';
    p.age = 5;
    p.cityPath = 'command';
    p.resources = { energy: 1_000_000, alloys: 2000000, compute: 1_000_000 };
    p.devPower = 2_000;
    hub.level = 5;
    hub.upgradeTargetLevel = undefined;
    hub.upgradeProgress = undefined;
    for (const unit of Object.keys(HOME_UNIT_RESEARCH) as UnitType[]) this.progression.research[unit] = RESEARCH_MAX_LEVEL;
    this.progression.researching = undefined;

    const plan = urbanPlanForHub(hub.tileX, hub.tileY);
    const hubPlotX = hub.tileX - (((hub.tileX - plan.originX) % 9 + 9) % 9) + 2;
    const hubPlotY = hub.tileY - (((hub.tileY - plan.originY) % 9 + 9) % 9) + 2;
    const n = this.grid.size;
    // Plot templates: offsets inside a 7×7 plot.
    const QUAD3: [number, number][] = [[0, 0], [4, 0], [0, 4], [4, 4]];
    const QUAD2: [number, number][] = [[1, 1], [4, 1], [1, 4], [4, 4]];
    const CORNERS: [number, number][] = [[0, 0], [6, 0], [0, 6], [6, 6]];
    const industry: BuildingType[] = ['drone_factory', 'mech_forge', 'missile_foundry', 'aerospace_hangar', 'exosuit_lab', 'robotics_workshop', 'army_camp', 'army_camp'];
    const economy: BuildingType[] = ['mill', 'lumber_camp', 'mining_camp', 'farm', 'data_center', 'solar_array'];
    const outer: BuildingType[][] = [['solar_array'], ['farm', 'mill'], ['house'], ['wind_turbine'], ['house', 'data_center'], ['solar_array', 'wind_turbine']];
    let placed = 0;
    const put = (type: BuildingType, x: number, y: number): void => {
      const def = BUILDING_DEFS[type];
      if (!this.validFootprint(x, y, def.size)) return;
      const level = HOME_MAX_LEVEL[type] ?? 1;
      const b: Building = {
        id: this.nextId++, owner: playerId, type, tileX: x, tileY: y,
        hp: buildingMaxHp(type, level), progress: 1, queue: [], ...(level > 1 ? { level } : {}),
        ...(type === 'farm' ? { foodLeft: FARM_FOOD } : {}),
      };
      this.buildings.set(b.id, b);
      this.blockFootprint(x, y, def.size);
      this.knownCompletedBuildings.add(b.id);
      placed++;
    };
    for (const plot of urbanPlots(plan, n)) {
      const ring = Math.max(Math.abs(plot.x - hubPlotX), Math.abs(plot.y - hubPlotY)) / 9;
      const rim = plot.x < 9 || plot.y < 9 || plot.x + 7 > n - 9 || plot.y + 7 > n - 9;
      const k = Math.abs((plot.x * 7 + plot.y * 13) / 9) | 0;
      const cycle = <T,>(list: T[], i: number): T => list[(k + i) % list.length];
      if (ring === 0) {
        const guards: BuildingType[] = ['point_turret', 'watch_tower', 'sensor_tower', 'point_turret'];
        CORNERS.forEach(([dx, dy], i) => put(guards[i], plot.x + dx, plot.y + dy));
      } else if (ring === 1) {
        QUAD3.forEach(([dx, dy], i) => put(cycle(industry, i), plot.x + dx, plot.y + dy));
      } else if (ring === 2) {
        QUAD2.forEach(([dx, dy], i) => put(cycle(economy, i), plot.x + dx, plot.y + dy));
      } else if (rim) {
        // Defended rim: anti-air at the centre, turrets and towers on the corners.
        put('anti_air', plot.x + 2, plot.y + 2);
        CORNERS.forEach(([dx, dy], i) => put(i % 2 ? 'watch_tower' : 'point_turret', plot.x + dx, plot.y + dy));
      } else if (ring === 3) {
        QUAD2.forEach(([dx, dy]) => put('house', plot.x + dx, plot.y + dy));
      } else {
        const zone = cycle(outer, 0);
        QUAD2.forEach(([dx, dy], i) => put(zone[i % zone.length], plot.x + dx, plot.y + dy));
      }
    }

    // A docked strike wing and a full builder crew.
    const roster: Partial<Record<UnitType, number>> = {
      robot: 4, drone: 3, attack_drone: 10, siege_mech: 4, rocket_launcher: 4, fighter: 4,
      stealth_bomber: 2, plasma_tank: 3, iron_guardian: 1, aegis_valkyrie: 1,
    };
    let created = 0;
    for (const [type, wanted] of Object.entries(roster) as [UnitType, number][]) {
      let have = [...this.units.values()].filter((u) => u.owner === playerId && u.type === type).length;
      while (have < wanted) {
        const camp = this.nearestCamp(hub);
        const spot = camp && SYMBIOSIS_COMBAT_UNITS.has(type)
          ? this.campDockSpot(camp)
          : this.findFreeSpotNear(hub.tileX, hub.tileY, BUILDING_DEFS.town_center.size);
        if (!spot) break;
        const u = createUnit(this.nextId++, playerId, type, spot.x + 0.5, spot.y + 0.5);
        u.hp = this.unitMaxHp(u);
        this.units.set(u.id, u);
        this.knownUnits.add(u.id);
        have++;
        created++;
      }
    }
    this.recomputePower();
    this.dev = true;
    return `Perfect city ready: City Level 5, ${placed} buildings across ${urbanPlots(plan, n).length} plots, ${created} units, all research.`;
  }

  /** Developer-only showcase city. Placement still uses normal footprint rules,
   *  so the result is playable and pathfinding-safe rather than a visual mock. */
  private createPerfectBase(playerId: number): string {
    const p = this.players.get(playerId);
    if (!p) return 'Player not found.';
    const tc = [...this.buildings.values()].find((b) => b.owner === playerId && b.type === 'town_center');
    if (!tc) return 'A Civic Hub is required before creating a perfect base.';
    p.age = 5;
    p.cityPath = 'command';
    p.ageResearch = undefined;
    p.resources = { energy: 1_000_000, alloys: 2000000, compute: 1_000_000 };
    p.devPower = 500;
    for (const tech of TECH_DEFS) p.techs.add(tech.id);

    const cx = tc.tileX + BUILDING_DEFS.town_center.size / 2;
    const cy = tc.tileY + BUILDING_DEFS.town_center.size / 2;
    const findSite = (size: number): { x: number; y: number } | null => {
      for (let radius = 4; radius <= 42; radius++) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
            const x = Math.floor(cx + dx - size / 2);
            const y = Math.floor(cy + dy - size / 2);
            if (this.validFootprint(x, y, size)) return { x, y };
          }
        }
      }
      return null;
    };
    const desired: Partial<Record<BuildingType, number>> = {
      house: 10, data_center: 4, elon_vault: 2, army_camp: 4,
      solar_array: 3, wind_turbine: 3, design_studio: 1, robotics_workshop: 1,
      drone_factory: 1, mech_forge: 1, aerospace_hangar: 1, missile_foundry: 1,
      exosuit_lab: 1, barracks: 1, blacksmith: 1, market: 1, watch_tower: 4,
    };
    let placed = 0;
    for (const [type, wanted] of Object.entries(desired) as [BuildingType, number][]) {
      let have = [...this.buildings.values()].filter((b) => b.owner === playerId && b.type === type).length;
      while (have < wanted) {
        const def = BUILDING_DEFS[type];
        const site = findSite(def.size);
        if (!site) break;
        const b: Building = { id: this.nextId++, owner: playerId, type, tileX: site.x, tileY: site.y,
          hp: def.hp, progress: 1, queue: [], ...(type === 'farm' ? { foodLeft: FARM_FOOD } : {}) };
        this.buildings.set(b.id, b);
        this.blockFootprint(site.x, site.y, def.size);
        have++;
        placed++;
      }
    }
    p.elonBalance = this.elonCapacityOf(playerId);

    const roster: Partial<Record<UnitType, number>> = {
      villager: 6, designer: 5, robot: 4, drone: 3,
      attack_drone: 4, siege_mech: 2, fighter: 2, stealth_bomber: 1,
      rocket_launcher: 2, plasma_tank: 2, iron_guardian: 1,
    };
    let created = 0;
    for (const [type, wanted] of Object.entries(roster) as [UnitType, number][]) {
      let have = [...this.units.values()].filter((u) => u.owner === playerId && u.type === type).length;
      while (have < wanted) {
        const angle = (created * 2.399963) % (Math.PI * 2);
        const radius = 3 + (created % 9) * .45;
        const spot = nearestWalkableTile(this.gridForType(type as keyof RaidArmy), Math.floor(cx + Math.cos(angle) * radius), Math.floor(cy + Math.sin(angle) * radius));
        if (!spot) break;
        const u = createUnit(this.nextId++, playerId, type, spot.x + .5, spot.y + .5);
        u.hp = this.unitMaxHp(u);
        this.units.set(u.id, u);
        have++;
        created++;
      }
    }
    this.dev = true;
    return `Perfect base ready: level 5, ${placed} facilities, ${created} units, full ELON/resources, all upgrades.`;
  }

  /** One decision cycle of need: housing (people waiting for homes count as
   *  unmet), work (idle villagers are unmet labor), and grid power. Standing is
   *  earned only for need served; the running totals give reliability. */
  private sampleNeeds(): void {
    const held = new Map<number, number>();
    for (const b of this.buildings.values()) {
      const head = b.queue[0];
      if (head && head.progress >= 1) held.set(b.owner, (held.get(b.owner) ?? 0) + UNIT_DEFS[head.unit].pop);
    }
    const work = new Map<number, { all: number; busy: number }>();
    for (const u of this.units.values()) {
      if (u.type !== 'villager') continue;
      const w = work.get(u.owner) ?? { all: 0, busy: 0 };
      w.all++;
      if (u.state !== 'idle') w.busy++;
      work.set(u.owner, w);
    }
    for (const p of this.players.values()) {
      if (p.defeated) continue;
      const pop = this.popOf(p.id);
      const w = work.get(p.id) ?? { all: 0, busy: 0 };
      const needs: NeedSample[] = [
        { key: 'housing', declared: pop + (held.get(p.id) ?? 0), served: pop, perElon: 5 },
        { key: 'work', declared: w.all, served: w.busy, perElon: 4 },
      ];
      if (this.symbiosis) {
        const g = this.powerOf(p.id);
        needs.push({ key: 'power', declared: g.draw, served: Math.min(g.draw, g.supply), perElon: 2 });
      }
      let declared = 0;
      let served = 0;
      let elon = 0;
      let energy = 0;
      for (const n of needs) {
        declared += n.declared;
        served += n.served;
        if (n.key === 'power') energy += needElon(n);
        else elon += needElon(n);
      }
      p.needDeclared += declared;
      p.needServed += served;
      this.addElon(p.id, 'need', elon, 'served:needs');
      this.addElon(p.id, 'energy', energy, 'served:power');
    }
  }

  private stewardshipOf(playerId: number): { facilities: number; value: number } {
    let facilities = 0;
    let value = 0;
    for (const b of this.buildings.values()) {
      if (b.owner !== playerId || b.progress < 1) continue;
      facilities++;
      value += stewardshipValue(b.type);
    }
    return { facilities, value };
  }

  private liveScore(playerId: number): { stewardship: number; reliabilityPpm: number; bonus: number; score: number } {
    const p = this.players.get(playerId)!;
    const st = this.stewardshipOf(playerId);
    const ppm = reliabilityPpm(p.needServed, p.needDeclared);
    const bonus = reliabilityBonus(ppm);
    return { stewardship: st.value, reliabilityPpm: ppm, bonus, score: Math.round((p.elon + st.value + bonus) * 100) / 100 };
  }

  standings(): Standing[] {
    return rankStandings([...this.players.values()].map((p) => {
      const st = this.stewardshipOf(p.id);
      const live = this.liveScore(p.id);
      return {
        playerId: p.id, name: p.name, standing: p.elon, facilities: st.facilities, stewardship: st.value,
        reliabilityPpm: live.reliabilityPpm, declaredNeed: p.needDeclared, servedNeed: p.needServed,
        bonus: live.bonus, score: live.score,
      };
    }));
  }

  ledgerExport(): { head: string; height: number; verified: boolean; blocks: ReturnType<MatchLedger['export']>['blocks']; txs: ReturnType<MatchLedger['export']>['txs'] } | null {
    if (!this.ledger) return null;
    this.ledger.seal(this.tick);
    return { head: this.ledger.head, height: this.ledger.height, verified: this.ledger.verify(), ...this.ledger.export() };
  }

  contributionSummary(): { tick: number; players: { id: number; name: string; elon: number; age: number; defeated: boolean; buildings: number; units: number; resources: Resources }[]; elonEvents: ElonEvent[]; standings: Standing[]; facilities: FacilityRecord[]; dev: boolean } {
    return {
      tick: this.tick,
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, elon: p.elon, age: p.age, defeated: p.defeated,
        buildings: [...this.buildings.values()].filter((b) => b.owner === p.id).length,
        units: [...this.units.values()].filter((u) => u.owner === p.id).length,
        resources: { ...p.resources },
      })),
      elonEvents: this.elonEvents.map((event) => ({ ...event })),
      standings: this.standings(),
      facilities: this.facilityLog.map((f) => ({ ...f })),
      dev: this.dev,
    };
  }

  /** Entra como espectador. Devolve false se o id já está jogando (um jogador
   *  não assiste a própria partida — ele já recebe tudo). */
  addSpectator(playerId: number): boolean {
    if (this.players.has(playerId) || this.ended) return false;
    this.spectators.add(playerId);
    return true;
  }

  removeSpectator(playerId: number): void {
    this.spectators.delete(playerId);
  }

  private unitToSnap(u: Unit): UnitSnap {
    const s: UnitSnap = { id: u.id, owner: u.owner, type: u.type, x: u.x, y: u.y, hp: u.hp, state: u.state };
    if (u.carryType) s.carryType = u.carryType;
    if (u.carryAmount) s.carryAmount = u.carryAmount;
    if (u.attackTargetId !== undefined) s.targetId = u.attackTargetId;
    else if (u.gatherTargetId !== undefined) s.targetId = u.gatherTargetId;
    else if (u.buildTargetId !== undefined) s.targetId = u.buildTargetId;
    if (u.cargo?.length) s.garrison = u.cargo.length; // transporte: quantos a bordo
    return s;
  }

  private buildingToSnap(b: Building): BuildingSnap {
    const s: BuildingSnap = {
      id: b.id,
      owner: b.owner,
      type: b.type,
      tileX: b.tileX,
      tileY: b.tileY,
      hp: b.hp,
      progress: b.progress,
      queue: b.queue.map((q) => ({ ...q })),
    };
    if (b.rallyX !== undefined) s.rallyX = b.rallyX;
    if (b.rallyY !== undefined) s.rallyY = b.rallyY;
    if (b.foodLeft !== undefined) s.foodLeft = b.foodLeft;
    if (b.research) {
      const tech = TECH_DEFS.find((t) => t.id === b.research!.id);
      s.research = { id: b.research.id, progress: tech ? Math.min(1, b.research.elapsed / (tech.time || 1)) : 0 };
    }
    if (b.targetId !== undefined) s.targetId = b.targetId; // torre atirando
    if (b.garrison?.length) s.garrison = b.garrison.length; // unidades dentro
    if (b.upgradeTargetLevel !== undefined) s.upgradeTargetLevel = b.upgradeTargetLevel;
    if (b.trainBlocked) s.trainBlocked = b.trainBlocked;
    if (b.level !== undefined && b.level > 1) s.level = b.level;
    if (b.upgradeProgress !== undefined) s.upgradeProgress = b.upgradeProgress;
    const proof = this.facilityProofs.get(b.id);
    if (proof) s.proof = proof;
    return s;
  }

  /** Supply from completed generators (+ the Town Center base) vs. draw from
   *  automated builders. Only meaningful in Symbiosis matches. */
  private recomputePower(): void {
    const next = new Map<number, PowerSnap>();
    for (const p of this.players.values()) next.set(p.id, { supply: 0, draw: 0 });
    for (const b of this.buildings.values()) {
      if (b.progress < 1) continue;
      const g = next.get(b.owner);
      if (!g) continue;
      const base = BUILDING_DEFS[b.type].power ?? (b.type === 'town_center' ? TOWN_CENTER_POWER : 0);
      g.supply += this.homeMode ? Math.round(base * levelScale(b.level, 0.5)) : base;
      if (!this.homeMode && !this.raidMode) g.draw += BUILDING_POWER_DRAW[b.type] ?? 0;
    }
    for (const u of this.units.values()) {
      const g = next.get(u.owner);
      if (g) g.draw += POWER_DRAW[u.type] ?? 0;
    }
    // Space Gateway turns orbital solar/telemetry infrastructure into a civic
    // grid advantage without granting offensive capability.
    for (const p of this.players.values()) {
      if (p.cityPath === 'space') next.get(p.id)!.supply += 10;
      if (p.devPower) next.get(p.id)!.supply += p.devPower;
    }
    this.power = next;
  }

  powerOf(playerId: number): PowerSnap {
    return this.power.get(playerId) ?? { supply: 0, draw: 0 };
  }

  /** 1 for non-automated units; grid-limited for robots and drones. */
  private automationFactor(u: Unit): number {
    // A raiding army is away from its home grid; only Home/Arena grids throttle.
    if (!POWER_DRAW[u.type] || this.raidMode) return 1;
    const g = this.powerOf(u.owner);
    return powerEfficiency(g.supply, g.draw);
  }

  private popOf(playerId: number): number {
    let total = 0;
    for (const u of this.units.values()) {
      // Home: manufactured army occupies Army Camp space, not housing.
      if (this.homeMode && SYMBIOSIS_COMBAT_UNITS.has(u.type)) continue;
      if (u.owner === playerId) total += UNIT_DEFS[u.type].pop;
      // tropa EMBARCADA num transporte também conta (AoE2)
      if (u.cargo) for (const c of u.cargo) if (c.owner === playerId) total += UNIT_DEFS[c.type].pop;
    }
    // unidades GUARNECIDAS dentro de prédios ainda contam na população (AoE2)
    for (const b of this.buildings.values()) {
      if (b.garrison) for (const u of b.garrison) if (u.owner === playerId) total += UNIT_DEFS[u.type].pop;
    }
    return total;
  }

  private popCapOf(playerId: number): number {
    let total = 0;
    for (const b of this.buildings.values()) {
      if (b.owner === playerId && b.progress >= 1) total += BUILDING_DEFS[b.type].popProvided;
    }
    return Math.min(POP_CAP_MAX, total);
  }

  private checkVictory(): void {
    if (this.ended || this.homeMode || this.raidMode) return;
    const alive = [...this.players.values()].filter((p) => !p.defeated);
    // Vitória por LADOS: cada time (>0) é um lado; sem time, cada jogador é o
    // próprio lado. Acaba quando resta <= 1 lado vivo (aliados vencem juntos).
    const sides = new Set(alive.map((p) => (p.team && p.team > 0 ? `t${p.team}` : `p${p.id}`)));
    // Solo (sandbox/treino): o jogo só termina se o único jogador for derrotado
    // (senão ele ficaria preso num mapa vazio sem tela de fim).
    const over = this.players.size > 1 ? sides.size <= 1 : alive.length === 0;
    if (over) {
      this.ended = true;
      const winner = alive[0];
      const winnerName = alive.length > 1 ? alive.map((p) => p.name).join(' + ') : winner?.name ?? '';
      const report = this.buildMatchReport(winner ? winner.id : -1);
      this.finalReport = report;
      for (const p of this.players.values()) {
        // `won` individual: aliados do lado vencedor também veem "Vitória!"
        // (mesmo um aliado já derrotado — o TIME dele venceu).
        const won = winner ? this.allied(p.id, winner.id) : false;
        const contributions = [...this.players.values()].map((player) => ({ playerId: player.id, name: player.name, elon: player.elon }));
        const standings = this.standings();
        this.send(p.id, winner
          ? { type: 'gameOver', winner: winner.id, winnerName, won, contributions, standings, ...(this.dev ? { dev: true } : {}), ...(report ? { report } : {}) }
          : { type: 'gameOver', winner: -1, winnerName: '', won: false, contributions, standings, ...(this.dev ? { dev: true } : {}), ...(report ? { report } : {}) });
      }
      this.onGameOver(winner ? winner.id : -1, winnerName);
    }
  }

  /** Verifica derrota por perda de todos os town_centers (concluídos ou em obra). */
  private checkTownCenterLoss(playerId: number): void {
    const p = this.players.get(playerId);
    if (!p || p.defeated) return;
    const hasTC = [...this.buildings.values()].some((b) => b.owner === playerId && b.type === 'town_center');
    if (!hasTC) this.markDefeated(playerId);
  }

  // ---------------- Comandos ----------------

  private applyQueuedCommands(): void {
    const cmds = this.queue;
    this.queue = [];
    for (const { playerId, cmd } of cmds) {
      const p = this.players.get(playerId);
      if (!p || p.defeated) continue;
      // Direct unit orders from a human hand those units back to the player for a while.
      if (!p.difficulty && 'unitIds' in cmd && Array.isArray(cmd.unitIds) && cmd.kind !== 'build') {
        for (const id of cmd.unitIds) this.playerTouched.set(id, this.tick);
      }
      try {
        this.applyCommand(playerId, cmd);
      } catch (err) {
        console.error('[room] erro aplicando comando', cmd.kind, err);
      }
    }
  }

  private applyCommand(playerId: number, cmd: GameCommand): void {
    switch (cmd.kind) {
      case 'move':
        this.cmdMove(playerId, cmd.unitIds, cmd.x, cmd.y, cmd.queue ?? false);
        break;
      case 'stop':
        this.cmdStop(playerId, cmd.unitIds);
        break;
      case 'delete':
        this.cmdDelete(playerId, cmd.ids);
        break;
      case 'repair':
        this.cmdRepair(playerId, cmd.unitIds, cmd.targetId);
        break;
      case 'garrison':
        this.cmdGarrison(playerId, cmd.unitIds, cmd.targetId);
        break;
      case 'unload':
        this.cmdUnload(playerId, cmd.buildingId);
        break;
      case 'gather':
        this.cmdGather(playerId, cmd.unitIds, cmd.targetId);
        break;
      case 'build':
        this.cmdBuild(playerId, cmd.unitIds, cmd.building, cmd.tileX, cmd.tileY, cmd.queue ?? false);
        break;
      case 'train':
        this.cmdTrain(playerId, cmd.buildingId, cmd.unit);
        break;
      case 'cancelTrain':
        this.cmdCancelTrain(playerId, cmd.buildingId, cmd.index);
        break;
      case 'attack':
        this.cmdAttack(playerId, cmd.unitIds, cmd.targetId);
        break;
      case 'setRally':
        this.cmdSetRally(playerId, cmd.buildingId, cmd.x, cmd.y);
        break;
      case 'setCommander':
        this.cmdSetCommander(playerId, cmd.persona, cmd.autonomy);
        break;
      case 'commanderOrder':
        this.cmdCommanderOrder(playerId, cmd.objective);
        break;
      case 'cancelCommanderOrder':
        this.cmdCancelCommanderOrder(playerId);
        break;
      case 'setCommanderPolicy':
        this.cmdSetCommanderPolicy(playerId, cmd.policy);
        break;
      case 'upgradeBuilding':
        if (this.homeMode) this.cmdUpgradeBuilding(playerId, cmd.buildingId);
        break;
      case 'unitResearch':
        if (this.homeMode) this.cmdUnitResearch(playerId, cmd.unit);
        break;
      case 'advanceAge':
        this.cmdAdvanceAge(playerId);
        break;
      case 'chooseCityPath':
        this.cmdChooseCityPath(playerId, cmd.path);
        break;
      case 'research':
        this.cmdResearch(playerId, cmd.buildingId, cmd.techId);
        break;
      case 'trade':
        this.cmdTrade(playerId, cmd.action, cmd.resource);
        break;
      case 'scoutRaid':
        this.cmdScoutRaid(playerId, cmd.defenderId);
        break;
      case 'setRaidArmy':
        this.cmdSetRaidArmy(playerId, cmd.army);
        break;
      case 'startRaid':
        this.cmdStartRaid(playerId);
        break;
      case 'deployRaid':
        this.cmdDeployRaid(playerId, cmd.unit, cmd.x, cmd.y);
        break;
      case 'showRaidReplay': {
        const raid = this.raids.get(playerId);
        if (raid?.phase === 'result') raid.phase = 'replay';
        break;
      }
      case 'closeRaid': {
        const raid = this.raids.get(playerId);
        if (raid?.phase === 'result' || raid?.phase === 'replay') this.raids.delete(playerId);
        break;
      }
    }
  }

  // ---------------- Clash-style raids ----------------

  private emptyRaidArmy(): RaidArmy {
    return { attack_drone: 0, fighter: 0, rocket_launcher: 0, siege_mech: 0,
      stealth_bomber: 0, plasma_tank: 0, iron_guardian: 0, aegis_valkyrie: 0 };
  }

  private raidSnap(r: ActiveRaid): RaidSnap {
    return { id: r.id, phase: r.phase, attacker: r.attacker, defender: r.defender,
      army: { ...r.army }, remaining: { ...r.remaining }, deployed: r.deployed,
      duration: r.duration, secondsLeft: r.secondsLeft, destruction: r.destruction,
      stars: r.stars, loot: { ...r.loot }, events: r.events.map((e) => ({ ...e })) };
  }

  private cmdScoutRaid(attacker: number, defender: number): void {
    const a = this.players.get(attacker);
    const d = this.players.get(defender);
    if (!a || !d || a.defeated || d.defeated || this.allied(attacker, defender)) return;
    if (!this.symbiosis || a.age < 5 || a.cityPath !== 'command') {
      this.errorTo(attacker, 'err.raid_requires_command');
      return;
    }
    if (d.age < 5 || d.cityPath !== 'command') {
      this.errorTo(attacker, 'err.raid_target_protected');
      return;
    }
    const buildings = [...this.buildings.values()].filter((b) => b.owner === defender && b.progress >= 1);
    if (!buildings.length) return;
    this.raids.set(attacker, {
      id: this.nextRaidId++, phase: 'scouting', attacker, defender,
      army: this.emptyRaidArmy(), remaining: this.emptyRaidArmy(), deployed: 0,
      duration: 180, secondsLeft: 180, destruction: 0, stars: 0,
      loot: { energy: 0, alloys: 0, compute: 0 }, events: [],
      initialBuildings: new Set(buildings.map((b) => b.id)),
      initialHp: buildings.reduce((n, b) => n + BUILDING_DEFS[b.type].hp, 0),
      raidUnits: new Set(), awardedStars: new Set(), recordedDestroyed: new Set(),
    });
  }

  private cmdSetRaidArmy(playerId: number, army: RaidArmy): void {
    const r = this.raids.get(playerId);
    if (!r || r.phase !== 'scouting') return;
    const clean: RaidArmy = {
      attack_drone: Math.max(0, Math.min(12, Math.floor(army.attack_drone || 0))),
      fighter: Math.max(0, Math.min(8, Math.floor(army.fighter || 0))),
      rocket_launcher: Math.max(0, Math.min(6, Math.floor(army.rocket_launcher || 0))),
      siege_mech: Math.max(0, Math.min(6, Math.floor(army.siege_mech || 0))),
      stealth_bomber: Math.max(0, Math.min(4, Math.floor(army.stealth_bomber || 0))),
      plasma_tank: Math.max(0, Math.min(4, Math.floor(army.plasma_tank || 0))),
      iron_guardian: Math.max(0, Math.min(1, Math.floor(army.iron_guardian || 0))),
      aegis_valkyrie: Math.max(0, Math.min(1, Math.floor(army.aegis_valkyrie || 0))),
    };
    if (Object.values(clean).reduce((a, b) => a + b, 0) > 18) return;
    for (const [type, wanted] of Object.entries(clean) as [keyof RaidArmy, number][]) {
      const manufactured = [...this.units.values()].filter((u) => u.owner === playerId && u.type === type).length;
      if (wanted > manufactured) { this.errorTo(playerId, 'err.raid_not_manufactured'); return; }
    }
    r.army = clean;
    r.remaining = { ...clean };
  }

  private cmdStartRaid(playerId: number): void {
    const r = this.raids.get(playerId);
    if (!r || r.phase !== 'scouting') return;
    if (Object.values(r.army).reduce((a, b) => a + b, 0) < 1) return;
    for (const [type, amount] of Object.entries(r.army) as [keyof RaidArmy, number][]) {
      const reserve = [...this.units.values()].filter((u) => u.owner === playerId && u.type === type).slice(0, amount);
      if (reserve.length !== amount) return;
      for (const u of reserve) this.units.delete(u.id);
    }
    r.phase = 'deploying';
    r.startedTick = this.tick;
    r.events.push({ at: 0, kind: 'start', label: `Assault on ${this.players.get(r.defender)?.name ?? 'city'}` });
  }

  private cmdDeployRaid(playerId: number, type: keyof RaidArmy, x: number, y: number): void {
    const r = this.raids.get(playerId);
    if (!r || (r.phase !== 'deploying' && r.phase !== 'battle') || r.remaining[type] < 1) return;
    const n = this.grid.size;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= n || y >= n) return;
    const edge = Math.min(x, y, n - x, n - y);
    if (edge > 3) { this.errorTo(playerId, 'err.raid_edge_only'); return; }
    const spot = nearestWalkableTile(this.gridForType(type), Math.floor(x), Math.floor(y));
    if (!spot) return;
    const u = createUnit(this.nextId++, playerId, type, spot.x + 0.5, spot.y + 0.5);
    this.units.set(u.id, u);
    r.raidUnits.add(u.id);
    r.remaining[type]--;
    r.deployed++;
    r.phase = 'battle';
    const target = this.nearestRaidTarget(r.defender, u.x, u.y);
    if (target) this.assignAttack(u, target.id);
    r.events.push({ at: this.raidElapsed(r), kind: 'deploy', label: type.replaceAll('_', ' '), x: u.x, y: u.y });
  }

  private gridForType(type: keyof RaidArmy): Grid {
    return isFlyingUnit(type) ? this.airGrid : this.grid;
  }

  private nearestRaidTarget(defender: number, x: number, y: number): Building | undefined {
    let best: Building | undefined;
    let dist = Infinity;
    for (const b of this.buildings.values()) {
      if (b.owner !== defender || b.progress < 1) continue;
      const s = BUILDING_DEFS[b.type].size;
      const d = Math.hypot(b.tileX + s / 2 - x, b.tileY + s / 2 - y);
      if (d < dist) { dist = d; best = b; }
    }
    return best;
  }

  private raidElapsed(r: ActiveRaid): number {
    return r.startedTick === undefined ? 0 : Math.round((this.tick - r.startedTick) * TICK_MS / 100) / 10;
  }

  private updateRaids(): void {
    for (const r of this.raids.values()) {
      if (r.phase !== 'deploying' && r.phase !== 'battle') continue;
      r.secondsLeft = Math.max(0, r.duration - this.raidElapsed(r));
      let hp = 0;
      let alive = 0;
      for (const id of r.initialBuildings) {
        const b = this.buildings.get(id);
        if (b) { hp += Math.max(0, b.hp); alive++; }
        else if (!r.recordedDestroyed.has(id)) {
          r.recordedDestroyed.add(id);
          r.events.push({ at: this.raidElapsed(r), kind: 'destroy', label: `Facility ${id} destroyed` });
        }
      }
      r.destruction = Math.min(100, Math.round((1 - hp / Math.max(1, r.initialHp)) * 100));
      const tcGone = ![...this.buildings.values()].some((b) => b.owner === r.defender && b.type === 'town_center');
      const earned = [r.destruction >= 50, tcGone, alive === 0];
      r.stars = earned.filter(Boolean).length;
      earned.forEach((yes, i) => {
        const star = i + 1;
        if (yes && !r.awardedStars.has(star)) {
          r.awardedStars.add(star);
          r.events.push({ at: this.raidElapsed(r), kind: 'star', label: `Star ${star} secured` });
        }
      });
      for (const id of r.raidUnits) {
        const u = this.units.get(id);
        if (!u || u.state !== 'idle') continue;
        const target = this.nearestRaidTarget(r.defender, u.x, u.y);
        if (target) this.assignAttack(u, target.id);
      }
      const forceGone = r.deployed > 0 && [...r.raidUnits].every((id) => !this.units.has(id));
      const reserves = Object.values(r.remaining).reduce((a, b) => a + b, 0);
      if (r.secondsLeft <= 0 || alive === 0 || (forceGone && reserves === 0)) this.finishRaid(r);
    }
  }

  private finishRaid(r: ActiveRaid): void {
    if (r.phase === 'result') return;
    r.phase = 'result';
    const defender = this.players.get(r.defender);
    const attacker = this.players.get(r.attacker);
    if (defender && attacker) {
      const rate = Math.min(0.3, r.destruction / 300);
      for (const k of Object.keys(r.loot) as ResourceType[]) {
        const amount = Math.max(0, Math.floor(defender.resources[k] * rate));
        defender.resources[k] -= amount;
        attacker.resources[k] += amount;
        r.loot[k] = amount;
      }
    }
    r.events.push({ at: this.raidElapsed(r), kind: 'finish', label: `${r.stars} stars · ${r.destruction}% destroyed` });
  }

  /** Mercado: compra/venda de 1 lote (100) de recurso por ouro. O preço é da
   *  SALA: comprar encarece, vender barateia — para todos os jogadores. */
  private cmdTrade(playerId: number, action: 'buy' | 'sell', resource: 'energy' | 'alloys'): void {
    const p = this.players.get(playerId);
    if (!p || p.defeated) return;
    if (this.marketPrices[resource] === undefined) return;
    const hasMarket = [...this.buildings.values()].some(
      (b) => b.owner === playerId && b.type === 'market' && b.progress >= 1,
    );
    if (!hasMarket) {
      this.errorTo(playerId, 'err.need_market');
      return;
    }
    const price = this.marketPrices[resource];
    if (action === 'buy') {
      const cost = tradeBuyCost(price);
      if (p.resources.compute < cost) {
        this.errorTo(playerId, 'err.no_gold');
        return;
      }
      p.resources.compute -= cost;
      p.resources[resource] += TRADE_LOT;
      this.marketPrices[resource] = Math.min(MARKET_PRICE_MAX, price + MARKET_PRICE_STEP);
    } else {
      if (p.resources[resource] < TRADE_LOT) {
        this.errorTo(playerId, 'err.no_resource_sell');
        return;
      }
      p.resources[resource] -= TRADE_LOT;
      p.resources.compute += tradeSellGain(price);
      this.marketPrices[resource] = Math.max(MARKET_PRICE_MIN, price - MARKET_PRICE_STEP);
    }
  }

  private cmdResearch(playerId: number, buildingId: number, techId: string): void {
    const p = this.players.get(playerId);
    const b = this.buildings.get(buildingId);
    if (!p || p.defeated || !b || b.owner !== playerId || b.progress < 1) return;
    const tech = TECH_DEFS.find((t) => t.id === techId);
    if (!tech || tech.building !== b.type) return;
    if (p.techs.has(techId)) return;
    if (b.research) {
      this.errorTo(playerId, 'err.building_researching');
      return;
    }
    if (p.age < tech.ageReq) {
      this.errorTo(playerId, 'err.requires_age', { age: tech.ageReq });
      return;
    }
    if (tech.prereq && !p.techs.has(tech.prereq)) {
      this.errorTo(playerId, 'err.requires_prev_upgrade');
      return;
    }
    if (!this.canAfford(p, tech.cost)) {
      this.errorTo(playerId, 'err.no_resources');
      return;
    }
    this.deduct(p, tech.cost);
    b.research = { id: techId, elapsed: 0 };
  }

  /** Aplica uma tecnologia concluída: registra e reforça as unidades existentes. */
  private completeTech(playerId: number, techId: string): void {
    const p = this.players.get(playerId);
    if (!p || p.techs.has(techId)) return;
    p.techs.add(techId);
    const tech = TECH_DEFS.find((t) => t.id === techId);
    if (!tech || !tech.addHp) return;
    // upgrades de vida valem para unidades já existentes (sobem hp atual e máximo)
    for (const u of this.units.values()) {
      if (u.owner === playerId && tech.units.includes(u.type)) u.hp += tech.addHp;
    }
  }

  private cmdAdvanceAge(playerId: number): void {
    if (this.homeMode) {
      const hub = [...this.buildings.values()].find((b) => b.owner === playerId && b.type === 'town_center');
      if (hub) this.cmdUpgradeBuilding(playerId, hub.id);
      return;
    }
    const p = this.players.get(playerId);
    if (!p || p.defeated) return;
    if (p.ageResearch) {
      this.errorTo(playerId, 'err.age_researching');
      return;
    }
    if (p.age >= MAX_AGE) return;
    let hasTC = false;
    for (const b of this.buildings.values()) {
      if (b.owner === playerId && b.type === 'town_center' && b.progress >= 1) { hasTC = true; break; }
    }
    if (!hasTC) {
      this.errorTo(playerId, 'err.requires_tc');
      return;
    }
    // regra do AoE2: 2 prédios DIFERENTES da era atual concluídos
    // (Casa/Fazenda/Muralha não contam; duas cópias do mesmo valem uma).
    const needB = buildingsToAdvance(p.age);
    if (needB > 0) {
      const have = new Set<BuildingType>();
      for (const b of this.buildings.values()) {
        if (b.owner === playerId && b.progress >= 1 && countsForAgeUp(b.type, p.age)) have.add(b.type);
      }
      if (have.size < needB) {
        this.errorTo(playerId, 'err.requires_buildings', { n: needB, age: p.age, have: have.size });
        return;
      }
    }
    const completed: BuildingType[] = [];
    for (const b of this.buildings.values()) if (b.owner === playerId && b.progress >= 1) completed.push(b.type);
    if (!layerGateMet(p.age, completed)) {
      this.errorTo(playerId, 'err.requires_layer', { building: LAYER_GATE[p.age][0] });
      return;
    }
    const cost = AGE_COSTS[p.age + 1] ?? {};
    if (!this.canAfford(p, cost)) {
      this.errorTo(playerId, 'err.no_resources');
      return;
    }
    this.deduct(p, cost);
    p.ageResearch = { target: p.age + 1, elapsed: 0 };
  }

  private cmdChooseCityPath(playerId: number, path: CityPath): void {
    // Backward-compatible alias for old clients. The branch was removed.
    void path;
    this.cmdAdvanceAge(playerId);
  }

  private ownedUnits(playerId: number, unitIds: number[]): Unit[] {
    const out: Unit[] = [];
    for (const id of unitIds) {
      const u = this.units.get(id);
      if (u && u.owner === playerId) out.push(u);
    }
    return out;
  }

  /** Grade de movimento da unidade: barcos usam a naval, o resto a terrestre. */
  private gridFor(u: Unit): Grid {
    if (isFlyingUnit(u.type)) return this.airGrid;
    return isNavalUnit(u.type) ? this.navalGrid : this.grid;
  }

  // ---------------- Player AI commander ----------------

  /** May this player's forces fight? Symbiosis gates warfare on the Command
   *  Metropolis (Level 5) except in skirmish matches. */
  private atWar(p: GamePlayer | undefined): boolean {
    return !this.symbiosis || this.openWarfare || p?.cityPath === 'command';
  }

  private cmdSetCommander(playerId: number, persona: CommanderPersona, autonomy: CommanderAutonomy): void {
    if (this.homeMode || this.raidMode) return;
    if (!['vanguard', 'sentinel', 'architect'].includes(persona) || !['manual', 'assisted', 'autonomous'].includes(autonomy)) return;
    this.commanders.get(playerId)?.configure(persona, autonomy);
  }

  private cmdSetCommanderPolicy(playerId: number, policy: CommanderPolicy): void {
    if (this.homeMode || this.raidMode || !policy) return;
    this.commanders.get(playerId)?.setPolicy(policy);
  }

  private cmdCommanderOrder(playerId: number, objective: StrategicObjective): void {
    if (this.homeMode || this.raidMode || !objective) return;
    if ('x' in objective && (!Number.isFinite(objective.x) || !Number.isFinite(objective.y)
      || objective.x < 0 || objective.y < 0 || objective.x >= this.grid.size || objective.y >= this.grid.size)) return;
    if (objective.kind === 'attack_target') {
      const unit = this.units.get(objective.targetId);
      const building = this.buildings.get(objective.targetId);
      const owner = unit?.owner ?? building?.owner;
      if (owner === undefined || this.allied(owner, playerId)) return;
    }
    const resources = ['energy', 'alloys', 'compute'];
    if (objective.kind === 'prioritize_resource' && (!resources.includes(objective.resource) || (objective.from && !resources.includes(objective.from)))) return;
    const brain = this.commanders.get(playerId);
    if (!brain) return;
    if (brain.activeObjective) this.endCommanderRun(playerId);
    brain.issue(objective);
    // Execute in the same tick so the order feels immediate.
    this.runCommander(playerId, brain);
  }

  private cmdCancelCommanderOrder(playerId: number): void {
    const brain = this.commanders.get(playerId);
    if (!brain) return;
    brain.cancel(this.tick);
    if (!brain.activeObjective) this.endCommanderRun(playerId);
  }

  private updateCommanders(): void {
    for (const player of this.players.values()) {
      if (player.defeated || player.difficulty) continue;
      const brain = this.commanders.get(player.id);
      if (!brain) continue;
      this.runCommander(player.id, brain);
      if (this.tick % 30 === 0) this.commanderProduction(player.id, brain);
    }
  }

  private runCommander(playerId: number, brain: CommanderBrain): void {
    const step = brain.step(this.commanderFacts(playerId));
    if (!brain.activeObjective) this.endCommanderRun(playerId);
    if (!step) return;
    if (step.economy) {
      const { objective, decisionId } = step.economy;
      brain.resolveEconomy(decisionId, this.reassignWorkers(playerId, objective.resource, objective.from), this.tick);
    }
    if (step.start) {
      this.startCommanderObjective(playerId, step.start.objective, step.start.source);
      const decision = brain.activeObjective?.decision;
      if (decision) this.stats?.commander(playerId, decision, this.players.get(playerId)?.name ?? '');
    } else if (step.reinforce) {
      this.reinforceCommanderObjective(playerId, step.reinforce);
    }
  }

  /** Combat units the commander may command: not workers, not builders. */
  private commanderArmy(playerId: number): Unit[] {
    const out: Unit[] = [];
    for (const unit of this.units.values()) {
      if (unit.owner === playerId && unit.type !== 'villager' && UNIT_DEFS[unit.type].attack > 0 && !isBuilderUnit(unit.type) && !isNavalUnit(unit.type)) out.push(unit);
    }
    return out;
  }

  /** Units the player micro-managed recently stay under the player's hand. */
  private playerHolds(unit: Unit): boolean {
    const at = this.playerTouched.get(unit.id);
    return at !== undefined && this.tick - at < PLAYER_HOLD_TICKS;
  }

  private armyPower(units: Unit[]): number {
    let power = 0;
    for (const unit of units) {
      const def = UNIT_DEFS[unit.type];
      power += Math.max(0, unit.hp) * (def.attack / Math.max(0.5, def.attackCooldown));
    }
    return power / 100;
  }

  /** Static resistance around an enemy core: defensive structures (one extra
   *  arrow per garrisoned unit, as in updateTowers) and armed workers nearby. */
  private defensePower(owner: number, at: { x: number; y: number }): number {
    const age = this.players.get(owner)?.age ?? 1;
    const techs = this.players.get(owner)?.techs;
    let power = 0;
    let workers = 0;
    for (const u of this.units.values()) {
      if (u.owner !== owner || u.type !== 'villager' || Math.hypot(u.x - at.x, u.y - at.y) > BASE_RADIUS) continue;
      workers++;
      power += u.hp * (UNIT_DEFS.villager.attack / UNIT_DEFS.villager.attackCooldown) * 0.5;
    }
    for (const b of this.buildings.values()) {
      if (b.owner !== owner || b.progress < 1) continue;
      const def = DEFENSE_DEFS[b.type];
      if (!def || Math.hypot(b.tileX - at.x, b.tileY - at.y) > BASE_RADIUS) continue;
      // Nearby workers can garrison under attack; count half of that potential.
      const inside = b.garrison?.length ?? 0;
      const potential = Math.min((GARRISON_CAP[b.type] ?? 0) - inside, workers);
      const arrows = 1 + inside + Math.max(0, potential) * 0.5;
      power += b.hp * (buildingAttack(b.type, age, techs) * arrows / def.cooldown);
    }
    return power / 100;
  }

  private coreOf(playerId: number): Building | undefined {
    for (const b of this.buildings.values()) if (b.owner === playerId && b.type === 'town_center') return b;
    return undefined;
  }

  private centerOf(b: Building): { x: number; y: number } {
    const size = BUILDING_DEFS[b.type].size;
    return { x: b.tileX + size / 2, y: b.tileY + size / 2 };
  }

  private commanderFacts(playerId: number): CommanderFacts {
    const player = this.players.get(playerId)!;
    const coreBuilding = this.coreOf(playerId);
    const core = coreBuilding ? { id: coreBuilding.id, ...this.centerOf(coreBuilding) } : undefined;
    const enemyCores = [...this.buildings.values()].filter((b) => b.type === 'town_center' && !this.allied(b.owner, playerId));
    enemyCores.sort((a, b) => {
      if (!core) return a.id - b.id;
      const da = Math.hypot(a.tileX - core.x, a.tileY - core.y);
      const db = Math.hypot(b.tileX - core.x, b.tileY - core.y);
      return da - db || a.id - b.id;
    });
    const enemy = enemyCores[0];
    const army = this.commanderArmy(playerId);
    const enemyArmy: Unit[] = [];
    let hostilesNearBase = 0;
    for (const unit of this.units.values()) {
      if (this.allied(unit.owner, playerId)) continue;
      if (unit.type !== 'villager' && UNIT_DEFS[unit.type].attack > 0 && !isBuilderUnit(unit.type)) enemyArmy.push(unit);
      if (core && Math.hypot(unit.x - core.x, unit.y - core.y) <= BASE_RADIUS) hostilesNearBase++;
    }
    const armyHealth = army.length > 0
      ? army.reduce((sum, unit) => sum + Math.min(1, unit.hp / Math.max(1, this.unitMaxHp(unit))), 0) / army.length
      : 1;
    const own = this.armyPower(army);
    const theirs = this.armyPower(enemyArmy);
    const defenses = enemy ? this.defensePower(enemy.owner, this.centerOf(enemy)) : 0;
    const armySpread = core && army.length > 0 ? army.reduce((sum, u) => sum + Math.hypot(u.x - core.x, u.y - core.y), 0) / army.length : 0;
    const recent = this.recentAttacks.get(playerId);
    // Demand-weighted stockpiles: food funds workers, troops and ages; stone little.
    const weighted = (Object.entries(player.resources) as [ResourceType, number][])
      .filter(([r]) => this.freeSourceFor(playerId, r))
      .map(([r, n]) => [r, n / RESOURCE_DEMAND[r]] as [ResourceType, number])
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    // A resource the doctrine is waiting on outranks the demand weighting.
    const short = this.commanderShortfall.get(playerId);
    const wanted = short && this.tick - short.tick <= 300 ? weighted.find(([r]) => r === short.resource) : undefined;
    const needy = wanted ?? weighted[0];
    const rich = weighted.filter(([r]) => r !== needy?.[0]).at(-1);
    let richWorkers = 0;
    for (const u of this.units.values()) if (u.owner === playerId && u.type === 'villager' && this.gatheringResource(u) === rich?.[0]) richWorkers++;
    const surplus = needy && rich && player.resources[needy[0]] < 300
      && (wanted ? rich[1] > 2 * Math.max(needy[1], 50) : rich[1] > 4 * Math.max(needy[1], 50)) && richWorkers >= 3
      ? { from: rich[0], to: needy[0], ratio: rich[1] / Math.max(needy[1], 50) } : undefined;
    let idleWorkers = 0;
    for (const u of this.units.values()) if (u.owner === playerId && u.type === 'villager' && u.state === 'idle') idleWorkers++;
    const brain = this.commanders.get(playerId);
    const active = brain?.activeObjective;
    const expansion = core ? this.nearestExpansion(playerId, core) : undefined;
    return {
      tick: this.tick,
      ...(core ? { core } : {}),
      coreHealth: coreBuilding ? coreBuilding.hp / BUILDING_DEFS.town_center.hp : 1,
      ...(enemy ? { enemyCore: { id: enemy.id, ...this.centerOf(enemy) } } : {}),
      ...(recent && this.tick - recent.tick <= 100 ? { recentAttack: { x: recent.x, y: recent.y } } : {}),
      armySize: army.length,
      armyHealth,
      strengthRatio: theirs > 0 ? own / theirs : own > 0 ? 9 : 1,
      assaultRatio: theirs + defenses > 0 ? own / (theirs + defenses) : own > 0 ? 9 : 1,
      armySpread,
      hostilesNearBase,
      idleWorkers,
      lowestResource: needy?.[0] ?? 'energy',
      ...(surplus ? { surplus } : {}),
      ...(expansion ? { expansion } : {}),
      ...(active ? { active: this.objectiveStatus(playerId, active.objective, army) } : {}),
    };
  }

  /** Nearest gold/stone cluster beyond the base with no friendly structure near it. */
  private nearestExpansion(playerId: number, core: { x: number; y: number }): { x: number; y: number } | undefined {
    let best: { x: number; y: number } | undefined;
    let bestD = Infinity;
    for (const node of this.nodes.values()) {
      if (node.type !== 'gold_mine' && node.type !== 'stone_mine') continue;
      const d = Math.hypot(node.tileX - core.x, node.tileY - core.y);
      if (d < BASE_RADIUS + 4 || d >= bestD) continue;
      let claimed = false;
      for (const b of this.buildings.values()) {
        if (Math.hypot(b.tileX - node.tileX, b.tileY - node.tileY) <= 8) { claimed = true; break; }
      }
      if (claimed) continue;
      bestD = d;
      best = { x: node.tileX + 0.5, y: node.tileY + 0.5 };
    }
    return best;
  }

  private objectivePoint(playerId: number, objective: StrategicObjective): { x: number; y: number } | undefined {
    const core = this.coreOf(playerId);
    switch (objective.kind) {
      case 'defend_area':
      case 'capture_zone':
        return { x: objective.x, y: objective.y };
      case 'protect_core':
      case 'prepare_offensive':
      case 'retreat_regroup':
        return core ? { x: core.tileX + 4.5, y: core.tileY + 4.5 } : undefined;
      case 'attack_target': {
        const b = this.buildings.get(objective.targetId);
        if (b) return this.centerOf(b);
        const u = this.units.get(objective.targetId);
        return u ? { x: u.x, y: u.y } : undefined;
      }
      case 'prioritize_resource':
        return undefined;
    }
  }

  private nearestHostile(playerId: number, x: number, y: number, radius: number): Unit | undefined {
    let best: Unit | undefined;
    let bestD = radius;
    for (const unit of this.units.values()) {
      if (this.allied(unit.owner, playerId)) continue;
      const d = Math.hypot(unit.x - x, unit.y - y);
      if (d <= bestD) { bestD = d; best = unit; }
    }
    return best;
  }

  /** Dispatches the force for a newly started objective. Player orders take the
   *  whole army; commander initiative leaves the player's micro-managed units alone. */
  private startCommanderObjective(playerId: number, objective: StrategicObjective, source: 'player' | 'commander'): void {
    const army = this.commanderArmy(playerId).filter((unit) => source === 'player' || !this.playerHolds(unit));
    const previous = this.commanderRuns.get(playerId);
    const carried = previous?.sheltered ?? [];
    const run: CommanderRun = { startTick: this.tick, unitIds: new Set(army.map((unit) => unit.id)), lost: 0 };
    this.commanderRuns.set(playerId, run);
    if (objective.kind === 'defend_area' || objective.kind === 'protect_core') {
      const point = this.objectivePoint(playerId, objective);
      if (point) run.sheltered = [...new Set([...carried, ...this.shelterWorkers(playerId, army, point)])];
    } else if (previous) {
      this.releaseShelter(playerId, previous);
    }
    if (objective.kind === 'prioritize_resource') {
      run.detail = this.reassignWorkers(playerId, objective.resource, objective.from);
      return;
    }
    this.dispatchArmy(playerId, objective, army);
  }

  private reinforceCommanderObjective(playerId: number, objective: StrategicObjective): void {
    const run = this.commanderRuns.get(playerId);
    if (!run || objective.kind === 'prioritize_resource') return;
    const fresh = this.commanderArmy(playerId).filter((unit) => unit.state === 'idle' && !this.playerHolds(unit));
    if (fresh.length === 0) return;
    const point = this.objectivePoint(playerId, objective);
    // Idle units already on station need no new order.
    const away = point ? fresh.filter((unit) => Math.hypot(unit.x - point.x, unit.y - point.y) > 4) : fresh;
    for (const unit of away) run.unitIds.add(unit.id);
    if (away.length) this.dispatchArmy(playerId, objective, away);
  }

  private dispatchArmy(playerId: number, objective: StrategicObjective, army: Unit[]): void {
    const ids = army.map((unit) => unit.id);
    if (ids.length === 0) return;
    const point = this.objectivePoint(playerId, objective);
    switch (objective.kind) {
      case 'attack_target':
        this.cmdAttack(playerId, ids, objective.targetId);
        break;
      case 'defend_area':
      case 'protect_core': {
        const hostile = point ? this.nearestHostile(playerId, point.x, point.y, DEFEND_RADIUS) : undefined;
        if (hostile) this.cmdAttack(playerId, ids, hostile.id);
        else if (point) this.cmdMove(playerId, ids, point.x, point.y);
        break;
      }
      case 'capture_zone':
      case 'prepare_offensive':
      case 'retreat_regroup':
        if (point) this.cmdMove(playerId, ids, point.x, point.y);
        break;
      case 'prioritize_resource':
        break;
    }
  }

  /** Outmatched defense: workers near the core take shelter in the Command
   *  Core and towers, which then fire an extra arrow per occupant. */
  private shelterWorkers(playerId: number, army: Unit[], at: { x: number; y: number }): number[] {
    const core = this.coreOf(playerId);
    if (!core || core.progress < 1) return [];
    const c = this.centerOf(core);
    let threat = 0;
    for (const u of this.units.values()) {
      if (!this.allied(u.owner, playerId) && Math.hypot(u.x - at.x, u.y - at.y) <= BASE_RADIUS) threat += this.armyPower([u]);
    }
    if (threat === 0 || this.armyPower(army) >= threat * 1.2) return [];
    // Workers in the core and those near the attack both run for cover.
    const exposed = (u: Unit): boolean => Math.hypot(u.x - c.x, u.y - c.y) <= BASE_RADIUS || Math.hypot(u.x - at.x, u.y - at.y) <= DEFEND_RADIUS + 4;
    const shelters = [...this.buildings.values()]
      .filter((b) => b.owner === playerId && b.progress >= 1 && (GARRISON_CAP[b.type] ?? 0) > (b.garrison?.length ?? 0))
      .sort((a, b) => Math.hypot(a.tileX - c.x, a.tileY - c.y) - Math.hypot(b.tileX - c.x, b.tileY - c.y));
    const workers = [...this.units.values()]
      .filter((u) => u.owner === playerId && u.type === 'villager' && exposed(u) && !this.playerHolds(u))
      .sort((a, b) => a.id - b.id);
    const used: number[] = [];
    for (const shelter of shelters) {
      const room = (GARRISON_CAP[shelter.type] ?? 0) - (shelter.garrison?.length ?? 0);
      const batch = workers.splice(0, room);
      if (batch.length === 0) break;
      this.cmdGarrison(playerId, batch.map((u) => u.id), shelter.id);
      used.push(shelter.id);
    }
    return used;
  }

  /** Whatever the outcome, an objective never leaves workers locked inside. */
  private endCommanderRun(playerId: number): void {
    const run = this.commanderRuns.get(playerId);
    if (run) this.releaseShelter(playerId, run);
    this.commanderRuns.delete(playerId);
  }

  private releaseShelter(playerId: number, run: CommanderRun): number {
    let released = 0;
    for (const id of run.sheltered ?? []) {
      const b = this.buildings.get(id);
      if (!b || b.owner !== playerId) continue;
      released += b.garrison?.length ?? 0;
      this.cmdUnload(playerId, id);
    }
    run.sheltered = [];
    return released;
  }

  /** Idle workers plus up to a third of those on other resources move to `resource`. */
  /** Whether a worker sent to `resource` would find something to gather. */
  private freeSourceFor(playerId: number, resource: ResourceType): boolean {
    for (const node of this.nodes.values()) if (NODE_DEFS[node.type].resource === resource) return true;
    if (resource !== 'energy') return false;
    const worked = new Set<number>();
    for (const u of this.units.values()) if (u.gatherTargetId !== undefined) worked.add(u.gatherTargetId);
    for (const b of this.buildings.values()) {
      if (b.owner === playerId && b.type === 'farm' && b.progress >= 1 && !worked.has(b.id)) return true;
    }
    return false;
  }

  /** Resource a worker is currently producing, from its gather target. */
  private gatheringResource(u: Unit): ResourceType | undefined {
    if (u.state !== 'gathering' && u.state !== 'movingToGather' && u.state !== 'returning') return undefined;
    if (u.gatherTargetId === undefined) return u.carryType;
    const node = this.nodes.get(u.gatherTargetId);
    if (node) return NODE_DEFS[node.type].resource;
    return this.buildings.get(u.gatherTargetId)?.type === 'farm' || this.sheep.has(u.gatherTargetId) ? 'energy' : u.carryType;
  }

  private reassignWorkers(playerId: number, resource: ResourceType, from?: ResourceType): string {
    const nodes: { id: number; tileX: number; tileY: number }[] = [...this.nodes.values()].filter((node) => NODE_DEFS[node.type].resource === resource);
    if (resource === 'energy') {
      // Unworked farms count as food sources (one farmer each).
      const worked = new Set<number>();
      for (const u of this.units.values()) if (u.gatherTargetId !== undefined) worked.add(u.gatherTargetId);
      for (const b of this.buildings.values()) {
        if (b.owner === playerId && b.type === 'farm' && b.progress >= 1 && !worked.has(b.id)) nodes.push(b);
      }
    }
    if (nodes.length === 0) return `No ${resource} source is available.`;
    const workers = [...this.units.values()].filter((u) => u.owner === playerId && u.type === 'villager');
    const idle = workers.filter((u) => u.state === 'idle');
    const others = workers.filter((u) => {
      const current = this.gatheringResource(u);
      return current !== undefined && current !== resource && (!from || current === from);
    }).sort((a, b) => a.id - b.id);
    const moved = [...idle, ...others.slice(0, Math.floor(others.length / 3))];
    for (const worker of moved) {
      if (nodes.length === 0) break;
      const target = nodes.reduce((best, node) => (Math.hypot(node.tileX - worker.x, node.tileY - worker.y) < Math.hypot(best.tileX - worker.x, best.tileY - worker.y) ? node : best));
      this.cmdGather(playerId, [worker.id], target.id);
      if (this.buildings.has(target.id)) nodes.splice(nodes.indexOf(target), 1);
    }
    return moved.length > 0 ? `${moved.length} worker(s) reassigned to ${resource}.` : 'No workers were available to reassign.';
  }

  /** Authoritative evaluation of the active objective, read by the brain. */
  private objectiveStatus(playerId: number, objective: StrategicObjective, army: Unit[]): ObjectiveStatus {
    const run = this.commanderRuns.get(playerId);
    if (!run) return { state: 'failed', detail: 'The objective lost its assigned force.' };
    const elapsed = this.tick - run.startTick;
    if (objective.kind === 'prioritize_resource') {
      const detail = run.detail ?? 'Workers reassigned.';
      return { state: detail.startsWith('No ') ? 'failed' : 'completed', detail };
    }
    const assigned = army.filter((unit) => run.unitIds.has(unit.id));
    const lost = [...run.unitIds].filter((id) => !this.units.has(id)).length;
    const sheltering = (run.sheltered?.length ?? 0) > 0;
    if (run.unitIds.size > 0 && assigned.length === 0 && !sheltering) return { state: 'failed', detail: `All ${run.unitIds.size} assigned unit(s) were destroyed.` };
    if (run.unitIds.size === 0 && elapsed > 50 && !sheltering) return { state: 'failed', detail: 'No combat units were available.' };
    const point = this.objectivePoint(playerId, objective);
    const near = (radius: number): number => (point ? assigned.filter((unit) => Math.hypot(unit.x - point.x, unit.y - point.y) <= radius).length : 0);
    const losses = lost > 0 ? ` (${lost} lost)` : '';
    switch (objective.kind) {
      case 'attack_target':
        if (!this.units.has(objective.targetId) && !this.buildings.has(objective.targetId)) {
          return { state: 'completed', detail: `Target destroyed${losses}.` };
        }
        return { state: 'running', detail: 'Engaging.' };
      case 'defend_area':
      case 'protect_core': {
        if (!point) return { state: 'failed', detail: 'The defended position no longer exists.' };
        const hostile = this.nearestHostile(playerId, point.x, point.y, DEFEND_RADIUS);
        if (hostile) {
          // Keep idle defenders fighting whatever is still in the sector.
          const idle = assigned.filter((unit) => unit.state === 'idle' && !this.playerHolds(unit)).map((unit) => unit.id);
          if (idle.length) this.cmdAttack(playerId, idle, hostile.id);
          return { state: 'running', detail: 'Hostiles in sector.' };
        }
        if (elapsed >= 50 && (near(DEFEND_RADIUS) > 0 || sheltering)) {
          const released = this.releaseShelter(playerId, run);
          return { state: 'completed', detail: `Sector secure${losses}.${released ? ` ${released} worker(s) released from shelter.` : ''}` };
        }
        return { state: 'running', detail: 'Moving to the sector.' };
      }
      case 'capture_zone':
      case 'prepare_offensive':
      case 'retreat_regroup': {
        if (!point) return { state: 'failed', detail: 'The rally position no longer exists.' };
        const arrived = near(objective.kind === 'capture_zone' ? 5 : 7);
        if (assigned.length > 0 && arrived >= Math.ceil(assigned.length * 0.75)) {
          const verb = objective.kind === 'capture_zone' ? 'Zone held by' : objective.kind === 'retreat_regroup' ? 'Regrouped' : 'Assembled';
          return { state: 'completed', detail: `${verb} ${arrived} unit(s)${losses}.` };
        }
        return { state: 'running', detail: `${arrived}/${assigned.length} on station.` };
      }
    }
  }

  /** Doctrine-driven spending inside the player's spending limit. Autonomous
   *  commanders queue; Assisted ones only recommend; Manual ones stay silent. */
  private commanderProduction(playerId: number, brain: CommanderBrain): void {
    if (brain.currentAutonomy === 'manual') return;
    const p = this.players.get(playerId);
    const core = this.coreOf(playerId);
    if (!p || !core) return;
    const mine = [...this.buildings.values()].filter((b) => b.owner === playerId);
    const has: Partial<Record<BuildingType, number>> = {};
    for (const b of mine) has[b.type] = (has[b.type] ?? 0) + 1;
    let villagers = 0;
    let military = 0;
    for (const u of this.units.values()) {
      if (u.owner !== playerId) continue;
      if (u.type === 'villager') villagers++;
      else if (UNIT_DEFS[u.type].attack > 0 && !isBuilderUnit(u.type)) military++;
    }
    const popCap = this.popCapOf(playerId);
    const facts: ProductionFacts = {
      age: p.age,
      villagers,
      military,
      towers: has.watch_tower ?? 0,
      popRoom: popCap - this.popOf(playerId),
      popCapped: popCap >= POP_CAP_MAX,
      houseInProgress: mine.some((b) => b.type === 'house' && b.progress < 1),
      structuresInProgress: mine.filter((b) => b.progress < 1).length,
      underAttack: !!this.recentAttacks.get(playerId) && this.tick - this.recentAttacks.get(playerId)!.tick <= 100,
      producers: mine.filter((b) => b.progress >= 1 && b.type !== 'town_center' && BUILDING_DEFS[b.type].trains.length > 0)
        .map((b) => ({ id: b.id, type: b.type, queue: b.queue.length })),
      ...(core.progress >= 1 ? { townCenterId: core.id } : {}),
      townCenterQueue: core.queue.length,
      has,
      foodSources: [...this.nodes.values()].filter((n) => NODE_DEFS[n.type].resource === 'energy').length
        + mine.filter((b) => b.type === 'farm' && b.progress >= 1 && (b.foodLeft ?? 0) > 0).length,
      canAdvance: this.commanderCanAdvance(p),
      ageReady: this.commanderAgeReady(p),
      ...(() => { const need = nextAgeRequirement(p.age, mine); return need ? { ageBuildingNeeded: need } : {}; })(),
    };
    const intents = planProduction(brain.currentPersona, facts);
    if (intents.length === 0) return;
    const executes = brain.currentAutonomy === 'autonomous';
    // The spending limit is a share of what is in the bank at the start of the cycle.
    const budget = {} as Record<ResourceType, number>;
    for (const key of Object.keys(p.resources) as ResourceType[]) budget[key] = p.resources[key] * brain.currentPolicy.spendLimit;
    const fits = (cost: Partial<Record<ResourceType, number>>): boolean =>
      (Object.entries(cost) as [ResourceType, number][]).every(([key, value]) => budget[key] >= (value ?? 0) && p.resources[key] >= (value ?? 0));
    const charge = (cost: Partial<Record<ResourceType, number>>): void => {
      for (const [key, value] of Object.entries(cost) as [ResourceType, number][]) budget[key] -= value ?? 0;
    };
    // The first structure (or age) the doctrine could not afford names the resource to gather next.
    let shortfall: ResourceType | undefined;
    const noteShortfall = (cost: Partial<Record<ResourceType, number>>): void => {
      if (shortfall) return;
      let worst = 0;
      for (const [key, value] of Object.entries(cost) as [ResourceType, number][]) {
        const missing = ((value ?? 0) - Math.min(budget[key], p.resources[key])) / Math.max(1, value ?? 0);
        if (missing > worst) { worst = missing; shortfall = key; }
      }
    };
    if (facts.ageReady && !facts.canAdvance) noteShortfall(AGE_COSTS[p.age + 1] ?? {});
    const queued: string[] = [];
    let units = 0;
    let structures = 0;
    let popRoom = facts.popRoom;
    for (const intent of intents) {
      if (intent.kind === 'advance_age') {
        const cost = AGE_COSTS[p.age + 1] ?? {};
        // Age research is the one purchase allowed past the spending limit: it is
        // only planned when fully affordable and it is the doctrine's priority.
        if (!this.canAfford(p, cost)) continue;
        if (executes) this.cmdAdvanceAge(playerId);
        charge(cost);
        queued.push(`age ${p.age + 1} research`);
        continue;
      }
      if (intent.kind === 'train') {
        const b = this.buildings.get(intent.buildingId);
        if (!b || !this.commanderCanTrain(p, b, intent.unit) || popRoom < UNIT_DEFS[intent.unit].pop) continue;
        const cost = UNIT_DEFS[intent.unit].cost;
        if (!fits(cost)) continue;
        charge(cost);
        popRoom -= UNIT_DEFS[intent.unit].pop;
        queued.push(intent.unit.replace(/_/g, ' '));
        units++;
        if (executes) this.cmdTrain(playerId, b.id, intent.unit);
      } else {
        const def = BUILDING_DEFS[intent.building];
        if (p.age < def.ageReq || (def.requires && !has[def.requires])) continue;
        if (!fits(def.cost)) { noteShortfall(def.cost); continue; }
        if (executes && !commanderBuild(this, playerId, intent.building)) continue;
        charge(def.cost);
        queued.push(intent.building.replace(/_/g, ' '));
        structures++;
      }
    }
    if (shortfall) this.commanderShortfall.set(playerId, { resource: shortfall, tick: this.tick });
    else this.commanderShortfall.delete(playerId);
    if (queued.length === 0) return;
    const reason = facts.underAttack
      ? 'Base under attack; reinforcing the defense.'
      : `${villagers} workers, ${military} combat units, ${Math.max(0, facts.popRoom)} free population.`;
    brain.noteProduction(this.tick, queued, units, structures, executes, reason);
  }

  /** Dry run of cmdAdvanceAge's rules, without the cost. */
  private commanderAgeReady(p: GamePlayer): boolean {
    if (p.ageResearch || p.age >= MAX_AGE) return false;
    const have = new Set<BuildingType>();
    for (const b of this.buildings.values()) {
      if (b.owner === p.id && b.progress >= 1 && countsForAgeUp(b.type, p.age)) have.add(b.type);
    }
    const completed: BuildingType[] = [];
    for (const b of this.buildings.values()) if (b.owner === p.id && b.progress >= 1) completed.push(b.type);
    return have.size >= buildingsToAdvance(p.age) && layerGateMet(p.age, completed);
  }

  private commanderCanAdvance(p: GamePlayer): boolean {
    return this.commanderAgeReady(p) && this.canAfford(p, AGE_COSTS[p.age + 1] ?? {});
  }

  /** Dry run of cmdTrain's rules so commander production never triggers error toasts. */
  private commanderCanTrain(p: GamePlayer, b: Building, unit: UnitType): boolean {
    if (b.owner !== p.id || b.progress < 1 || !BUILDING_DEFS[b.type].trains.includes(unit)) return false;
    if (b.queue.length >= this.queueSlotsOf(b) || p.age < (UNIT_AGE_REQ[unit] ?? 1)) return false;
    if ((SYMBIOSIS_UNITS.has(unit) || SYMBIOSIS_COMBAT_UNITS.has(unit)) && !this.symbiosis) return false;
    if (SYMBIOSIS_COMBAT_UNITS.has(unit)) {
      if (this.armyCommittedOf(p.id) + UNIT_DEFS[unit].pop > this.armyCapacityOf(p.id)) return false;
      if (p.elonBalance < (ELON_UNIT_COST[unit] ?? 0)) return false;
    }
    return true;
  }

  // ---------------- Match statistics ----------------

  private sampleMatchStats(): void {
    if (!this.stats) return;
    const strength = new Map<number, { power: number; size: number }>();
    for (const p of this.players.values()) {
      const army = this.commanderArmy(p.id);
      strength.set(p.id, { power: this.armyPower(army), size: army.length });
    }
    this.stats.sample(this.tick, strength, this.playerNames());
  }

  private playerNames(): Map<number, string> {
    const names = new Map<number, string>();
    for (const p of this.players.values()) names.set(p.id, p.name);
    return names;
  }

  /** Resource nodes within reach of a player's structures (nearest owner wins). */
  private zonesControlledBy(playerId: number): number {
    let count = 0;
    for (const node of this.nodes.values()) {
      if (node.type === 'tree') continue;
      let owner = -1;
      let bestD = 10;
      for (const b of this.buildings.values()) {
        const d = Math.hypot(b.tileX - node.tileX, b.tileY - node.tileY);
        if (d < bestD) { bestD = d; owner = b.owner; }
      }
      if (owner === playerId) count++;
    }
    return count;
  }

  /** Post-battle report of a finished arena match (archived by the lobby). */
  matchReport(): MatchReport | undefined {
    return this.finalReport;
  }

  private buildMatchReport(winnerId: number): MatchReport | undefined {
    if (!this.stats) return undefined;
    return this.stats.report({
      tick: this.tick,
      winnerId,
      players: [...this.players.values()].map((p) => {
        const brain = this.commanders.get(p.id);
        const winner = winnerId >= 0 ? this.allied(p.id, winnerId) : false;
        return {
          id: p.id, name: p.name, color: p.color, isBot: !!p.difficulty, won: winner,
          zonesControlled: this.zonesControlledBy(p.id),
          ...(brain && !p.difficulty ? {
            commander: { persona: brain.currentPersona, autonomy: brain.currentAutonomy, record: brain.stats(), decisions: brain.history() },
          } : {}),
        };
      }),
    });
  }

  private cmdMove(playerId: number, unitIds: number[], x: number, y: number, queue = false): void {
    const all = this.ownedUnits(playerId, unitIds);
    // Pastoreio (Fase 2): ovelhas PRÓPRIAS entre os ids também recebem a ordem.
    const herd = unitIds
      .map((id) => this.sheep.get(id))
      .filter((s): s is Sheep => !!s && s.owner === playerId);
    if (all.length === 0 && herd.length === 0) return;
    // Espalha destinos POR DOMÍNIO: barcos ganham tiles de água, o resto de terra
    // (senão uma seleção mista mandaria barco pra grama e soldado pro rio).
    const land = all.filter((u) => !isNavalUnit(u.type) && !isFlyingUnit(u.type));
    const naval = all.filter((u) => isNavalUnit(u.type));
    const air = all.filter((u) => isFlyingUnit(u.type));
    const airSpots = air.length > 0 ? collectSpreadTiles(this.airGrid, Math.round(x), Math.round(y), air.length) : [];
    const landSpots = land.length + herd.length > 0
      ? collectSpreadTiles(this.grid, Math.round(x), Math.round(y), land.length + herd.length)
      : [];
    const navalSpots = naval.length > 0
      ? collectSpreadTiles(this.navalGrid, Math.round(x), Math.round(y), naval.length)
      : [];
    const dispatch = (u: Unit, target: { x: number; y: number } | undefined): void => {
      const t = target ?? { x: Math.round(x), y: Math.round(y) };
      const wx = t.x + 0.5;
      const wy = t.y + 0.5;
      // Shift (queue) e já se movendo: ENFILEIRA o waypoint (segue depois de chegar).
      if (queue && (u.state === 'moving' || (u.moveQueue?.length ?? 0) > 0)) {
        (u.moveQueue ??= []).push({ x: wx, y: wy });
      } else {
        this.clearTasks(u); // zera tarefas E a fila de waypoints
        this.pathUnitTo(u, wx, wy);
        u.state = u.path.length > 0 ? 'moving' : 'idle';
      }
    };
    land.forEach((u, i) => dispatch(u, landSpots[i] ?? landSpots[landSpots.length - 1]));
    naval.forEach((u, i) => dispatch(u, navalSpots[i] ?? navalSpots[navalSpots.length - 1]));
    air.forEach((u, i) => dispatch(u, airSpots[i] ?? airSpots[airSpots.length - 1]));
    herd.forEach((s, i) => {
      const target = landSpots[land.length + i] ?? landSpots[landSpots.length - 1] ?? { x: Math.round(x), y: Math.round(y) };
      this.pathSheepTo(s, target.x + 0.5, target.y + 0.5);
    });
  }

  /** Traça o caminho de uma ovelha pastoreada até (tx,ty) do mundo. */
  private pathSheepTo(s: Sheep, tx: number, ty: number): void {
    if (s.food < SHEEP_FOOD) return; // carcaça não anda
    const gx = Math.round(tx - 0.5);
    const gy = Math.round(ty - 0.5);
    let goalX = gx;
    let goalY = gy;
    if (!isWalkable(this.grid, gx, gy)) {
      const near = nearestWalkableTile(this.grid, gx, gy);
      if (!near) {
        s.path = [];
        return;
      }
      goalX = near.x;
      goalY = near.y;
    }
    const path = findPath(this.grid, Math.floor(s.x), Math.floor(s.y), new Set([idx(goalX, goalY, this.grid.size)]));
    s.path = path ?? [];
    s.pathTargetX = goalX + 0.5;
    s.pathTargetY = goalY + 0.5;
  }

  private cmdStop(playerId: number, unitIds: number[]): void {
    for (const u of this.ownedUnits(playerId, unitIds)) {
      this.clearTasks(u);
      u.state = 'idle';
    }
  }

  /** Apaga as PRÓPRIAS unidades/prédios selecionados (tecla Delete). Sem reembolso,
   *  igual ao Age of Empires — só remove e libera o espaço. Apagar o último Centro
   *  da Cidade conta como derrota. */
  private cmdDelete(playerId: number, ids: number[]): void {
    for (const id of ids) {
      const u = this.units.get(id);
      if (u && u.owner === playerId) {
        this.units.delete(id);
        this.retargetAttackersOf(id);
        continue;
      }
      const b = this.buildings.get(id);
      if (b && b.owner === playerId) {
        if (this.homeMode && b.type === 'town_center') continue;
        this.ejectGarrison(b); // libera quem estava dentro (não perde as unidades)
        this.unblockFootprint(b.tileX, b.tileY, BUILDING_DEFS[b.type].size);
        this.buildings.delete(id);
        this.retargetAttackersOf(id);
        if (b.type === 'town_center') this.checkTownCenterLoss(playerId);
      }
    }
  }

  /** Reparar um prédio PRÓPRIO pronto e danificado com aldeões: reusa o fluxo de
   *  construção — o updateBuilding detecta prédio pronto+ferido e recupera a vida. */
  private cmdRepair(playerId: number, unitIds: number[], targetId: number): void {
    const b = this.buildings.get(targetId);
    if (!b || b.owner !== playerId || b.progress < 1) return;
    if (b.hp >= BUILDING_DEFS[b.type].hp) return; // já com vida cheia
    for (const u of this.ownedUnits(playerId, unitIds)) {
      if (isBuilderUnit(u.type)) this.assignBuilder(u, b);
    }
  }

  /** Guarnecer: mandar unidades ENTRAREM numa torre/Centro próprio (some do mapa,
   *  protegidas; o prédio atira +1 flecha por unidade dentro). */
  private cmdGarrison(playerId: number, unitIds: number[], targetId: number): void {
    const b = this.buildings.get(targetId);
    if (b) {
      if (b.owner !== playerId || b.progress < 1 || !GARRISON_CAP[b.type]) return;
      for (const u of this.ownedUnits(playerId, unitIds)) {
        if (isNavalUnit(u.type)) continue; // barco não entra em prédio
        this.clearTasks(u);
        u.garrisonTargetId = targetId;
        if (this.pathUnitAdjacentTo(u, b.tileX, b.tileY, BUILDING_DEFS[b.type].size)) {
          u.state = 'movingToGarrison';
        } else {
          this.enterGarrison(u, b); // já colado no prédio → entra na hora
        }
      }
      return;
    }
    // EMBARCAR: alvo é um barco de TRANSPORTE próprio — a tropa anda até o tile
    // de terra mais próximo do barco (pathUnitTo clampa pro caminhável) e sobe
    // quando chega perto (updateMovingToGarrison re-mira se o barco se mexer).
    const t = this.units.get(targetId);
    if (!t || t.owner !== playerId || t.type !== 'transport') return;
    for (const u of this.ownedUnits(playerId, unitIds)) {
      if (isNavalUnit(u.type)) continue; // só unidade terrestre embarca
      this.clearTasks(u);
      u.garrisonTargetId = targetId;
      this.pathUnitTo(u, t.x, t.y);
      u.state = 'movingToGarrison';
      u.repathTimer = 1.2;
    }
  }

  /** Unidade terrestre sobe no barco de transporte (some do mapa, vira cargo). */
  private enterTransport(u: Unit, t: Unit): void {
    u.garrisonTargetId = undefined;
    if ((t.cargo?.length ?? 0) >= TRANSPORT_CAP) {
      u.state = 'idle'; // barco cheio: fica na margem
      return;
    }
    this.units.delete(u.id);
    this.retargetAttackersOf(u.id);
    this.clearTasks(u);
    u.state = 'idle';
    (t.cargo ??= []).push(u);
  }

  /** Unidade entra no prédio (removida do mapa, guardada em b.garrison). Respeita
   *  a capacidade — excedente fica de fora, ocioso. */
  private enterGarrison(u: Unit, b: Building): void {
    const cap = GARRISON_CAP[b.type] ?? 0;
    u.garrisonTargetId = undefined;
    if ((b.garrison?.length ?? 0) >= cap) {
      u.state = 'idle';
      return;
    }
    this.units.delete(u.id);
    this.retargetAttackersOf(u.id); // quem mirava nela desiste
    (b.garrison ??= []).push(u);
  }

  /** Ejetar: devolve as unidades guarnecidas ao mapa (prédio) ou DESEMBARCA o
   *  transporte na costa (o id serve pros dois — o contador de ids é único). */
  private cmdUnload(playerId: number, buildingId: number): void {
    const b = this.buildings.get(buildingId);
    if (b) {
      if (b.owner !== playerId) return;
      this.ejectGarrison(b);
      return;
    }
    const t = this.units.get(buildingId);
    if (!t || t.owner !== playerId || t.type !== 'transport') return;
    this.unloadTransport(t, playerId);
  }

  /** Desembarque: despeja a tropa nos tiles de TERRA mais próximos do barco.
   *  Precisa estar encostado na costa (senão avisa e não faz nada). */
  private unloadTransport(t: Unit, playerId: number): void {
    const cargo = t.cargo;
    if (!cargo || cargo.length === 0) return;
    // BFS do tile do barco coletando os tiles TERRESTRES caminháveis mais
    // próximos; limita ao raio ~3 (encostado na margem) pra não teleportar longe.
    const spots = collectSpreadTiles(this.grid, Math.floor(t.x), Math.floor(t.y), cargo.length)
      .filter((p) => Math.hypot(p.x + 0.5 - t.x, p.y + 0.5 - t.y) <= 3.2);
    if (spots.length === 0) {
      this.errorTo(playerId, 'err.unload_no_shore');
      return;
    }
    cargo.splice(0).forEach((u, i) => {
      const p = spots[i % spots.length];
      u.x = p.x + 0.5;
      u.y = p.y + 0.5;
      this.clearTasks(u);
      u.state = 'idle';
      this.units.set(u.id, u);
    });
  }

  private ejectGarrison(b: Building): void {
    const g = b.garrison;
    if (!g || g.length === 0) return;
    const size = BUILDING_DEFS[b.type].size;
    const cx = Math.round(b.tileX + size / 2);
    const cy = Math.round(b.tileY + size / 2);
    const spots = collectSpreadTiles(this.grid, cx, cy, g.length);
    g.forEach((u, i) => {
      const t = spots[i] ?? spots[spots.length - 1] ?? { x: cx, y: cy };
      u.x = t.x + 0.5;
      u.y = t.y + 0.5;
      this.clearTasks(u);
      u.state = 'idle';
      this.units.set(u.id, u);
    });
    b.garrison = [];
  }

  private updateMovingToGarrison(u: Unit, dt: number): void {
    // --- EMBARQUE em transporte: o alvo é um BARCO (pode estar se mexendo) ---
    const t = this.units.get(u.garrisonTargetId ?? -1);
    if (t && t.type === 'transport') {
      if (!this.allied(t.owner, u.owner)) {
        u.garrisonTargetId = undefined;
        u.state = 'idle';
        return;
      }
      if (Math.hypot(t.x - u.x, t.y - u.y) <= 1.9) {
        this.enterTransport(u, t); // chegou na beira: sobe
        return;
      }
      this.advanceAlongPath(u, dt);
      u.repathTimer -= dt;
      if (u.repathTimer <= 0) {
        u.repathTimer = 1.2; // barco anda: re-mira o tile de terra mais próximo dele
        this.pathUnitTo(u, t.x, t.y);
        if (u.path.length === 0 && Math.hypot(t.x - u.x, t.y - u.y) > 1.9) {
          u.state = 'idle'; // não alcança daqui (barco longe da margem)
          u.garrisonTargetId = undefined;
        }
      }
      return;
    }
    this.advanceAlongPath(u, dt);
    if (u.path.length > 0) return;
    const b = this.buildings.get(u.garrisonTargetId ?? -1);
    if (!b || b.progress < 1 || !GARRISON_CAP[b.type]) {
      u.garrisonTargetId = undefined;
      u.state = 'idle';
      return;
    }
    const size = BUILDING_DEFS[b.type].size;
    const nx = Math.max(b.tileX, Math.min(u.x, b.tileX + size - 1));
    const ny = Math.max(b.tileY, Math.min(u.y, b.tileY + size - 1));
    const d = Math.hypot(nx + 0.5 - u.x, ny + 0.5 - u.y);
    if (d <= 1.6) {
      this.enterGarrison(u, b);
    } else if (!this.pathUnitAdjacentTo(u, b.tileX, b.tileY, size)) {
      u.state = 'idle';
      u.garrisonTargetId = undefined;
    }
  }

  private clearTasks(u: Unit): void {
    u.path = [];
    u.moveQueue = [];
    u.gatherTargetId = undefined;
    u.gatherResource = undefined;
    u.dropOffId = undefined;
    u.buildTargetId = undefined;
    u.buildQueue = [];
    u.attackTargetId = undefined;
    u.garrisonTargetId = undefined;
  }

  private pathUnitTo(u: Unit, tx: number, ty: number): void {
    const grid = this.gridFor(u); // barco navega na grade naval
    const gx = Math.round(tx - 0.5);
    const gy = Math.round(ty - 0.5);
    let goalX = gx;
    let goalY = gy;
    if (!isWalkable(grid, gx, gy)) {
      const near = nearestWalkableTile(grid, gx, gy);
      if (!near) {
        u.path = [];
        return;
      }
      goalX = near.x;
      goalY = near.y;
    }
    const startX = Math.floor(u.x);
    const startY = Math.floor(u.y);
    const goals = new Set<number>([idx(goalX, goalY, grid.size)]);
    const path = findPath(grid, startX, startY, goals);
    u.path = path ?? [];
    u.pathTargetX = goalX + 0.5;
    u.pathTargetY = goalY + 0.5;
  }

  /** Como pathUnitAdjacentTo, mas EVITA tiles do anel já ocupados/reservados
   *  por outros coletores do mesmo alvo — espalha os aldeões em volta da
   *  árvore/mina/fazenda em vez de empilhar todos no mesmo tile (AoE2). */
  private pathUnitAdjacentToSpread(u: Unit, bx: number, by: number, size: number, targetId: number): boolean {
    const grid = this.gridFor(u); // barco pesqueiro cerca o peixe pela ÁGUA
    const ring = ringTiles(bx - 1, by - 1, bx + size, by + size).filter((p) =>
      isWalkable(grid, p.x, p.y),
    );
    if (ring.length === 0) return false;
    // tiles "reservados": onde cada outro coletor deste alvo está (ou vai parar)
    const taken = new Set<number>();
    for (const o of this.units.values()) {
      if (o.id === u.id || o.owner !== u.owner || o.gatherTargetId !== targetId) continue;
      const gx = o.path.length > 0 ? Math.round((o.pathTargetX ?? o.x) - 0.5) : Math.floor(o.x);
      const gy = o.path.length > 0 ? Math.round((o.pathTargetY ?? o.y) - 0.5) : Math.floor(o.y);
      taken.add(idx(gx, gy, grid.size));
    }
    const free = ring.filter((p) => !taken.has(idx(p.x, p.y, grid.size)));
    const goalsArr = free.length > 0 ? free : ring;
    const startX = Math.floor(u.x);
    const startY = Math.floor(u.y);
    const goals = new Set<number>(goalsArr.map((p) => idx(p.x, p.y, grid.size)));
    const path = findPath(grid, startX, startY, goals);
    if (!path) {
      // já pode estar num tile do anel (livre ou não — não expulsa quem chegou)
      const cur = idx(startX, startY, this.grid.size);
      if (ring.some((p) => idx(p.x, p.y, this.grid.size) === cur)) {
        u.path = [];
        return true;
      }
      return false;
    }
    u.path = path;
    const last = path.length > 0 ? path[path.length - 1] : { x: startX, y: startY };
    u.pathTargetX = last.x + 0.5;
    u.pathTargetY = last.y + 0.5;
    return true;
  }

  /** Caminha até um tile caminhável adjacente ao footprint (bx,by,size). */
  private pathUnitAdjacentTo(u: Unit, bx: number, by: number, size: number): boolean {
    const grid = this.gridFor(u); // barcos encostam no Porto pela água
    const ring = ringTiles(bx - 1, by - 1, bx + size, by + size).filter((p) =>
      isWalkable(grid, p.x, p.y),
    );
    if (ring.length === 0) return false;
    const startX = Math.floor(u.x);
    const startY = Math.floor(u.y);
    const goals = new Set<number>(ring.map((p) => idx(p.x, p.y, grid.size)));
    const path = findPath(grid, startX, startY, goals);
    if (!path) {
      // já pode estar em um tile do anel
      const cur = idx(startX, startY, this.grid.size);
      if (goals.has(cur)) {
        u.path = [];
        return true;
      }
      return false;
    }
    u.path = path;
    const last = path.length > 0 ? path[path.length - 1] : { x: startX, y: startY };
    u.pathTargetX = last.x + 0.5;
    u.pathTargetY = last.y + 0.5;
    return true;
  }

  // ---------------- Coleta ----------------

  private cmdGather(playerId: number, unitIds: number[], targetId: number): void {
    const units = this.ownedUnits(playerId, unitIds).filter(
      (u) => u.type === 'villager' || u.type === 'fishing_boat',
    );
    if (units.length === 0) return;
    const node = this.nodes.get(targetId);
    const farm = this.buildings.get(targetId);
    const sheep = this.sheep.get(targetId);
    if (node) {
      // PEIXE é só de barco pesqueiro; o resto é só de aldeão.
      const gatherers = units.filter((u) => (node.type === 'fish') === (u.type === 'fishing_boat'));
      for (const u of gatherers) this.startGatherNode(u, node);
    } else if (farm && farm.type === 'farm' && farm.owner === playerId && farm.progress >= 1) {
      for (const u of units) if (u.type === 'villager') this.startGatherFarm(u, farm);
    } else if (sheep && (sheep.owner === playerId || sheep.owner === SHEEP_WILD_OWNER)) {
      for (const u of units) if (u.type === 'villager') this.startGatherSheep(u, sheep);
    } else {
      this.errorTo(playerId, 'err.bad_gather_target');
    }
  }

  private startGatherNode(u: Unit, node: ResNode): void {
    const resource = NODE_DEFS[node.type].resource;
    if (u.gatherResource !== resource) u.carryAmount = 0;
    this.clearTasks(u);
    u.gatherTargetId = node.id;
    u.gatherResource = resource;
    if (this.pathUnitAdjacentToSpread(u, node.tileX, node.tileY, 1, node.id)) {
      u.state = 'movingToGather';
    } else {
      u.state = 'idle';
    }
  }

  private startGatherFarm(u: Unit, farm: Building): void {
    const resource: ResourceType = 'energy';
    if (u.gatherResource !== resource) u.carryAmount = 0;
    this.clearTasks(u);
    u.gatherTargetId = farm.id;
    u.gatherResource = resource;
    if (this.pathUnitAdjacentToSpread(u, farm.tileX, farm.tileY, BUILDING_DEFS.farm.size, farm.id)) {
      u.state = 'movingToGather';
    } else {
      u.state = 'idle';
    }
  }

  /** Manda o aldeão abater/comer uma ovelha. Ela é passável (sem footprint):
   *  caminha até o tile dela. Abater = fixa o dono da ovelha no comedor. */
  private startGatherSheep(u: Unit, sheep: Sheep): void {
    const resource: ResourceType = 'energy';
    if (u.gatherResource !== resource) u.carryAmount = 0;
    this.clearTasks(u);
    u.gatherTargetId = sheep.id;
    u.gatherResource = resource;
    sheep.owner = u.owner; // sob abate, a ovelha vira sua na hora
    this.pathUnitTo(u, sheep.x, sheep.y);
    u.state = 'movingToGather';
  }

  private findNearestDropOff(playerId: number, x: number, y: number, resource?: ResourceType, naval = false): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.buildings.values()) {
      const def = BUILDING_DEFS[b.type];
      if (b.owner !== playerId || b.progress < 1 || !def.isDropOff) continue;
      // domínio: barco entrega SÓ no Porto (pela água); aldeão não usa o Porto
      if (naval !== (b.type === 'dock')) continue;
      // depósito especializado: só aceita seu(s) recurso(s). accepts ausente = aceita tudo (Centro da Cidade).
      if (resource !== undefined && def.accepts && !def.accepts.includes(resource)) continue;
      const cx = b.tileX + def.size / 2;
      const cy = b.tileY + def.size / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private findNearestNodeOfResource(resource: ResourceType, x: number, y: number, maxDist: number, naval = false): ResNode | null {
    let best: ResNode | null = null;
    let bestD = Infinity;
    for (const n of this.nodes.values()) {
      if (NODE_DEFS[n.type].resource !== resource) continue;
      // domínio: barco pesqueiro só emenda em PEIXE; aldeão nunca pesca
      if (naval !== (n.type === 'fish')) continue;
      const d = Math.hypot(n.tileX - x, n.tileY - y);
      if (d <= maxDist && d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  // ---------------- Construção ----------------

  private cmdBuild(playerId: number, unitIds: number[], type: BuildingType, tileX: number, tileY: number, queue = false): void {
    const units = this.ownedUnits(playerId, unitIds).filter((u) => isBuilderUnit(u.type));
    if (units.length === 0) return;
    const p = this.players.get(playerId)!;
    const def = Object.prototype.hasOwnProperty.call(BUILDING_DEFS, type) ? BUILDING_DEFS[type] : undefined;
    if (!def || (def.symbiosis && !this.symbiosis)) {
      this.errorTo(playerId, 'err.bad_building_type');
      return;
    }
    const arsenal: ReadonlySet<BuildingType> = new Set(['drone_factory', 'aerospace_hangar', 'missile_foundry', 'mech_forge', 'exosuit_lab']);
    if (arsenal.has(type) && p.cityPath !== 'command' && !this.homeMode && !this.openWarfare) {
      this.errorTo(playerId, 'err.raid_requires_command');
      return;
    }
    // Home unlocks follow the City Level table (spec §4), not Arena ages.
    const minLevel = this.homeMode ? HOME_BUILDING_CITY_LEVEL[type] ?? def.ageReq : def.ageReq;
    if (p.age < minLevel) {
      this.errorTo(playerId, 'err.requires_age', { age: minLevel });
      return;
    }
    // pré-requisito de prédio (árvore do AoE2): Fazenda/Mercado ← Moinho; etc.
    if (def.requires) {
      let hasReq = false;
      for (const b of this.buildings.values()) {
        if (b.owner === playerId && b.type === def.requires && b.progress >= 1) { hasReq = true; break; }
      }
      if (!hasReq) {
        this.errorTo(playerId, 'err.requires_building', { building: def.requires });
        return;
      }
    }

    // queue=true (Ctrl/Shift): enfileira em quem já está ocupado com obra;
    // quem está livre começa agora. queue=false: substitui a tarefa atual.
    const dispatch = (b: Building): void => {
      for (const u of units) {
        if (queue && (u.buildTargetId !== undefined || (u.buildQueue?.length ?? 0) > 0)) {
          (u.buildQueue ??= []).push(b.id);
        } else {
          this.assignBuilder(u, b);
        }
      }
    };

    // Reaproveita obra existente do mesmo tipo/tile do mesmo jogador.
    const existing = [...this.buildings.values()].find(
      (b) => b.owner === playerId && b.type === type && b.tileX === tileX && b.tileY === tileY && b.progress < 1,
    );
    if (existing) {
      dispatch(existing);
      return;
    }

    // Casa NOVA além do teto de população é desperdício (a moradia não passa de
    // POP_CAP_MAX): recusa. Obras em andamento contam (vão prover ao terminar).
    // O cliente já mostra o botão apagado e o fantasma vermelho; aqui é a
    // validação de verdade. (Os bots nunca caem aqui: a IA checa o teto antes.)
    if (type === 'house') {
      let provided = 0;
      for (const b of this.buildings.values()) {
        if (b.owner === playerId) provided += BUILDING_DEFS[b.type].popProvided;
      }
      if (provided >= POP_CAP_MAX) {
        this.errorTo(playerId, 'err.house_cap', { max: POP_CAP_MAX });
        return;
      }
    }

    const footprintOk = type === 'dock'
      ? this.validDockFootprint(tileX, tileY, def.size) // Porto: na água, encostado na costa
      : this.validFootprint(tileX, tileY, def.size);
    if (!footprintOk) {
      const plan = this.homeUrbanPlan();
      this.errorTo(playerId, plan && footprintOnRoad(plan, tileX, tileY, def.size) ? 'err.on_road' : 'err.bad_build_location');
      return;
    }
    if (!this.canAfford(p, def.cost)) {
      this.errorTo(playerId, 'err.no_resources');
      return;
    }
    this.deduct(p, def.cost);

    const id = this.nextId++;
    const building: Building = {
      id,
      owner: playerId,
      type,
      tileX,
      tileY,
      hp: Math.max(1, Math.round(def.hp * 0.1)),
      progress: 0,
      queue: [],
    };
    this.buildings.set(id, building);
    this.blockFootprint(tileX, tileY, def.size);
    dispatch(building);
  }

  /** Manda o aldeão ir construir ESTE prédio (sem mexer na fila de obras). */
  private startBuildTask(u: Unit, building: Building): void {
    u.buildTargetId = building.id;
    if (this.pathUnitAdjacentTo(u, building.tileX, building.tileY, BUILDING_DEFS[building.type].size)) {
      u.state = 'movingToBuild';
    } else {
      u.state = 'building'; // já está colado no prédio
    }
  }

  /** Nova ordem de obra: zera as tarefas atuais (inclusive a fila) e começa. */
  private assignBuilder(u: Unit, building: Building): void {
    this.clearTasks(u);
    this.startBuildTask(u, building);
  }

  /** Pega a próxima obra válida da fila do aldeão e começa. true se achou. */
  private advanceBuildQueue(u: Unit): boolean {
    while (u.buildQueue && u.buildQueue.length > 0) {
      const nextId = u.buildQueue.shift()!;
      const nb = this.buildings.get(nextId);
      if (nb && nb.progress < 1) {
        this.startBuildTask(u, nb);
        return true;
      }
      // prédio já concluído/removido: pula pro próximo da fila
    }
    return false;
  }

  /** Home urban plan anchored on the player's Civic Hub (null before one exists). */
  private homeUrbanPlan(): ReturnType<typeof urbanPlanForHub> | null {
    if (!this.homeMode) return null;
    const p = this.homePlayer();
    const hub = [...this.buildings.values()].find((b) => b.owner === p?.id && b.type === 'town_center');
    return hub ? urbanPlanForHub(hub.tileX, hub.tileY) : null;
  }

  private validFootprint(tileX: number, tileY: number, size: number): boolean {
    if (tileX < 0 || tileY < 0 || tileX + size > this.grid.size || tileY + size > this.grid.size) return false;
    // Urban planning: roads are never built over at Home (walls included).
    const plan = this.homeUrbanPlan();
    if (plan && footprintOnRoad(plan, tileX, tileY, size)) return false;
    for (let yy = tileY; yy < tileY + size; yy++) {
      for (let xx = tileX; xx < tileX + size; xx++) {
        const i = idx(xx, yy, this.grid.size);
        if (this.grid.tiles[i] !== 0 /* TILE_GRASS */) return false;
        if (this.grid.blocked[i]) return false;
      }
    }
    return true;
  }

  /** Porto: footprint TODO em água FUNDA (sem peixe/porto por baixo — grade
   *  naval livre) e ENCOSTADO na costa (>=1 vizinho de terra/raso, de onde o
   *  aldeão constrói). Não deixa em raso pra não trancar o vau. */
  private validDockFootprint(tileX: number, tileY: number, size: number): boolean {
    const n = this.grid.size;
    if (tileX < 0 || tileY < 0 || tileX + size > n || tileY + size > n) return false;
    for (let yy = tileY; yy < tileY + size; yy++) {
      for (let xx = tileX; xx < tileX + size; xx++) {
        const i = idx(xx, yy, n);
        if (this.grid.tiles[i] !== TILE_WATER) return false;
        if (this.navalGrid.blocked[i]) return false; // peixe ou outro porto
      }
    }
    return ringTiles(tileX - 1, tileY - 1, tileX + size, tileY + size).some(
      (p) => isWithinGrid(this.grid, p.x, p.y) && this.grid.tiles[idx(p.x, p.y, n)] !== TILE_WATER,
    );
  }

  private blockFootprint(tileX: number, tileY: number, size: number): void {
    for (let yy = tileY; yy < tileY + size; yy++) {
      for (let xx = tileX; xx < tileX + size; xx++) {
        if (!isWithinGrid(this.grid, xx, yy)) continue;
        const i = idx(xx, yy, this.grid.size);
        this.grid.blocked[i] = 1;
        this.navalGrid.blocked[i] = 1; // barcos também não atravessam prédios
      }
    }
  }

  private unblockFootprint(tileX: number, tileY: number, size: number): void {
    for (let yy = tileY; yy < tileY + size; yy++) {
      for (let xx = tileX; xx < tileX + size; xx++) {
        if (!isWithinGrid(this.grid, xx, yy)) continue;
        const i = idx(xx, yy, this.grid.size);
        // volta ao estado do TERRENO: terra livre p/ terrestres, grama bloqueia naval
        this.grid.blocked[i] = this.grid.tiles[i] === TILE_WATER ? 1 : 0;
        this.navalGrid.blocked[i] = this.grid.tiles[i] === TILE_GRASS ? 1 : 0;
      }
    }
  }

  // ---------------- Treinamento ----------------

  private cmdTrain(playerId: number, buildingId: number, unit: UnitType): void {
    const b = this.buildings.get(buildingId);
    if (!b || b.owner !== playerId || b.progress < 1) return;
    const def = BUILDING_DEFS[b.type];
    const homeArmy = this.homeMode && SYMBIOSIS_COMBAT_UNITS.has(unit);
    if (homeArmy) {
      // Home manufacturing: the factory and its level decide, not Arena trains lists.
      const unlock = HOME_UNIT_UNLOCK[unit];
      if (!unlock || unlock.factory !== b.type) return;
      if ((this.players.get(playerId)?.age ?? 1) < unlock.cityLevel) { this.errorTo(playerId, 'err.requires_age', { age: unlock.cityLevel }); return; }
      if ((b.level ?? 1) < unlock.factoryLevel) { this.errorTo(playerId, 'err.factory_level', { level: unlock.factoryLevel }); return; }
    } else if (!def.trains.includes(unit)) return;
    if ((SYMBIOSIS_UNITS.has(unit) || SYMBIOSIS_COMBAT_UNITS.has(unit)) && !this.symbiosis) return;
    if (b.queue.length >= this.queueSlotsOf(b)) {
      this.errorTo(playerId, 'err.queue_full');
      return;
    }
    const p = this.players.get(playerId)!;
    const req = homeArmy ? 1 : UNIT_AGE_REQ[unit] ?? 1;
    if (p.age < req) {
      this.errorTo(playerId, 'err.requires_age', { age: req });
      return;
    }
    let paid: Partial<Resources> | undefined;
    if (SYMBIOSIS_COMBAT_UNITS.has(unit) && !this.homeMode) {
      const elonCost = ELON_UNIT_COST[unit] ?? 0;
      if (this.armyCommittedOf(playerId) + UNIT_DEFS[unit].pop > this.armyCapacityOf(playerId)) { this.errorTo(playerId, 'err.army_full'); return; }
      if (p.elonBalance < elonCost) { this.errorTo(playerId, 'err.no_elon'); return; }
      p.elonBalance -= elonCost;
      this.ledger?.record(this.tick, 'obligation', playerId, `manufacture:${unit}`, -elonCost);
    } else {
      const cost = UNIT_DEFS[unit].cost;
      if (!this.canAfford(p, cost)) { this.errorTo(playerId, 'err.no_resources'); return; }
      this.deduct(p, cost);
      // Home: record the exact payment so a cancel refunds what was really paid.
      if (this.homeMode) paid = { ...cost };
    }
    b.queue.push(paid ? { unit, progress: 0, paid } : { unit, progress: 0 });
  }

  private cmdCancelTrain(playerId: number, buildingId: number, index: number): void {
    const b = this.buildings.get(buildingId);
    if (!b || b.owner !== playerId) return;
    if (index < 0 || index >= b.queue.length) return;
    if (this.homeMode) {
      this.cancelHomeJob(playerId, b, index);
      return;
    }
    const item = b.queue.splice(index, 1)[0];
    const p = this.players.get(playerId);
    if (p) {
      if (SYMBIOSIS_COMBAT_UNITS.has(item.unit)) p.elonBalance = Math.min(this.elonCapacityOf(playerId), p.elonBalance + (ELON_UNIT_COST[item.unit] ?? 0));
      else this.refund(p, UNIT_DEFS[item.unit].cost);
    }
  }

  private cmdSetRally(playerId: number, buildingId: number, x: number, y: number): void {
    const b = this.buildings.get(buildingId);
    if (!b || b.owner !== playerId) return;
    b.rallyX = x;
    b.rallyY = y;
  }

  private updateBuildingTraining(b: Building, dt: number): void {
    if (b.progress < 1 || b.queue.length === 0) return;
    const head = b.queue[0];
    if (this.homeMode && SYMBIOSIS_COMBAT_UNITS.has(head.unit)) {
      this.updateHomeManufacturing(b, dt);
      return;
    }
    const def = UNIT_DEFS[head.unit];
    if (head.progress < 1) {
      head.progress = Math.min(1, head.progress + dt / this.trainTimeFor(b));
      if (head.progress < 1) return;
    }
    // pronto: verifica pop cap
    const pop = this.popOf(b.owner);
    const cap = this.popCapOf(b.owner);
    if (pop + def.pop > cap) return; // segura na fila até liberar espaço

    // Barco nasce na ÁGUA ao lado do Porto; o resto nasce na grama ao lado.
    const spawnGrid = isNavalUnit(head.unit) ? this.navalGrid : this.grid;
    const spot = this.findFreeSpotNear(b.tileX, b.tileY, BUILDING_DEFS[b.type].size, spawnGrid);
    if (!spot) return; // sem espaço livre ainda; tenta no próximo tick

    b.queue.shift();
    const id = this.nextId++;
    const newUnit = createUnit(id, b.owner, head.unit, spot.x + 0.5, spot.y + 0.5);
    newUnit.hp = this.unitMaxHp(newUnit); // nasce já com o bônus de vida dos upgrades
    this.units.set(id, newUnit);
    this.stats?.trained(b.owner, head.unit, this.tick, this.players.get(b.owner)?.name ?? '');

    if (b.rallyX !== undefined && b.rallyY !== undefined) {
      // tile que CONTÉM o ponto de reunião (floor, não round: round(tile+0.5)
      // arredondava pra cima e errava o nó de recurso -> aldeão parava sem colher)
      const rx = Math.floor(b.rallyX);
      const ry = Math.floor(b.rallyY);
      const nodeAt = [...this.nodes.values()].find((n) => n.tileX === rx && n.tileY === ry);
      const fs = BUILDING_DEFS.farm.size;
      const farmAt = [...this.buildings.values()].find(
        (fb) =>
          fb.type === 'farm' && fb.owner === b.owner && fb.progress >= 1 &&
          rx >= fb.tileX && rx < fb.tileX + fs && ry >= fb.tileY && ry < fb.tileY + fs,
      );
      // ovelha não tem footprint (é passável) — o tile dela é o floor da posição
      // contínua, igual ao que o cliente manda ao mirar nela (ver input.ts).
      const sheepAt = [...this.sheep.values()].find((s) => Math.floor(s.x) === rx && Math.floor(s.y) === ry);
      if (nodeAt && (nodeAt.type === 'fish' ? newUnit.type === 'fishing_boat' : newUnit.type === 'villager')) {
        // ponto de reunião num recurso: aldeão sai colhendo / pesqueiro sai pescando
        this.startGatherNode(newUnit, nodeAt);
      } else if (farmAt && newUnit.type === 'villager') {
        // ponto de reunião numa fazenda: aldeão novo já sai colhendo (AoE2)
        this.startGatherFarm(newUnit, farmAt);
      } else if (sheepAt && newUnit.type === 'villager' && (sheepAt.owner === b.owner || sheepAt.owner === SHEEP_WILD_OWNER)) {
        // ponto de reunião numa ovelha: aldeão novo já sai abatendo/pastoreando
        this.startGatherSheep(newUnit, sheepAt);
      } else {
        this.pathUnitTo(newUnit, b.rallyX, b.rallyY);
        newUnit.state = newUnit.path.length > 0 ? 'moving' : 'idle';
      }
    }
  }

  private trainTimeFor(b: Building): number {
    // trainTime vem de BUILDING_DEFS via unit? Não — está em UNIT_DEFS? Checamos ambos.
    const head = b.queue[0];
    // Home factory upgrades raise throughput (+15%/level), never combat stats.
    const base = UNIT_TRAIN_TIME[head.unit] / (this.homeMode ? levelScale(b.level, 0.15) : 1);
    if (!SYMBIOSIS_COMBAT_UNITS.has(head.unit)) return base;
    // Human designers are the Laboratory layer: every active designer improves
    // all weapon factories by 8%, capped at 40% so factories still matter.
    let designers = 0;
    for (const u of this.units.values()) if (u.owner === b.owner && u.type === 'designer') designers++;
    return base * (1 - Math.min(0.4, designers * 0.08));
  }

  private findFreeSpotNear(bx: number, by: number, size: number, grid: Grid = this.grid): { x: number; y: number } | null {
    const ring = ringTiles(bx - 1, by - 1, bx + size, by + size);
    for (const p of ring) {
      if (isWalkable(grid, p.x, p.y)) return p;
    }
    return null;
  }

  // ---------------- Combate ----------------

  private cmdAttack(playerId: number, unitIds: number[], targetId: number): void {
    const attacker = this.players.get(playerId);
    if (!this.atWar(attacker)) return;
    const units = this.ownedUnits(playerId, unitIds);
    if (units.length === 0) return;
    const targetUnit = this.units.get(targetId);
    const targetBuilding = this.buildings.get(targetId);
    const targetOwner = targetUnit?.owner ?? targetBuilding?.owner;
    if (targetOwner !== undefined && !this.atWar(this.players.get(targetOwner))) return;
    const isEnemyUnit = targetUnit && !this.allied(targetUnit.owner, playerId);
    const isEnemyBuilding = targetBuilding && !this.allied(targetBuilding.owner, playerId);
    if (!isEnemyUnit && !isEnemyBuilding) return;
    for (const u of units) {
      this.assignAttack(u, targetId);
    }
  }

  private assignAttack(u: Unit, targetId: number): void {
    this.clearTasks(u);
    u.attackTargetId = targetId;
    u.state = 'movingToAttack';
    u.repathTimer = 0;
  }

  private targetPos(id: number): { x: number; y: number } | null {
    const u = this.units.get(id);
    if (u) return { x: u.x, y: u.y };
    const b = this.buildings.get(id);
    if (b) {
      const size = BUILDING_DEFS[b.type].size;
      return { x: b.tileX + size / 2, y: b.tileY + size / 2 };
    }
    return null;
  }

  /** Distância da unidade até o alvo. Pra PRÉDIO é a distância até a BORDA do
   *  footprint (retângulo `[tileX..tileX+size] x [tileY..tileY+size]`), porque o
   *  prédio é sólido: a unidade só consegue encostar POR FORA.
   *
   *  Estava errado: clampava `u.x/u.y` (float) no intervalo dos ÍNDICES de tile e
   *  depois somava 0.5 como se o resultado fosse índice — apontava pro tile errado
   *  e inflava a distância (~1.4 onde a parede está a 0.8). Como o espadachim tem
   *  alcance 1, ele NUNCA alcançava: ficava "indo atacar" eternamente sem bater no
   *  prédio inimigo. */
  private distToTarget(u: Unit, targetId: number): number {
    const tu = this.units.get(targetId);
    if (tu) return Math.hypot(tu.x - u.x, tu.y - u.y);
    const b = this.buildings.get(targetId);
    if (b) {
      const size = BUILDING_DEFS[b.type].size;
      const nx = Math.max(b.tileX, Math.min(u.x, b.tileX + size));
      const ny = Math.max(b.tileY, Math.min(u.y, b.tileY + size));
      return Math.hypot(nx - u.x, ny - u.y);
    }
    return Infinity;
  }

  /** Ataque efetivo da unidade (base + upgrades do dono). */
  private unitAttack(u: Unit): number {
    const p = this.players.get(u.owner);
    return UNIT_DEFS[u.type].attack + (p ? techBonus(p.techs, u.type).attack : 0);
  }

  /** Blindagem efetiva (redução de dano) da unidade. */
  private unitArmor(u: Unit): number {
    const p = this.players.get(u.owner);
    return p ? techBonus(p.techs, u.type).armor : 0;
  }

  /** Vida máxima efetiva (base + upgrades do dono). */
  private unitMaxHp(u: Unit): number {
    const p = this.players.get(u.owner);
    const base = UNIT_DEFS[u.type].hp + (p ? techBonus(p.techs, u.type).hp : 0);
    // Raid research: Siege Mech and Plasma Tank research add hit points.
    if (this.isRaidAttacker(u) && (u.type === 'siege_mech' || u.type === 'plasma_tank')) return Math.round(base * (1 + this.raidGain(u.type)));
    return base;
  }

  /** Alcance efetivo (base + upgrades do dono). */
  private unitRange(u: Unit): number {
    const p = this.players.get(u.owner);
    const base = UNIT_DEFS[u.type].range + (p ? techBonus(p.techs, u.type).range : 0);
    return u.type === 'rocket_launcher' && this.isRaidAttacker(u) ? base * (1 + this.raidGain('rocket_launcher')) : base;
  }

  private dealDamage(u: Unit, targetId: number): void {
    let atk = this.unitAttack(u);
    if (this.isRaidAttacker(u)) atk = this.raidAttackFor(u, atk, this.buildings.get(targetId));
    const tu = this.units.get(targetId);
    if (tu) {
      tu.hp -= Math.max(1, atk - this.unitArmor(tu)); // dano mínimo 1
      this.noteBaseHit(tu);
      if (tu.hp <= 0) {
        this.stats?.unitLost(tu.owner, tu.type, u.owner, this.tick, this.playerNames());
        this.units.delete(targetId);
        this.retargetAttackersOf(targetId);
      }
      return;
    }
    const b = this.buildings.get(targetId);
    if (b) {
      this.damageBuilding(b, atk, u.owner);
      if (this.isRaidAttacker(u)) this.raidAfterHit(u, b, atk);
    }
  }

  /** A worker hit anywhere, or any unit hit inside its own base, counts as an
   *  attack on the economy (bots' ally rescue and commander defense read it). */
  private noteBaseHit(u: Unit): void {
    if (this.homeMode || this.raidMode) return;
    if (u.type !== 'villager') {
      const core = this.coreOf(u.owner);
      if (!core) return;
      const c = this.centerOf(core);
      if (Math.hypot(u.x - c.x, u.y - c.y) > BASE_RADIUS) return;
    }
    this.recentAttacks.set(u.owner, { x: u.x, y: u.y, tick: this.tick });
  }

  private damageBuilding(b: Building, amount: number, attacker?: number): void {
    if (!this.buildings.has(b.id)) return;
    b.hp -= amount; // prédios não têm blindagem de upgrade
    if (b.type === 'town_center' && this.stats) this.stats.coreDamaged(b.owner, b.hp / BUILDING_DEFS.town_center.hp, this.tick, this.players.get(b.owner)?.name ?? '');
    // registra "base do fulano apanhando" — bots ALIADOS protetores leem isto
    const bs = BUILDING_DEFS[b.type].size;
    this.recentAttacks.set(b.owner, { x: b.tileX + bs / 2, y: b.tileY + bs / 2, tick: this.tick });
    if (b.hp <= 0) {
      this.stats?.structureLost(b.owner, b.type, attacker, this.tick, this.playerNames());
      this.unblockFootprint(b.tileX, b.tileY, bs);
      this.buildings.delete(b.id);
      this.retargetAttackersOf(b.id);
      this.checkTownCenterLoss(b.owner);
    }
  }

  private retargetAttackersOf(deadId: number): void {
    for (const u of this.units.values()) {
      if (u.attackTargetId === deadId) {
        this.clearTasks(u);
        u.state = 'idle';
      }
    }
  }

  // ---------------- Update de unidade por tick ----------------

  private updateUnit(u: Unit, dt: number): void {
    switch (u.state) {
      case 'idle':
        this.updateAutoAggro(u, dt);
        break;
      case 'moving':
        this.advanceAlongPath(u, dt);
        if (u.path.length === 0) {
          // chegou: se há waypoints enfileirados (Shift+clique), segue pro próximo
          const next = u.moveQueue?.shift();
          if (next) {
            this.pathUnitTo(u, next.x, next.y);
            if (u.path.length === 0) u.state = 'idle'; // waypoint inalcançável
          } else {
            u.state = 'idle';
          }
        }
        break;
      case 'movingToGather':
        this.updateMovingToGather(u, dt);
        break;
      case 'gathering':
        this.updateGathering(u, dt);
        break;
      case 'returning':
        this.updateReturning(u, dt);
        break;
      case 'movingToBuild':
        this.updateMovingToBuild(u, dt);
        break;
      case 'building':
        this.updateBuilding(u, dt);
        break;
      case 'movingToGarrison':
        this.updateMovingToGarrison(u, dt);
        break;
      case 'movingToAttack':
        this.updateMovingToAttack(u, dt);
        break;
      case 'attacking':
        this.updateAttacking(u, dt);
        break;
    }
    u.aggroTimer -= dt;
  }

  /** Afasta suavemente unidades PARADAS que ficaram umas em cima das outras
   *  (recém-treinadas no ponto de reunião, exército parado etc.) — dá o
   *  espaçamento de "formação" do AoE2 sem interferir em quem está andando
   *  ou trabalhando. */
  private separateIdleUnits(dt: number): void {
    // Terrestres: só as PARADAS se afastam. BARCOS: sempre (parados OU navegando)
    // — barco colado em barco "vira papel" e não dá pra ver quantos são; o
    // empurra-afasta contínuo mantém a sensação espacial (raio BOAT_SEPARATION).
    const idle: Unit[] = [];
    for (const u of this.units.values()) {
      if (isNavalUnit(u.type) || (u.state === 'idle' && u.path.length === 0)) idle.push(u);
    }
    if (idle.length < 2) return;
    const MIN_D = 0.6;   // distância mínima entre centros (tiles)
    const PUSH = 1.4;    // velocidade máxima de afastamento (tiles/s)
    for (let i = 0; i < idle.length; i++) {
      const a = idle[i];
      for (let j = i + 1; j < idle.length; j++) {
        const b = idle[j];
        const minD = isNavalUnit(a.type) && isNavalUnit(b.type) ? BOAT_SEPARATION : MIN_D;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= minD) continue;
        if (d < 1e-4) {
          // exatamente empilhadas: separa num ângulo determinístico pelos ids
          const ang = ((a.id * 37 + b.id * 61) % 360) * (Math.PI / 180);
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d = 1;
        }
        const step = Math.min((minD - d) / 2, PUSH * dt);
        const ux = (dx / d) * step;
        const uy = (dy / d) * step;
        this.nudge(a, -ux, -uy);
        this.nudge(b, ux, uy);
      }
    }
  }

  /** Solta unidades presas EM CIMA de um tile bloqueado (ex.: um prédio foi
   *  colocado por cima delas): teleporta pro tile caminhável mais próximo. Uma
   *  unidade PARADA (sem caminho) num tile bloqueado só existe se está presa —
   *  os waypoints de um caminho são sempre caminháveis — então é seguro. Cura
   *  o bug de "5 aldeões travados na fazenda que não movem nem colhem". */
  private freeTrappedUnits(): void {
    for (const u of this.units.values()) {
      if (u.path.length > 0) continue;
      const grid = this.gridFor(u); // barco preso (ex.: Porto colocado em cima) volta pra água
      const tx = Math.floor(u.x);
      const ty = Math.floor(u.y);
      if (isWalkable(grid, tx, ty)) continue;
      const spot = nearestWalkableTile(grid, tx, ty);
      if (!spot) continue;
      u.x = spot.x + 0.5;
      u.y = spot.y + 0.5;
      this.clearTasks(u);
      u.state = 'idle';
    }
  }

  /** Ovelhas: pastoreio (Fase 2) + conversão por proximidade ("roubo", estilo
   *  AoE) 2x/s + apodrecimento da carcaça. Some sozinho no late-game (ovelhas
   *  comidas somem) — early-out quando não há nenhuma. */
  private updateSheep(dt: number): void {
    if (this.sheep.size === 0) return;

    // Quem está cuidando de qual ovelha AGORA (comendo ou a caminho dela):
    // trava o dono e PAUSA o apodrecimento (só carcaça largada apodrece).
    const eating = new Map<number, number>(); // sheepId -> owner
    for (const u of this.units.values()) {
      if (u.type !== 'villager' || u.gatherTargetId === undefined) continue;
      if (u.state !== 'gathering' && u.state !== 'movingToGather' && u.state !== 'returning') continue;
      if (this.sheep.has(u.gatherTargetId)) eating.set(u.gatherTargetId, u.owner);
    }

    for (const s of this.sheep.values()) {
      // Fase 2: avança quem foi mandada pastorear (carcaça não anda).
      if (s.path.length > 0 && s.food >= SHEEP_FOOD) this.advanceSheep(s, dt);
      // Carcaça (já mordida) sem ninguém cuidando: apodrece até virar pó (AoE).
      if (s.food < SHEEP_FOOD && !eating.has(s.id)) {
        s.food -= SHEEP_DECAY_PER_S * dt;
        if (s.food <= 0) this.sheep.delete(s.id);
      } else if (s.food < SHEEP_FOOD_MAX && s.path.length === 0 && !eating.has(s.id)) {
        // Ovelha saudável e PARADA (ninguém comendo) engorda devagar até o teto.
        s.food = Math.min(SHEEP_FOOD_MAX, s.food + SHEEP_FATTEN_PER_S * dt);
      }
    }

    if (this.tick % SHEEP_CONVERT_EVERY_TICKS !== 0) return;

    const R = SHEEP_CONVERT_RANGE;
    for (const s of this.sheep.values()) {
      // Carcaça tem dono congelado (quem abateu); não é roubável.
      if (s.food < SHEEP_FOOD) continue;
      const pinned = eating.get(s.id);
      if (pinned !== undefined) {
        s.owner = pinned;
        continue;
      }
      // dono = jogador com a UNIDADE mais próxima dentro do raio (broad-phase por eixo)
      let bestOwner = SHEEP_WILD_OWNER;
      let bestId = Infinity;
      let bestD2 = R * R;
      for (const u of this.units.values()) {
        const dx = u.x - s.x;
        if (dx > R || dx < -R) continue;
        const dy = u.y - s.y;
        if (dy > R || dy < -R) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2 || (d2 === bestD2 && u.id < bestId)) {
          bestD2 = d2;
          bestId = u.id;
          bestOwner = u.owner;
        }
      }
      // sem unidade no raio: mantém o dono (fica sua até alguém chegar mais perto).
      // ALIADO não "rouba" a sua ovelha (só inimigo contesta; selvagem é de quem chegar).
      if (bestOwner !== SHEEP_WILD_OWNER && bestOwner !== s.owner
        && !(s.owner !== SHEEP_WILD_OWNER && this.allied(bestOwner, s.owner))) {
        s.owner = bestOwner;
      }
    }
  }

  /** Avança uma ovelha pastoreada pelo seu path (Fase 2). */
  private advanceSheep(s: Sheep, dt: number): void {
    let remaining = SHEEP_SPEED * dt;
    while (remaining > 0 && s.path.length > 0) {
      const wp = s.path[0];
      const dx = wp.x + 0.5 - s.x;
      const dy = wp.y + 0.5 - s.y;
      const d = Math.hypot(dx, dy);
      if (d <= remaining) {
        s.x = wp.x + 0.5;
        s.y = wp.y + 0.5;
        remaining -= d;
        s.path.shift();
      } else {
        s.x += (dx / d) * remaining;
        s.y += (dy / d) * remaining;
        remaining = 0;
      }
    }
  }

  /** Move a unidade se o destino continuar em chão caminhável. */
  private nudge(u: Unit, dx: number, dy: number): void {
    const nx = u.x + dx;
    const ny = u.y + dy;
    if (isWalkable(this.gridFor(u), Math.floor(nx), Math.floor(ny))) {
      u.x = nx;
      u.y = ny;
    }
  }

  private advanceAlongPath(u: Unit, dt: number): void {
    if (u.path.length === 0) return;
    let remaining = UNIT_DEFS[u.type].speed * this.automationFactor(u) * dt;
    while (remaining > 0 && u.path.length > 0) {
      const wp = u.path[0];
      const dx = wp.x + 0.5 - u.x;
      const dy = wp.y + 0.5 - u.y;
      const d = Math.hypot(dx, dy);
      if (d <= remaining) {
        u.x = wp.x + 0.5;
        u.y = wp.y + 0.5;
        remaining -= d;
        u.path.shift();
      } else {
        u.x += (dx / d) * remaining;
        u.y += (dy / d) * remaining;
        remaining = 0;
      }
    }
  }

  private updateAutoAggro(u: Unit, dt: number): void {
    if (u.type === 'villager' || u.type === 'fishing_boat') {
      // Coletor parado segurando carga (drop-off destruído/indisponível quando
      // ficou 'idle' em updateGathering/updateReturning): reusa aggroTimer para
      // tentar reentregar periodicamente em vez de travar ocioso para sempre.
      if (u.carryAmount > 0 && u.aggroTimer <= 0) {
        u.aggroTimer = 1; // ~1x/s, evita varredura de prédios a cada tick
        const drop = this.findNearestDropOff(u.owner, u.x, u.y, u.carryType, isNavalUnit(u.type));
        if (drop) {
          u.dropOffId = drop.id;
          if (this.pathUnitAdjacentTo(u, drop.tileX, drop.tileY, BUILDING_DEFS[drop.type].size)) {
            u.state = 'returning';
          }
        }
      }
      return;
    }
    if (u.type === 'transport' || SYMBIOSIS_UNITS.has(u.type)) return; // transporte/automação não brigam
    if (!this.atWar(this.players.get(u.owner))) return;
    // Bot FÁCIL: soldados NÃO perseguem — seguram posição (a IA original "não
    // atacava"). Torres e Centro da Vila do bot ainda defendem a base sozinhos.
    if (this.players.get(u.owner)?.difficulty === 'easy') return;
    if (u.aggroTimer > 0) return;
    u.aggroTimer = 0.5; // ~2x/s
    const sight = UNIT_DEFS[u.type].sight;
    const meNaval = isNavalUnit(u.type);
    const meMelee = UNIT_DEFS[u.type].range <= 1.5;
    let bestId: number | null = null;
    let bestD = Infinity;
    for (const other of this.units.values()) {
      if (this.allied(other.owner, u.owner)) continue;
      if (!this.atWar(this.players.get(other.owner))) continue;
      // corpo-a-corpo terrestre não alcança barco (não fica pingando na margem);
      // galé não persegue terra adentro: só engaja alvo TERRESTRE já no alcance.
      const otherNaval = isNavalUnit(other.type);
      if (!meNaval && meMelee && otherNaval) continue;
      const d = Math.hypot(other.x - u.x, other.y - u.y);
      if (meNaval && !otherNaval && d > UNIT_DEFS[u.type].range) continue;
      if (d <= sight && d < bestD) {
        bestD = d;
        bestId = other.id;
      }
    }
    if (bestId === null) {
      for (const b of this.buildings.values()) {
        if (this.allied(b.owner, u.owner)) continue;
        if (!this.atWar(this.players.get(b.owner))) continue;
        const size = BUILDING_DEFS[b.type].size;
        const nx = Math.max(b.tileX, Math.min(u.x, b.tileX + size - 1));
        const ny = Math.max(b.tileY, Math.min(u.y, b.tileY + size - 1));
        const d = Math.hypot(nx + 0.5 - u.x, ny + 0.5 - u.y);
        if (d <= sight && d < bestD) {
          bestD = d;
          bestId = b.id;
        }
      }
    }
    if (bestId !== null) {
      u.attackTargetId = bestId;
      u.state = 'movingToAttack';
      u.repathTimer = 0;
    }
  }

  private updateMovingToGather(u: Unit, dt: number): void {
    this.advanceAlongPath(u, dt);
    if (u.path.length > 0) return;
    const targetId = u.gatherTargetId;
    if (targetId === undefined) {
      u.state = 'idle';
      return;
    }
    const node = this.nodes.get(targetId);
    const farm = this.buildings.get(targetId);
    const sheep = this.sheep.get(targetId);
    const pos = node
      ? { x: node.tileX + 0.5, y: node.tileY + 0.5 }
      : sheep
        ? { x: sheep.x, y: sheep.y }
        : farm
          ? this.nearestFarmTile(farm, u)
          : null;
    if (!pos) {
      // a fonte acabou enquanto vinha a caminho: emenda na próxima mais perto
      this.retargetGather(u);
      return;
    }
    const d = Math.hypot(pos.x - u.x, pos.y - u.y);
    if (d <= 1.6) {
      u.state = 'gathering';
    } else {
      // repath (alvo pode ter sido removido/mudou/andado)
      if (node && this.pathUnitAdjacentToSpread(u, node.tileX, node.tileY, 1, node.id)) return;
      if (farm && this.pathUnitAdjacentToSpread(u, farm.tileX, farm.tileY, BUILDING_DEFS.farm.size, farm.id)) return;
      if (sheep) {
        this.pathUnitTo(u, sheep.x, sheep.y);
        if (u.path.length > 0) return;
      }
      u.state = 'idle';
    }
  }

  private nearestFarmTile(farm: Building, u: Unit): { x: number; y: number } {
    const size = BUILDING_DEFS.farm.size;
    const nx = Math.max(farm.tileX, Math.min(u.x, farm.tileX + size - 1));
    const ny = Math.max(farm.tileY, Math.min(u.y, farm.tileY + size - 1));
    return { x: nx + 0.5, y: ny + 0.5 };
  }

  private updateGathering(u: Unit, dt: number): void {
    const targetId = u.gatherTargetId;
    if (targetId === undefined) {
      u.state = 'idle';
      return;
    }
    const node = this.nodes.get(targetId);
    const farm = this.buildings.get(targetId);
    const sheep = this.sheep.get(targetId);
    if (!node && !(farm && farm.type === 'farm') && !sheep) {
      // fonte sumiu: tenta retarget mesmo recurso
      this.retargetGather(u);
      return;
    }
    const resource = u.gatherResource!;
    const amountAvail = node ? node.amount : sheep ? sheep.food : farm!.foodLeft ?? 0;
    // techs econômicas do Mercado: coleta mais rápida e mais capacidade de carga
    const techs = this.players.get(u.owner)?.techs ?? [];
    // Barco de pesca tem porão próprio (maior que o cesto do aldeão).
    const cap = u.type === 'fishing_boat' ? FISH_BOAT_CARRY : carryCapacity(techs);
    const capacity = cap - (u.carryType === resource ? u.carryAmount : 0);
    if (u.carryType !== resource) {
      u.carryType = resource;
      u.carryAmount = 0;
    }
    const gathered = Math.min(GATHER_RATE * gatherMultiplier(techs, resource) * dt, capacity, amountAvail);
    u.carryAmount += gathered;
    if (node) {
      node.amount -= gathered;
      if (node.amount <= 0) {
        this.unblockFootprint(node.tileX, node.tileY, 1);
        this.nodes.delete(node.id);
      }
    } else if (sheep) {
      sheep.owner = u.owner; // abatendo = ovelha continua sua
      sheep.food -= gathered;
      if (sheep.food <= 0) this.sheep.delete(sheep.id); // sem unblock (ovelha não bloqueia)
    } else if (farm) {
      farm.foodLeft = (farm.foodLeft ?? 0) - gathered;
      if (farm.foodLeft <= 0) {
        this.unblockFootprint(farm.tileX, farm.tileY, BUILDING_DEFS.farm.size);
        this.buildings.delete(farm.id);
      }
    }

    const full = u.carryAmount >= cap - 1e-6;
    const sourceGone = node
      ? !this.nodes.has(node.id)
      : sheep
        ? !this.sheep.has(sheep.id)
        : !this.buildings.has(farm!.id);
    if (full) {
      this.sendToDropOff(u);
      return;
    }
    if (sourceGone) {
      // fonte esgotou antes de encher: EMENDA na próxima do mesmo recurso
      // (AoE2) — só vai entregar quando encher; sem outra fonte, entrega o
      // que tem (se algo) e para. (Barco emenda em PEIXE; nunca em fazenda.)
      const resource = u.gatherResource;
      const near = resource ? this.findNearestNodeOfResource(resource, u.x, u.y, 10, isNavalUnit(u.type)) : null;
      if (near) {
        this.startGatherNode(u, near);
        return;
      }
      if (resource === 'energy' && u.type === 'villager') {
        const nextFarm = this.findNearestOwnFarm(u.owner, u.x, u.y, 10);
        if (nextFarm) {
          this.startGatherFarm(u, nextFarm);
          return;
        }
      }
      if (u.carryAmount > 0) this.sendToDropOff(u);
      else u.state = 'idle';
    }
  }

  /** Prédios de defesa (torre de vigia + Centro da Cidade): atiram flechas no
   *  inimigo mais próximo dentro do alcance. Alcance E dano crescem com a era do
   *  dono e com as pesquisas de defesa (Balística/Frestas). */
  private updateTowers(dt: number): void {
    for (const b of this.buildings.values()) {
      const def = DEFENSE_DEFS[b.type];
      if (!def || b.progress < 1) continue;
      b.attackTimer = (b.attackTimer ?? 0) - dt;
      const p = this.players.get(b.owner);
      if (!this.atWar(p)) { b.targetId = undefined; continue; }
      const age = p?.age ?? 1;
      const baseRange = buildingRange(b.type, age, p?.techs);
      const range = this.raidSim ? this.raidDefenseRange(b, baseRange) : baseRange;
      const size = BUILDING_DEFS[b.type].size;
      const cx = b.tileX + size / 2;
      const cy = b.tileY + size / 2;
      // mantém o alvo atual enquanto vivo e no alcance; senão procura outro
      let target = b.targetId !== undefined ? this.units.get(b.targetId) : undefined;
      if (!target || this.allied(target.owner, b.owner)
        || (!this.atWar(this.players.get(target.owner)))
        || Math.hypot(target.x - cx, target.y - cy) > range) {
        target = undefined;
        b.targetId = undefined;
        let bestD = range;
        for (const u of this.units.values()) {
          if (this.allied(u.owner, b.owner)) continue;
          if (!this.atWar(this.players.get(u.owner))) continue;
          if (def.targets && (def.targets === 'air') !== isFlyingUnit(u.type)) continue;
          const d = Math.hypot(u.x - cx, u.y - cy);
          if (d <= bestD) {
            bestD = d;
            target = u;
          }
        }
        if (target) b.targetId = target.id;
      }
      if (target && b.attackTimer <= 0) {
        b.attackTimer = def.cooldown;
        const baseDmg = buildingAttack(b.type, age, p?.techs);
        const dmg = this.raidSim ? this.raidDefenseDamage(b, baseDmg, target) : baseDmg;
        const arrows = 1 + (b.garrison?.length ?? 0); // +1 flecha por unidade dentro
        if (arrows <= 1) {
          target.hp -= Math.max(1, dmg - this.unitArmor(target));
          if (target.hp <= 0) {
            this.stats?.unitLost(target.owner, target.type, b.owner, this.tick, this.playerNames());
            this.units.delete(target.id);
            this.retargetAttackersOf(target.id);
            b.targetId = undefined;
          }
        } else {
          // guarnecido: dispara nos N inimigos mais próximos (defesa de área)
          const enemies = [...this.units.values()]
            .filter((e) => !this.allied(e.owner, b.owner))
            .map((e) => ({ e, d: Math.hypot(e.x - cx, e.y - cy) }))
            .filter((o) => o.d <= range)
            .sort((a, z) => a.d - z.d)
            .slice(0, arrows);
          for (const { e } of enemies) {
            e.hp -= Math.max(1, dmg - this.unitArmor(e));
            if (e.hp <= 0) {
              this.stats?.unitLost(e.owner, e.type, b.owner, this.tick, this.playerNames());
              this.units.delete(e.id);
              this.retargetAttackersOf(e.id);
            }
          }
          if (!this.units.has(target.id)) b.targetId = undefined;
        }
      }
    }
  }

  /** Manda o aldeão entregar a carga no drop-off mais próximo (ou fica idle). */
  private sendToDropOff(u: Unit): void {
    const drop = this.findNearestDropOff(u.owner, u.x, u.y, u.carryType, isNavalUnit(u.type));
    if (!drop) {
      u.state = 'idle';
      return;
    }
    u.dropOffId = drop.id;
    if (this.pathUnitAdjacentTo(u, drop.tileX, drop.tileY, BUILDING_DEFS[drop.type].size)) {
      u.state = 'returning';
    } else {
      u.state = 'idle';
    }
  }

  /** Fazenda própria pronta e com comida mais próxima (para emendar a colheita). */
  private findNearestOwnFarm(owner: number, x: number, y: number, maxDist: number): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.buildings.values()) {
      if (b.owner !== owner || b.type !== 'farm' || b.progress < 1 || (b.foodLeft ?? 0) <= 0) continue;
      const d = Math.hypot(b.tileX + 1 - x, b.tileY + 1 - y);
      if (d <= maxDist && d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private retargetGather(u: Unit): void {
    const resource = u.gatherResource;
    if (!resource) {
      u.state = 'idle';
      return;
    }
    const near = this.findNearestNodeOfResource(resource, u.x, u.y, 10, isNavalUnit(u.type));
    if (near) {
      this.startGatherNode(u, near);
      return;
    }
    if (resource === 'energy' && u.type === 'villager') {
      const farm = this.findNearestOwnFarm(u.owner, u.x, u.y, 10);
      if (farm) {
        this.startGatherFarm(u, farm);
        return;
      }
    }
    u.state = 'idle';
  }

  private updateReturning(u: Unit, dt: number): void {
    this.advanceAlongPath(u, dt);
    if (u.path.length > 0) return;
    const drop = this.buildings.get(u.dropOffId ?? -1);
    if (!drop || drop.progress < 1) {
      u.state = 'idle';
      return;
    }
    const size = BUILDING_DEFS[drop.type].size;
    const nx = Math.max(drop.tileX, Math.min(u.x, drop.tileX + size - 1));
    const ny = Math.max(drop.tileY, Math.min(u.y, drop.tileY + size - 1));
    const d = Math.hypot(nx + 0.5 - u.x, ny + 0.5 - u.y);
    if (d > 1.6) {
      if (!this.pathUnitAdjacentTo(u, drop.tileX, drop.tileY, size)) u.state = 'idle';
      return;
    }
    const p = this.players.get(u.owner);
    if (p && u.carryType) {
      p.resources[u.carryType] += u.carryAmount;
      this.stats?.gathered(p.id, u.carryType, u.carryAmount);
    }
    u.carryAmount = 0;
    // volta à mesma fonte, ou retarget
    const targetId = u.gatherTargetId;
    const node = targetId !== undefined ? this.nodes.get(targetId) : undefined;
    const farm = targetId !== undefined ? this.buildings.get(targetId) : undefined;
    const sheepT = targetId !== undefined ? this.sheep.get(targetId) : undefined;
    if (node) {
      this.startGatherNode(u, node);
    } else if (sheepT) {
      // volta pra MESMA ovelha (senão ela ficava largada apodrecendo)
      this.startGatherSheep(u, sheepT);
    } else if (farm && farm.type === 'farm') {
      this.startGatherFarm(u, farm);
    } else {
      this.retargetGather(u);
    }
  }

  private updateMovingToBuild(u: Unit, dt: number): void {
    this.advanceAlongPath(u, dt);
    if (u.path.length > 0) return;
    const b = this.buildings.get(u.buildTargetId ?? -1);
    if (!b) {
      // obra sumiu antes de chegar: emenda na próxima da fila (se houver)
      u.buildTargetId = undefined;
      if (this.advanceBuildQueue(u)) return;
      u.state = 'idle';
      return;
    }
    const size = BUILDING_DEFS[b.type].size;
    const nx = Math.max(b.tileX, Math.min(u.x, b.tileX + size - 1));
    const ny = Math.max(b.tileY, Math.min(u.y, b.tileY + size - 1));
    const d = Math.hypot(nx + 0.5 - u.x, ny + 0.5 - u.y);
    if (d <= 1.6) {
      u.state = 'building';
    } else if (!this.pathUnitAdjacentTo(u, b.tileX, b.tileY, size)) {
      u.state = 'idle';
    } else if (u.path.length === 0 && d <= 2.2) {
      // Already on the adjacent (diagonal) tile but off its centre: re-pathing
      // yields an empty path forever. Close enough — start building.
      u.state = 'building';
    }
  }

  private updateBuilding(u: Unit, dt: number): void {
    const b = this.buildings.get(u.buildTargetId ?? -1);
    const def = b ? BUILDING_DEFS[b.type] : undefined;
    // nada a fazer: obra sumiu, ou está pronta E com vida cheia → segue a fila
    if (!b || !def || (b.progress >= 1 && b.hp >= def.hp && b.upgradeTargetLevel === undefined)) {
      u.buildTargetId = undefined;
      if (this.advanceBuildQueue(u)) return;
      u.state = 'idle';
      return;
    }
    if (b.progress >= 1 && b.upgradeTargetLevel !== undefined && this.homeMode) {
      this.homeUpgradeTick(u, b, dt);
      return;
    }
    if (b.progress >= 1) {
      // REPARO: prédio pronto porém danificado — recupera vida gastando recurso.
      this.repairTick(u, b, dt);
      return;
    }
    let rate = (BUILD_RATE[u.type] ?? 1) * this.automationFactor(u);
    if (this.homeMode) {
      const aggregate = this.homeCrewRate(u, b);
      if (aggregate === null) return;
      rate = aggregate;
    }
    b.progress = Math.min(1, b.progress + (dt * rate) / def.buildTime);
    b.hp = Math.round(def.hp * (0.1 + 0.9 * b.progress));
    if (b.progress >= 1) {
      if (this.homeMode) this.recordHomeEvent('build', `${b.type.replace(/_/g, ' ')} completed`);
      if (b.type === 'farm') {
        b.foodLeft = FARM_FOOD;
        // fazenda pronta: quem construiu segue a fila; sem fila, colhe na hora (AoE2)
        for (const worker of this.units.values()) {
          if (worker.owner === b.owner && worker.buildTargetId === b.id) {
            worker.buildTargetId = undefined;
            if (this.advanceBuildQueue(worker)) continue;
            this.startGatherFarm(worker, b);
          }
        }
        return;
      }
      // prédio comum pronto: próxima obra da fila tem prioridade
      u.buildTargetId = undefined;
      if (this.advanceBuildQueue(u)) return;
      u.state = 'idle';
    }
  }

  /** Um aldeão consertando um prédio pronto: recupera vida na velocidade de
   *  construção, gastando 50% do custo da obra proporcional ao HP recuperado.
   *  Sem recurso pra pagar o próximo tiquinho, para. */
  private repairTick(u: Unit, b: Building, dt: number): void {
    const def = BUILDING_DEFS[b.type];
    const p = this.players.get(u.owner);
    const rate = (BUILD_RATE[u.type] ?? 1) * this.automationFactor(u);
    const gain = Math.min((def.hp / def.buildTime) * dt * rate, def.hp - b.hp);
    if (!p || gain <= 0) {
      u.buildTargetId = undefined;
      if (!this.advanceBuildQueue(u)) u.state = 'idle';
      return;
    }
    const frac = (gain / def.hp) * 0.5; // reparo = metade da obra, proporcional ao HP
    const entries = Object.entries(def.cost) as [ResourceType, number][];
    for (const [res, amt] of entries) {
      if ((p.resources[res] ?? 0) < (amt ?? 0) * frac) {
        u.state = 'idle';
        u.buildTargetId = undefined;
        return;
      }
    }
    for (const [res, amt] of entries) p.resources[res] -= (amt ?? 0) * frac;
    b.hp = Math.min(def.hp, b.hp + gain);
  }

  private updateMovingToAttack(u: Unit, dt: number): void {
    const targetId = u.attackTargetId;
    if (targetId === undefined || (!this.units.has(targetId) && !this.buildings.has(targetId))) {
      u.state = 'idle';
      return;
    }
    u.repathTimer -= dt;
    const pos = this.targetPos(targetId);
    if (pos && u.repathTimer <= 0) {
      u.repathTimer = 1;
      const moved = Math.hypot(pos.x - u.pathTargetX, pos.y - u.pathTargetY);
      if (moved > 1 || u.path.length === 0) {
        const tb = this.buildings.get(targetId);
        if (tb) {
          this.pathUnitAdjacentTo(u, tb.tileX, tb.tileY, BUILDING_DEFS[tb.type].size);
        } else {
          this.pathUnitTo(u, pos.x, pos.y);
        }
      }
    }
    this.advanceAlongPath(u, dt);
    const range = this.unitRange(u);
    const d = this.distToTarget(u, targetId);
    if (d <= range) {
      u.state = 'attacking';
      u.attackCooldown = 0;
    }
  }

  private updateAttacking(u: Unit, dt: number): void {
    const targetId = u.attackTargetId;
    if (targetId === undefined || (!this.units.has(targetId) && !this.buildings.has(targetId))) {
      u.state = 'idle';
      return;
    }
    const range = this.unitRange(u);
    const d = this.distToTarget(u, targetId);
    if (d > range) {
      u.state = 'movingToAttack';
      u.repathTimer = 0;
      return;
    }
    u.attackCooldown -= dt;
    if (u.attackCooldown <= 0) {
      u.attackCooldown = UNIT_DEFS[u.type].attackCooldown;
      this.dealDamage(u, targetId);
    }
  }

  // ---------------- Recursos/economia ----------------

  private canAfford(p: GamePlayer, cost: Partial<Record<ResourceType, number>>): boolean {
    for (const key of Object.keys(cost) as ResourceType[]) {
      if (p.resources[key] < (cost[key] ?? 0)) return false;
    }
    return true;
  }

  private deduct(p: GamePlayer, cost: Partial<Record<ResourceType, number>>): void {
    for (const key of Object.keys(cost) as ResourceType[]) {
      p.resources[key] -= cost[key] ?? 0;
    }
    this.stats?.spent(p.id, cost);
  }

  private refund(p: GamePlayer, cost: Partial<Record<ResourceType, number>>): void {
    const negative: Partial<Record<ResourceType, number>> = {};
    for (const key of Object.keys(cost) as ResourceType[]) {
      p.resources[key] += cost[key] ?? 0;
      negative[key] = -(cost[key] ?? 0);
    }
    this.stats?.spent(p.id, negative);
  }

  private bootstrapHome(playerId: number): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.resources = { energy: 1400, alloys: 2300, compute: 900 };
    const starters = [...this.units.values()].filter((u) => u.owner === playerId).sort((a, b) => a.id - b.id);
    if (starters[0]) starters[0].type = 'designer';
    if (starters[1]) { starters[1].type = 'robot'; starters[1].hp = UNIT_DEFS.robot.hp; }
    if (starters[2]) { starters[2].type = 'drone'; starters[2].hp = UNIT_DEFS.drone.hp; }
    const hub = [...this.buildings.values()].find((b) => b.owner === playerId && b.type === 'town_center');
    if (hub) {
      const foundation: { type: BuildingType; x: number; y: number }[] = [
        { type: 'house', x: hub.tileX - 6, y: hub.tileY - 2 },
        { type: 'mill', x: hub.tileX - 6, y: hub.tileY + 5 },
        { type: 'lumber_camp', x: hub.tileX + 7, y: hub.tileY - 2 },
      ];
      for (const planned of foundation) {
        const type = planned.type;
        const def = BUILDING_DEFS[type];
        let placed = false;
        if (this.validFootprint(planned.x, planned.y, def.size)) {
          const building: Building = { id: this.nextId++, owner: playerId, type, tileX: planned.x, tileY: planned.y, hp: def.hp, progress: 1, queue: [] };
          this.buildings.set(building.id, building);
          this.blockFootprint(building.tileX, building.tileY, def.size);
          this.knownCompletedBuildings.add(building.id);
          placed = true;
        }
        for (let radius = 5; radius < 16 && !placed; radius++) {
          for (let y = hub.tileY - radius; y <= hub.tileY + radius && !placed; y++) {
            for (let x = hub.tileX - radius; x <= hub.tileX + radius; x++) {
              if (!this.validFootprint(x, y, def.size)) continue;
              const building: Building = { id: this.nextId++, owner: playerId, type, tileX: x, tileY: y, hp: def.hp, progress: 1, queue: [] };
              this.buildings.set(building.id, building);
              this.blockFootprint(x, y, def.size);
              this.knownCompletedBuildings.add(building.id);
              placed = true;
              break;
            }
          }
        }
      }
    }
    this.homeProductionCollectedAt = this.now();
    this.chain = newChainState(this.homeSalt, this.now());
    this.elonLogged = player.elonBalance;
    this.progression.foundedAt = this.now();
  }

  /** Records the first time a milestone happens (telemetry; never overwritten). */
  markMilestone(key: keyof NonNullable<HomeProgression['milestones']>): void {
    if (!this.homeMode) return;
    const m = (this.progression.milestones ??= {});
    if (m[key] === undefined) m[key] = this.now();
  }

  // ---------------- City ledger (Home) ----------------

  /** Logs a city event; it is sealed into the next minute's block. */
  recordHomeEvent(kind: Parameters<typeof recordTx>[2], label: string, amount = 0): void {
    if (this.homeMode && this.chain) recordTx(this.chain.ledger, this.now(), kind, label, amount);
  }

  /** Once a minute: log ELON accrued since the last block, then seal. */
  private sealHomeLedger(): void {
    const chain = this.chain;
    const p = this.homePlayer();
    if (!chain || !p) return;
    const delta = p.elonBalance - this.elonLogged;
    if (delta >= 0.01) recordTx(chain.ledger, this.now(), 'elon', `+${delta.toFixed(2)} ELON accrued`, delta);
    this.elonLogged = p.elonBalance;
    sealBlock(chain.ledger, this.now());
  }

  /** Moves the whole-number playable ELON balance into a settlement, logs it
   *  and seals a block whose head the chain adapter will anchor. */
  settleElon(id: string): { settlement?: import('@age/shared').ElonSettlement; error?: string } {
    const chain = this.chain;
    const p = this.homePlayer();
    if (!chain || !p) return { error: 'err.ledger_unavailable' };
    const amount = Math.floor(p.elonBalance);
    if (amount < 1) return { error: 'err.nothing_to_settle' };
    this.sealHomeLedger(); // accrual up to now stays a separate, earlier entry
    p.elonBalance -= amount;
    this.elonLogged = p.elonBalance;
    recordTx(chain.ledger, this.now(), 'settlement', `Settled ${amount} ELON (${id})`, amount);
    this.markMilestone('firstSettlement');
    sealBlock(chain.ledger, this.now());
    const settlement = {
      id, amount, at: this.now(), ledgerHead: chain.ledger.head, ledgerHeight: chain.ledger.nextHeight - 1, status: 'pending' as const,
    };
    chain.settledTotal += amount;
    chain.settlements.unshift(settlement);
    if (chain.settlements.length > LEDGER_MAX_SETTLEMENTS) chain.settlements.length = LEDGER_MAX_SETTLEMENTS;
    return { settlement };
  }

  ledgerView(chainMode: 'disabled' | 'local' | 'rpc', contract?: string): import('@age/shared').HomeLedgerView | null {
    const chain = this.chain;
    const p = this.homePlayer();
    if (!chain || !p) return null;
    const l = chain.ledger;
    return {
      city: `${p.name}'s City`,
      height: l.nextHeight - 1,
      head: l.head,
      verified: verifyLedger(l),
      pending: l.pending.length,
      elon: { balance: Math.floor(p.elonBalance * 100) / 100, capacity: this.elonCapacityOf(p.id), perMinute: this.elonPerMinuteOf(p.id), settledTotal: chain.settledTotal },
      settlements: chain.settlements.map((x) => ({ ...x })),
      blocks: l.blocks.slice(-24).reverse().map((b) => ({ ...b })),
      txs: [...l.pending.slice().reverse(), ...l.txs.slice(-60).reverse()].slice(0, 60).map((t) => ({ ...t })),
      chain: { mode: chainMode, ...(contract ? { contract } : {}) },
    };
  }

  /** Spec §3.2 crew rule: fastest + 0.6 × the rest, applied once per site per
   *  tick by the lowest-id worker. Returns null for the other workers. */
  private homeCrewRate(u: Unit, b: Building): number | null {
    const active = [...this.units.values()]
      .filter((worker) => worker.owner === b.owner && worker.buildTargetId === b.id && worker.state === 'building')
      .sort((a, z) => a.id - z.id);
    if (active[0]?.id !== u.id) return null;
    const rates = active
      .map((worker) => (BUILD_RATE[worker.type] ?? 1) * this.automationFactor(worker))
      .sort((a, z) => z - a);
    return (rates[0] ?? 0) + rates.slice(1).reduce((sum, value) => sum + value * 0.6, 0);
  }

  private homeUpgradeTick(u: Unit, b: Building, dt: number): void {
    const rate = this.homeCrewRate(u, b);
    if (rate === null || b.upgradeTargetLevel === undefined) return;
    const time = homeUpgradeTime(b.type, b.upgradeTargetLevel);
    b.upgradeProgress = Math.min(1, (b.upgradeProgress ?? 0) + (dt * rate) / time);
    if (b.upgradeProgress < 1) return;
    this.completeHomeUpgrade(b);
    for (const worker of this.units.values()) {
      if (worker.owner !== b.owner || worker.buildTargetId !== b.id) continue;
      worker.buildTargetId = undefined;
      if (!this.advanceBuildQueue(worker)) worker.state = 'idle';
    }
  }

  /** The new level exists only from here on (spec §3.4: never imply it early). */
  private completeHomeUpgrade(b: Building): void {
    if (b.upgradeTargetLevel === undefined) return;
    b.level = b.upgradeTargetLevel;
    b.upgradeTargetLevel = undefined;
    b.upgradeProgress = undefined;
    b.hp = buildingMaxHp(b.type, b.level);
    this.recordHomeEvent('upgrade', `${b.type === 'town_center' ? 'City Level' : `${b.type.replace(/_/g, ' ')} level`} ${b.level}`);
    if (b.type === 'town_center') {
      const owner = this.players.get(b.owner);
      if (owner) {
        owner.age = b.level;
        if (b.level >= 2 && b.level <= 5) this.markMilestone(`level${b.level}` as 'level2');
        if (b.level >= 5) owner.cityPath = 'command'; // Specialized City: command path
      }
    }
  }

  private hasCompleted(playerId: number, types: BuildingType[], level: number): boolean {
    for (const b of this.buildings.values()) {
      if (b.owner === playerId && b.progress >= 1 && types.includes(b.type) && (b.level ?? 1) >= level) return true;
    }
    return false;
  }

  /** Unmet Hub requirements for a target City Level, as short reasons for the HUD. */
  cityLevelBlockers(playerId: number, target: number): string[] {
    const req = HOME_CITY_LEVELS[target];
    if (!req) return ['max level'];
    const out: string[] = [];
    for (const need of req.buildings) {
      if (!this.hasCompleted(playerId, need.types, need.level)) out.push(`${need.types.join('/')} L${need.level}`);
    }
    const grid = this.powerOf(playerId);
    if (grid.supply < req.minSupply || grid.draw > grid.supply) out.push(`grid ${req.minSupply}+ supply, no shortage`);
    if (req.research && (this.progression.research[req.research.unit] ?? 0) < req.research.level) {
      out.push(`${req.research.unit} research L${req.research.level}`);
    }
    const points = HOME_LEVEL_POINTS[target] ?? Infinity;
    if (this.developmentPointsOf(playerId) < points) out.push(`${points} development`);
    return out;
  }

  /** Physical one-level upgrade of a completed building (Hub = City Level). The
   *  building keeps working at its old level until builders finish. */
  /** City Level is the source of truth for the Hub's level (older saves only
   *  stored `age`); keep them in step before reading either. */
  private syncHubLevels(): void {
    for (const b of this.buildings.values()) {
      if (b.type !== 'town_center') continue;
      const age = this.players.get(b.owner)?.age ?? 1;
      if (age > 1) b.level = age;
      else delete b.level;
    }
  }

  private cmdUpgradeBuilding(playerId: number, buildingId: number): void {
    this.syncHubLevels();
    const player = this.players.get(playerId);
    const b = this.buildings.get(buildingId);
    if (!player || !b || b.owner !== playerId || b.progress < 1) return;
    if (b.upgradeTargetLevel !== undefined) { this.errorTo(playerId, 'err.upgrade_in_progress'); return; }
    const level = b.level ?? 1;
    const max = HOME_MAX_LEVEL[b.type] ?? 1;
    if (level >= max) { this.errorTo(playerId, 'err.max_level'); return; }
    const target = level + 1;
    if (b.type === 'town_center') {
      const blockers = this.cityLevelBlockers(playerId, target);
      if (blockers.length) { this.errorTo(playerId, 'err.city_requirements', { missing: blockers.join(', ') }); return; }
    } else if (target > player.age) {
      // A building may not outgrow its city.
      this.errorTo(playerId, 'err.requires_age', { age: target });
      return;
    }
    const builders = [...this.units.values()].filter((u) => u.owner === playerId && isBuilderUnit(u.type));
    if (builders.length === 0) { this.errorTo(playerId, 'err.home_builders'); return; }
    const cost = homeUpgradeCost(b.type, target);
    if (!this.canAfford(player, cost)) { this.errorTo(playerId, 'err.no_resources'); return; }
    this.deduct(player, cost);
    b.upgradeTargetLevel = target;
    b.upgradeProgress = 0;
    // Idle builders go first; with none idle the Hub still pulls the whole crew.
    const idle = builders.filter((u) => u.state === 'idle');
    for (const u of idle.length ? idle : b.type === 'town_center' ? builders : builders.slice(0, 1)) this.assignBuilder(u, b);
  }

  private cmdUnitResearch(playerId: number, unit: UnitType): void {
    const player = this.players.get(playerId);
    const def = HOME_UNIT_RESEARCH[unit];
    const unlock = HOME_UNIT_UNLOCK[unit];
    if (!player || !def || !unlock) return;
    if (this.progression.researching) { this.errorTo(playerId, 'err.research_busy'); return; }
    if (!this.hasCompleted(playerId, ['robotics_workshop'], 1)) { this.errorTo(playerId, 'err.requires_building', { building: 'robotics_workshop' }); return; }
    if (player.age < unlock.cityLevel) { this.errorTo(playerId, 'err.requires_age', { age: unlock.cityLevel }); return; }
    const next = (this.progression.research[unit] ?? 0) + 1;
    if (next > HOME_RESEARCH_MAX) { this.errorTo(playerId, 'err.max_level'); return; }
    const cost = homeResearchCost(unit, next);
    if (!this.canAfford(player, cost)) { this.errorTo(playerId, 'err.no_resources'); return; }
    this.deduct(player, cost);
    this.progression.researching = { unit, level: next, progress: 0 };
  }

  /** Research runs at the workshop under the grid factor; upgraded workshops research faster. */
  private updateHomeResearch(dt: number): void {
    const r = this.progression.researching;
    const player = this.homePlayer();
    if (!r || !player) return;
    const def = HOME_UNIT_RESEARCH[r.unit];
    const workshop = [...this.buildings.values()]
      .filter((b) => b.owner === player.id && b.type === 'robotics_workshop' && b.progress >= 1)
      .reduce((best, b) => Math.max(best, b.level ?? 1), 0);
    if (!def || workshop === 0) return;
    const grid = this.powerOf(player.id);
    r.progress = Math.min(1, r.progress + (dt * powerEfficiency(grid.supply, grid.draw) * levelScale(workshop, 0.2)) / (def.time * r.level));
    if (r.progress >= 1) {
      this.progression.research[r.unit] = r.level;
      this.recordHomeEvent('research', `${r.unit.replace(/_/g, ' ')} research level ${r.level}`);
      this.progression.researching = undefined;
    }
  }

  /** Immutable defense snapshot of this Home for other players to raid (spec
   *  §6.6): completed buildings only, re-centred on the raid map with their
   *  relative layout, levels and the current grid factor. */
  captureDefenseSnapshot(label: string, ownerKey: string): DefenseSnapshot | null {
    const p = this.homePlayer();
    if (!p) return null;
    const hubB = [...this.buildings.values()].find((b) => b.owner === p.id && b.type === 'town_center' && b.progress >= 1);
    if (!hubB) return null;
    // A raid targets the city core: plots within SNAPSHOT_RADIUS of the Hub. A
    // whole-map city would leave no deployment band and no 3-minute raid.
    const SNAPSHOT_RADIUS = 22;
    const hcx = hubB.tileX + 1.5;
    const hcy = hubB.tileY + 1.5;
    const built = [...this.buildings.values()].filter((b) => {
      if (b.owner !== p.id || b.progress < 1) return false;
      const size = BUILDING_DEFS[b.type].size;
      return Math.max(Math.abs(b.tileX + size / 2 - hcx), Math.abs(b.tileY + size / 2 - hcy)) <= SNAPSHOT_RADIUS;
    });
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const b of built) {
      const size = BUILDING_DEFS[b.type].size;
      minX = Math.min(minX, b.tileX); minY = Math.min(minY, b.tileY);
      maxX = Math.max(maxX, b.tileX + size); maxY = Math.max(maxY, b.tileY + size);
    }
    const n = this.grid.size;
    const dx = Math.max(2 - minX, Math.min(n - 2 - maxX, Math.floor(n / 2 - (minX + maxX) / 2)));
    const dy = Math.max(2 - minY, Math.min(n - 2 - maxY, Math.floor(n / 2 - (minY + maxY) / 2)));
    const grid = this.powerOf(p.id);
    const signature = this.defenseSignature();
    const body: Omit<DefenseSnapshot, 'checksum'> = {
      id: `player-${ownerKey.slice(0, 10)}-${createHash('sha256').update(signature).digest('hex').slice(0, 10)}`,
      version: 2,
      kind: 'player',
      label,
      cityLevel: p.age,
      seed: 0,
      buildings: built
        .sort((a, z) => a.id - z.id)
        .map((b) => ({ id: b.id, type: b.type, tileX: b.tileX + dx, tileY: b.tileY + dy, ...((b.level ?? 1) > 1 ? { level: b.level } : {}) })),
      trees: [],
      defensePower: Math.round(powerEfficiency(grid.supply, grid.draw) * 1000) / 1000,
    };
    return { ...body, checksum: snapshotChecksum(body) };
  }

  /** Stable fingerprint of the defensible layout; a change triggers a new published snapshot. */
  defenseSignature(): string {
    this.syncHubLevels();
    const p = this.homePlayer();
    return [...this.buildings.values()]
      .filter((b) => b.owner === p?.id && b.progress >= 1)
      .map((b) => `${b.id}:${b.type}:${b.tileX}:${b.tileY}:${b.level ?? 1}`)
      .sort()
      .join('|');
  }

  /** Completed buildings only. Upgrades add +50% of base per level; each
   *  further copy of a type is worth 80% of the previous (no spam farming);
   *  walls are capped at 50 in total. */
  private developmentPointsOf(playerId: number): number {
    const byType = new Map<BuildingType, number[]>();
    let wallPoints = 0;
    for (const b of this.buildings.values()) {
      if (b.owner !== playerId || b.progress < 1) continue;
      const value = (HOME_DEVELOPMENT[b.type] ?? 0) * levelScale(b.level, 0.5);
      if (b.type === 'wall') { wallPoints += value; continue; }
      const list = byType.get(b.type) ?? [];
      list.push(value);
      byType.set(b.type, list);
    }
    let points = 0;
    for (const values of byType.values()) {
      values.sort((a, z) => z - a).forEach((v, i) => { points += v * Math.pow(0.8, i); });
    }
    return Math.round(points + Math.min(50, wallPoints));
  }

  private storageCapsOf(playerId: number): Resources {
    const caps = { ...HOME_BASE_STORAGE };
    for (const b of this.buildings.values()) {
      if (b.owner !== playerId || b.progress < 1) continue;
      const bonus = HOME_STORAGE_PER_DEPOT[b.type];
      if (!bonus) continue;
      for (const key of Object.keys(bonus) as ResourceType[]) caps[key] += Math.round((bonus[key] ?? 0) * levelScale(b.level, 1));
    }
    return caps;
  }

  private updateHomeProduction(dt: number): void {
    for (const player of this.players.values()) {
      const caps = this.storageCapsOf(player.id);
      for (const b of this.buildings.values()) {
        if (b.owner !== player.id || b.progress < 1) continue;
        const production = HOME_PRODUCTION_PER_HOUR[b.type];
        if (!production) continue;
        const scale = levelScale(b.level, 0.5);
        for (const key of Object.keys(production) as ResourceType[]) {
          // Production stops at capacity; it never destroys stock already above it.
          if (player.resources[key] >= caps[key]) continue;
          player.resources[key] = Math.min(caps[key], player.resources[key] + (production[key] ?? 0) * scale * dt / 3600);
        }
      }
    }
    this.homeProductionCollectedAt = this.now();
  }

  private homeStatus(): HomeStatusSnap {
    const player = [...this.players.values()][0];
    const level = player?.age ?? 1;
    return {
      revision: this.homeRevision,
      developmentPoints: player ? this.developmentPointsOf(player.id) : 0,
      nextLevelPoints: HOME_LEVEL_POINTS[level + 1] ?? HOME_LEVEL_POINTS[level] ?? 0,
      offlineAppliedSeconds: this.homeOfflineAppliedSeconds,
      session: 'home',
      trophies: this.raidData.trophies,
      ...(this.raidData.reports[0] ? { lastReport: this.raidData.reports[0] } : {}),
      research: { ...this.progression.research },
      ...(this.progression.researching ? { researching: { ...this.progression.researching } } : {}),
      shieldSeconds: Math.max(0, Math.ceil((this.progression.shieldUntil - this.now()) / 1000)),
      defenseReports: this.progression.defenseReports.slice(0, 5),
      elonSettled: this.chain?.settledTotal ?? 0,
    };
  }

  captureHomeState(profileId: string): HomeSave {
    if (!this.homeMode) throw new Error('cannot capture arena as a Home save');
    const player = [...this.players.values()][0];
    if (!player) throw new Error('Home has no player');
    this.homeRevision++;
    return structuredClone({
      version: 5,
      profileId,
      revision: this.homeRevision,
      savedAt: this.now(),
      tick: this.tick,
      nextId: this.nextId,
      map: { size: this.map.size, tiles: [...this.map.tiles] },
      player: { ...player, resources: { ...player.resources }, techs: [...player.techs] },
      buildings: [...this.buildings.values()],
      units: [...this.units.values()],
      nodes: [...this.nodes.values()],
      sheep: [...this.sheep.values()],
      lastPower: { ...this.powerOf(player.id) },
      productionCollectedAt: this.homeProductionCollectedAt || this.now(),
      storageCaps: this.storageCapsOf(player.id),
      raid: this.raidData,
      progression: this.progression,
      chain: this.chain,
    } satisfies HomeSave);
  }

  private restoreHomeState(save: HomeSave, playerId: number, name: string, color: string): void {
    const savedOwner = save.player.id;
    this.raidData = structuredClone(save.raid);
    this.progression = structuredClone(save.progression);
    this.chain = save.chain ? structuredClone(save.chain) : newChainState(this.homeSalt, this.now());
    this.elonLogged = this.players.get(playerId)?.elonBalance ?? 0;
    // Reserved units held by a raid record belong to this player too.
    for (const u of this.raidData.active?.reserved ?? []) if (u.owner === savedOwner) u.owner = playerId;
    this.tick = Math.max(0, Math.floor(save.tick));
    this.nextId = Math.max(save.nextId, 1);
    this.homeRevision = save.revision;
    this.players.clear();
    this.players.set(playerId, { ...structuredClone(save.player), id: playerId, name, color, techs: new Set(save.player.techs), defeated: false });
    this.buildings = new Map(save.buildings.map((value) => {
      const b = structuredClone(value); if (b.owner === savedOwner) b.owner = playerId; return [b.id, b];
    }));
    this.units = new Map(save.units.map((value) => {
      const u = structuredClone(value); if (u.owner === savedOwner) u.owner = playerId; return [u.id, u];
    }));
    // The Home is a city only: no forests, mines, sheep or water. Older saves
    // made on wilderness terrain come back as clean city ground.
    this.nodes = new Map();
    this.sheep = new Map();
    void save.nodes; void save.sheep;
    if (save.map.size === this.grid.size) {
      const cityTiles = save.map.tiles.map(() => TILE_GRASS);
      this.grid.tiles.splice(0, this.grid.tiles.length, ...cityTiles);
      this.map.tiles.splice(0, this.map.tiles.length, ...cityTiles);
    }
    this.grid.blocked.fill(0);
    this.navalGrid.blocked.fill(0);
    for (let i = 0; i < this.grid.tiles.length; i++) {
      if (this.grid.tiles[i] !== TILE_GRASS) this.grid.blocked[i] = 1;
      if (this.grid.tiles[i] !== TILE_WATER) this.navalGrid.blocked[i] = 1;
    }
    for (const node of this.nodes.values()) {
      const at = idx(node.tileX, node.tileY, this.grid.size);
      if (node.type === 'fish') this.navalGrid.blocked[at] = 1;
      else this.grid.blocked[at] = 1;
    }
    for (const b of this.buildings.values()) this.blockFootprint(b.tileX, b.tileY, BUILDING_DEFS[b.type].size);
    this.syncHubLevels();
    this.recomputePower();
    const elapsed = Math.min(HOME_OFFLINE_CAP_SECONDS, Math.max(0, (this.now() - save.savedAt) / 1000));
    this.homeOfflineAppliedSeconds = elapsed;
    this.applyOfflineHome(playerId, elapsed, save.lastPower);
    this.homeProductionCollectedAt = this.now();
    this.knownCompletedBuildings = new Set([...this.buildings.values()].filter((b) => b.progress >= 1).map((b) => b.id));
    this.knownUnits = new Set(this.units.keys());
    this.knownAges.set(playerId, this.players.get(playerId)!.age);
  }

  private applyOfflineHome(playerId: number, elapsed: number, savedPower: PowerSnap): void {
    if (elapsed <= 0) return;
    const player = this.players.get(playerId);
    if (!player) return;
    const caps = this.storageCapsOf(playerId);
    const hours = elapsed / 3600;
    for (const b of this.buildings.values()) {
      if (b.owner !== playerId || b.progress < 1) continue;
      const production = HOME_PRODUCTION_PER_HOUR[b.type];
      if (!production) continue;
      const scale = levelScale(b.level, 0.5);
      for (const key of Object.keys(production) as ResourceType[]) {
        if (player.resources[key] >= caps[key]) continue; // stop at capacity, never clamp down
        player.resources[key] = Math.min(caps[key], player.resources[key] + (production[key] ?? 0) * scale * hours);
      }
    }
    const efficiency = powerEfficiency(savedPower.supply, savedPower.draw);
    for (const b of this.buildings.values()) {
      if (b.owner !== playerId || b.progress >= 1) continue;
      // Only builders still committed to this site count; departed/idle ones add nothing.
      const workers = [...this.units.values()].filter((u) => u.owner === playerId && u.buildTargetId === b.id
        && (u.state === 'building' || u.state === 'movingToBuild'));
      const contributions = workers.map((u) => {
        const travel = u.state === 'movingToBuild' ? u.path.length / Math.max(0.1, UNIT_DEFS[u.type].speed) : 0;
        const active = Math.max(0, elapsed - travel);
        const factor = POWER_DRAW[u.type] ? efficiency : 1;
        return active * (BUILD_RATE[u.type] ?? 1) * factor;
      }).sort((a, z) => z - a);
      const work = (contributions[0] ?? 0) + contributions.slice(1).reduce((sum, value) => sum + value * 0.6, 0);
      b.progress = Math.min(1, b.progress + work / BUILDING_DEFS[b.type].buildTime);
      b.hp = Math.round(BUILDING_DEFS[b.type].hp * (0.1 + 0.9 * b.progress));
      if (b.progress >= 1 && b.upgradeTargetLevel !== undefined) {
        player.age = b.upgradeTargetLevel;
        b.upgradeTargetLevel = undefined;
      }
    }
    // Upgrades in progress use the same crew rule and frozen power factor.
    for (const b of this.buildings.values()) {
      if (b.owner !== playerId || b.progress < 1 || b.upgradeTargetLevel === undefined) continue;
      const contributions = [...this.units.values()]
        .filter((u) => u.owner === playerId && u.buildTargetId === b.id && (u.state === 'building' || u.state === 'movingToBuild'))
        .map((u) => {
          const travel = u.state === 'movingToBuild' ? u.path.length / Math.max(0.1, UNIT_DEFS[u.type].speed) : 0;
          return Math.max(0, elapsed - travel) * (BUILD_RATE[u.type] ?? 1) * (POWER_DRAW[u.type] ? efficiency : 1);
        })
        .sort((a, z) => z - a);
      const work = (contributions[0] ?? 0) + contributions.slice(1).reduce((sum, value) => sum + value * 0.6, 0);
      b.upgradeProgress = Math.min(1, (b.upgradeProgress ?? 0) + work / homeUpgradeTime(b.type, b.upgradeTargetLevel));
      if (b.upgradeProgress >= 1) this.completeHomeUpgrade(b);
    }
    // Research continues offline on the frozen grid factor.
    const research = this.progression.researching;
    if (research) {
      const workshop = [...this.buildings.values()]
        .filter((b) => b.owner === playerId && b.type === 'robotics_workshop' && b.progress >= 1)
        .reduce((best, b) => Math.max(best, b.level ?? 1), 0);
      const def = HOME_UNIT_RESEARCH[research.unit];
      if (def && workshop > 0) {
        research.progress = Math.min(1, research.progress + (elapsed * efficiency * levelScale(workshop, 0.2)) / (def.time * research.level));
        if (research.progress >= 1) {
          this.progression.research[research.unit] = research.level;
          this.recordHomeEvent('research', `${research.unit.replace(/_/g, ' ')} research level ${research.level} (offline)`);
          this.progression.researching = undefined;
        }
      }
    }
    // Factory queues run on the same frozen power factor. Finished units dock
    // directly (no offline flight); a full camp blocks the factory as it would live.
    for (const b of [...this.buildings.values()].sort((a, z) => a.id - z.id)) {
      if (b.owner !== playerId || b.progress < 1) continue;
      let budget = elapsed * efficiency;
      while (b.queue.length > 0 && SYMBIOSIS_COMBAT_UNITS.has(b.queue[0].unit)) {
        const head = b.queue[0];
        const remaining = (1 - head.progress) * this.trainTimeFor(b);
        if (budget < remaining) {
          head.progress += budget / this.trainTimeFor(b);
          break;
        }
        budget -= remaining;
        head.progress = 1;
        if (!this.releaseFinishedUnit(b, true)) break;
      }
    }
  }

  // ---------------- Home manufacturing (Phase 2) ----------------

  private updateHomeManufacturing(b: Building, dt: number): void {
    const head = b.queue[0];
    if (head.progress < 1) {
      b.trainBlocked = undefined; // only a finished head can be blocked
      // Power shortage slows factories down to the efficiency floor, never to zero.
      const grid = this.powerOf(b.owner);
      head.progress = Math.min(1, head.progress + (dt * powerEfficiency(grid.supply, grid.draw)) / this.trainTimeFor(b));
      if (head.progress < 1) return;
    }
    this.releaseFinishedUnit(b, false);
  }

  /** Moves the finished queue head out of the factory into the shared camp pool.
   *  Returns false (and marks the factory blocked) when no camp space exists. */
  private releaseFinishedUnit(b: Building, docked: boolean): boolean {
    const head = b.queue[0];
    const capacity = this.armyCapacityOf(b.owner);
    if (this.armyUsedOf(b.owner) + this.armySpaceOf(head.unit) > capacity) {
      b.trainBlocked = capacity > 0 ? 'camp_full' : 'no_camp';
      return false;
    }
    const camp = this.nearestCamp(b);
    const dock = camp ? this.campDockSpot(camp) : null;
    const exit = docked ? dock : this.findFreeSpotNear(b.tileX, b.tileY, BUILDING_DEFS[b.type].size);
    if (!camp || !dock || !exit) return false; // no free tile yet; retry next tick
    b.queue.shift();
    b.trainBlocked = undefined;
    const id = this.nextId++;
    const unit = createUnit(id, b.owner, head.unit, exit.x + 0.5, exit.y + 0.5);
    unit.hp = this.unitMaxHp(unit);
    this.units.set(id, unit);
    this.recordHomeEvent('manufacture', `${head.unit.replace(/_/g, ' ')} manufactured`);
    this.markMilestone('firstUnit');
    if (!docked) {
      // Physical departure: leave the factory and fly/drive to the camp pads.
      this.pathUnitTo(unit, dock.x + 0.5, dock.y + 0.5);
      unit.state = unit.path.length > 0 ? 'moving' : 'idle';
    }
    return true;
  }

  private nearestCamp(from: Building): Building | null {
    let best: Building | null = null;
    let bestDist = Infinity;
    for (const b of this.buildings.values()) {
      if (b.owner !== from.owner || b.progress < 1 || !BUILDING_DEFS[b.type].armyCapacity) continue;
      const d = Math.hypot(b.tileX - from.tileX, b.tileY - from.tileY);
      if (d < bestDist || (d === bestDist && best && b.id < best.id)) { best = b; bestDist = d; }
    }
    return best;
  }

  /** Spreads docked units around the camp's ring instead of stacking one tile. */
  private campDockSpot(camp: Building): { x: number; y: number } | null {
    const size = BUILDING_DEFS[camp.type].size;
    const ring = ringTiles(camp.tileX - 1, camp.tileY - 1, camp.tileX + size, camp.tileY + size)
      .filter((p) => isWalkable(this.grid, p.x, p.y));
    if (ring.length === 0) return null;
    let docked = 0;
    for (const u of this.units.values()) {
      if (u.owner === camp.owner && SYMBIOSIS_COMBAT_UNITS.has(u.type)) docked++;
    }
    return ring[docked % ring.length];
  }

  /** Home refunds: unstarted 100%, started 50%, finished (waiting to dock) never.
   *  Refunds respect storage caps, so cancelling can never mint past capacity. */
  private cancelHomeJob(playerId: number, b: Building, index: number): void {
    const item = b.queue[index];
    const p = this.players.get(playerId);
    if (!item || !p) return;
    if (item.progress >= 1) {
      this.errorTo(playerId, 'err.job_finished');
      return;
    }
    b.queue.splice(index, 1);
    if (index === 0) b.trainBlocked = undefined;
    const paid = item.paid ?? UNIT_DEFS[item.unit].cost;
    const share = item.progress > 0 ? HOME_STARTED_JOB_REFUND : 1;
    const caps = this.storageCapsOf(playerId);
    for (const key of Object.keys(paid) as ResourceType[]) {
      const value = p.resources[key];
      p.resources[key] = Math.max(value, Math.min(caps[key], value + Math.floor((paid[key] ?? 0) * share)));
    }
  }

  // ---------------- Home raids (Phase 3): isolated snapshot simulation ----------------

  /** Replaces the generated world with the pinned defense snapshot. The raid
   *  never ticks until the first deployment, which happens at tick 0, so a
   *  replay is the same snapshot + deployments at the same ticks. */
  private setupRaid(snapshot: DefenseSnapshot, zone: RaidDeployZone, attacker: number, defender: number, onEnd?: (o: RaidOutcome) => void): void {
    this.buildings.clear();
    this.units.clear();
    this.nodes.clear();
    this.sheep.clear();
    this.grid.tiles.fill(TILE_GRASS);
    this.grid.blocked.fill(0);
    this.navalGrid.blocked.fill(1);
    this.airGrid.blocked.fill(0);
    this.tick = 0;
    for (const id of [attacker, defender]) {
      const p = this.players.get(id);
      if (p) p.cityPath = 'command'; // raid participants are always combat-enabled
    }
    const defenderPlayer = this.players.get(defender);
    if (defenderPlayer) defenderPlayer.age = snapshot.cityLevel;
    let maxId = 0;
    let hubId: number | undefined;
    const scored: number[] = [];
    for (const s of snapshot.buildings) {
      const def = BUILDING_DEFS[s.type];
      const level = Math.max(1, Math.floor(s.level ?? 1));
      this.buildings.set(s.id, {
        id: s.id, owner: defender, type: s.type, tileX: s.tileX, tileY: s.tileY,
        hp: buildingMaxHp(s.type, level), progress: 1, queue: [], ...(level > 1 ? { level } : {}),
      });
      this.blockFootprint(s.tileX, s.tileY, def.size);
      if (s.type !== 'wall') scored.push(s.id);
      if (s.type === 'town_center') hubId = s.id;
      maxId = Math.max(maxId, s.id);
    }
    for (const t of snapshot.trees) {
      this.nodes.set(t.id, { id: t.id, type: 'tree', tileX: t.tileX, tileY: t.tileY, amount: 100 });
      this.grid.blocked[idx(t.tileX, t.tileY, this.grid.size)] = 1;
      maxId = Math.max(maxId, t.id);
    }
    this.nextId = maxId + 1;
    this.knownCompletedBuildings = new Set(this.buildings.keys());
    this.knownUnits = new Set();
    this.recomputePower();
    const empty = this.emptyRaidArmy();
    this.raidSim = {
      attacker, defender, zone, reserve: { ...empty }, initialArmy: { ...empty }, deployed: 0,
      maxTicks: 0, scored, hubId, destruction: 0, stars: 0, hubDestroyed: false, onEnd,
      research: {}, defensePower: Math.max(DEFENSE_POWER_FLOOR, Math.min(1, snapshot.defensePower ?? 1)),
    };
  }

  /** Sends the current state now (the raid does not tick while scouting). */
  pushSnapshot(): void {
    this.broadcastSnapshot();
  }

  /** Advances exactly one fixed tick (headless replays and tests). */
  advance(): void {
    this.step();
  }

  get raidOutcome(): RaidOutcome | undefined {
    return this.raidSim?.outcome;
  }

  get raidDeployed(): number {
    return this.raidSim?.deployed ?? 0;
  }

  setRaidReserve(army: RaidArmy, maxTicks: number, research: Partial<Record<keyof RaidArmy, number>> = {}): void {
    if (!this.raidSim || this.raidSim.deployed > 0) return;
    this.raidSim.reserve = { ...army };
    this.raidSim.initialArmy = { ...army };
    this.raidSim.maxTicks = maxTicks;
    this.raidSim.research = { ...research };
  }

  /** Fractional research gain for an attacking unit type (0 outside raids). */
  private raidGain(type: UnitType): number {
    const r = this.raidSim;
    if (!r || !(type in r.reserve)) return 0;
    return (r.research[type as keyof RaidArmy] ?? 0) * (HOME_UNIT_RESEARCH[type]?.perLevel ?? 0);
  }

  private isRaidAttacker(u: Unit): boolean {
    return this.raidSim !== null && u.owner === this.raidSim.attacker;
  }

  /** Defense range in a raid: +0.5 tile per level, +15% near a Sensor Tower. */
  private raidDefenseRange(b: Building, base: number): number {
    let range = base + 0.5 * ((b.level ?? 1) - 1);
    for (const s of this.buildings.values()) {
      if (s.type !== 'sensor_tower' || s.owner !== b.owner) continue;
      if (Math.hypot(s.tileX - b.tileX, s.tileY - b.tileY) <= 6) { range *= 1.15; break; }
    }
    return range;
  }

  /** Defense damage in a raid: level (+20%/level) × defender grid factor ×
   *  Iron Guardian field on the target (−30% while pulsing). */
  private raidDefenseDamage(b: Building, base: number, target: Unit): number {
    const r = this.raidSim!;
    let dmg = base * levelScale(b.level, 0.2) * r.defensePower;
    if (target.owner === r.attacker && this.inGuardianField(target)) dmg *= 0.7;
    return dmg;
  }

  /** Guardian field: radius 4 and a 4 s pulse every 8 s, both +5%/research level. */
  private inGuardianField(target: Unit): boolean {
    const gain = this.raidGain('iron_guardian');
    if ((this.tick % 80) >= 40 * (1 + gain)) return false;
    const radius = 4 * (1 + gain);
    for (const g of this.units.values()) {
      if (g.type === 'iron_guardian' && g.owner === target.owner && Math.hypot(g.x - target.x, g.y - target.y) <= radius) return true;
    }
    return false;
  }

  /** Attacker damage in a raid, after research (drone damage, fighter vs defenses). */
  private raidAttackFor(u: Unit, base: number, target: Building | undefined): number {
    if (u.type === 'attack_drone') return base * (1 + this.raidGain('attack_drone'));
    if (u.type === 'fighter' && target && DEFENSE_DEFS[target.type]) return base * (1 + this.raidGain('fighter'));
    return base;
  }

  /** Bomber blast and Valkyrie chain arcs after a hit on a building. */
  private raidAfterHit(u: Unit, primary: Building, atk: number): void {
    const size = BUILDING_DEFS[primary.type].size;
    const cx = primary.tileX + size / 2;
    const cy = primary.tileY + size / 2;
    // Distance from the impact point to each footprint's nearest edge, so area
    // effects reach neighbours regardless of building size.
    const others = [...this.buildings.values()]
      .filter((b) => b.owner === primary.owner && b.id !== primary.id)
      .map((b) => {
        const bs = BUILDING_DEFS[b.type].size;
        const nx = Math.max(b.tileX, Math.min(cx, b.tileX + bs));
        const ny = Math.max(b.tileY, Math.min(cy, b.tileY + bs));
        return { b, d: Math.hypot(nx - cx, ny - cy) - size / 2 };
      })
      .sort((a, z) => a.d - z.d || a.b.id - z.b.id);
    if (u.type === 'stealth_bomber') {
      const radius = 2.5 * (1 + this.raidGain('stealth_bomber'));
      for (const { b, d } of others) if (d <= radius) this.damageBuilding(b, atk * 0.5);
    } else if (u.type === 'aegis_valkyrie') {
      const level = this.raidSim?.research.aegis_valkyrie ?? 0;
      const arcs = 2 + Number(level >= 3) + Number(level >= 5);
      const arcDamage = atk * 0.5 * (1 + this.raidGain('aegis_valkyrie'));
      for (const { b } of others.filter((o) => o.d <= 3.5).slice(0, arcs)) this.damageBuilding(b, arcDamage);
    }
  }

  setRaidView(view: HomeRaidView): void {
    if (this.raidSim) this.raidSim.view = view;
  }

  /** Places one reserved unit inside the legal perimeter band. Returns an error
   *  code, or null when the unit is on the field. */
  raidDeploy(type: keyof RaidArmy, x: number, y: number): string | null {
    const r = this.raidSim;
    if (!r || r.outcome) return 'err.raid_over';
    if (!Object.prototype.hasOwnProperty.call(r.reserve, type) || r.reserve[type] < 1) return 'err.raid_no_reserve';
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 'err.raid_perimeter';
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (!inDeployZone(r.zone, tx, ty)) return 'err.raid_perimeter';
    const spot = nearestWalkableTile(this.gridForType(type), tx, ty);
    if (!spot || !inDeployZone(r.zone, spot.x, spot.y)) return 'err.raid_perimeter';
    const u = createUnit(this.nextId++, r.attacker, type, spot.x + 0.5, spot.y + 0.5);
    u.hp = this.unitMaxHp(u);
    this.units.set(u.id, u);
    this.knownUnits.add(u.id);
    r.reserve[type]--;
    r.deployed++;
    const target = this.raidTargetFor(u, r.defender);
    if (target) this.assignAttack(u, target.id);
    return null;
  }

  /** Ends the raid after the next tick; only meaningful once troops are down. */
  raidSurrender(): number | undefined {
    const r = this.raidSim;
    if (!r || r.outcome || r.deployed === 0) return undefined;
    r.surrenderAt ??= this.tick;
    return r.surrenderAt;
  }

  /** Replay entry point: surrender recorded at a known tick. */
  setRaidSurrenderAt(tick: number): void {
    if (this.raidSim && !this.raidSim.outcome) this.raidSim.surrenderAt = tick;
  }

  /** Spec §6.4 target preference per unit type. Lower score wins; ties keep
   *  insertion order, so targeting is deterministic. */
  private raidTargetFor(u: Unit, defender: number): Building | undefined {
    const mine = [...this.buildings.values()].filter((b) => b.owner === defender);
    const center = (b: Building) => {
      const size = BUILDING_DEFS[b.type].size;
      return { x: b.tileX + size / 2, y: b.tileY + size / 2 };
    };
    const dist = (b: Building) => { const c = center(b); return Math.hypot(c.x - u.x, c.y - u.y); };
    const isDefense = (b: Building) => !!DEFENSE_DEFS[b.type] && b.type !== 'town_center';
    const neighbours = (b: Building) => {
      const c = center(b);
      return mine.filter((o) => o !== b && Math.hypot(center(o).x - c.x, center(o).y - c.y) <= 3).length;
    };
    let score: (b: Building) => number;
    switch (u.type) {
      case 'siege_mech': // opens ground routes
        score = (b) => (isDefense(b) || b.type === 'wall' ? 0 : 1000) + dist(b); break;
      case 'rocket_launcher': // suppresses active defenses from standoff range
        score = (b) => (isDefense(b) ? 0 : 1000) + dist(b); break;
      case 'fighter': // strike pass on air-threat defenses
        score = (b) => (b.type === 'anti_air' ? 0 : isDefense(b) ? 500 : 1000) + dist(b); break;
      case 'stealth_bomber': // densest cluster
        score = (b) => -neighbours(b) * 10 + dist(b) * 0.1; break;
      case 'plasma_tank': // high-HP structure nearby
        score = (b) => dist(b) - buildingMaxHp(b.type, b.level) / 150; break;
      case 'iron_guardian': { // the defense currently shooting allies
        const threats = new Set(mine.filter((b) => b.targetId !== undefined && this.units.get(b.targetId)?.owner === u.owner).map((b) => b.id));
        score = (b) => (threats.has(b.id) ? 0 : isDefense(b) ? 500 : 1000) + dist(b); break;
      }
      case 'aegis_valkyrie': // high-value, exposed defense
        score = (b) => (isDefense(b) ? 0 : 1000) + dist(b) * 0.5 - (b.level ?? 1) * 3 + neighbours(b) * 2; break;
      default: // drones and the rest: nearest structure
        score = dist;
    }
    let best: Building | undefined;
    let bestScore = Infinity;
    for (const b of mine) {
      const value = score(b);
      if (value < bestScore) { bestScore = value; best = b; }
    }
    return best;
  }

  private updateRaidSim(): void {
    const r = this.raidSim;
    if (!r || r.outcome || r.deployed === 0) return;
    for (const u of this.units.values()) {
      if (u.owner !== r.attacker || u.state !== 'idle') continue;
      const target = this.raidTargetFor(u, r.defender);
      if (target) this.assignAttack(u, target.id);
    }
    let destroyed = 0;
    for (const id of r.scored) if (!this.buildings.has(id)) destroyed++;
    r.destruction = r.scored.length ? Math.floor((destroyed * 100) / r.scored.length) : 100;
    r.hubDestroyed = r.hubId !== undefined && !this.buildings.has(r.hubId);
    // Independent milestones (spec §6.5): 50%, Hub, 100%.
    r.stars = Number(r.destruction >= 50) + Number(r.hubDestroyed) + Number(r.destruction >= 100);
    let attackers = 0;
    for (const u of this.units.values()) if (u.owner === r.attacker) attackers++;
    const reserve = Object.values(r.reserve).reduce((a, b) => a + b, 0);
    let reason: RaidEndReason | null = null;
    if (r.destruction >= 100) reason = 'destroyed';
    else if (r.surrenderAt !== undefined && this.tick > r.surrenderAt) reason = 'surrender';
    else if (this.tick >= r.maxTicks) reason = 'timer';
    else if (attackers === 0 && reserve === 0) reason = 'eliminated';
    if (!reason) return;
    r.outcome = {
      endTick: this.tick, reason, destruction: r.destruction, stars: r.stars, hubDestroyed: r.hubDestroyed,
      checksum: this.raidChecksum(reason, r),
    };
    this.stop();
    this.broadcastSnapshot();
    r.onEnd?.(r.outcome);
  }

  private raidChecksum(reason: RaidEndReason, r: RaidSim): string {
    const buildings = [...this.buildings.values()].map((b) => [b.id, b.hp]).sort((a, z) => a[0] - z[0]);
    const units = [...this.units.values()]
      .map((u) => [u.id, u.type, u.hp, Math.round(u.x * 1000), Math.round(u.y * 1000)] as const)
      .sort((a, z) => a[0] - z[0]);
    return createHash('sha256')
      .update(JSON.stringify({ tick: this.tick, reason, destruction: r.destruction, stars: r.stars, hub: r.hubDestroyed, buildings, units }))
      .digest('hex');
  }

  private raidSimSnap(): RaidSnap {
    const r = this.raidSim!;
    const view = r.view;
    const phase: RaidPhase = r.outcome ? 'result' : r.deployed > 0 ? 'battle' : view?.state === 'SCOUTING' ? 'scouting' : 'deploying';
    const elapsed = r.deployed > 0 ? this.tick : 0;
    return {
      id: 0, phase, attacker: r.attacker, defender: r.defender,
      army: { ...r.initialArmy }, remaining: { ...r.reserve }, deployed: r.deployed,
      duration: (r.maxTicks * TICK_MS) / 1000,
      secondsLeft: r.outcome ? 0 : Math.max(0, ((r.maxTicks - elapsed) * TICK_MS) / 1000),
      destruction: r.destruction, stars: r.stars,
      loot: view?.report ? { ...view.report.reward } : { energy: 0, alloys: 0, compute: 0 },
      events: [],
      ...(view ? { home: structuredClone(view) } : {}),
    };
  }

  // ---------------- Home side of raids: reservation, return, rewards ----------------

  private homePlayer(): GamePlayer | undefined {
    return [...this.players.values()][0];
  }

  get homeName(): string {
    return this.homePlayer()?.name ?? 'Unknown';
  }

  get homeLevel(): number {
    return this.homePlayer()?.age ?? 1;
  }

  /** Manufactured combat units currently at Home, by type. */
  homeArmy(): RaidArmy {
    const army = this.emptyRaidArmy();
    const p = this.homePlayer();
    for (const u of this.units.values()) {
      if (u.owner === p?.id && u.type in army) army[u.type as keyof RaidArmy]++;
    }
    return army;
  }

  /** Moves the requested units out of Home into a reservation (lowest ids first).
   *  All-or-nothing: returns null without changing anything if any are missing. */
  takeForRaid(army: RaidArmy): Unit[] | null {
    const p = this.homePlayer();
    if (!p) return null;
    const picked: Unit[] = [];
    for (const [type, count] of Object.entries(army) as [keyof RaidArmy, number][]) {
      if (!Number.isInteger(count) || count < 0) return null;
      const pool = [...this.units.values()].filter((u) => u.owner === p.id && u.type === type).sort((a, z) => a.id - z.id);
      if (pool.length < count) return null;
      picked.push(...pool.slice(0, count));
    }
    for (const u of picked) {
      this.units.delete(u.id);
      this.retargetAttackersOf(u.id);
    }
    return picked.map((u) => structuredClone(u));
  }

  /** Puts undeployed reserved units back at Home, docked by a camp. */
  returnFromRaid(units: Unit[]): void {
    const p = this.homePlayer();
    const hub = [...this.buildings.values()].find((b) => b.owner === p?.id && b.type === 'town_center');
    for (const stored of units) {
      if (this.units.has(stored.id)) continue; // already home: returning twice is a no-op
      const u = structuredClone(stored);
      this.clearTasks(u);
      u.state = 'idle';
      const camp = hub ? this.nearestCamp(hub) : null;
      const spot = camp ? this.campDockSpot(camp) : hub ? this.findFreeSpotNear(hub.tileX, hub.tileY, BUILDING_DEFS[hub.type].size) : null;
      if (spot) { u.x = spot.x + 0.5; u.y = spot.y + 0.5; }
      this.units.set(u.id, u);
      this.knownUnits.add(u.id);
    }
  }

  /** Credits a system-funded reward, clamped to storage. Returns what was credited. */
  grantRaidReward(reward: Resources): Resources {
    const p = this.homePlayer();
    const granted: Resources = { energy: 0, alloys: 0, compute: 0 };
    if (!p) return granted;
    const caps = this.storageCapsOf(p.id);
    for (const key of Object.keys(granted) as ResourceType[]) {
      // Whole units only, never past storage; computed directly (stockpiles are fractional).
      const room = Math.max(0, Math.floor(caps[key] - p.resources[key]));
      const credit = Math.min(room, Math.max(0, Math.floor(reward[key] ?? 0)));
      p.resources[key] += credit;
      granted[key] = credit;
    }
    return granted;
  }

  spendHomeGold(amount: number): boolean {
    const p = this.homePlayer();
    if (!p || p.resources.compute < amount) return false;
    p.resources.compute -= amount;
    return true;
  }

  /** Bounded report/settlement bookkeeping shared by every settlement path. */
  recordRaidSettlement(key: string, report: RaidReport): void {
    this.raidData.reports.unshift(report);
    this.raidData.reports.length = Math.min(this.raidData.reports.length, RAID_MAX_REPORTS);
    this.raidData.settled.push(key);
    if (this.raidData.settled.length > RAID_MAX_SETTLED_KEYS) this.raidData.settled.splice(0, this.raidData.settled.length - RAID_MAX_SETTLED_KEYS);
  }

  toPlayerInfos(): PlayerInfo[] {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, team: p.team }));
  }
}

function isWithinGrid(g: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.size && y < g.size;
}

// Tempo de treino: vem de UNIT_DEFS (trainTime), não de BUILDING_DEFS.
const UNIT_TRAIN_TIME: Record<UnitType, number> = {
  villager: UNIT_DEFS.villager.trainTime,
  designer: UNIT_DEFS.designer.trainTime,
  swordsman: UNIT_DEFS.swordsman.trainTime,
  archer: UNIT_DEFS.archer.trainTime,
  knight: UNIT_DEFS.knight.trainTime,
  fishing_boat: UNIT_DEFS.fishing_boat.trainTime,
  war_galley: UNIT_DEFS.war_galley.trainTime,
  transport: UNIT_DEFS.transport.trainTime,
  robot: UNIT_DEFS.robot.trainTime,
  drone: UNIT_DEFS.drone.trainTime,
  attack_drone: UNIT_DEFS.attack_drone.trainTime,
  fighter: UNIT_DEFS.fighter.trainTime,
  rocket_launcher: UNIT_DEFS.rocket_launcher.trainTime,
  siege_mech: UNIT_DEFS.siege_mech.trainTime,
  stealth_bomber: UNIT_DEFS.stealth_bomber.trainTime,
  plasma_tank: UNIT_DEFS.plasma_tank.trainTime,
  iron_guardian: UNIT_DEFS.iron_guardian.trainTime,
  aegis_valkyrie: UNIT_DEFS.aegis_valkyrie.trainTime,
};
