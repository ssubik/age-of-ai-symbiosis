// Tela 4: Jogo — canvas fullscreen + HUD, câmera, input e renderização.

import type { BuildingType, Resources, CommanderAutonomy, CommanderPersona, CommanderPolicy, CommanderView, ExperienceMode, GameCommand, MapData, PlayerInfo, RaidAction, RaidArmy, ResourceType, StrategicObjective, UnitType } from '@age/shared';
import { AGE_COSTS, AGE_NAMES, LAYER_GATE, layerGateMet, BUILDING_DEFS, DEFENSE_DEFS, UNIT_DEFS, MAX_AGE, SYMBIOSIS_COMBAT_UNITS, TICK_RATE, buildingsToAdvance, countsForAgeUp, isBuilderUnit } from '@age/shared';
import { COMMANDER_INFO, OBJECTIVE_LABEL, OUTCOME_LABEL, clock, type CommanderPanel } from '../game/commanderui';
import { GameState } from '../state';
import { el } from '../ui';
import { BUILDING_NAMES, RESOURCE_NAMES, t, UNIT_NAMES } from '../i18n';
import { Camera } from '../game/camera';
import { Hud, type HudDeps } from '../game/hud';
import { GameInput } from '../game/input';
import { Sfx } from '../game/audio';
import { music } from '../music';
import { settings } from '../settings';
import { Minimap } from '../game/minimap';
import { Renderer } from '../game/renderer';
import { createUIState } from '../game/uistate';
import { ConnLostOverlay } from './connlost';
import { recommend } from '../game/advisor';

const RAID_UNIT_TYPES: readonly (keyof RaidArmy)[] = ['attack_drone', 'fighter', 'rocket_launcher', 'siege_mech', 'stealth_bomber', 'plasma_tank', 'iron_guardian', 'aegis_valkyrie'];

export interface GameScreenDeps {
  onCommand: (cmd: GameCommand) => void;
  onChat: (text: string) => void;
  onTogglePause: () => void;
  onPing: (x: number, y: number) => void;
  onBackToLobby: () => void;
  /** Opens the city ledger page (activity log and ELON settlement). */
  onOpenLedger?: () => void;
  /** Home: open the skirmish launcher. */
  onSkirmish?: () => void;
  /** Persistent-Home raid requests (Home and raid sessions only). */
  onRaid?: (action: RaidAction) => void;
}

export class GameScreen {
  readonly el: HTMLElement;
  readonly state: GameState;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private cam: Camera;
  private renderer: Renderer;
  private minimap: Minimap;
  private hud!: Hud;
  private hudDeps!: HudDeps;
  private input: GameInput;
  private connLost: ConnLostOverlay;
  private pauseOverlay!: HTMLElement;
  private pauseBy!: HTMLElement;
  /** "👁 N assistindo" — só existe pra quem JOGA. */
  private watchBadge: HTMLElement | null = null;
  /** Aviso de derrota com a partida ainda rolando (Assistir / Sair). */
  private defeatOverlay: HTMLElement | null = null;
  private avisouDerrota = false;
  /** Aviso de "acabou o que você assistia" (Continuar olhando / Voltar). */
  private specEndOverlay: HTMLElement | null = null;
  private councilText: HTMLElement | null = null;
  private councilLastId = '';
  private commanderPanel: CommanderPanel | null = null;
  private commanderTarget: number | undefined;
  private commanderPolicyEditedAt = 0;
  private elonValue: HTMLElement | null = null;
  private elonScore: HTMLElement | null = null;
  private chainHeight: HTMLElement | null = null;
  private chainHead: HTMLElement | null = null;
  private chainFeed: HTMLElement | null = null;
  private chainSig = '';
  private raidPanel: HTMLElement | null = null;
  private raidSig = '';
  private raidDeploy: keyof import('@age/shared').RaidArmy | null = null;
  private raidDraft: import('@age/shared').RaidArmy = { attack_drone: 0, fighter: 0, rocket_launcher: 0, siege_mech: 0, stealth_bomber: 0, plasma_tank: 0, iron_guardian: 0, aegis_valkyrie: 0 };
  private raidOpen = false;
  private raidDraftKey = '';
  private attackBtn: HTMLButtonElement | null = null;
  private goalPanel: HTMLElement | null = null;
  private homeBadge: HTMLElement | null = null;
  private guideEl: HTMLElement | null = null;
  private guideSig = '';
  private guideCollapsed = false;
  private goalSig = '';
  private productionCycle = 0;

  private rafId = 0;
  private resizeObserver: ResizeObserver | null = null;
  private didCenter = false;
  private sfx = new Sfx();
  private renderScale = settings.renderScale; // qualidade/desempenho (menu de opções)
  private sndAge = 1;
  private sndTechs = 0;
  private sndUnits = -1;
  private sndCombatAt = 0;
  private lastBaseAlertAt = -Infinity;
  private nextOwl = 0;
  private nextWorkSound = 0;
  private workListenX = Number.NaN;
  private workListenY = Number.NaN;
  private workListenSince = 0;

  /** Só ASSISTINDO: sem vaga, sem unidades, sem comando. O controle já é inerte
   *  por si (nada é "meu"), então isto serve pra ARRUMAR A TELA — revelar o mapa
   *  e esconder painéis que ficariam vazios pra sempre. */
  private readonly spectating: boolean;
  /** Estou só assistindo? (o main usa pra não dizer "você desistiu" a quem
   *  nunca esteve jogando.) */
  get isSpectating(): boolean { return this.spectating; }

