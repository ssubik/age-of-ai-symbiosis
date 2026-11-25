// Protocolo WebSocket — mensagens JSON (uma por frame de texto).
// O servidor é autoritativo: o cliente só envia intenções (comandos) e
// renderiza os snapshots que recebe.

import type { MatchCommitment } from './proof-types';
import type { CommanderAutonomy, CommanderPersona, CommanderPolicy, MatchReport, StrategicObjective } from './commander';
import type {
  BuildingSnap,
  ChainSnap,
  Standing,
  BuildingType,
  MapData,
  NodeSnap,
  PlayerInfo,
  PlayerSnap,
  SheepSnap,
  UnitSnap,
  UnitType,
  CityPath,
  HomeStatusSnap,
  HomeLedgerView,
  RaidArmy,
  RaidSnap,
} from './types';

// ---------- Cliente -> Servidor ----------

export type GameCommand =
  // queue=true (Shift): adiciona um WAYPOINT em vez de substituir o destino atual.
  | { kind: 'move'; unitIds: number[]; x: number; y: number; queue?: boolean }
  | { kind: 'stop'; unitIds: number[] }
  // apagar as PRÓPRIAS unidades/prédios selecionados (tecla Delete). Sem reembolso (AoE2).
  | { kind: 'delete'; ids: number[] }
  // reparar um prédio PRÓPRIO pronto e danificado com aldeões (recupera vida gastando recurso)
  | { kind: 'repair'; unitIds: number[]; targetId: number }
  // guarnecer: colocar unidades DENTRO de uma torre/Centro próprio (protege + flechas extras)
  | { kind: 'garrison'; unitIds: number[]; targetId: number }
  // ejetar: tira todas as unidades guarnecidas de volta pro mapa
  | { kind: 'unload'; buildingId: number }
  // targetId: nó de recurso OU fazenda concluída do próprio jogador
  | { kind: 'gather'; unitIds: number[]; targetId: number }
  // colocar um prédio novo, ou (mesmo tile/tipo) designar aldeões a uma obra existente.
  // queue=true (Ctrl/Shift): enfileira a obra em vez de substituir a tarefa atual.
  | { kind: 'build'; unitIds: number[]; building: BuildingType; tileX: number; tileY: number; queue?: boolean }
  | { kind: 'train'; buildingId: number; unit: UnitType }
  | { kind: 'cancelTrain'; buildingId: number; index: number }
  | { kind: 'attack'; unitIds: number[]; targetId: number }
  | { kind: 'setRally'; buildingId: number; x: number; y: number }
  | { kind: 'setCommander'; persona: CommanderPersona; autonomy: CommanderAutonomy }
  | { kind: 'commanderOrder'; objective: StrategicObjective }
  | { kind: 'cancelCommanderOrder' }
  | { kind: 'setCommanderPolicy'; policy: CommanderPolicy }
  // pesquisar a próxima era no Centro da Cidade
  | { kind: 'advanceAge' }
  // Home: physically upgrade a completed building one level (Hub = City Level).
  | { kind: 'upgradeBuilding'; buildingId: number }
  // Home: research the next level of one unit family at the Robotics Workshop.
  | { kind: 'unitResearch'; unit: UnitType }
  | { kind: 'chooseCityPath'; path: CityPath }
  // pesquisar uma tecnologia/upgrade num prédio
  | { kind: 'research'; buildingId: number; techId: string }
  // Mercado: comprar/vender 1 lote (100) de recurso por ouro (requer mercado pronto)
  | { kind: 'trade'; action: 'buy' | 'sell'; resource: 'energy' | 'alloys' }
  | { kind: 'scoutRaid'; defenderId: number }
  | { kind: 'setRaidArmy'; army: RaidArmy }
  | { kind: 'startRaid' }
  | { kind: 'deployRaid'; unit: keyof RaidArmy; x: number; y: number }
  | { kind: 'showRaidReplay' }
  | { kind: 'closeRaid' };

/** Preços do mercado (ouro por lote de 100), compartilhados pela sala. */
export type MarketPrices = Record<'energy' | 'alloys', number>;

/** Modo da partida: 'normal' (economia do zero) ou 'batalha' (recursos de sobra,
 * já numa era avançada — jogo rápido, direto pro combate). */
