// Tipos de dados compartilhados entre servidor e cliente.
// Convenções:
//  - Posições de unidades são floats em unidades de tile (centro da unidade).
//  - Prédios são ancorados no tile superior-esquerdo e ocupam size x size tiles.
//  - Ids de unidades, prédios e nós de recurso vêm de um contador único
//    (um id nunca se repete entre categorias — comandos usam targetId genérico).

export type ResourceType = 'food' | 'wood' | 'gold' | 'stone';
export type CityPath = 'command' | 'space';
export type UnitType =
  | 'villager' | 'designer' | 'swordsman' | 'archer' | 'knight'
  // Navais (andam SÓ na água; treinadas no Porto):
  | 'fishing_boat' // pesca bancos de peixe e entrega no Porto
  | 'war_galley'   // barco de guerra (ataque à distância)
  | 'transport'    // leva unidades terrestres pelo rio (embarcar/desembarcar)
  // Symbiosis-only automated builders (Robotics Workshop):
  | 'robot'        // ground builder: fast construction, cannot gather
  | 'drone'        // flying builder: crosses water and terrain
  // Symbiosis aerial/strategic attack wing:
  | 'attack_drone' | 'fighter' | 'rocket_launcher'
  | 'siege_mech' | 'stealth_bomber' | 'plasma_tank' | 'iron_guardian';
export type BuildingType =
  | 'town_center'
  | 'house'
  | 'barracks'
  | 'farm'
  | 'archery_range'
  | 'stable'
  | 'blacksmith'
  | 'market'
  | 'wall'
  | 'watch_tower'
  | 'mill'          // depósito de comida
  | 'lumber_camp'   // depósito de madeira
  | 'mining_camp'   // depósito de ouro e pedra
  | 'dock'          // Porto: NA água (costa); deposita peixe e treina barcos
  // Symbiosis-only energy grid and automation:
  | 'solar_array'
  | 'wind_turbine'
  | 'robotics_workshop'
  | 'design_studio'
  | 'data_center'
  | 'elon_vault'
  | 'army_camp'
  | 'drone_factory'
  | 'aerospace_hangar'
  | 'missile_foundry'
  | 'mech_forge'
  | 'exosuit_lab';
export type NodeType = 'tree' | 'berry_bush' | 'gold_mine' | 'stone_mine' | 'fish';

export type Resources = Record<ResourceType, number>;

export type UnitState =
  | 'idle'
  | 'moving'
  | 'movingToGather'
  | 'gathering'
  | 'returning'      // levando recursos ao depósito
  | 'movingToBuild'
  | 'building'
  | 'movingToGarrison' // indo entrar numa torre/Centro (guarnição)
  | 'movingToAttack'
  | 'attacking';

export interface UnitSnap {
  id: number;
  owner: number; // playerId
  type: UnitType;
  x: number;
  y: number;
  hp: number;
  state: UnitState;
  carryType?: ResourceType;
  carryAmount?: number;
  targetId?: number;
  /** Barco de transporte: quantas unidades estão embarcadas. */
  garrison?: number;
}

// progress 0..1 — apenas o primeiro item da fila avança
export interface TrainQueueItem {
  unit: UnitType;
  progress: number;
}

export interface BuildingSnap {
  id: number;
  owner: number;
  type: BuildingType;
  tileX: number; // canto superior-esquerdo
  tileY: number;
  hp: number;
  progress: number; // 0..1 de construção; 1 = concluído
  queue: TrainQueueItem[];
  rallyX?: number;
  rallyY?: number;
  foodLeft?: number; // apenas fazendas concluídas
  /** Pesquisa de tecnologia em andamento neste prédio (id + progresso 0..1). */
  research?: { id: string; progress: number };
  /** Alvo atual (torres de vigia atirando — o cliente desenha a flecha). */
  targetId?: number;
  /** Quantas unidades estão GUARNECIDAS dentro (torre/Centro) — o cliente mostra
   *  a contagem e desenha flechas extras. */
  garrison?: number;
  /** Symbiosis: ledger transaction hash attesting this facility's completion. */
  proof?: string;
}

export interface NodeSnap {
  id: number;
  type: NodeType;
  tileX: number;
  tileY: number;
  amount: number; // recurso restante
}

/** Ovelha (estilo AoE): comida do início de jogo, branca quando selvagem
 *  (owner = -1), tingida da cor do dono quando um jogador a converte
 *  chegando perto. Posição em coordenadas de tile (centro), como as unidades. */