  constructor(map: MapData, players: PlayerInfo[], you: number, private deps: GameScreenDeps, fogEnabled = false, spectating = false, private experience: ExperienceMode = 'symbiosis', private session: 'arena' | 'home' | 'raid' = 'arena') {
    this.spectating = spectating;
    // Espectador vê o mapa todo (é o ponto de assistir) — a névoa é desligada.
    this.state = new GameState(map, players, you, spectating ? false : fogEnabled);
    const gs = this.state;

    this.el = el('div', 'screen');
    if (spectating) this.el.classList.add('spectating');
    this.el.style.cursor = 'default';
    const root = el('div', 'game-atlas');
    root.id = 'game-root';

    if (session === 'raid') {
      this.el.classList.add('raid-mode');
      this.raidOpen = true;
    }
    if (session === 'home') {
      this.el.classList.add('home-mode');
      // City status chip (level, development, grid) beside a Ledger button.
      const bar = el('div', 'home-status');
      this.homeBadge = el('span', 'home-status-text', 'City L1');
      const ledger = el('button', 'home-ledger-btn', '⛓ Ledger');
      ledger.title = 'Open the city ledger: activity log and ELON settlement';
      ledger.addEventListener('click', () => this.deps.onOpenLedger?.());
      const skirmish = el('button', 'home-ledger-btn home-skirmish-btn', '⚔ Skirmish');
      skirmish.title = 'Leave the city for a 1v1 match with your AI commander (your city is saved)';
      skirmish.addEventListener('click', () => this.deps.onSkirmish?.());
      bar.append(this.homeBadge, ledger, skirmish);
      root.appendChild(bar);
      this.guideEl = el('aside', 'city-guide');
      this.guideEl.setAttribute('aria-label', 'City guide');
      try { this.guideCollapsed = localStorage.getItem('ageofai:guideCollapsed') === '1'; } catch { /* storage blocked */ }
      root.appendChild(this.guideEl);
    }

    this.canvas = el('canvas');
    this.canvas.id = 'game-canvas';
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.cam = new Camera(map.size);

    this.hudDeps = {
      onBuild: (type) => this.input.startPlacement(type),
      onTrain: (buildingId, unit) => this.deps.onCommand({ kind: 'train', buildingId, unit }),
      onCancelTrain: (buildingId, index) => this.deps.onCommand({ kind: 'cancelTrain', buildingId, index }),
      onAdvanceAge: () => this.deps.onCommand({ kind: 'advanceAge' }),
      onChooseCityPath: (path) => this.deps.onCommand({ kind: 'chooseCityPath', path }),
      onResearch: (buildingId, techId) => this.deps.onCommand({ kind: 'research', buildingId, techId }),
      onTrade: (action, resource) => this.deps.onCommand({ kind: 'trade', action, resource }),
      onChat: (text) => this.deps.onChat(text),
      onIdleVillager: () => this.selectNextIdleVillager(),
      onUnload: (id) => this.deps.onCommand({ kind: 'unload', buildingId: id }),
      getPlacement: () => this.input.ui.placement,
      onUpgrade: (buildingId) => this.deps.onCommand({ kind: 'upgradeBuilding', buildingId }),
      onUnitResearch: (unit) => this.deps.onCommand({ kind: 'unitResearch', unit }),
    };
    this.createHud();
    root.appendChild(this.hud.el);

    if (experience === 'symbiosis' && !spectating) {
      this.el.classList.add('symbiosis-mode');
      const council = el('aside', 'council-panel commander-panel');
      const head = el('button', 'council-head');
      head.appendChild(el('span', 'council-dot'));
      head.appendChild(el('span', '', 'AI COMMANDER'));
      head.appendChild(el('span', 'council-chevron', '▾'));
      this.councilText = el('div', 'council-text', t('council.waiting'));
      head.addEventListener('click', () => council.classList.toggle('collapsed'));
      // On phones the battlefield comes first: the commander opens on demand.
      if (window.matchMedia?.('(max-width: 620px)').matches) council.classList.add('collapsed');
      council.appendChild(head);
      council.appendChild(this.councilText);
      const rail = el('div', 'sym-rail');
      rail.appendChild(council);
      root.appendChild(rail);
      const contribution = el('div', 'elon-panel');
      contribution.appendChild(el('span', 'elon-label', 'IMPACT'));
      this.elonValue = el('strong', '', '0');
      contribution.appendChild(this.elonValue);
      this.elonScore = el('span', 'elon-score', '');
      contribution.appendChild(this.elonScore);
      contribution.title = t('elon.explain');
      root.appendChild(contribution);

      const ledger = el('aside', 'chain-panel collapsed');
      ledger.title = t('chain.explain');
      const lhead = el('button', 'chain-head');
      lhead.appendChild(el('span', 'chain-eyebrow', t('chain.title')));
      this.chainHeight = el('strong', 'chain-height', t('chain.block', { n: 0 }));
      lhead.appendChild(this.chainHeight);
      lhead.addEventListener('click', () => ledger.classList.toggle('collapsed'));
      ledger.appendChild(lhead);
      this.chainHead = el('div', 'chain-hash', '');
      ledger.appendChild(this.chainHead);
      this.chainFeed = el('ol', 'chain-feed');
      ledger.appendChild(this.chainFeed);
      rail.appendChild(ledger);
    }

    this.minimap = new Minimap(gs, this.cam, {
      onOrderMove: (wx, wy, queue) => this.input.orderMoveTo(wx, wy, queue),
      onSelectArmy: () => this.selectAllMilitary(),
      onCenterHome: () => this.centerOnHome(),
      onIdleVillager: () => this.selectNextIdleVillager(),
      onPing: (wx, wy) => this.deps.onPing(wx, wy),
    });
    this.hud.minimapSlot.appendChild(this.minimap.el);

    this.connLost = new ConnLostOverlay({ onBackToLobby: () => this.deps.onBackToLobby() });
    root.appendChild(this.connLost.el);

    // Overlay de PAUSA (aparece pra todos quando alguém aperta P).
    this.pauseOverlay = el('div', 'pause-overlay so-aviso hidden');
    const pbox = el('div', 'pause-box');
    pbox.appendChild(el('div', 'pause-title', t('pause.title')));
    this.pauseBy = el('div', 'pause-by', '');
    pbox.appendChild(this.pauseBy);
    pbox.appendChild(el('div', 'pause-hint', t('pause.hint')));
    this.pauseOverlay.appendChild(pbox);
    root.appendChild(this.pauseOverlay);

    // DERROTA com a partida CONTINUANDO (ex.: 3 jogadores e você caiu primeiro).
    // Antes o cliente ignorava a própria derrota: o jogador ficava olhando uma
    // tela onde não tinha mais nada, sem saber que já tinha perdido, até a
    // partida acabar. Agora avisa e deixa escolher: fica vendo o resto, ou sai.
    if (!spectating) {
      this.defeatOverlay = el('div', 'pause-overlay hidden');
      const dbox = el('div', 'pause-box');
      dbox.appendChild(el('div', 'pause-title', t('defeat.title')));
      dbox.appendChild(el('div', 'pause-by', t('defeat.desc')));
      const acoes = el('div', 'defeat-actions');
      const bVer = el('button', 'btn primary', t('defeat.watch'));
      bVer.addEventListener('click', () => {
        this.defeatOverlay?.classList.add('hidden');
        // Vira espectador da própria partida: revela o mapa e esconde os painéis
        // (ele não tem mais unidade nem recurso — ficariam zerados na tela).
        this.state.fog.revealAll();
        this.el.classList.add('spectating');
      });
      const bSair = el('button', 'btn', t('defeat.leave'));
      bSair.addEventListener('click', () => this.deps.onBackToLobby());
      acoes.appendChild(bVer);
      acoes.appendChild(bSair);
      dbox.appendChild(acoes);
      this.defeatOverlay.appendChild(dbox);
      root.appendChild(this.defeatOverlay);
    }

    // ESPECTADOR: faixa dizendo que ele está só assistindo (no lugar da barra de
    // recursos, que o CSS esconde — ela mostraria 0/0 pra quem não é jogador).
    if (spectating) {
      const faixa = el('div', 'spectator-banner');
      faixa.appendChild(el('span', 'eye', '👁'));
      faixa.appendChild(el('span', '', t('spec.watching')));
      const nomes = players.map((p) => p.name).join('  ·  ');
      if (nomes) faixa.appendChild(el('span', 'who', nomes));
      root.appendChild(faixa);
    } else {
      // JOGADOR: aviso de quantos estão olhando. Ninguém deve ser observado sem
      // saber — mesmo que o espectador não veja os recursos.
      this.watchBadge = el('div', 'watch-badge hidden');
      root.appendChild(this.watchBadge);
    }

    this.renderer = new Renderer(gs);

    const uiState = createUIState();
    this.input = new GameInput(this.canvas, this.cam, gs, uiState, {
      onCommand: (cmd) => this.deps.onCommand(cmd),
      onBuildCommand: (type, tileX, tileY, unitIds, queue) => {
        this.deps.onCommand({ kind: 'build', unitIds, building: type, tileX, tileY, queue });
      },
      onCenterHome: () => this.centerOnHome(),
      onIdleVillager: (all) => all ? this.selectAllIdleVillagers() : this.selectNextIdleVillager(),
      onTogglePause: () => this.deps.onTogglePause(),
      isChatOpen: () => this.hud.isChatOpen(),
      openChat: () => this.hud.openChat(),
    }, this.sfx);

    if (!spectating) {
      this.goalPanel = el('button', `goal-panel${experience === 'symbiosis' ? ' below-impact' : ''}`);
      this.goalPanel.addEventListener('click', () => this.selectTownCenter());
      root.appendChild(this.goalPanel);
    }

    if (experience === 'symbiosis' && !spectating) {
      this.raidPanel = el('aside', 'raid-panel');
      root.appendChild(this.raidPanel);
      this.canvas.addEventListener('mousedown', this.onRaidDeploy, true);
      root.appendChild(this.createQuickDock());
    }

    // primeiro gesto do usuário destrava o áudio no navegador (SFX e trilha)
    this.canvas.addEventListener('mousedown', () => { this.sfx.resume(); music.unlock(); }, { once: true });
    // carrega os arquivos de som presentes em /public/sounds/ (ausentes usam reserva)
    this.sfx.setVolume(settings.sfxVol); // aplica o volume salvo no menu de opções
    void this.sfx.preload();

    this.el.appendChild(root);
    this.setupResize(root);

    const tc = gs.myTownCenter();
    if (tc) {
      const size = BUILDING_DEFS.town_center.size;
      this.cam.centerOn(tc.tileX + size / 2, tc.tileY + size / 2);
    } else {
      this.cam.centerOn(map.size / 2, map.size / 2);
    }

    this.startLoop();
  }

  /** Mostra/esconde o overlay de PAUSA e bloqueia o input do jogo enquanto pausado. */
  setPaused(paused: boolean, by: string): void {
    this.pauseOverlay.classList.toggle('hidden', !paused);
    this.pauseBy.textContent = paused && by ? t('pause.by', { name: by }) : '';
    this.input.setPaused(paused);
  }

