// HUD DOM sobre o canvas: barra de recursos, painel de seleção, painel de
// ações (construir/treinar/fila) e chat.

import type {
  BuildingSnap,
  BuildingType,
  NodeSnap,
  ResourceType,
  SheepSnap,
  TechDef,
  UnitSnap,
  UnitType,
} from '@age/shared';
import {
  AGE_COSTS,
  AGE_NUMERALS,
  BUILDING_DEFS,
  buildingsToAdvance,
  countsForAgeUp,
  LAYER_GATE,
  layerGateMet,
  MAX_AGE,
  NODE_DEFS,
  POP_CAP_MAX,
  SHEEP_FOOD_MAX,
  TECH_DEFS,
  TRADE_LOT,
  TRAIN_QUEUE_MAX,
  TRANSPORT_CAP,
  UNIT_AGE_REQ,
  UNIT_DEFS,
  BUILD_RATE,
  isBuilderUnit,
  powerEfficiency,
  ELON_UNIT_COST,
  HOME_CAMP_SPACE,
  buildingMaxHp,
  HOME_BUILDING_CITY_LEVEL,
  HOME_CITY_LEVELS,
  HOME_LEVEL_POINTS,
  HOME_MAX_LEVEL,
  HOME_RESEARCH_MAX,
  HOME_UNIT_RESEARCH,
  HOME_UNIT_UNLOCK,
  homeResearchCost,
  homeUpgradeCost,
  homeUpgradeTime,
  SYMBIOSIS_COMBAT_UNITS,
  techBonus,
  tradeBuyCost,
  tradeSellGain,
} from '@age/shared';
import {
  AGE_NAMES,
  BUILDING_DESCS,
  BUILDING_ICONS,
  BUILDING_NAMES,
  costLongText,
  costText,
  NODE_ICONS,
  NODE_NAMES,
  nodeResourceIcon,
  RESOURCE_ICONS,
  RESOURCE_NAMES,
  t,
  techName,
  UNIT_DESCS,
  UNIT_ICONS,
  UNIT_NAMES,
} from '../i18n';
import type { GameState } from '../state';
import { el } from '../ui';

export interface HudDeps {
  onBuild: (type: BuildingType) => void;
  onTrain: (buildingId: number, unit: UnitType) => void;
  onCancelTrain: (buildingId: number, index: number) => void;
  onAdvanceAge: () => void;
  onChooseCityPath: (path: 'command' | 'space') => void;
  onResearch: (buildingId: number, techId: string) => void;
  onTrade: (action: 'buy' | 'sell', resource: 'energy' | 'alloys') => void;
  onChat: (text: string) => void;
  onIdleVillager: () => void;
  /** Desembarcar o transporte selecionado (id do barco). */
  onUnload: (id: number) => void; // id do PRÉDIO guarnecido ou do barco de transporte
  getPlacement: () => BuildingType | null;
  /** Home: physical one-level upgrade of a building. */
  onUpgrade?: (buildingId: number) => void;
  /** Reassign builders to an unfinished site without requiring right-click. */
  onResumeConstruction: (building: BuildingSnap) => void;
  /** Home: next research level for a unit family. */
  onUnitResearch?: (unit: UnitType) => void;
}

/** Units a Home factory builds (from the unlock table, not Arena trains lists). */
function homeFactoryUnits(type: BuildingType): UnitType[] {
  return (Object.entries(HOME_UNIT_UNLOCK) as [UnitType, { factory: BuildingType }][])
    .filter(([, unlock]) => unlock.factory === type)
    .map(([unit]) => unit);
}

const BUILD_GROUPS: { label: string; types: BuildingType[] }[] = [
  { label: 'CITY', types: ['house', 'town_center', 'elon_vault', 'army_camp'] },
  { label: 'ECONOMY', types: ['data_center', 'solar_array', 'wind_turbine', 'farm', 'mill', 'lumber_camp', 'mining_camp', 'market'] },
  { label: 'PRODUCTION', types: ['design_studio', 'robotics_workshop', 'drone_factory', 'mech_forge', 'aerospace_hangar', 'missile_foundry', 'exosuit_lab', 'barracks'] },
  { label: 'DEFENSE', types: ['blacksmith', 'watch_tower', 'point_turret', 'anti_air', 'sensor_tower', 'wall'] },
];
const RES_ORDER: ResourceType[] = ['energy', 'alloys', 'compute'];

/** Resource-bar icons drawn as inline SVG (renders identically everywhere,
 *  unlike emoji). Energy = bolt, Alloys = ingots, Compute = processor. */
const RES_ICON_SVG: Record<ResourceType, string> = {
  energy: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.4 1.2 3.2 9.1h4.1l-1 5.7 6.4-8.2H8.6z" fill="#f2c14e" stroke="#9a6d12" stroke-width=".8" stroke-linejoin="round"/></svg>',
  alloys: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.6 13.6 3 10h4.4l1.4 3.6z" fill="#8a9bad" stroke="#4d5a68" stroke-width=".7" stroke-linejoin="round"/>' +
    '<path d="M7.2 13.6 8.6 10H13l1.4 3.6z" fill="#9fb1c2" stroke="#4d5a68" stroke-width=".7" stroke-linejoin="round"/>' +
    '<path d="M4.4 9.4 5.8 5.8h4.4l1.4 3.6z" fill="#c3d0dc" stroke="#4d5a68" stroke-width=".7" stroke-linejoin="round"/></svg>',
  compute: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 1.6v2M8 1.6v2M11 1.6v2M5 12.4v2M8 12.4v2M11 12.4v2M1.6 5h2M1.6 8h2M1.6 11h2M12.4 5h2M12.4 8h2M12.4 11h2" stroke="#7c64c8" stroke-width="1.1" stroke-linecap="round"/>' +
    '<rect x="3.4" y="3.4" width="9.2" height="9.2" rx="1.6" fill="#a98bfa" stroke="#5b46a3" stroke-width=".8"/>' +
    '<rect x="5.8" y="5.8" width="4.4" height="4.4" rx=".8" fill="#e4dbff"/></svg>',
};

/** span com o ícone SVG de um recurso (para a barra superior). */
function resIconEl(r: ResourceType): HTMLElement {
  const s = document.createElement('span');
  s.className = 'res-ico';
  s.innerHTML = RES_ICON_SVG[r];
  return s;
}

/** Aldeão parado (ícone SVG do botão de aldeão ocioso). */
const IDLE_VIL_SVG =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="4.4" r="2.6" fill="#e2b48a" stroke="#8a6a3f"/>' +
  '<path d="M8 7.2c-2.6 0-4.2 1.6-4.6 4.2-.1.8.4 1.6 1.3 1.6h6.6c.9 0 1.4-.8 1.3-1.6C12.2 8.8 10.6 7.2 8 7.2z" fill="#c8a05a" stroke="#8a6a3f"/>' +
  '<path d="M3.6 4.4h8.8" stroke="#8a6a3f" stroke-width="1.6" stroke-linecap="round"/></svg>';

export class Hud {
  readonly el = el('div', 'hud');

  private resVals: Partial<Record<ResourceType, HTMLElement>> = {};
  private popEl: HTMLElement;
  private popVal: HTMLElement;
  private ageVal: HTMLElement;
  private powerEl: HTMLElement | null = null;
  private powerVal: HTMLElement | null = null;
  private elonVal: HTMLElement | null = null;
  private armyVal: HTMLElement | null = null;
  private ageTxtCache = '';
  private idleBtn!: HTMLButtonElement;
  private idleVal!: HTMLElement;