export type GameMode = 'normal' | 'batalha';

/** Optional presentation/advisory layer. Classic remains the compatibility
 * default when this field is absent (including older servers/clients). */
export type ExperienceMode = 'classic' | 'symbiosis';

/** Terreno do mapa (o "mapa" que o host escolhe):
 *  'classic' = continente com lagos;
 *  'river'   = rio cruzando o mapa COM bancos de areia (travessia a pé) + peixe;
 *  'strait'  = rio dividindo o mapa SEM travessia — só se cruza de barco. */
export type TerrainKind = 'classic' | 'river' | 'strait';

/** Nível de dificuldade de um bot (escolhido ao adicionar na sala). 'easy' =
 * passivo (só se defende); 'expert' = agressivo + bônus de recursos (Titã). */
export type BotDifficulty = 'easy' | 'normal' | 'hard' | 'expert';

/** Persistent-Home raid requests (master spec §9.1). Requests, not facts: the
 *  server validates each against the session state machine. */
export type RaidAction =
  | { kind: 'scout' }
  | { kind: 'scoutBot' }
  | { kind: 'next' }
  | { kind: 'reserve'; army: RaidArmy }
  | { kind: 'deploy'; unit: keyof RaidArmy; x: number; y: number }
  | { kind: 'cancel' }
  | { kind: 'surrender' }
  | { kind: 'return' };

/** City ledger page: open it, settle the playable ELON balance, or retry an anchor. */
export type LedgerAction = { kind: 'open' } | { kind: 'settle' } | { kind: 'anchor'; id: string };

export type ClientMessage =
  | { type: 'setName'; name: string; clientId?: string }
  | { type: 'enterHome' }
  | { type: 'enterArena' }
  // Leave the city for a 1v1 vertical-slice match against a bot opponent.
  | { type: 'startSkirmish'; difficulty?: BotDifficulty; persona?: CommanderPersona; autonomy?: CommanderAutonomy }
  | { type: 'raid'; action: RaidAction }
  | { type: 'ledger'; action: LedgerAction }
  | { type: 'setMode'; mode: GameMode } // apenas host: escolhe Normal/Batalha na sala
  | { type: 'setExperience'; experience: ExperienceMode }
  | { type: 'setFog'; fog: boolean } // apenas host: mapa fechado (névoa) ou aberto
  | { type: 'setTerrain'; terrain: TerrainKind } // apenas host: Clássico ou Rio
  // apenas host: permite que gente de fora ASSISTA a partida. Ligado por padrão;
  // desmarcar fecha a transmissão (e derruba quem já estava assistindo).
  | { type: 'setBroadcast'; on: boolean }
  // entra numa partida EM ANDAMENTO só pra assistir (não joga, não tem vaga)
  | { type: 'spectate'; roomId: string }
  | { type: 'setBotDifficulty'; botId: number; difficulty: BotDifficulty } // apenas host
  | { type: 'listRooms' }
  | { type: 'createRoom' }
  | { type: 'joinRoom'; roomId: string }
  | { type: 'leaveRoom' }
  | { type: 'setReady'; ready: boolean }
  | { type: 'setTeam'; playerId: number; team: number } // apenas host: time da vaga (0 = sozinho, 1/2 = time)
  | { type: 'addBot'; difficulty?: BotDifficulty } // apenas host: adiciona um oponente de IA à sala
  | { type: 'removeBot' } // apenas host: remove o último bot
  | { type: 'startGame' } // apenas host
  | { type: 'chat'; text: string }
  | { type: 'setPause'; paused: boolean } // pausar/despausar a partida (qualquer jogador, tecla P)
  | { type: 'ping'; x: number; y: number } // sinaliza um ponto no minimapa (só aliados veem)
  | { type: 'cmd'; cmd: GameCommand };

// ---------- Servidor -> Cliente ----------

export interface RoomSummary {
  id: string;
  hostName: string; // nome de quem criou a sala (mostrado no lugar do código)
  playerCount: number;
  maxPlayers: number;
  inGame: boolean;
  /** Partida em andamento que aceita espectador → o cliente mostra "Assistir"
   *  no lugar do "Entrar" desabilitado. */
  canSpectate?: boolean;
  /** Quantos estão assistindo agora (mostrado na lista e pros jogadores). */
  spectators?: number;
}