export interface SheepSnap {
  id: number;
  owner: number; // -1 = selvagem (branca)
  x: number;
  y: number;
  food: number; // comida restante
}

export interface PlayerSnap {
  id: number;
  /** AUSENTE pra quem está só ASSISTINDO: o espectador vê a ação, não a
   *  economia. Não é enfeite de tela — o dado não sai do servidor, então nem
   *  um cliente modificado consegue ler o ouro de quem está jogando. */
  resources?: Resources;
  pop: number;
  popCap: number;
  defeated: boolean;
  /** Era atual (1..MAX_AGE). */
  age: number;
  /** Progresso 0..1 da pesquisa da próxima era (ausente se não pesquisando,
   *  e sempre ausente pro espectador). */
  ageProgress?: number;
  /** Level-5 specialization; absent through Symbiotic City (level 4). */
  cityPath?: CityPath;
  /** Path being established while the level-5 research timer runs. */
  pathResearch?: CityPath;
  /** Ids das tecnologias já pesquisadas. Ausente pro espectador. */
  techs?: string[];
  /** Optional non-transferable contribution standing (Symbiosis presentation). */
  elon?: number;
  /** Spendable manufacturing currency, distinct from lifetime contribution standing. */
  elonBalance?: number;
  elonCapacity?: number;
  elonPerMinute?: number;
  armyUsed?: number;
  armyCapacity?: number;
  /** Recent explainable server-authoritative contribution events. */
  elonEvents?: ElonEvent[];
  /** Symbiosis power grid: generation capacity vs. automated-builder draw. */
  power?: PowerSnap;
  /** Live stewardship score (Symbiosis). */
  score?: { stewardship: number; reliabilityPpm: number; bonus: number; score: number };
}

export type RaidPhase = 'idle' | 'scouting' | 'deploying' | 'battle' | 'result' | 'replay';

export interface RaidArmy {
  attack_drone: number;
  fighter: number;
  rocket_launcher: number;
  siege_mech: number;
  stealth_bomber: number;
  plasma_tank: number;
  iron_guardian: number;
}

export interface RaidEvent {
  at: number;
  kind: 'start' | 'deploy' | 'destroy' | 'star' | 'finish';
  label: string;
  x?: number;
  y?: number;
}

/** Server-authoritative Clash-style assault state, visible only to its attacker. */
export interface RaidSnap {
  id: number;
  phase: RaidPhase;
  attacker: number;
  defender: number;
  army: RaidArmy;
  remaining: RaidArmy;
  deployed: number;
  duration: number;
  secondsLeft: number;
  destruction: number;
  stars: number;
  loot: Resources;
  events: RaidEvent[];
}

/** WATT-style stewardship result for one player. */
export interface Standing {
  rank: number;
  playerId: number;
  name: string;
  /** ELON contribution standing (earned by serving needs, labor, ages). */
  standing: number;
  facilities: number;
  /** Completed, still-standing facilities, counted once. */
  stewardship: number;
  /** Share of declared need served, in parts per million. */
  reliabilityPpm: number;
  declaredNeed: number;
  servedNeed: number;
  bonus: number;
  score: number;
}

export interface PowerSnap {
  supply: number;
  draw: number;
}

export type ChainTxKind = 'facility' | 'labor' | 'obligation' | 'energy' | 'need' | 'genesis';

export interface ChainTx {
  hash: string;
  tick: number;
  kind: ChainTxKind;
  playerId: number;
  label: string;
  amount: number;
  block?: number;
}

export interface ChainBlock {
  height: number;
  tick: number;
  hash: string;
  prevHash: string;
  txRoot: string;
  txCount: number;
}

/** Public match ledger summary: a deterministic hash chain sealed by the
 *  authoritative server. Its head is committed on-chain when the match ends. */
export interface ChainSnap {
  height: number;
  head: string;
  pending: number;
  blocks: ChainBlock[];
  txs: ChainTx[];
}

export interface ElonEvent {
  tick: number;
  playerId: number;
  category: 'energy' | 'labor' | 'obligation' | 'need';
  amount: number;
  reason: string;
  sourceId?: number;
}

export interface PlayerInfo {
  id: number;
  name: string;
  color: string;
  team?: number; // 0/ausente = sozinho; 1/2 = time (aliados)
}

export interface MapData {
  size: number;
  // row-major: tiles[y * size + x]; valores TILE_GRASS | TILE_WATER (constants.ts)
  tiles: number[];
}