  private selPanel = el('div', 'sel-panel hidden');
  private actPanel = el('div', 'act-panel');
  private prodPanel = el('div', 'prod-panel');
  /** Caixa de ajuda acima do menu (estilo AoE2): nome/custo + pra que serve. */
  private tipEl = el('div', 'cmd-tip hidden');
  private tipTitle = el('div', 'tip-title');
  private tipDesc = el('div', 'tip-desc');
  /** Região direita da barra: onde o minimapa é montado (por game.ts). */
  readonly minimapSlot = el('div', 'cb-right');
  private chatBox = el('div', 'chat-box');
  private chatInput: HTMLInputElement;

  private selSig = '';
  private actKey = '';
  private buildBtns = new Map<BuildingType, HTMLButtonElement>();
  private buildTab = 0;
  private buildTabBtns: HTMLButtonElement[] = [];
  private centerPanel: HTMLElement | null = null;
  private trainBtns = new Map<UnitType, HTMLButtonElement>();
  private trainBuildingId = -1;
  private queueEl: HTMLElement | null = null;
  private queueSig = '';
  private headFill: HTMLElement | null = null;
  private prodTxt: HTMLElement | null = null;
  private prodFill: HTMLElement | null = null;
  private ageBtn: HTMLButtonElement | null = null;
  private pathBtns = new Map<'command' | 'space', HTMLButtonElement>();
  private prodAgeRow: HTMLElement | null = null;
  private prodAgeTxt: HTMLElement | null = null;
  private prodAgeFill: HTMLElement | null = null;
  private researchBtns = new Map<string, HTMLButtonElement>();
  private upgradeBtn: HTMLButtonElement | null = null;
  private unitResearchBtns = new Map<UnitType, HTMLButtonElement>();
  private prodResRow: HTMLElement | null = null;
  private prodResTxt: HTMLElement | null = null;
  private prodResFill: HTMLElement | null = null;
  /** Botões de comércio do Mercado ("sell:food", "buy:wood", ...). */
  private tradeBtns = new Map<string, HTMLButtonElement>();