export interface RoomPlayer {
  id: number;
  name: string;
  ready: boolean;
  isHost: boolean;
  color: string;
  isBot?: boolean;
  difficulty?: BotDifficulty; // só bots
  team?: number; // 0/ausente = sozinho (cada um por si); 1/2 = time
}

export type ServerMessage =
  | { type: 'ledger'; view: HomeLedgerView }
  | { type: 'welcome'; playerId: number }
  | { type: 'nameOk' }              // nome aceito -> pode ir pro lobby
  | { type: 'nameTaken' }           // nome já em uso -> escolha outro
  | { type: 'roomList'; rooms: RoomSummary[] }
  | { type: 'roomState'; roomId: string; players: RoomPlayer[]; mode: GameMode; fog: boolean; terrain: TerrainKind; broadcast: boolean; experience?: ExperienceMode }
  | { type: 'leftRoom' }
  // Erro: o servidor manda um CÓDIGO (traduzido no cliente via i18n) + params
  // opcionais. `age` (número) e `building` (tipo) são convertidos para o nome
  // no idioma do jogador pelo cliente. `message` é reserva (texto pronto).
  | { type: 'error'; code: string; params?: Record<string, string | number>; message?: string }
  | { type: 'chat'; from: string; text: string }
  // `spectating`: você entrou só pra ASSISTIR — não tem vaga nem unidades, e
  // `you` não corresponde a jogador nenhum (o cliente usa isso pra revelar o
  // mapa e esconder os painéis de comando).
  | { type: 'gameStart'; map: MapData; players: PlayerInfo[]; you: number; fog: boolean; spectating?: boolean; experience?: ExperienceMode; session?: 'arena' | 'home' | 'raid' }
  | {
      type: 'snapshot';
      tick: number;
      units: UnitSnap[];
      buildings: BuildingSnap[];
      nodes: NodeSnap[];
      sheep: SheepSnap[];
      players: PlayerSnap[];
      /** Preços do mercado (ouro por lote de 100) — globais da sala.
       *  Ausente pro espectador (é informação de economia). */
      market?: MarketPrices;
      /** Quantos estão assistindo. Vai só pros JOGADORES, pra ninguém ser
       *  observado sem saber. */
      spectators?: number;
      /** Symbiosis: public match-ledger summary (hash chain head + recent activity). */
      chain?: ChainSnap;
      /** Attacker-only asynchronous-assault lifecycle and retained replay. */
      raid?: RaidSnap;
      /** Present only for persistent Home sessions. */
      home?: HomeStatusSnap;
    }
  // Acabou o que se estava assistindo. NÃO tira o espectador da tela na força:
  // ele vê o que aconteceu e decide se continua olhando o tabuleiro final ou se
  // volta pro lobby (era o buraco: quando o último humano desistia, a sala era
  // apagada e quem assistia ficava congelado pra sempre, sem aviso nenhum).
  //   'gameOver'    — a partida terminou normalmente (`winnerName` = quem ganhou)
  //   'surrendered' — `who` desistiu e por isso a partida acabou
  //   'closed'      — o host fechou a transmissão (a partida pode seguir)
  | { type: 'spectateEnded'; reason: 'closed' | 'gameOver' | 'surrendered'; winnerName?: string; who?: string }
  // `won` (opcional) diz se VOCÊ venceu — necessário em times (vitória em dupla).
  | { type: 'gameOver'; winner: number; winnerName: string; won?: boolean; contributions?: { playerId: number; name: string; elon: number }[]; standings?: Standing[]; /** Developer shortcuts were used: scores are not comparable. */ dev?: boolean; /** Post-battle intelligence (arena matches). */ report?: MatchReport }
  // Partida pausada/retomada (para TODOS da sala). `by` = quem mexeu (mostra na tela).
  | { type: 'gamePaused'; paused: boolean; by: string }
  // Sinalização no minimapa (só chega aos ALIADOS do autor). `color` = cor do autor.
  | { type: 'ping'; x: number; y: number; color: string }
  // Developer tools: center this player's camera on a world point.
  | { type: 'focus'; x: number; y: number }
  // Symbiosis: the finished match's archive/ledger commitment and its chain receipt.
  | { type: 'matchProof'; proof: MatchCommitment };