  /** (Re)cria o HUD com os deps atuais + o som de clique dos botões. */
  private createHud(): void {
    this.hud = new Hud(this.state, this.hudDeps, this.experience === 'symbiosis');
    // clique nos botões do HUD => som de UI (delegado)
    this.hud.el.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement)?.closest('button')) this.sfx.uiClick();
    });
  }

  /** Troca de idioma no meio da partida: reconstrói o HUD (que monta texto no
   *  construtor) já no novo idioma, SEM recarregar — canvas, câmera, estado e
   *  conexão continuam. O minimapa mora no slot do HUD, então é re-anexado. */
  retranslate(): void {
    const old = this.hud.el;
    this.createHud();
    old.replaceWith(this.hud.el);
    this.hud.minimapSlot.appendChild(this.minimap.el);
  }

  private setupResize(root: HTMLElement): void {
    const resize = (): void => {
      const rect = root.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      // backing store escalado pela resolução escolhida (75%/50% = mais leve);
      // o CSS size e o viewport da câmera ficam em px reais (input/pick/HUD intactos).
      this.canvas.width = Math.round(w * dpr * this.renderScale);
      this.canvas.height = Math.round(h * dpr * this.renderScale);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      this.cam.setViewport(w, h);
    };
    resize();
    // no construtor o elemento ainda não está no DOM (mede 0x0) — remede após o mount
    setTimeout(resize, 0);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(resize);
      this.resizeObserver.observe(root);
    }
    window.addEventListener('resize', resize);
    this.onWindowResize = resize;
  }

  private onWindowResize: (() => void) | null = null;

  private centerOnHome(): void {
    // In a raid, "home" for the camera is the enemy Hub at the centre of the snapshot.
    const tc = this.session === 'raid'
      ? [...this.state.buildings.values()].find((b) => b.type === 'town_center')
      : this.state.myTownCenter();
    if (!tc) return;
    const size = BUILDING_DEFS.town_center.size;
    this.cam.centerOn(tc.tileX + size / 2, tc.tileY + size / 2);
  }

  /** Selects and centres the player's first completed building of a type. */
  private selectOwnBuilding(type: BuildingType): boolean {
    const b = [...this.state.buildings.values()].find((x) => x.owner === this.state.you && x.type === type && (x.progress ?? 1) >= 1);
    if (!b) return false;
    const size = BUILDING_DEFS[b.type].size;
    this.state.selection.clear();
    this.state.selection.add(b.id);
    this.cam.centerOn(b.tileX + size / 2, b.tileY + size / 2);
    return true;
  }

  /** First-session guide. Every step is derived from authoritative state, so
   *  it resumes after a reload and never disagrees with the city. */
  private guideSteps(): { title: string; hint: string; done: boolean; show: () => void }[] {
    const me = this.state.me();
    const home = this.state.home;
    const has = (type: BuildingType) => [...this.state.buildings.values()].some((b) => b.owner === this.state.you && b.type === type && (b.progress ?? 1) >= 1);
    const build = (type: BuildingType) => () => { this.openBuildFlow(); this.input.startPlacement(type); };
    const level = me?.age ?? 1;
    return [
      { title: 'Power the grid', hint: 'Place a Solar Field on an empty plot. Roads stay clear.', done: has('solar_array') || has('wind_turbine'), show: build('solar_array') },
      { title: 'Build a Robotics Workshop', hint: 'It trains builders and runs unit research.', done: has('robotics_workshop'), show: build('robotics_workshop') },
      { title: 'Reach City Level 2', hint: 'Select the Civic Hub and upgrade it once its checklist is complete.', done: level >= 2, show: () => this.selectTownCenter() },
      { title: 'Build a Drone Factory', hint: 'Your first weapons plant.', done: has('drone_factory'), show: build('drone_factory') },
      { title: 'Build an Army Camp', hint: 'Finished units dock here; a full camp pauses the factory.', done: has('army_camp'), show: build('army_camp') },
      { title: 'Manufacture an Attack Drone', hint: 'Select the Drone Factory and queue a drone.', done: [...this.state.units.values()].some((u) => u.owner === this.state.you && u.type === 'attack_drone') || !!home?.lastReport, show: () => { this.selectOwnBuilding('drone_factory'); } },
      { title: 'Raid a base', hint: 'Open Attack, scout a base, reserve your drones and deploy them in the cyan band.', done: !!home?.lastReport, show: () => { this.raidOpen = true; this.raidSig = ''; } },
      { title: 'Research Attack Drone', hint: 'Select the Robotics Workshop and start drone research.', done: (home?.research.attack_drone ?? 0) >= 1, show: () => { this.selectOwnBuilding('robotics_workshop'); } },
      { title: 'Settle ELON', hint: 'Open the ledger and settle your ELON into a sealed block.', done: (home?.elonSettled ?? 0) > 0, show: () => this.deps.onOpenLedger?.() },
    ];
  }

  private updateGuide(): void {
    const box = this.guideEl;
    if (!box || !this.state.home) return;
    const steps = this.guideSteps();
    const doneCount = steps.filter((x) => x.done).length;
    const current = steps.find((x) => !x.done);
    const sig = `${doneCount}:${current?.title}:${this.guideCollapsed}`;
    if (sig === this.guideSig) return;
    this.guideSig = sig;
    box.innerHTML = '';
    box.classList.toggle('collapsed', this.guideCollapsed || !current);
    const toggle = (collapsed: boolean) => {
      this.guideCollapsed = collapsed;
      try { localStorage.setItem('ageofai:guideCollapsed', collapsed ? '1' : '0'); } catch { /* storage blocked */ }
      this.guideSig = '';
    };
    if (!current) {
      box.appendChild(el('span', 'city-guide-done', '✓ City guide complete'));
      return;
    }
    if (this.guideCollapsed) {
      const open = el('button', 'city-guide-pill', `Guide · ${doneCount}/${steps.length}`);
      open.addEventListener('click', () => toggle(false));
      box.appendChild(open);
      return;
    }
    const head = el('div', 'city-guide-head');
    head.appendChild(el('span', 'city-guide-kicker', `City guide · ${doneCount + 1} of ${steps.length}`));
    const hide = el('button', 'city-guide-hide', 'Hide');
    hide.setAttribute('aria-label', 'Hide the city guide');
    hide.addEventListener('click', () => toggle(true));
    head.appendChild(hide);
    box.appendChild(head);
    const bar = el('div', 'city-guide-bar');
    const fill = el('div', 'city-guide-fill');
    fill.style.width = `${(doneCount / steps.length) * 100}%`;
    bar.appendChild(fill);
    box.appendChild(bar);
    box.appendChild(el('strong', 'city-guide-title', current.title));
    box.appendChild(el('p', 'city-guide-hint', current.hint));
    const show = el('button', 'city-guide-show', 'Show me');
    show.addEventListener('click', () => current.show());
    box.appendChild(show);
  }

  private selectTownCenter(): void {
    const tc = this.state.myTownCenter();
    if (!tc) return;
    this.state.selection.clear();
    this.state.selection.add(tc.id);
    this.centerOnHome();
  }

  /** "Next level" tracker: what is still missing to advance, always visible,
   *  so nobody has to discover the age-up rule inside the Civic Hub panel. */
  private updateGoal(): void {
    const panel = this.goalPanel;
    const me = this.state.me();
    if (!panel || !me) return;
    if (this.state.home) { panel.classList.add('hidden'); return; }
    const age = me.age;
    if (age >= MAX_AGE || me.cityPath) {
      panel.classList.add('hidden');
      return;
    }
    const need = buildingsToAdvance(age);
    const have = new Set<BuildingType>();
    for (const b of this.state.buildings.values()) {
      if (b.owner === this.state.you && b.progress >= 1 && countsForAgeUp(b.type, age)) have.add(b.type);
    }
    const cost = AGE_COSTS[age + 1] ?? {};
    const res = (Object.entries(cost) as [ResourceType, number][]).map(([r, n]) => {
      const owned = Math.floor(me.resources?.[r] ?? 0);
      return { r, n, ok: owned >= n, have: owned };
    });
    const researching = me.ageProgress !== undefined;
    const completed: BuildingType[] = [];
    for (const b of this.state.buildings.values()) if (b.owner === this.state.you && b.progress >= 1) completed.push(b.type);
    const layerOk = layerGateMet(age, completed);
    const ready = have.size >= need && layerOk && res.every((x) => x.ok);
    const sig = `${age}:${researching ? Math.round((me.ageProgress ?? 0) * 100) : -1}:${have.size}:${layerOk}:${res.map((x) => `${x.have >= x.n ? 'y' : x.have}`).join(',')}`;
    if (sig === this.goalSig) return;
    this.goalSig = sig;
    panel.classList.remove('hidden');
    panel.classList.toggle('ready', ready && !researching);
    panel.innerHTML = '';
    panel.appendChild(el('div', 'goal-eyebrow', `${t('goal.title')} · ${AGE_NAMES[age + 1]}`));
    if (researching) {
      const pct = Math.round((me.ageProgress ?? 0) * 100);
      panel.appendChild(el('div', 'goal-line', t('goal.researching', { age: AGE_NAMES[age + 1], pct })));
      const bar = el('div', 'goal-bar');
      const fill = el('div', 'goal-fill');
      fill.style.width = `${pct}%`;
      bar.appendChild(fill);
      panel.appendChild(bar);
      return;
    }
    const symbiosis = this.experience === 'symbiosis';
    const options = (Object.keys(BUILDING_DEFS) as BuildingType[])
      .filter((type) => countsForAgeUp(type, age) && (symbiosis || !BUILDING_DEFS[type].symbiosis) && !have.has(type))
      .slice(0, 3)
      .map((type) => BUILDING_NAMES[type] ?? type);
    const step = (ok: boolean, text: string, sub?: string): void => {
      const row = el('div', `goal-line${ok ? ' done' : ''}`);
      row.appendChild(el('span', 'goal-check', ok ? '✓' : '○'));
      const body = el('span', '', text);
      if (sub && !ok) body.appendChild(el('small', '', sub));
      row.appendChild(body);
      panel.appendChild(row);
    };
    const gate = LAYER_GATE[age];
    if (gate) step(layerOk, t('goal.layer', { building: gate.map((type) => BUILDING_NAMES[type] ?? type).join(' / ') }), t(`goal.layer_why.${age}`));
    step(have.size >= need, t(need > 1 ? 'goal.build_many' : 'goal.build_one', { need, have: Math.min(have.size, need) }), options.length ? t('goal.examples', { list: options.join(', ') }) : undefined);
    for (const x of res) {
      const name = RESOURCE_NAMES[x.r];
      step(x.ok, `${name.charAt(0).toUpperCase()}${name.slice(1)} ${Math.min(x.have, x.n)}/${x.n}`);
    }
    if (ready) panel.appendChild(el('div', 'goal-cta', t('goal.ready')));
  }

  private createQuickDock(): HTMLElement {
    const dock = el('nav', 'quick-dock');
    const add = (icon: string, label: string, action: () => void, accent = false): HTMLButtonElement => {
      const button = el('button', `quick-action${accent ? ' accent' : ''}`);
      button.appendChild(el('span', 'quick-icon', icon));
      button.appendChild(el('span', 'quick-label', label));
      button.addEventListener('click', action);
      dock.appendChild(button);
      return button;
    };
    add('⌂', 'Home', () => this.centerOnHome());
    add('＋', 'Build', () => this.openBuildFlow(), true);
    add('⚙', 'Produce', () => this.openProductionFlow());
    add('✦', 'Army', () => this.selectAllMilitary());
    if (this.session === 'arena') {
      // Skirmish: a strategic order — the commander assaults the enemy Command Core.
      this.attackBtn = add('➤', 'Assault', () => this.orderAssault());
      this.attackBtn.title = 'Order your commander to assault the enemy Command Core';
      return dock;
    }
    // highlighted only once raids are unlocked (level 5 Command Metropolis)
    this.attackBtn = add('➤', 'Attack', () => { this.raidOpen = !this.raidOpen; this.raidSig = ''; });
    this.attackBtn.title = 'Raids unlock at level 5 with a Command Metropolis';
    return dock;
  }

  /** Centers the camera on a world point (developer tools). */
  focus(x: number, y: number): void {
    this.cam.centerOn(x, y);
  }

  private orderAssault(): void {
    const mine = this.state.myTownCenter();
    let target: { id: number; d: number } | undefined;
    for (const b of this.state.buildings.values()) {
      if (b.type !== 'town_center' || b.owner === this.state.you || this.state.alliedOwners.has(b.owner)) continue;
      const d = mine ? Math.hypot(b.tileX - mine.tileX, b.tileY - mine.tileY) : 0;
      if (!target || d < target.d) target = { id: b.id, d };
    }
    if (target) this.deps.onCommand({ kind: 'commanderOrder', objective: { kind: 'attack_target', targetId: target.id } });
  }

  private openBuildFlow(): void {
    const builders = [...this.state.units.values()]
      .filter((u) => u.owner === this.state.you && isBuilderUnit(u.type))
      .sort((a, b) => Number(a.state !== 'idle') - Number(b.state !== 'idle') || a.id - b.id);
    const builder = builders[0];
    if (!builder) return;
    this.state.selection.clear();
    this.state.selection.add(builder.id);
    const pos = this.state.unitPos(builder, performance.now());
    this.cam.centerOn(pos.x, pos.y);
    this.sfx.selectUnit(builder.type);
  }

  /** Repeated taps cycle through production buildings, like a compact factory drawer. */
  private openProductionFlow(): void {
    const facilities = [...this.state.buildings.values()]
      .filter((b) => b.owner === this.state.you && b.progress >= 1
        && (BUILDING_DEFS[b.type]?.trains.length ?? 0) > 0 && b.type !== 'town_center')
      .sort((a, b) => a.id - b.id);
    if (!facilities.length) { this.openBuildFlow(); return; }
    const building = facilities[this.productionCycle++ % facilities.length];
    this.state.selection.clear();
    this.state.selection.add(building.id);
    const size = BUILDING_DEFS[building.type].size;
    this.cam.centerOn(building.tileX + size / 2, building.tileY + size / 2);
  }

  private idleCycle = 0;

  /** Seleciona e centraliza o próximo aldeão ocioso (botão do HUD / tecla "."). */
  private selectNextIdleVillager(): void {
    const gs = this.state;
    const idle = [...gs.units.values()]
      .filter((u) => u.owner === gs.you && u.type === 'villager' && u.state === 'idle')
      .sort((a, b) => a.id - b.id);
    if (idle.length === 0) return;
    const u = idle[this.idleCycle++ % idle.length];
    gs.selection.clear();
    gs.selection.add(u.id);
    const p = gs.unitPos(u, performance.now());
    this.cam.centerOn(p.x, p.y);
    this.sfx.selectUnit('villager');
  }

  /** Reunir o exército: seleciona toda a tropa militar própria (não-aldeões). */
  private selectAllMilitary(): void {
    const army = [...this.state.units.values()]
      .filter((u) => u.owner === this.state.you && SYMBIOSIS_COMBAT_UNITS.has(u.type))
      .sort((a, b) => a.id - b.id);
    if (army.length === 0) return;
    this.state.selection.clear();
    for (const u of army) this.state.selection.add(u.id);
    this.sfx.selectUnit(army[0].type);
  }

  private selectAllIdleVillagers(): void {
    const idle = [...this.state.units.values()]
      .filter((u) => u.owner === this.state.you && u.type === 'villager' && u.state === 'idle')
      .sort((a, b) => a.id - b.id);
    if (idle.length === 0) return;
    this.state.selection.clear();
    for (const u of idle) this.state.selection.add(u.id);
    this.sfx.selectUnit('villager');
  }

  /** Toca sons de eventos detectando mudanças entre snapshots (era, pesquisa,
   *  treino concluído). Comparação barata por frame. */
  /** Last projectile phase per shooter, to hear each launch exactly once. */
  private shotPhase = new Map<number, number>();
  private lastRaidStars = 0;

  /** Weapon cues follow the same deterministic launch phase the renderer draws. */
  private playWeaponSounds(now: number): void {
    const ear = (x: number, y: number) => Math.max(0, 1 - Math.hypot(x - this.cam.x, y - this.cam.y) / 16);
    const fired = (id: number, cooldownMs: number) => {
      const phase = (now + id * 137) % cooldownMs;
      const prev = this.shotPhase.get(id);
      this.shotPhase.set(id, phase);
      return prev !== undefined && phase < prev;
    };
    const UNIT_WEAPON: Partial<Record<UnitType, Parameters<Sfx['weapon']>[0]>> = {
      attack_drone: 'pulse', fighter: 'cannon', rocket_launcher: 'rocket', plasma_tank: 'plasma',
      stealth_bomber: 'bomb', aegis_valkyrie: 'arc', siege_mech: 'slam', iron_guardian: 'pulse',
    };
    for (const u of this.state.units.values()) {
      const kind = UNIT_WEAPON[u.type];
      if (!kind || u.state !== 'attacking') continue;
      if (!fired(u.id, UNIT_DEFS[u.type].attackCooldown * 1000)) continue;
      const p = this.state.unitPos(u, now);
      this.sfx.weapon(kind, ear(p.x, p.y));
    }
    for (const b of this.state.buildings.values()) {
      const def = DEFENSE_DEFS[b.type];
      if (!def || b.targetId == null) continue;
      if (!fired(b.id, def.cooldown * 1000)) continue;
      const size = BUILDING_DEFS[b.type].size;
      const kind = b.type === 'anti_air' ? 'rocket' : b.type === 'point_turret' ? 'turret' : 'pulse';
      this.sfx.weapon(kind, ear(b.tileX + size / 2, b.tileY + size / 2) * 0.8);
    }
    const stars = this.state.raid?.stars ?? 0;
    if (stars > this.lastRaidStars) this.sfx.raidStar();
    this.lastRaidStars = stars;
  }

  /** Ledger settlement chime (called by the app when a settlement lands). */
  playSettleCue(): void {
    this.sfx.settle();
  }

  private playEventSounds(now: number): void {
    if (this.session !== 'arena') this.playWeaponSounds(now);
    // coruja cruzando o céu: pio ocasional (~1x/min) — só no Arena; a cidade é robótica
    if (this.session !== 'arena') { /* no wildlife in the city */ }
    else if (this.nextOwl === 0) this.nextOwl = now + 25000 + Math.random() * 35000;
    else if (now >= this.nextOwl) {
      this.sfx.owl();
      // Em média uma vez por minuto, mas nunca num intervalo mecânico.
      this.nextOwl = now + 35000 + Math.random() * 55000;
    }
    if (now >= this.nextWorkSound) {
      // Ao chegar a uma região, a atividade se apresenta; se a câmera fica ali,
      // o ouvido se acostuma e esses impactos somem suavemente, devolvendo a paz.
      const moved = !Number.isFinite(this.workListenX) || Math.hypot(this.cam.x - this.workListenX, this.cam.y - this.workListenY) > 1.2;
      if (moved) {
        this.workListenX = this.cam.x;
        this.workListenY = this.cam.y;
        this.workListenSince = now;
      }
      const settledFor = now - this.workListenSince;
      const attention = settledFor < 2800 ? 1 : Math.max(0, 1 - (settledFor - 2800) / 6500);
      let best: { type: import('@age/shared').NodeType | 'building'; d: number; pan: number } | null = null;
      for (const u of this.state.units.values()) {
        if (u.state !== 'gathering' && u.state !== 'building') continue;
        const p = this.state.unitPos(u, now);
        const d = Math.hypot(p.x - this.cam.x, p.y - this.cam.y);
        if (d > 15 || (best && d >= best.d)) continue;
        const node = u.targetId == null ? undefined : this.state.nodes.get(u.targetId);
        const type = u.state === 'building' ? 'building' : node?.type;
        if (!type) continue;
        const screen = this.cam.worldToScreen(p.x, p.y);
        best = { type, d, pan: (screen.x / Math.max(1, this.cam.viewW) - 0.5) * 1.7 };
      }
      if (best && attention > 0) this.sfx.work(best.type, Math.max(0, 1 - best.d / 15) ** 1.7 * 0.78 * attention, best.pan);
      // Intervalo irregular e mais espaçado, especialmente importante nas minas.
      this.nextWorkSound = now + 680 + Math.random() * 520;
    }
    const me = this.state.me();
    if (!me) return;
    if (me.age > this.sndAge) this.sfx.ageUp();
    this.sndAge = me.age;
    const techCount = me.techs?.length ?? 0;
    if (techCount > this.sndTechs && this.sndTechs >= 0) this.sfx.research();
    this.sndTechs = techCount;
    let mine = 0;
    for (const u of this.state.units.values()) if (u.owner === this.state.you) mine++;
    if (this.sndUnits >= 0 && mine > this.sndUnits) this.sfx.trained();
    this.sndUnits = mine;

    // combate: sons de golpe/morte/destruição para o que surgiu desde o último
    // frame — só do que está À VISTA (batalha escondida na névoa não faz som)
    const fogVis = (wx: number, wy: number): boolean =>
      this.state.fog.isVisible(Math.floor(wx), Math.floor(wy));
    let newHit = false;
    let newDeath = false;
    let newWreck = false;
    for (const h of this.state.hits) if (h.at > this.sndCombatAt && fogVis(h.x, h.y)) newHit = true;
    for (const d of this.state.deaths) if (d.at > this.sndCombatAt && fogVis(d.unit.x, d.unit.y)) newDeath = true;
    for (const w of this.state.wrecks) {
      if (w.at <= this.sndCombatAt) continue;
      const sz = BUILDING_DEFS[w.building.type]?.size ?? 1;
      if (fogVis(w.building.tileX + sz / 2, w.building.tileY + sz / 2)) newWreck = true;
    }
    if (newHit) this.sfx.hit(performance.now());
    if (newDeath) this.sfx.death();
    if (newWreck) this.sfx.wreck();
    this.sndCombatAt = performance.now();

    if (now - this.lastBaseAlertAt >= 5000) {
      for (const [id] of this.state.lastHit) {
        const u = this.state.units.get(id);
        const b = this.state.buildings.get(id);
        if ((!u || u.owner !== this.state.you) && (!b || b.owner !== this.state.you)) continue;
        let wx: number, wy: number;
        if (u) {
          const p = this.state.unitPos(u, now);
          wx = p.x; wy = p.y;
        } else if (b) {
          const size = BUILDING_DEFS[b.type]?.size ?? 1;
          wx = b.tileX + size / 2; wy = b.tileY + size / 2;
        } else continue;
        const s = this.cam.worldToScreen(wx, wy);
        if (s.x >= 0 && s.y >= 0 && s.x <= this.cam.viewW && s.y <= this.cam.viewH) continue;
        this.sfx.baseUnderAttack();
        this.lastBaseAlertAt = now;
        break;
      }
    }

    // música de batalha: entra quando EU estou envolvido em combate (minhas
    // unidades atacando, ou minhas unidades/prédios levando dano)
    const gsNow = performance.now();
    const you = this.state.you;
    let inBattle = false;
    for (const u of this.state.units.values()) {
      if (u.owner === you && (u.state === 'attacking' || u.state === 'movingToAttack')) { inBattle = true; break; }
    }
    if (!inBattle) {
      for (const [id, t] of this.state.lastHit) {
        if (gsNow - t > 1200) continue;
        const u = this.state.units.get(id);
        const b = this.state.buildings.get(id);
        if ((u && u.owner === you) || (b && b.owner === you)) { inBattle = true; break; }
      }
    }
    if (inBattle) music.battlePulse();
    music.tick(gsNow);
  }

  private startLoop(): void {
    const frame = (now: number): void => {
      // Centraliza na base assim que o primeiro snapshot com o Centro da Cidade chega.
      if (!this.didCenter && (this.session === 'raid' ? this.state.buildings.size > 0 : this.state.myTownCenter())) {
        this.centerOnHome();
        this.didCenter = true;
      }
      this.input.tick(now);
      this.playEventSounds(now);
      this.hud.update();
      this.updateCouncil();
      this.updateLedger();
      this.updateRaidPanel();
      this.updateGoal();
      this.updateHomeStatus();
      this.updateGuide();
      this.updateWatchBadge();
      this.checkDefeat();
      if (this.ctx) {
        const dpr = (window.devicePixelRatio || 1) * this.renderScale;
        this.renderer.draw(this.ctx, this.cam, this.input.ui, dpr, now);
      }
      this.minimap.draw(now);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  private updateHomeStatus(): void {
    if (!this.homeBadge) return;
    const player = this.state.playerSnaps.get(this.state.you);
    const home = this.state.home;
    const current = home?.developmentPoints ?? 0;
    const next = home?.nextLevelPoints ?? current;
    const grid = player?.power;
    const stable = !grid || grid.supply >= grid.draw;
    const level = player?.age ?? 1;
    const text = `City L${level} · ${current.toLocaleString()}${level < 5 ? ` / ${next.toLocaleString()}` : ''} dev`;
    if (this.homeBadge.textContent !== text) this.homeBadge.textContent = text;
    // Only a grid shortage earns colour; everything else stays neutral.
    this.homeBadge.classList.toggle('short', !stable);
    this.homeBadge.title = stable ? 'Development points toward the next City Level' : 'Grid shortage: automation runs slower';
  }

  private onRaidDeploy = (event: MouseEvent): void => {
    if (!this.raidDeploy || event.button !== 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const world = this.cam.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    if (this.session === 'raid') this.deps.onRaid?.({ kind: 'deploy', unit: this.raidDeploy, x: world.x, y: world.y });
    else this.deps.onCommand({ kind: 'deployRaid', unit: this.raidDeploy, x: world.x, y: world.y });
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private updateRaidPanel(): void {
    const panel = this.raidPanel;
    if (!panel) return;
    // Lets small screens hide the command bar while the strike panel is up.
    this.el.classList.toggle('raid-open', !panel.classList.contains('hidden'));
    if (this.session === 'home') { this.updateHomeRaidPanel(panel); return; }
    if (this.session === 'raid') { this.updateRaidSessionPanel(panel); return; }
    if (this.session === 'arena') { panel.classList.add('hidden'); return; }
    const r = this.state.raid;
    const me = this.state.me();
    const sig = r
      ? `${r.id}:${r.phase}:${r.secondsLeft.toFixed(0)}:${r.destruction}:${r.stars}:${JSON.stringify(r.remaining)}:${r.events.length}:${this.raidDeploy}:${this.raidOpen}`
      : `none:${me?.age}:${me?.cityPath}:${this.raidOpen}`;
    if (sig === this.raidSig) return;
    this.raidSig = sig;
    const unlocked = me?.age === 5 && me.cityPath === 'command';
    this.attackBtn?.classList.toggle('accent', unlocked);
    this.attackBtn?.classList.toggle('locked', !unlocked);
    panel.innerHTML = '';
    panel.appendChild(el('div', 'raid-kicker', 'STRIKE COMMAND'));
    if (!r) {
      panel.appendChild(el('h3', '', 'Scout enemy city'));
      if (!this.raidOpen) {
        panel.classList.add('hidden');
        return;
      }
      panel.classList.remove('hidden');
      if (me?.age !== 5 || me.cityPath !== 'command') {
        panel.appendChild(el('p', 'raid-muted', 'Reach level 5 and establish a Command Metropolis to launch attacks.'));
        return;
      }
      for (const enemy of this.state.players.filter((p) => p.id !== this.state.you && !this.state.alliedOwners.has(p.id))) {
        const scout = el('button', 'raid-target', `Scout ${enemy.name}`);
        scout.addEventListener('click', () => this.deps.onCommand({ kind: 'scoutRaid', defenderId: enemy.id }));
        panel.appendChild(scout);
      }
      return;
    }
    panel.classList.remove('hidden');
    panel.appendChild(el('h3', '', `${this.state.nameOf(r.defender)} · ${r.phase.toUpperCase()}`));
    if (r.phase === 'scouting') {
      panel.appendChild(el('p', 'raid-muted', 'City scouted. Assemble up to 18 strike units.'));
      for (const type of ['attack_drone', 'fighter', 'rocket_launcher', 'siege_mech', 'stealth_bomber', 'plasma_tank', 'iron_guardian', 'aegis_valkyrie'] as const) {
        const row = el('div', 'raid-army-row');
        row.appendChild(el('span', '', UNIT_NAMES[type] ?? type));
        const minus = el('button', '', '−');
        const count = el('strong', '', String(this.raidDraft[type]));
        const plus = el('button', '', '+');
        minus.addEventListener('click', () => { this.raidDraft[type] = Math.max(0, this.raidDraft[type] - 1); this.raidSig = ''; });
        plus.addEventListener('click', () => {
          const manufactured = [...this.state.units.values()].filter((u) => u.owner === this.state.you && u.type === type).length;
          if (this.raidDraft[type] < manufactured && Object.values(this.raidDraft).reduce((a, b) => a + b, 0) < 18) this.raidDraft[type]++;
          this.raidSig = '';
        });
        row.append(minus, count, plus);
        panel.appendChild(row);
      }
      const start = el('button', 'raid-primary', 'Confirm force & attack');
      start.addEventListener('click', () => {
        this.deps.onCommand({ kind: 'setRaidArmy', army: { ...this.raidDraft } });
        this.deps.onCommand({ kind: 'startRaid' });
      });
      panel.appendChild(start);
      return;
    }
    if (r.phase === 'deploying' || r.phase === 'battle') {
      panel.appendChild(el('div', 'raid-score', `${r.stars ? '★'.repeat(r.stars) : '☆ ☆ ☆'}  ${r.destruction}%  ·  ${Math.ceil(r.secondsLeft)}s`));
      panel.appendChild(el('p', 'raid-muted', 'Select a unit, then click the outer edge of the map. Units choose targets automatically.'));
      for (const type of ['attack_drone', 'fighter', 'rocket_launcher', 'siege_mech', 'stealth_bomber', 'plasma_tank', 'iron_guardian', 'aegis_valkyrie'] as const) {
        const b = el('button', `raid-unit ${this.raidDeploy === type ? 'active' : ''}`, `${UNIT_NAMES[type] ?? type} × ${r.remaining[type]}`);
        b.toggleAttribute('disabled', r.remaining[type] < 1);
        b.addEventListener('click', () => { this.raidDeploy = type; this.raidSig = ''; });
        panel.appendChild(b);
      }
      return;
    }
    panel.appendChild(el('div', 'raid-result-stars', r.stars ? '★'.repeat(r.stars) : 'NO STARS'));
    panel.appendChild(el('div', 'raid-result-destruction', `${r.destruction}% destroyed`));
    panel.appendChild(el('p', 'raid-loot', `Loot  ${r.loot.energy} energy · ${r.loot.alloys} alloys · ${r.loot.compute} compute`));
    if (r.phase === 'replay') {
      const timeline = el('ol', 'raid-timeline');
      for (const event of r.events) timeline.appendChild(el('li', '', `${event.at.toFixed(1)}s  ${event.label}`));
      panel.appendChild(timeline);
    } else {
      const replay = el('button', 'raid-primary', 'Show replay');
      replay.addEventListener('click', () => this.deps.onCommand({ kind: 'showRaidReplay' }));
      panel.appendChild(replay);
    }
    const close = el('button', 'raid-target', 'Close report');
    close.addEventListener('click', () => { this.raidDeploy = null; this.deps.onCommand({ kind: 'closeRaid' }); });
    panel.appendChild(close);
  }

  /** Home: trophies, last report and the entry to scouting (spec §2.2). */
  private updateHomeRaidPanel(panel: HTMLElement): void {
    const home = this.state.home;
    const me = this.state.me();
    const armySize = [...this.state.units.values()].filter((u) => u.owner === this.state.you && RAID_UNIT_TYPES.includes(u.type as keyof RaidArmy)).length;
    const report = home?.lastReport;
    const defense = home?.defenseReports ?? [];
    const shieldMin = Math.ceil((home?.shieldSeconds ?? 0) / 60);
    const sig = `home:${this.raidOpen}:${home?.trophies}:${report?.raidId}:${armySize}:${me?.resources?.compute}:${shieldMin}:${defense[0]?.raidId}`;
    this.attackBtn?.classList.toggle('accent', armySize > 0);
    this.attackBtn?.classList.toggle('locked', false);
    if (this.attackBtn) this.attackBtn.title = 'Scout a base and raid it with your manufactured army';
    if (sig === this.raidSig) return;
    this.raidSig = sig;
    panel.innerHTML = '';
    panel.classList.toggle('hidden', !this.raidOpen);
    if (!this.raidOpen) return;
    panel.appendChild(el('div', 'raid-kicker', `STRIKE COMMAND · 🏆 ${home?.trophies ?? 0}${shieldMin > 0 ? ` · 🛡 ${shieldMin >= 60 ? `${Math.floor(shieldMin / 60)}h ${shieldMin % 60}m` : `${shieldMin}m`}` : ''}`));
    panel.appendChild(el('h3', '', 'Raid a base'));
    if (shieldMin > 0) panel.appendChild(el('p', 'raid-muted', 'Your city is shielded from raids. Deploying in a raid of your own breaks the shield.'));
    // Defense log: what attackers were paid by the system; nothing was taken from you.
    for (const d of defense.slice(0, 3)) {
      panel.appendChild(el('p', 'raid-loot', `🛡 ${d.attacker} raided you · ${d.stars ? '★'.repeat(d.stars) : 'no stars'} · ${d.destruction}% · they earned ${d.attackerReward.compute} compute (system-funded)`));
    }
    if (report) {
      panel.appendChild(el('p', 'raid-loot', `Last: ${report.label} · ${report.stars ? '★'.repeat(report.stars) : 'no stars'} · ${report.destruction}% · ${report.trophiesDelta >= 0 ? '+' : ''}${report.trophiesDelta} 🏆`));
    }
    panel.appendChild(el('p', 'raid-muted', armySize > 0
      ? `${armySize} manufactured unit${armySize === 1 ? '' : 's'} ready in your camps.`
      : 'Manufacture Attack Drones at a Drone Factory first. You can still scout.'));
    const scout = el('button', 'raid-primary', 'Scout a base · free');
    scout.addEventListener('click', () => this.deps.onRaid?.({ kind: 'scout' }));
    panel.appendChild(scout);
    panel.appendChild(el('p', 'raid-muted', 'Rewards are system-funded; defenders never lose stored resources.'));
  }

  /** Raid view: scout offer → reservation → deployment → report. */
  private updateRaidSessionPanel(panel: HTMLElement): void {
    const r = this.state.raid;
    const v = r?.home;
    if (!r || !v) return;
    if (this.raidDraftKey !== v.label + v.cityLevel) {
      this.raidDraftKey = v.label + v.cityLevel;
      this.raidDraft = { attack_drone: 0, fighter: 0, rocket_launcher: 0, siege_mech: 0, stealth_bomber: 0, plasma_tank: 0, iron_guardian: 0, aegis_valkyrie: 0 };
      this.raidDeploy = null;
    }
    const sig = `raid:${v.state}:${r.phase}:${Math.ceil(r.secondsLeft)}:${v.expiresIn}:${r.destruction}:${r.stars}:${JSON.stringify(r.remaining)}:${JSON.stringify(this.raidDraft)}:${this.raidDeploy}:${v.report?.raidId}`;
    if (sig === this.raidSig) return;
    this.raidSig = sig;
    panel.innerHTML = '';
    panel.classList.remove('hidden');
    panel.appendChild(el('div', 'raid-kicker', `STRIKE COMMAND · ${v.opponent === 'player' ? 'PLAYER CITY' : 'BOT OUTPOST'} · CITY LEVEL ${v.cityLevel}`));
    panel.appendChild(el('h3', '', v.label));
    const button = (cls: string, text: string, action: RaidAction, disabled = false): void => {
      const b = el('button', cls, text);
      b.toggleAttribute('disabled', disabled);
      b.addEventListener('click', () => { this.raidDeploy = null; this.deps.onRaid?.(action); });
      panel.appendChild(b);
    };
    const res = (x: Resources) => `${x.energy} energy · ${x.alloys} alloys · ${x.compute} compute`;

    if (v.report || r.phase === 'result') {
      const rep = v.report;
      panel.appendChild(el('div', 'raid-result-stars', (rep?.stars ?? r.stars) ? '★'.repeat(rep?.stars ?? r.stars) : 'NO STARS'));
      panel.appendChild(el('div', 'raid-result-destruction', `${rep?.destruction ?? r.destruction}% destroyed`));
      if (rep) {
        const why = { timer: 'Time ran out', destroyed: 'Base destroyed', eliminated: 'Strike force lost', surrender: 'Surrendered' }[rep.reason];
        panel.appendChild(el('p', 'raid-muted', why));
        panel.appendChild(el('p', 'raid-loot', `Reward ${res(rep.reward)}`));
        const lost = (['energy', 'alloys', 'compute'] as const).filter((k) => (rep.earned?.[k] ?? 0) > rep.reward[k]);
        if (lost.length) panel.appendChild(el('p', 'raid-muted', `Storage full: ${lost.map((k) => `${(rep.earned[k] ?? 0) - rep.reward[k]} ${k}`).join(' · ')} could not be stored. Upgrade depots to hold more.`));
        panel.appendChild(el('p', 'raid-loot', `${rep.trophiesDelta >= 0 ? '+' : ''}${rep.trophiesDelta} 🏆 · ${rep.deployed} deployed · ${rep.returned} returned to camp`));
      }
      button('raid-primary', 'Return home', { kind: 'return' }, !rep);
      return;
    }

    if (v.state === 'SCOUTING') {
      panel.appendChild(el('p', 'raid-muted', `Offer expires in ${v.expiresIn ?? 0}s · up to ${res(v.reward)} · +${v.trophies.win}/−${v.trophies.loss} 🏆`));
      let any = false;
      for (const type of RAID_UNIT_TYPES) {
        const have = v.available[type];
        if (have < 1) continue;
        any = true;
        const row = el('div', 'raid-army-row');
        row.appendChild(el('span', '', `${UNIT_NAMES[type] ?? type} (${have})`));
        const minus = el('button', '', '−');
        const count = el('strong', '', String(this.raidDraft[type]));
        const plus = el('button', '', '+');
        minus.addEventListener('click', () => { this.raidDraft[type] = Math.max(0, this.raidDraft[type] - 1); this.raidSig = ''; });
        plus.addEventListener('click', () => { this.raidDraft[type] = Math.min(have, this.raidDraft[type] + 1); this.raidSig = ''; });
        row.append(minus, count, plus);
        panel.appendChild(row);
      }
      if (!any) panel.appendChild(el('p', 'raid-muted', 'No manufactured units at Home. Build a Drone Factory and an Army Camp.'));
      const chosen = Object.values(this.raidDraft).reduce((a, b) => a + b, 0);
      button('raid-primary', `Reserve ${chosen} unit${chosen === 1 ? '' : 's'}`, { kind: 'reserve', army: { ...this.raidDraft } }, chosen < 1);
      button('raid-target', `Next base · ${v.nextScoutGold} compute`, { kind: 'next' }, (this.state.me()?.resources?.compute ?? 0) < v.nextScoutGold);
      button('raid-target', 'Back home', { kind: 'cancel' });
      return;
    }

    // ARMY_RESERVED / IN_PROGRESS
    panel.appendChild(el('div', 'raid-score', `${r.stars ? '★'.repeat(r.stars) : '☆ ☆ ☆'}  ${r.destruction}%  ·  ${Math.ceil(r.secondsLeft)}s`));
    panel.appendChild(el('p', 'raid-muted', this.raidDeploy
      ? `Click inside the cyan band to place a ${UNIT_NAMES[this.raidDeploy] ?? this.raidDeploy}.`
      : 'Pick a unit, then click inside the cyan band. Units choose targets on their own.'));
    for (const type of RAID_UNIT_TYPES) {
      if (r.army[type] < 1) continue;
      const b = el('button', `raid-unit ${this.raidDeploy === type ? 'active' : ''}`, `${UNIT_NAMES[type] ?? type} × ${r.remaining[type]}`);
      b.toggleAttribute('disabled', r.remaining[type] < 1);
      b.addEventListener('click', () => { this.raidDeploy = type; this.raidSig = ''; });
      panel.appendChild(b);
    }
    if (v.state === 'ARMY_RESERVED') button('raid-target', 'Cancel · units return to camp', { kind: 'cancel' });
    else button('raid-target', 'Surrender', { kind: 'surrender' });
  }

  private updateCouncil(): void {
    if (!this.councilText || !this.state.hasSnapshot) return;
    const me = this.state.me();
    if (!me?.resources) return;
    if (this.elonValue) this.elonValue.textContent = String(me.elon ?? 0);
    if (this.elonScore && me.score) {
      const txt = t('elon.score', { score: me.score.score.toFixed(1), rel: (me.score.reliabilityPpm / 10000).toFixed(0) });
      if (this.elonScore.textContent !== txt) this.elonScore.textContent = txt;
    }
    if (me.commander) {
      this.commanderTarget = [...this.state.selection].find((id) => {
        const owner = this.state.units.get(id)?.owner ?? this.state.buildings.get(id)?.owner;
        return owner !== undefined && !this.state.alliedOwners.has(owner);
      });
      this.renderCommander(me.commander);
      return;
    }
    let villagers = 0;
    let idleVillagers = 0;
    for (const unit of this.state.units.values()) {
      if (unit.owner !== this.state.you || unit.type !== 'villager') continue;
      villagers++;
      if (unit.state === 'idle') idleVillagers++;
    }
    let hasWorkshop = false;
    for (const b of this.state.buildings.values()) {
      if (b.owner === this.state.you && b.type === 'robotics_workshop') { hasWorkshop = true; break; }
    }
    const advice = recommend({
      ...me.resources,
      population: me.pop,
      populationCap: me.popCap,
      villagers,
      age: me.age,
      idleVillagers,
      powerSupply: me.power?.supply,
      powerDraw: me.power?.draw,
      hasWorkshop,
    });
    if (advice.id === this.councilLastId) return;
    this.councilLastId = advice.id;
    this.councilText.innerHTML = '';
    this.councilText.appendChild(el('strong', '', t(`council.${advice.id}.action`)));
    this.councilText.appendChild(el('span', '', t(`council.${advice.id}.why`)));
  }

  /** Builds the commander controls once; later snapshots only update them, so a
   *  slider being dragged is never rebuilt under the pointer. */
  private buildCommanderPanel(): CommanderPanel {
    const root = this.councilText!;
    root.innerHTML = '';
    const identity = el('strong', 'commander-identity');
    const blurb = el('span', 'commander-blurb');
    root.append(identity, blurb);
    const group = (label: string): HTMLElement => {
      const wrap = el('div', 'commander-group');
      wrap.appendChild(el('span', 'commander-label', label));
      root.appendChild(wrap);
      return wrap;
    };
    const personaBtns = new Map<CommanderPersona, HTMLButtonElement>();
    const personaRow = group('PERSONALITY');
    for (const value of ['vanguard', 'sentinel', 'architect'] as CommanderPersona[]) {
      const button = el('button', 'commander-chip', COMMANDER_INFO[value].name);
      button.title = COMMANDER_INFO[value].blurb;
      button.addEventListener('click', () => this.deps.onCommand({ kind: 'setCommander', persona: value, autonomy: this.state.me()?.commander?.autonomy ?? 'assisted' }));
      personaBtns.set(value, button);
      personaRow.appendChild(button);
    }
    const autonomyBtns = new Map<CommanderAutonomy, HTMLButtonElement>();
    const autonomyRow = group('AUTONOMY');
    const autonomyHelp: Record<CommanderAutonomy, string> = {
      manual: 'Acts only on your strategic orders.',
      assisted: 'Handles low-risk tasks (defense, idle workers, retreats) and recommends the rest.',
      autonomous: 'Chooses objectives and spends within your limits. Your orders still override it.',
    };
    for (const value of ['manual', 'assisted', 'autonomous'] as CommanderAutonomy[]) {
      const button = el('button', 'commander-chip', value);
      button.title = autonomyHelp[value];
      button.addEventListener('click', () => this.deps.onCommand({ kind: 'setCommander', persona: this.state.me()?.commander?.persona ?? 'sentinel', autonomy: value }));
      autonomyBtns.set(value, button);
      autonomyRow.appendChild(button);
    }
    const policyRow = group('AUTHORITY');
    const sliders = {} as CommanderPanel['sliders'];
    const sliderDefs: [keyof CommanderPolicy, string, string][] = [
      ['risk', 'Risk', 'Low: attack only with a clear advantage. High: accept even fights.'],
      ['aggression', 'Offense', 'Low: defensive posture. High: offensive posture.'],
      ['spendLimit', 'Spending', 'Share of your stockpile the commander may spend each production cycle.'],
    ];
    for (const [key, label, help] of sliderDefs) {
      const row = el('label', 'commander-slider');
      row.title = help;
      const input = el('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.step = '5';
      const out = el('output');
      input.addEventListener('input', () => { out.textContent = `${input.value}%`; });
      input.addEventListener('change', () => {
        this.commanderPolicyEditedAt = performance.now();
        this.deps.onCommand({
          kind: 'setCommanderPolicy',
          policy: { risk: +sliders.risk.value / 100, aggression: +sliders.aggression.value / 100, spendLimit: +sliders.spendLimit.value / 100 },
        });
      });
      row.append(el('span', '', label), input, out);
      sliders[key] = input;
      policyRow.appendChild(row);
    }
    const send = (label: string, help: string, objective: () => StrategicObjective): HTMLButtonElement => {
      const button = el('button', 'commander-order', label);
      button.title = help;
      button.addEventListener('click', () => this.deps.onCommand({ kind: 'commanderOrder', objective: objective() }));
      return button;
    };
    const orders = group('STRATEGIC ORDERS');
    const attack = send('Attack selected', 'Concentrate the army on the selected enemy unit or building.', () => ({ kind: 'attack_target', targetId: this.commanderTarget ?? -1 }));
    orders.append(
      send('Defend here', 'Secure the sector at the center of your view.', () => ({ kind: 'defend_area', x: this.cam.x, y: this.cam.y })),
      send('Protect core', 'Recall the army to guard your Command Core.', () => ({ kind: 'protect_core' })),
      attack,
      send('Capture here', 'Move to and hold the resource zone at the center of your view.', () => ({ kind: 'capture_zone', x: this.cam.x, y: this.cam.y })),
      send('Prepare assault', 'Assemble the army at the Command Core.', () => ({ kind: 'prepare_offensive' })),
      send('Retreat', 'Break contact and regroup at the Command Core.', () => ({ kind: 'retreat_regroup' })),
    );
    const economy = group('WORKER PRIORITY');
    for (const resource of ['energy', 'alloys', 'compute'] as ResourceType[]) {
      economy.appendChild(send(resource, `Move idle workers and a third of the others to ${resource}.`, () => ({ kind: 'prioritize_resource', resource })));
    }
    const status = group('CURRENT OBJECTIVE');
    const active = el('span', 'commander-active', 'None');
    const cancel = el('button', 'commander-order commander-cancel', 'Cancel order');
    cancel.addEventListener('click', () => this.deps.onCommand({ kind: 'cancelCommanderOrder' }));
    status.append(active, cancel);
    const log = group('DECISION LOG');
    const record = el('span', 'commander-record');
    root.appendChild(record);
    return { identity, blurb, personaBtns, autonomyBtns, sliders, attack, active, cancel, log, record, logSig: '' };
  }

  private renderCommander(view: CommanderView): void {
    if (!this.councilText) return;
    const panel = (this.commanderPanel ??= this.buildCommanderPanel());
    const info = COMMANDER_INFO[view.persona];
    panel.identity.textContent = `${info.name.toUpperCase()} · ${info.style}`;
    panel.blurb.textContent = info.blurb;
    for (const [value, button] of panel.personaBtns) button.classList.toggle('active', value === view.persona);
    for (const [value, button] of panel.autonomyBtns) button.classList.toggle('active', value === view.autonomy);
    // Server values win, except right after the player moved a slider (the echo is in flight).
    const editing = performance.now() - this.commanderPolicyEditedAt < 1500;
    for (const key of ['risk', 'aggression', 'spendLimit'] as (keyof CommanderPolicy)[]) {
      const input = panel.sliders[key];
      if (editing || document.activeElement === input) continue;
      const value = String(Math.round(view.policy[key] * 100));
      if (input.value !== value) input.value = value;
      const out = input.nextElementSibling as HTMLOutputElement | null;
      if (out) out.textContent = `${value}%`;
    }
    panel.attack.disabled = this.commanderTarget === undefined;
    const run = view.active;
    const seconds = run ? Math.max(0, Math.floor((this.state.tick - run.sinceTick) / TICK_RATE)) : 0;
    panel.active.textContent = run
      ? `${OBJECTIVE_LABEL[run.objective.kind]} · ${run.source === 'player' ? 'your order' : 'commander'} · ${seconds}s`
      : view.objective ? `${OBJECTIVE_LABEL[view.objective.kind]} · queued` : 'None — holding.';
    panel.cancel.hidden = !(run?.source === 'player' || view.objective);
    const r = view.record;
    panel.record.textContent = `${r.completed} completed · ${r.failed} failed · ${r.superseded} superseded · ${r.suggestions} suggestions`;
    const sig = view.decisions.map((d) => `${d.id}:${d.outcome}`).join(',');
    if (sig === panel.logSig) return;
    panel.logSig = sig;
    panel.log.querySelectorAll('.commander-decision, .commander-empty').forEach((node) => node.remove());
    const recent = view.decisions.slice(-4).reverse();
    if (recent.length === 0) panel.log.appendChild(el('span', 'commander-empty', 'Awaiting battlefield observations.'));
    for (const decision of recent) {
      const row = el('div', `commander-decision ${decision.outcome}`);
      const head = el('div', 'commander-decision-head');
      head.append(
        el('span', 'commander-badge', OUTCOME_LABEL[decision.outcome]),
        el('span', '', `${clock(decision.tick)} · ${decision.source === 'player' ? 'your order' : decision.commander}`),
      );
      row.append(head, el('b', '', decision.action), el('span', '', decision.reason));
      row.appendChild(el('span', 'commander-expect', `Expected: ${decision.expected}`));
      if (decision.result) row.appendChild(el('span', 'commander-result', `Result: ${decision.result}`));
      row.title = `Observed: ${decision.observation}`;
      if (decision.outcome === 'suggested' && decision.objective !== 'production') {
        const approve = el('button', 'commander-order commander-approve', 'Authorize');
        approve.hidden = !decision.proposal;
        approve.title = 'Issue this recommendation as your order.';
        approve.addEventListener('click', () => {
          if (decision.proposal) this.deps.onCommand({ kind: 'commanderOrder', objective: decision.proposal });
        });
        row.appendChild(approve);
      }
      panel.log.appendChild(row);
    }
  }

  private updateLedger(): void {
    const chain = this.state.chain;
    if (!this.chainFeed || !chain) return;
    const sig = `${chain.height}:${chain.pending}:${chain.txs[0]?.hash ?? ''}`;
    if (sig === this.chainSig) return;
    this.chainSig = sig;
    if (this.chainHeight) this.chainHeight.textContent = t('chain.block', { n: chain.height });
    if (this.chainHead) {
      this.chainHead.textContent = `${t('chain.head')} ${chain.head.slice(0, 10)}…${chain.head.slice(-4)} · ${t('chain.pending', { n: chain.pending })}`;
    }
    this.chainFeed.innerHTML = '';
    for (const tx of chain.txs.slice(0, 6)) {
      const row = el('li', `chain-tx ${tx.block === undefined ? 'pending' : ''}`);
      const dot = el('span', 'chain-dot');
      dot.style.background = tx.playerId >= 0 ? this.state.colorOf(tx.playerId) : 'var(--accent)';
      row.appendChild(dot);
      const body = el('div', 'chain-body');
      const kind = el('span', `chain-kind k-${tx.kind}`, t(`chain.kind.${tx.kind}`));
      body.appendChild(kind);
      body.appendChild(el('span', 'chain-label', this.describeTx(tx.label)));
      row.appendChild(body);
      const meta = el('div', 'chain-meta');
      meta.appendChild(el('span', 'chain-amt', tx.amount ? `+${tx.amount}` : ''));
      meta.appendChild(el('span', 'chain-txhash', tx.block === undefined ? '···' : `#${tx.block}`));
      row.appendChild(meta);
      row.title = tx.hash;
      this.chainFeed.appendChild(row);
    }
  }

  private describeTx(label: string): string {
    const [verb, what] = label.split(':');
    if (verb === 'completed' && what) return BUILDING_NAMES[what as BuildingType] ?? what;
    if (verb === 'trained' && what) return UNIT_NAMES[what as UnitType] ?? what;
    if (verb === 'reached' && what) return what.replace('age-', 'Age ');
    if (verb === 'served') return what === 'power' ? t('chain.served_power') : t('chain.served_needs');
    return verb === 'genesis' ? 'Genesis' : label;
  }

  /** Acabou o que eu estava assistindo. Mostra O QUE aconteceu e deixa escolher:
   *  continuar olhando o tabuleiro final, ou voltar pro lobby. Quem assiste não é
   *  arrancado da tela — foi justamente esse buraco (nenhum aviso, tela
   *  congelada) que apareceu no primeiro teste de verdade. */
  showSpectateEnd(motivo: string): void {
    if (this.specEndOverlay) { // já avisado (ex.: dois eventos seguidos)
      this.specEndOverlay.classList.remove('hidden');
      return;
    }
    const ov = el('div', 'pause-overlay');
    const box = el('div', 'pause-box');
    box.appendChild(el('div', 'pause-title', t('spec.end_title')));
    box.appendChild(el('div', 'pause-by', motivo));
    const acoes = el('div', 'defeat-actions');
    const ficar = el('button', 'btn', t('spec.end_stay'));
    ficar.addEventListener('click', () => ov.classList.add('hidden'));
    const sair = el('button', 'btn primary', t('spec.end_leave'));
    sair.addEventListener('click', () => this.deps.onBackToLobby());
    acoes.appendChild(ficar);
    acoes.appendChild(sair);
    box.appendChild(acoes);
    ov.appendChild(box);
    this.specEndOverlay = ov;
    this.el.querySelector('#game-root')?.appendChild(ov);
  }

  /** Fui derrotado e a partida continua? Avisa UMA vez e deixa escolher entre
   *  assistir o resto ou sair. (Quando a partida acaba de vez chega o `gameOver`,
   *  que abre a tela de fim — outro caminho.) */
  private checkDefeat(): void {
    if (this.avisouDerrota || !this.defeatOverlay) return;
    if (!this.state.me()?.defeated) return;
    this.avisouDerrota = true;
    this.defeatOverlay.classList.remove('hidden');
  }

  /** "👁 N assistindo" pra quem joga. Só toca o DOM quando o número muda —
   *  escrever texto 60x por segundo à toa é desperdício. */
  private lastWatchers = -1;
  private updateWatchBadge(): void {
    const b = this.watchBadge;
    if (!b) return;
    const n = this.state.spectatorCount;
    if (n === this.lastWatchers) return;
    this.lastWatchers = n;
    b.classList.toggle('hidden', n <= 0);
    if (n > 0) b.textContent = t('spec.badge', { n });
  }

  addChat(from: string, text: string): void {
    this.hud.addChat(from, text);
  }

  showConnLost(): void {
    this.connLost.show();
  }

  /** Menu de opções: volume dos efeitos (0..1). */
  setSfxVolume(v: number): void {
    this.sfx.setVolume(v);
  }

  /** Menu de opções: resolução (1 / 0.75 / 0.5) — reescala o canvas na hora. */
  setRenderScale(s: number): void {
    this.renderScale = s;
    this.onWindowResize?.();
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.sfx.stopMusic();
    this.input.destroy();
    this.minimap.destroy();
    this.canvas.removeEventListener('mousedown', this.onRaidDeploy, true);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.onWindowResize) window.removeEventListener('resize', this.onWindowResize);
  }
}