  constructor(private gs: GameState, private deps: HudDeps, private symbiosis = false) {
    // ---- barra superior de recursos ----
    const top = el('div', 'panel hud-top');
    for (const r of RES_ORDER) {
      const span = el('span', 'res');
      span.title = RESOURCE_NAMES[r];
      span.appendChild(resIconEl(r));
      span.append(' ');
      const val = el('b', '', '0');
      span.appendChild(val);
      this.resVals[r] = val;
      top.appendChild(span);
    }
    this.popEl = el('span', 'res pop');
    this.popEl.title = t('hud.pop_tip');
    this.popEl.append('👥 ');
    this.popVal = el('b', '', '0/0');
    this.popEl.appendChild(this.popVal);
    top.appendChild(this.popEl);
    if (this.symbiosis) {
      const elon = el('span', 'res elon-resource');
      elon.title = 'Spendable ELON generated by your city';
      elon.append('E ');
      this.elonVal = el('b', '', '0/200');
      elon.appendChild(this.elonVal);
      top.appendChild(elon);
      const army = el('span', 'res army-resource');
      army.title = 'Manufactured army capacity';
      army.append('✦ ');
      this.armyVal = el('b', '', '0/0');
      army.appendChild(this.armyVal);
      top.appendChild(army);
      this.powerEl = el('span', 'res power');
      this.powerEl.title = t('hud.power_tip');
      this.powerEl.append('🔌 ');
      this.powerVal = el('b', '', '0/0');
      this.powerEl.appendChild(this.powerVal);
      top.appendChild(this.powerEl);
    }
    const ageSpan = el('span', 'res age');
    ageSpan.title = t('hud.age_tip');
    ageSpan.append('🏛 ');
    this.ageVal = el('b', '', this.ageName(1));
    ageSpan.appendChild(this.ageVal);
    top.appendChild(ageSpan);
    // botão de aldeão ocioso (AoE2): seleciona/centraliza o próximo parado
    this.idleBtn = el('button', 'btn idle-vil hidden');
    this.idleBtn.title = t('hud.idle_tip');
    const idleIco = el('span', 'res-ico');
    idleIco.innerHTML = IDLE_VIL_SVG;
    this.idleBtn.appendChild(idleIco);
    this.idleVal = el('b', '', '0');
    this.idleBtn.appendChild(this.idleVal);
    this.idleBtn.addEventListener('click', () => this.deps.onIdleVillager());
    top.appendChild(this.idleBtn);
    this.el.appendChild(top);

    // ---- barra de comando inferior (estilo AoE2): comandos à esquerda,
    //      seleção + produção no centro, minimapa à direita ----
    const bar = el('div', 'command-bar');
    const left = el('div', 'cb-left');
    left.appendChild(this.actPanel);
    const center = el('div', 'cb-center');
    center.appendChild(this.selPanel);
    center.appendChild(this.prodPanel);
    this.centerPanel = center;
    bar.appendChild(left);
    bar.appendChild(center);
    bar.appendChild(this.minimapSlot);
    this.el.appendChild(bar);

    // ---- caixa de ajuda dos botões (aparece logo acima do menu, à esquerda) ----
    this.tipEl.appendChild(this.tipTitle);
    this.tipEl.appendChild(this.tipDesc);
    this.el.appendChild(this.tipEl);
    // hover delegado: qualquer elemento com data-tip-title dentro do painel de
    // ações mostra a caixa; sair do painel esconde.
    this.actPanel.addEventListener('mouseover', (e) => {
      const t = (e.target as HTMLElement)?.closest('[data-tip-title]') as HTMLElement | null;
      if (t) {
        this.tipTitle.textContent = t.dataset.tipTitle ?? '';
        this.tipDesc.textContent = t.dataset.tipDesc ?? '';
        this.tipDesc.classList.toggle('hidden', !t.dataset.tipDesc);
        this.tipEl.classList.remove('hidden');
      } else {
        this.tipEl.classList.add('hidden');
      }
    });
    this.actPanel.addEventListener('mouseleave', () => this.tipEl.classList.add('hidden'));

    // ---- chat ----
    this.el.appendChild(this.chatBox);
    this.chatInput = el('input', 'txt game-chat-input hidden');
    this.chatInput.maxLength = 200;
    this.chatInput.placeholder = t('hud.chat_placeholder');
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.chatInput.value.trim();
        if (text) this.deps.onChat(text);
        this.closeChat();
      } else if (e.key === 'Escape') {
        this.closeChat();
      }
    });
    this.el.appendChild(this.chatInput);
  }

  /** Atualização por frame (barata: só escreve DOM quando algo muda). */
  update(): void {
    this.updateResources();
    this.updateSelection();
    this.updateActions();
    // nothing selected and nothing producing: drop the empty middle frame
    this.centerPanel?.classList.toggle('hidden', this.selPanel.classList.contains('hidden') && !this.prodPanel.firstChild);
  }

  // ---------------------------------------------------------------- chat

  isChatOpen(): boolean {
    return !this.chatInput.classList.contains('hidden');
  }

  openChat(): void {
    this.chatInput.classList.remove('hidden');
    this.chatInput.focus();
  }

  closeChat(): void {
    this.chatInput.value = '';
    this.chatInput.classList.add('hidden');
    this.chatInput.blur();
  }

  addChat(from: string, text: string): void {
    const msg = el('div', 'chat-msg');
    msg.appendChild(el('span', 'chat-from', `${from}: `));
    msg.append(text);
    this.chatBox.appendChild(msg);
    while (this.chatBox.children.length > 6) this.chatBox.firstChild?.remove();
    window.setTimeout(() => msg.classList.add('faded'), 6000);
    window.setTimeout(() => msg.remove(), 8000);
  }

  // ---------------------------------------------------------------- recursos

  private updateResources(): void {
    const me = this.gs.me();
    if (!me) return;
    for (const r of RES_ORDER) {
      const val = this.resVals[r];
      if (!val) continue;
      const txt = String(Math.floor(me.resources?.[r] ?? 0));
      if (val.textContent !== txt) val.textContent = txt;
    }
    const popTxt = `${me.pop}/${me.popCap}`;
    if (this.popVal.textContent !== popTxt) this.popVal.textContent = popTxt;
    this.popEl.classList.toggle('full', me.pop >= me.popCap);
    if (this.powerEl && this.powerVal && me.power) {
      const powerTxt = `${me.power.draw}/${me.power.supply}`;
      if (this.powerVal.textContent !== powerTxt) this.powerVal.textContent = powerTxt;
      this.powerEl.classList.toggle('full', me.power.draw > me.power.supply);
    }
    if (this.elonVal) this.elonVal.textContent = `${Math.floor(me.elonBalance ?? 0)}/${me.elonCapacity ?? 200}  +${me.elonPerMinute ?? 0}/m`;
    if (this.armyVal) this.armyVal.textContent = `${me.armyUsed ?? 0}/${me.armyCapacity ?? 0}`;
    // contador de aldeões ociosos (botão só aparece quando há algum)
    let idle = 0;
    for (const u of this.gs.units.values()) {
      if (u.owner === this.gs.you && u.type === 'villager' && u.state === 'idle') idle++;
    }
    const idleTxt = String(idle);
    if (this.idleVal.textContent !== idleTxt) this.idleVal.textContent = idleTxt;
    this.idleBtn.classList.toggle('hidden', idle === 0);
    const age = me.age ?? 1;
    const pathLabel = me.cityPath ? t(`path.${me.cityPath}.title`) : this.ageName(age);
    const researchingLabel = me.pathResearch ? t(`path.${me.pathResearch}.title`) : AGE_NUMERALS[age + 1];
    const ageTxt = me.ageProgress !== undefined
      ? `${AGE_NUMERALS[age]} → ${researchingLabel} (${Math.round(me.ageProgress * 100)}%)`
      : `${AGE_NUMERALS[age]} · ${pathLabel}`;
    if (ageTxt !== this.ageTxtCache) {
      this.ageTxtCache = ageTxt;
      this.ageVal.textContent = ageTxt;
    }
  }

  // ---------------------------------------------------------------- seleção

  private updateSelection(): void {
    const gs = this.gs;
    const units: UnitSnap[] = [];
    for (const id of gs.selection) {
      const u = gs.units.get(id);
      if (u) units.push(u);
    }
    const building = gs.selectedBuilding();
    const node = gs.selectedNode();
    const sheep = gs.selectedSheep();

    let sig = '';
    if (units.length === 1) {
      const u = units[0];
      const techSig = gs.playerSnaps.get(u.owner)?.techs?.join(',') ?? '';
      // `garrison` entra na assinatura: é quantos estão A BORDO do transporte —
      // sem isso o "N a bordo" e o botão Desembarcar não redesenhavam quando a
      // tropa subia/descia (o painel ficava com o número velho).
      sig = `u:${u.id}:${u.hp}:${u.carryType ?? ''}:${u.carryAmount ?? 0}:${u.garrison ?? 0}:${techSig}`;
    } else if (units.length > 1) {
      // inclui a vida de cada um pra grade de retratos atualizar em combate
      const techSig = [...new Set(units.map((u) => u.owner))]
        .map((owner) => this.gs.playerSnaps.get(owner)?.techs?.join(',') ?? '')
        .join('|');
      sig = `m:${units.map((u) => `${u.id}=${Math.ceil(u.hp)}`).join(',')}:${techSig}`;
    } else if (building) {
      // `garrison` entra na assinatura: sem isso o "N dentro" e o botão de ejetar
      // não redesenhavam quando alguém entrava/saía (o painel ficava congelado
      // mostrando gente dentro de um prédio já vazio).
      sig = `b:${building.id}:${building.hp}:${building.progress}:${building.foodLeft ?? -1}:${building.garrison ?? 0}:${building.level ?? 1}`;
    } else if (node) {
      sig = `n:${node.id}:${node.amount}`;
    } else if (sheep) {
      sig = `s:${sheep.id}:${Math.ceil(sheep.food)}:${sheep.owner}`;
    }

    if (sig === this.selSig) return;
    this.selSig = sig;
    this.selPanel.innerHTML = '';
    if (!sig) {
      this.selPanel.classList.add('hidden');
      return;
    }
    this.selPanel.classList.remove('hidden');

    if (units.length === 1) this.renderUnitDetail(units[0]);
    else if (units.length > 1) this.renderMultiUnits(units);
    else if (building) this.renderBuildingDetail(building);
    else if (node) this.renderNodeDetail(node);
    else if (sheep) this.renderSheepDetail(sheep);
  }

  private titleRow(icon: string, name: string, color?: string): HTMLElement {
    const row = el('div', 'sel-title');
    row.appendChild(el('span', 'ico', icon));
    row.append(name);
    if (color) {
      const sw = el('span', 'swatch');
      sw.style.background = color;
      row.appendChild(sw);
    }
    return row;
  }

  private hpBar(hp: number, max: number): HTMLElement {
    const bar = el('div', 'hpbar');
    const fill = el('div', 'fill');
    const frac = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
    fill.style.width = `${frac * 100}%`;
    if (frac <= 0.3) fill.style.background = 'var(--red)';
    else if (frac <= 0.6) fill.style.background = '#e0b23e';
    bar.appendChild(fill);
    bar.appendChild(el('div', 'txt', `${Math.ceil(hp)} / ${max}`));
    return bar;
  }

  private renderUnitDetail(u: UnitSnap): void {
    const def = UNIT_DEFS[u.type];
    const bonuses = techBonus(this.gs.playerSnaps.get(u.owner)?.techs ?? [], u.type);
    const maxHp = (def?.hp ?? u.hp) + bonuses.hp;
    const attack = (def?.attack ?? 0) + bonuses.attack;
    const armor = bonuses.armor;
    this.selPanel.appendChild(this.titleRow(UNIT_ICONS[u.type] ?? '❔', UNIT_NAMES[u.type] ?? u.type, this.gs.colorOf(u.owner)));
    this.selPanel.appendChild(this.hpBar(u.hp, maxHp));
    this.selPanel.appendChild(el('div', 'sel-line', `⚔ ${attack}   ❤ ${maxHp}   🛡 ${armor}`));
    if (u.owner !== this.gs.you) {
      this.selPanel.appendChild(el('div', 'sel-line', t('hud.player', { name: this.gs.nameOf(u.owner) })));
    }
    const rate = BUILD_RATE[u.type];
    if (this.symbiosis && rate && u.type !== 'villager') {
      const grid = this.gs.playerSnaps.get(u.owner)?.power;
      const eff = grid ? powerEfficiency(grid.supply, grid.draw) : 1;
      this.selPanel.appendChild(el('div', 'sel-line', t('hud.build_rate', { rate, pct: Math.round(eff * 100) })));
    }
    if ((u.type === 'villager' || u.type === 'fishing_boat') && (u.carryAmount ?? 0) > 0 && u.carryType) {
      this.selPanel.appendChild(
        el('div', 'sel-line', t('hud.carrying', { amt: Math.floor(u.carryAmount ?? 0), icon: RESOURCE_ICONS[u.carryType] })),
      );
    }
    // Transporte: quantos a bordo + botão de DESEMBARCAR na costa (tecla U)
    if (u.type === 'transport' && u.owner === this.gs.you) {
      this.selPanel.appendChild(el('div', 'sel-line', t('hud.aboard', { n: u.garrison ?? 0, max: TRANSPORT_CAP })));
      if ((u.garrison ?? 0) > 0) {
        const btn = el('button', 'btn', t('hud.unload'));
        btn.title = t('hud.unload_tip');
        btn.addEventListener('click', () => this.deps.onUnload(u.id));
        this.selPanel.appendChild(btn);
      }
    }
  }

  /** Seleção múltipla: grade de retratos, cada um com sua barrinha de vida
   *  (estilo AoE2). Clicar num retrato seleciona só aquela unidade. */
  private renderMultiUnits(units: UnitSnap[]): void {
    this.selPanel.appendChild(this.titleRow('⚑', t('hud.units_count', { n: units.length })));
    const groups = el('div', 'sel-units');
    const MAX_TILES = 14;
    for (const u of units.slice(0, MAX_TILES)) {
      const tile = el('div', 'sel-unit');
      tile.appendChild(el('span', 'ico', UNIT_ICONS[u.type] ?? '❔'));
      const bonuses = techBonus(this.gs.playerSnaps.get(u.owner)?.techs ?? [], u.type);
      const maxHp = (UNIT_DEFS[u.type]?.hp ?? u.hp) + bonuses.hp;
      const frac = maxHp > 0 ? Math.max(0, Math.min(1, u.hp / maxHp)) : 0;
      const bar = el('div', 'mini-hp');
      const fill = el('div', 'fill');
      fill.style.width = `${frac * 100}%`;
      if (frac <= 0.3) fill.style.background = 'var(--red)';
      else if (frac <= 0.6) fill.style.background = '#e0b23e';
      bar.appendChild(fill);
      tile.appendChild(bar);
      tile.title = `${UNIT_NAMES[u.type] ?? u.type} — ${Math.ceil(u.hp)}/${maxHp}`; // formato numérico (sem tradução)
      tile.addEventListener('click', () => {
        this.gs.selection.clear();
        this.gs.selection.add(u.id);
      });
      groups.appendChild(tile);
    }
    if (units.length > MAX_TILES) {
      groups.appendChild(el('div', 'sel-unit more', `+${units.length - MAX_TILES}`));
    }
    this.selPanel.appendChild(groups);
  }

  private renderBuildingDetail(b: BuildingSnap): void {
    const def = BUILDING_DEFS[b.type];
    const maxHp = def ? buildingMaxHp(b.type, b.level) : b.hp;
    this.selPanel.appendChild(
      this.titleRow(BUILDING_ICONS[b.type] ?? '❔', this.buildingName(b.type), this.gs.colorOf(b.owner)),
    );
    this.selPanel.appendChild(this.hpBar(b.hp, maxHp));
    if (b.owner !== this.gs.you) {
      this.selPanel.appendChild(el('div', 'sel-line', t('hud.player', { name: this.gs.nameOf(b.owner) })));
    }
    if ((b.progress ?? 1) < 1) {
      this.selPanel.appendChild(
        el('div', 'sel-line', t('hud.construction_pct', { pct: Math.floor((b.progress ?? 0) * 100) })),
      );
    } else if (def?.power) {
      this.selPanel.appendChild(el('div', 'sel-line', t('hud.power_gen', { n: def.power })));
    } else if (b.type === 'farm' && b.foodLeft !== undefined) {
      this.selPanel.appendChild(
        el('div', 'sel-line', t('hud.food_left', { amt: Math.ceil(b.foodLeft), icon: RESOURCE_ICONS.energy })),
      );
    }
    if (b.proof) {
      const proof = el('div', 'sel-line proof-line', t('hud.proof', { hash: `${b.proof.slice(0, 8)}…${b.proof.slice(-6)}` }));
      proof.title = `${t('hud.proof_tip')}\n${b.proof}`;
      this.selPanel.appendChild(proof);
    }
    // Guarnecido: quantos dentro + botão de EJETAR (a tecla U segue valendo, mas
    // ninguém é obrigado a decorar — mesmo padrão do "Desembarcar" do transporte).
    if (b.garrison && b.owner === this.gs.you) {
      this.selPanel.appendChild(el('div', 'sel-line', t('hud.garrison', { n: b.garrison })));
      const btn = el('button', 'btn', t('hud.eject'));
      btn.title = t('hud.eject_tip');
      btn.addEventListener('click', () => this.deps.onUnload(b.id));
      this.selPanel.appendChild(btn);
    }
  }

  private ageName(age: number): string {
    return this.symbiosis ? t(`symbiosis.age.${age}`) : AGE_NAMES[age];
  }

  private buildingName(type: BuildingType): string {
    if (!this.symbiosis) return BUILDING_NAMES[type] ?? type;
    const modern: Partial<Record<BuildingType, string>> = {
      town_center: t('symbiosis.building.town_center'),
      house: t('symbiosis.building.house'),
      mill: t('symbiosis.building.mill'),
      market: t('symbiosis.building.market'),
      blacksmith: t('symbiosis.building.blacksmith'),
    };
    return modern[type] ?? BUILDING_NAMES[type] ?? type;
  }

  private renderNodeDetail(n: NodeSnap): void {
    this.selPanel.appendChild(this.titleRow(NODE_ICONS[n.type] ?? '❔', NODE_NAMES[n.type] ?? n.type));
    const def = NODE_DEFS[n.type];
    const total = def?.amount ?? n.amount;
    this.selPanel.appendChild(
      el('div', 'sel-line', t('hud.remaining', { amt: Math.ceil(n.amount), total, icon: nodeResourceIcon(n.type) })),
    );
  }

  private renderSheepDetail(s: SheepSnap): void {
    const owner = this.gs.isWildSheep(s) ? undefined : this.gs.colorOf(s.owner);
    this.selPanel.appendChild(this.titleRow('🐑', t('sheep.name'), owner));
    this.selPanel.appendChild(
      el('div', 'sel-line', t('hud.remaining', { amt: Math.ceil(s.food), total: SHEEP_FOOD_MAX, icon: '🍖' })),
    );
  }

  // ---------------------------------------------------------------- ações

  private actionsContext(): { key: string; building?: BuildingSnap } {
    const gs = this.gs;
    const ownUnits = gs.selectedOwnUnits();
    if (ownUnits.some((u) => isBuilderUnit(u.type))) return { key: 'build' };
    if (ownUnits.length > 0) return { key: 'hint:soldiers' };

    const b = gs.selectedBuilding();
    if (b && b.owner === gs.you) {
      const def = BUILDING_DEFS[b.type];
      const hasTechs = TECH_DEFS.some((t) => t.building === b.type);
      const homeExtras = !!this.gs.home && (!!HOME_MAX_LEVEL[b.type] || homeFactoryUnits(b.type).length > 0);
      if (def && (b.progress ?? 1) >= 1 && (def.trains.length > 0 || hasTechs || homeExtras)) {
        // O N entra na chave pro painel reconstruir quando a multi-seleção
        // muda de tamanho (senão o "×N" do título ficaria desatualizado).
        const n = gs.selectedOwnBuildings().filter((x) => x.type === b.type && (x.progress ?? 1) >= 1).length;
        return { key: `train:${b.id}x${n}`, building: b };
      }
      if ((b.progress ?? 1) < 1) return { key: `construction:${b.id}`, building: b };
      if (b.type === 'farm') return { key: 'hint:farm' };
      return { key: 'hint:house' };
    }
    if (b) return { key: 'hint:enemy' };

    if (gs.selectedNode()) return { key: 'hint:node' };
    if (gs.selectedSheep()) return { key: 'hint:sheep' };

    // unidade inimiga selecionada para info
    for (const id of gs.selection) {
      const u = gs.units.get(id);
      if (u && u.owner !== gs.you) return { key: 'hint:enemy' };
    }
    return { key: 'hint:none' };
  }

  private updateActions(): void {
    const ctx = this.actionsContext();
    if (ctx.key !== this.actKey) {
      this.actKey = ctx.key;
      this.rebuildActions(ctx);
    }
    this.refreshActions(ctx);
  }

  private rebuildActions(ctx: { key: string; building?: BuildingSnap }): void {
    this.actPanel.innerHTML = '';
    this.prodPanel.innerHTML = '';
    this.buildBtns.clear();
    this.trainBtns.clear();
    this.queueEl = null;
    this.queueSig = '';
    this.headFill = null;
    this.prodTxt = null;
    this.prodFill = null;
    this.ageBtn = null;
    this.upgradeBtn = null;
    this.unitResearchBtns.clear();
    this.pathBtns.clear();
    this.prodAgeRow = null;
    this.prodAgeTxt = null;
    this.prodAgeFill = null;
    this.researchBtns.clear();
    this.tradeBtns.clear();
    this.prodResRow = null;
    this.prodResTxt = null;
    this.prodResFill = null;
    this.trainBuildingId = -1;

    if (ctx.key === 'build') {
      // One category at a time: all four groups stacked never fit the 184px bar.
      const tabs = el('div', 'build-tabs');
      this.buildTabBtns = BUILD_GROUPS.map((group, i) => {
        const tab = el('button', `build-tab${i === this.buildTab ? ' on' : ''}`, group.label);
        tab.addEventListener('click', () => {
          this.buildTab = i;
          this.actKey = ''; // forces a rebuild on the next frame
        });
        tabs.appendChild(tab);
        return tab;
      });
      this.actPanel.appendChild(tabs);
      const grid = el('div', 'cmd-grid');
      for (const group of [BUILD_GROUPS[this.buildTab]]) {
        for (const type of group.types) {
        const def = BUILDING_DEFS[type];
        if (!def || (def.symbiosis && !this.symbiosis)) continue;
        // tile quadrado só com o ícone (estilo AoE2); nome/custo/descrição vão
        // pra caixa de ajuda acima do menu (data-tip-*)
        const btn = el('button', 'btn cmd-tile');
        btn.appendChild(el('span', 'ico', BUILDING_ICONS[type]));
        btn.dataset.tipTitle = t('hud.building_cost', { building: BUILDING_NAMES[type], cost: costLongText(def.cost), time: def.buildTime });
        btn.dataset.tipDesc = BUILDING_DESCS[type] ?? '';
        btn.addEventListener('click', () => {
          if (!btn.classList.contains('off')) this.deps.onBuild(type);
        });
        this.buildBtns.set(type, btn);
        grid.appendChild(btn);
        }
      }
      this.actPanel.appendChild(grid);
      return;
    }

    if (ctx.key.startsWith('construction:') && ctx.building) {
      const b = ctx.building;
      this.actPanel.appendChild(el('div', 'act-title', t('hud.resume_construction')));
      this.actPanel.appendChild(el('div', 'hint', t('hint.construction_button')));
      const resume = el('button', 'btn cmd-btn age-btn', t('hud.send_builders'));
      resume.addEventListener('click', () => this.deps.onResumeConstruction(b));
      this.actPanel.appendChild(resume);
      return;
    }

    if (ctx.key.startsWith('train:') && ctx.building) {
      const b = ctx.building;
      const def = BUILDING_DEFS[b.type];
      // Home factories list their family from the unlock table (e.g. Exosuit Lab L2 → Valkyrie).
      const trains = this.gs.home
        ? [...(def?.trains ?? []).filter((u) => !SYMBIOSIS_COMBAT_UNITS.has(u)), ...homeFactoryUnits(b.type)]
        : def?.trains ?? [];
      const techs = TECH_DEFS.filter((t) => t.building === b.type);
      this.trainBuildingId = b.id;
      // Multi-seleção (duplo-clique): todos os prédios próprios PRONTOS do
      // mesmo tipo. O treino é enfileirado em TODOS; o painel mostra "×N".
      const sameType = this.gs.selectedOwnBuildings().filter((bb) => bb.type === b.type && (bb.progress ?? 1) >= 1);
      const countSuffix = sameType.length > 1 ? ` ×${sameType.length}` : '';
      const verb = trains.length ? t('hud.train') : t('hud.research_verb');
      this.actPanel.appendChild(el('div', 'act-title', `${verb} — ${BUILDING_NAMES[b.type] ?? b.type}${countSuffix}`));
      const grid = el('div', 'cmd-grid');
      for (const unit of trains) {
        const udef = UNIT_DEFS[unit];
        if (!udef) continue;
        // tile quadrado só com o ícone; nome/custo/descrição na caixa de ajuda
        const btn = el('button', 'btn cmd-tile');
        btn.appendChild(el('span', 'ico', UNIT_ICONS[unit]));
        const elonCost = ELON_UNIT_COST[unit];
        btn.dataset.tipTitle = elonCost !== undefined
          ? `${UNIT_NAMES[unit]} · ${elonCost} ELON · ${udef.trainTime}s`
          : t('hud.unit_cost', { unit: UNIT_NAMES[unit], cost: costLongText(udef.cost), time: udef.trainTime });
        btn.dataset.tipDesc = `${UNIT_DESCS[unit] ?? ''} ${t('hud.shift_train5')}`;
        // Shift+clique: enfileira 5 (AoE2). Com vários prédios do mesmo tipo
        // selecionados, enfileira em cada um deles.
        btn.addEventListener('click', (e) => {
          if (btn.classList.contains('off')) return;
          const n = e.shiftKey ? 5 : 1;
          const targets = this.gs.selectedOwnBuildings().filter((bb) => bb.type === b.type && (bb.progress ?? 1) >= 1);
          for (const bb of targets.length ? targets : [b]) {
            for (let i = 0; i < n; i++) this.deps.onTrain(bb.id, unit);
          }
        });
        this.trainBtns.set(unit, btn);
        grid.appendChild(btn);
      }
      // botões de upgrade (pesquisa) do prédio
      for (const tech of techs) {
        const btn = el('button', 'btn cmd-tile');
        btn.appendChild(el('span', 'ico', tech.icon));
        btn.dataset.tipTitle = t('hud.tech_cost', { tech: techName(tech.id), cost: costLongText(tech.cost), time: tech.time });
        btn.dataset.tipDesc = this.techEffectText(tech);
        btn.addEventListener('click', () => {
          if (!btn.classList.contains('off')) this.deps.onResearch(b.id, tech.id);
        });
        this.researchBtns.set(tech.id, btn);
        grid.appendChild(btn);
      }
      // Home: unit research lives at the Robotics Workshop (spec §5).
      if (this.gs.home && b.type === 'robotics_workshop') {
        for (const unit of Object.keys(HOME_UNIT_RESEARCH) as UnitType[]) {
          const btn = el('button', 'btn cmd-tile research-tile');
          btn.appendChild(el('span', 'ico', UNIT_ICONS[unit]));
          btn.appendChild(el('span', 'lvl', '0'));
          btn.addEventListener('click', () => { if (!btn.classList.contains('off')) this.deps.onUnitResearch?.(unit); });
          this.unitResearchBtns.set(unit, btn);
          grid.appendChild(btn);
        }
      }
      this.actPanel.appendChild(grid);
      // Home: physical building upgrade (the Hub uses the City Level button below).
      if (this.gs.home && HOME_MAX_LEVEL[b.type] && b.type !== 'town_center') {
        const up = el('button', 'btn cmd-btn age-btn upgrade-btn');
        up.addEventListener('click', () => { if (!up.disabled) this.deps.onUpgrade?.(b.id); });
        this.upgradeBtn = up;
        this.actPanel.appendChild(up);
      }
      // Mercado: comprar/vender recursos por ouro (preços movem com as trocas)
      if (b.type === 'market') {
        this.actPanel.appendChild(el('div', 'act-title trade-title', t('hud.trade_title')));
        const box = el('div', 'trade-box');
        for (const res of ['energy', 'alloys'] as const) {
          const row = el('div', 'trade-row');
          row.appendChild(resIconEl(res));
          const sell = el('button', 'btn trade-btn');
          sell.dataset.tipTitle = t('hud.sell_100', { res: RESOURCE_NAMES[res] });
          sell.dataset.tipDesc = t('hud.sell_desc');
          sell.addEventListener('click', () => {
            if (!sell.classList.contains('off')) this.deps.onTrade('sell', res);
          });
          const buy = el('button', 'btn trade-btn');
          buy.dataset.tipTitle = t('hud.buy_100', { res: RESOURCE_NAMES[res] });
          buy.dataset.tipDesc = t('hud.buy_desc');
          buy.addEventListener('click', () => {
            if (!buy.classList.contains('off')) this.deps.onTrade('buy', res);
          });
          this.tradeBtns.set(`sell:${res}`, sell);
          this.tradeBtns.set(`buy:${res}`, buy);
          row.appendChild(sell);
          row.appendChild(buy);
          box.appendChild(row);
        }
        this.actPanel.appendChild(box);
      }
      // Centro da Cidade: botão de avançar de era (estilo AoE2)
      if (b.type === 'town_center') {
        const btn = el('button', 'btn cmd-btn age-btn');
        btn.dataset.tipTitle = t('hud.advance_age');
        btn.dataset.tipDesc = t('hud.advance_age_desc');
        btn.addEventListener('click', () => this.deps.onAdvanceAge());
        this.ageBtn = btn;
        this.actPanel.appendChild(btn);
      }
      // centro da barra: produção/pesquisa
      this.prodPanel.appendChild(el('div', 'act-title', trains.length ? t('hud.production') : t('hud.research_head')));
      if (trains.length) {
        const now = el('div', 'prod-now');
        this.prodTxt = el('span', 'prod-txt', t('hud.idle'));
        now.appendChild(this.prodTxt);
        const barWrap = el('div', 'prod-bar');
        this.prodFill = el('div', 'prod-fill');
        barWrap.appendChild(this.prodFill);
        now.appendChild(barWrap);
        this.prodPanel.appendChild(now);
      }
      // linha de pesquisa de TECNOLOGIA deste prédio (aparece só durante a pesquisa)
      const resRow = el('div', 'prod-now hidden');
      this.prodResTxt = el('span', 'prod-txt', '');
      resRow.appendChild(this.prodResTxt);
      const resBar = el('div', 'prod-bar');
      this.prodResFill = el('div', 'prod-fill age');
      resBar.appendChild(this.prodResFill);
      resRow.appendChild(resBar);
      this.prodResRow = resRow;
      this.prodPanel.appendChild(resRow);
      // linha de pesquisa de era (só no Centro da Cidade, durante a pesquisa)
      const ageRow = el('div', 'prod-now hidden');
      this.prodAgeTxt = el('span', 'prod-txt', '');
      ageRow.appendChild(this.prodAgeTxt);
      const ageBar = el('div', 'prod-bar');
      this.prodAgeFill = el('div', 'prod-fill age');
      ageBar.appendChild(this.prodAgeFill);
      ageRow.appendChild(ageBar);
      this.prodAgeRow = ageRow;
      this.prodPanel.appendChild(ageRow);
      if (trains.length) {
        this.queueEl = el('div', 'queue');
        this.prodPanel.appendChild(this.queueEl);
      }
      return;
    }

    this.actPanel.appendChild(el('div', 'act-title', t('hud.actions')));
    const hintKey = ctx.key.startsWith('hint:') ? ctx.key.replace(':', '.') : 'hint.none';
    this.actPanel.appendChild(el('div', 'hint', t(hintKey)));
  }

  private refreshActions(ctx: { key: string; building?: BuildingSnap }): void {
    if (ctx.key === 'build') {
      const placement = this.deps.getPlacement();
      const myAge = this.gs.me()?.age ?? 1;
      // pré-requisitos concluídos (árvore do AoE2): tipos que EU já tenho prontos
      const done = new Set<BuildingType>();
      // População que os MEUS prédios fornecem (contando os em obra também): ao
      // bater o teto POP_CAP_MAX, casa não ajuda mais e o botão dela apaga.
      let myPopProvided = 0;
      for (const b of this.gs.buildings.values()) {
        if (b.owner !== this.gs.you) continue;
        if (b.progress >= 1) done.add(b.type);
        myPopProvided += BUILDING_DEFS[b.type]?.popProvided ?? 0;
      }
      const popMaxed = myPopProvided >= POP_CAP_MAX;
      const isAvailable = (type: BuildingType): boolean => {
        const def = BUILDING_DEFS[type];
        const minLevel = this.gs.home ? HOME_BUILDING_CITY_LEVEL[type] ?? def?.ageReq ?? 1 : def?.ageReq ?? 1;
        return !!def && (!def.symbiosis || this.symbiosis) && myAge >= minLevel && (!def.requires || done.has(def.requires));
      };
      BUILD_GROUPS.forEach((group, i) => {
        const n = group.types.filter(isAvailable).length;
        this.buildTabBtns[i]?.classList.toggle('empty', n === 0);
      });
      for (const [type, btn] of this.buildBtns) {
        const def = BUILDING_DEFS[type];
        // estilo AoE2: o que ainda não está liberado (era futura ou sem o
        // pré-requisito, ex.: Fazenda sem Moinho) NEM APARECE no menu.
        const available = isAvailable(type);
        btn.style.display = available ? '' : 'none';
        if (!available) continue;
        btn.classList.remove('locked');
        const houseMaxed = type === 'house' && popMaxed;
        btn.classList.toggle('off', !this.canAfford(def.cost) || houseMaxed);
        btn.classList.toggle('active', placement === type);
        btn.dataset.tipTitle = houseMaxed
          ? t('hud.house_pop_maxed', { max: POP_CAP_MAX })
          : t('hud.building_cost', { building: BUILDING_NAMES[type], cost: costLongText(def.cost), time: def.buildTime });
      }
      return;
    }

    if (this.trainBuildingId >= 0) {
      const b = this.gs.buildings.get(this.trainBuildingId);
      if (!b) return; // seleção será podada; contexto muda no próximo frame
      const me = this.gs.me();
      const myAge = me?.age ?? 1;
      const queue = Array.isArray(b.queue) ? b.queue : [];
      const homeUnlockOf = (unit: UnitType) => (this.gs.home ? HOME_UNIT_UNLOCK[unit] : undefined);
      const slots = this.gs.home ? TRAIN_QUEUE_MAX + 2 * ((b.level ?? 1) - 1) : TRAIN_QUEUE_MAX;
      for (const [unit, btn] of this.trainBtns) {
        const udef = UNIT_DEFS[unit];
        const unlock = homeUnlockOf(unit);
        const req = unlock ? unlock.cityLevel : UNIT_AGE_REQ[unit] ?? 1;
        const factoryLocked = !!unlock && (b.level ?? 1) < unlock.factoryLevel;
        const locked = myAge < req || factoryLocked;
        // Home pays for the army in resources; a full camp blocks the factory, not the order.
        const elonCost = this.gs.home ? undefined : ELON_UNIT_COST[unit];
        const canPay = elonCost !== undefined ? (me?.elonBalance ?? 0) >= elonCost : this.canAfford(udef.cost);
        const armyFull = elonCost !== undefined && (me?.armyUsed ?? 0) + udef.pop > (me?.armyCapacity ?? 0);
        btn.classList.toggle('off', !udef || locked || !canPay || armyFull || queue.length >= slots);
        btn.classList.toggle('locked', locked);
        if (udef) {
          btn.dataset.tipTitle = factoryLocked
            ? `${UNIT_NAMES[unit]} · needs ${BUILDING_NAMES[b.type]} level ${unlock!.factoryLevel}`
            : locked && unlock
              ? `${UNIT_NAMES[unit]} · needs City Level ${req}`
            : locked
            ? t('hud.unit_age_locked', { unit: UNIT_NAMES[unit], age: AGE_NAMES[req] })
            : elonCost !== undefined
              ? `${UNIT_NAMES[unit]} · ${elonCost} ELON · ${udef.trainTime}s`
              : t('hud.unit_cost', { unit: UNIT_NAMES[unit], cost: costLongText(udef.cost), time: udef.trainTime })
                + (this.gs.home && HOME_CAMP_SPACE[unit] ? ` · ${t('hud.camp_space', { n: HOME_CAMP_SPACE[unit]! })}` : '');
        }
      }
      // botão de avançar de era (só existe no Centro da Cidade)
      if (this.ageBtn && me) {
        this.ageBtn.classList.toggle('hidden', false);
        if (me.cityPath) {
          this.ageBtn.textContent = t(`path.${me.cityPath}.title`);
          this.ageBtn.disabled = true;
        } else if (myAge >= MAX_AGE) {
          this.ageBtn.textContent = t('hud.age_max', { age: AGE_NAMES[MAX_AGE] });
          this.ageBtn.disabled = true;
        } else if (this.gs.home) {
          this.updateHubButton(this.ageBtn, b, myAge);
        } else if (me.ageProgress !== undefined) {
          this.ageBtn.textContent = t('hud.age_researching', { age: AGE_NAMES[myAge + 1] });
          this.ageBtn.disabled = true;
        } else {
          const cost = AGE_COSTS[myAge + 1] ?? {};
          {
            // regra do AoE2: N prédios DIFERENTES da era atual (casa/fazenda/muralha não contam)
            const needB = buildingsToAdvance(myAge);
            const have = new Set<BuildingType>();
            for (const b of this.gs.buildings.values()) {
              if (b.owner === this.gs.you && b.progress >= 1 && countsForAgeUp(b.type, myAge)) have.add(b.type);
            }
            const completed: BuildingType[] = [];
            for (const cb of this.gs.buildings.values()) if (cb.owner === this.gs.you && cb.progress >= 1) completed.push(cb.type);
            if (!this.gs.home && !layerGateMet(myAge, completed)) {
              this.ageBtn.textContent = t('err.requires_layer', { building: (LAYER_GATE[myAge] ?? []).map((type) => BUILDING_NAMES[type] ?? type).join(' / ') });
              this.ageBtn.disabled = true;
            } else if (have.size < needB) {
              const req = needB > 1 ? t('hud.buildings_diff', { n: needB }) : t('hud.one_building');
              this.ageBtn.textContent = t('hud.age_need', { age: AGE_NAMES[myAge + 1], req, have: have.size, need: needB });
              this.ageBtn.disabled = true;
            } else {
              this.ageBtn.textContent = t('hud.age_advance', { age: AGE_NAMES[myAge + 1], cost: costText(cost) });
              this.ageBtn.disabled = !this.canAfford(cost);
            }
          }
        }
      }
      if (this.upgradeBtn) this.updateUpgradeButton(this.upgradeBtn, b, myAge);
      if (this.unitResearchBtns.size) this.updateUnitResearch(myAge);
      // linha central de pesquisa de era
      if (this.prodAgeRow && this.prodAgeTxt && this.prodAgeFill && me) {
        if (me.ageProgress !== undefined) {
          const pct = Math.round(me.ageProgress * 100);
          this.prodAgeRow.classList.remove('hidden');
          this.prodAgeTxt.textContent = t('hud.researching_age', { age: AGE_NAMES[myAge + 1], pct });
          this.prodAgeFill.style.width = `${pct}%`;
        } else {
          this.prodAgeRow.classList.add('hidden');
        }
      }
      // botões de upgrade (pesquisa) deste prédio
      const myTechs = me?.techs ?? [];
      for (const [techId, btn] of this.researchBtns) {
        const tech = TECH_DEFS.find((t) => t.id === techId);
        if (!tech) continue;
        const done = myTechs.includes(techId);
        const ageLocked = myAge < tech.ageReq;
        const prereqMissing = !!tech.prereq && !myTechs.includes(tech.prereq);
        const busy = b.research !== undefined;
        btn.classList.toggle('off', done || ageLocked || prereqMissing || busy || !this.canAfford(tech.cost));
        btn.classList.toggle('researched', done);
        btn.classList.toggle('locked', !done && (ageLocked || prereqMissing));
        btn.dataset.tipTitle = done
          ? t('hud.tech_done', { tech: techName(tech.id) })
          : ageLocked
            ? t('hud.tech_age_locked', { tech: techName(tech.id), age: AGE_NAMES[tech.ageReq] })
            : prereqMissing
              ? t('hud.tech_prereq', { tech: techName(tech.id), prereq: techName(tech.prereq ?? '') })
              : t('hud.tech_cost', { tech: techName(tech.id), cost: costLongText(tech.cost), time: tech.time });
      }
      // botões de comércio do Mercado: preço ao vivo + disponibilidade
      if (this.tradeBtns.size > 0 && me?.resources) {
        for (const res of ['energy', 'alloys'] as const) {
          const price = this.gs.marketPrices[res] ?? 100;
          const sell = this.tradeBtns.get(`sell:${res}`);
          const buy = this.tradeBtns.get(`buy:${res}`);
          if (sell) {
            const gain = tradeSellGain(price);
            const txt = t('hud.sell', { gain });
            if (sell.textContent !== txt) sell.textContent = txt;
            sell.classList.toggle('off', (me.resources[res] ?? 0) < TRADE_LOT);
          }
          if (buy) {
            const cost = tradeBuyCost(price);
            const txt = t('hud.buy', { cost });
            if (buy.textContent !== txt) buy.textContent = txt;
            buy.classList.toggle('off', (me.resources.compute ?? 0) < cost);
          }
        }
      }
      // linha central: pesquisa de tecnologia deste prédio
      if (this.prodResRow && this.prodResTxt && this.prodResFill) {
        if (b.research) {
          const tech = TECH_DEFS.find((td) => td.id === b.research!.id);
          const pct = Math.round((b.research.progress ?? 0) * 100);
          this.prodResRow.classList.remove('hidden');
          this.prodResTxt.textContent = t('hud.researching_tech', { tech: tech ? techName(tech.id) : '', pct });
          this.prodResFill.style.width = `${pct}%`;
        } else {
          this.prodResRow.classList.add('hidden');
        }
      }
      // Head's started flag is in the signature so its refund tooltip updates.
      const sig = queue.map((q) => q.unit).join(',') + (queue[0]?.progress ? '*' : '');
      if (sig !== this.queueSig && this.queueEl) {
        this.queueSig = sig;
        this.queueEl.innerHTML = '';
        this.headFill = null;
        queue.forEach((item, index) => {
          const q = el('div', 'queue-item', UNIT_ICONS[item.unit] ?? '❔');
          q.title = this.gs.home
            ? t(item.progress > 0 ? 'hud.queue_cancel_started' : 'hud.queue_cancel', { unit: UNIT_NAMES[item.unit] ?? item.unit })
            : t('hud.queue_cancel', { unit: UNIT_NAMES[item.unit] ?? item.unit });
          q.addEventListener('click', () => this.deps.onCancelTrain(this.trainBuildingId, index));
          if (index === 0) {
            const fill = el('div', 'qfill');
            q.appendChild(fill);
            this.headFill = fill;
          }
          this.queueEl?.appendChild(q);
        });
      }
      const head = queue[0];
      if (head && this.headFill) {
        this.headFill.style.height = `${Math.max(0, Math.min(1, head.progress)) * 100}%`;
      }
      if (this.prodTxt && this.prodFill) {
        if (head && b.trainBlocked) {
          // State why the queue is stuck, not just that it is (spec §8.9).
          this.prodTxt.textContent = t(b.trainBlocked === 'no_camp' ? 'hud.queue_blocked_no_camp' : 'hud.queue_blocked_camp_full', { unit: UNIT_NAMES[head.unit] ?? head.unit });
          this.prodFill.style.width = '100%';
        } else if (head) {
          const pct = Math.round(Math.max(0, Math.min(1, head.progress)) * 100);
          this.prodTxt.textContent = t('hud.creating', { unit: UNIT_NAMES[head.unit] ?? head.unit, pct });
          this.prodFill.style.width = `${pct}%`;
        } else {
          this.prodTxt.textContent = t('hud.idle');
          this.prodFill.style.width = '0%';
        }
      }
    }
  }

  /** Client mirror of the server's Hub requirement check, so the button says *why*. */
  private cityLevelBlockers(target: number): string[] {
    const req = HOME_CITY_LEVELS[target];
    const home = this.gs.home;
    const me = this.gs.me();
    if (!req || !home || !me) return ['max level'];
    const out: string[] = [];
    for (const need of req.buildings) {
      const ok = [...this.gs.buildings.values()].some((x) => x.owner === this.gs.you && (x.progress ?? 1) >= 1 && need.types.includes(x.type) && (x.level ?? 1) >= need.level);
      if (!ok) out.push(`${need.types.map((t) => BUILDING_NAMES[t]).join('/')} L${need.level}`);
    }
    const supply = me.power?.supply ?? 0;
    if (supply < req.minSupply || (me.power?.draw ?? 0) > supply) out.push(`grid ${req.minSupply}+ supply`);
    if (req.research && (home.research[req.research.unit] ?? 0) < req.research.level) out.push(`${UNIT_NAMES[req.research.unit]} research L${req.research.level}`);
    const points = HOME_LEVEL_POINTS[target] ?? 0;
    if (home.developmentPoints < points) out.push(`development ${home.developmentPoints}/${points}`);
    return out;
  }

  private updateHubButton(btn: HTMLButtonElement, hub: BuildingSnap, level: number): void {
    const target = level + 1;
    if (level >= 5) { btn.textContent = 'City Level 5 · Specialized City'; btn.disabled = true; return; }
    if (hub.upgradeProgress !== undefined) {
      btn.textContent = `Building City Level ${target} · ${Math.round(hub.upgradeProgress * 100)}%`;
      btn.disabled = true;
      return;
    }
    const cost = homeUpgradeCost('town_center', target);
    const missing = this.cityLevelBlockers(target);
    btn.textContent = missing.length
      ? `City Level ${target} needs: ${missing.join(' · ')}`
      : `Upgrade to City Level ${target} · ${costText(cost)} · ${homeUpgradeTime('town_center', target)}s`;
    btn.disabled = missing.length > 0 || !this.canAfford(cost);
  }

  private updateUpgradeButton(btn: HTMLButtonElement, b: BuildingSnap, cityLevel: number): void {
    const level = b.level ?? 1;
    const max = HOME_MAX_LEVEL[b.type] ?? 1;
    const target = level + 1;
    if (b.upgradeProgress !== undefined) {
      btn.textContent = `Upgrading to level ${target} · ${Math.round(b.upgradeProgress * 100)}%`;
      btn.disabled = true;
    } else if (level >= max) {
      btn.textContent = `Level ${level} · maximum`;
      btn.disabled = true;
    } else if (target > cityLevel) {
      btn.textContent = `Level ${level} · level ${target} needs City Level ${target}`;
      btn.disabled = true;
    } else {
      const cost = homeUpgradeCost(b.type, target);
      btn.textContent = `Upgrade to level ${target} · ${costText(cost)} · ${homeUpgradeTime(b.type, target)}s`;
      btn.disabled = !this.canAfford(cost);
    }
  }

  private updateUnitResearch(cityLevel: number): void {
    const home = this.gs.home;
    if (!home) return;
    for (const [unit, btn] of this.unitResearchBtns) {
      const def = HOME_UNIT_RESEARCH[unit]!;
      const level = home.research[unit] ?? 0;
      const active = home.researching?.unit === unit ? home.researching : undefined;
      const unlockLevel = HOME_UNIT_UNLOCK[unit]?.cityLevel ?? 99;
      const locked = cityLevel < unlockLevel;
      const done = level >= HOME_RESEARCH_MAX;
      const cost = homeResearchCost(unit, level + 1);
      const lvl = btn.querySelector('.lvl');
      if (lvl) lvl.textContent = active ? `${Math.round(active.progress * 100)}%` : String(level);
      btn.classList.toggle('active', !!active);
      btn.classList.toggle('locked', locked);
      btn.classList.toggle('off', locked || done || !!home.researching || !this.canAfford(cost));
      btn.dataset.tipTitle = locked
        ? `${UNIT_NAMES[unit]} research · needs City Level ${unlockLevel}`
        : done
          ? `${UNIT_NAMES[unit]} research · level ${level} (max)`
          : `${UNIT_NAMES[unit]} research L${level + 1} · ${costLongText(cost)} · ${def.time * (level + 1)}s`;
      btn.dataset.tipDesc = `+${Math.round(def.perLevel * 100)}% ${def.effect} per level. ${home.researching && !active ? 'The lab is busy.' : ''}`;
    }
  }

  /** Descrição curta do efeito de um upgrade, para o tooltip. */
  private techEffectText(tech: TechDef): string {
    const parts: string[] = [];
    if (tech.addAttack) parts.push(t('hud.eff_attack', { n: tech.addAttack }));
    if (tech.addArmor) parts.push(t('hud.eff_armor', { n: tech.addArmor }));
    if (tech.addHp) parts.push(t('hud.eff_hp', { n: tech.addHp }));
    if (tech.addRange) parts.push(t('hud.eff_range', { n: tech.addRange }));
    // techs econômicas (Mercado)
    if (tech.gather) {
      for (const [res, frac] of Object.entries(tech.gather)) {
        parts.push(t('hud.eff_gather', { pct: Math.round((frac ?? 0) * 100), res: RESOURCE_NAMES[res as ResourceType] }));
      }
    }
    if (tech.carry) parts.push(t('hud.eff_carry', { n: tech.carry }));
    if (tech.defense?.attack) parts.push(t('hud.eff_def_attack', { n: tech.defense.attack }));
    if (tech.defense?.range) parts.push(t('hud.eff_def_range', { n: tech.defense.range }));
    const who = tech.units.length ? ` (${tech.units.map((u) => UNIT_NAMES[u]).join(', ')})` : '';
    return `${parts.join(', ')}${who} • ${costLongText(tech.cost)} • ${tech.time}s`;
  }

  private canAfford(cost: Partial<Record<ResourceType, number>>): boolean {
    const me = this.gs.me();
    if (!me || !me.resources) return false;
    for (const [r, v] of Object.entries(cost) as [ResourceType, number][]) {
      if ((me.resources[r] ?? 0) < (v ?? 0)) return false;
    }
    return true;
  }
}
