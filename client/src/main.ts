// Entry point. The game is the player's Home city: it boots straight onto the
// map (no landing, lobby or room pages) and the only other page is the city
// ledger, where activity is logged and ELON is settled.

import type { BuildingType, GameCommand, HomeLedgerView, ServerMessage } from '@age/shared';
import { Net } from './net';
import { music } from './music';
import { toast } from './ui';
import { settings, saveSettings } from './settings';
import { t, applyLang, AGE_NAMES, BUILDING_NAMES, L } from './i18n';
import { getClientId, getSavedName, saveName } from './identity';
import { GameScreen } from './screens/game';
import { SettingsOverlay } from './screens/settings';
import { LedgerPage } from './screens/ledger';
import { SkirmishLauncher, savedSkirmishOptions, type SkirmishOptions } from './screens/skirmish';
import { BattleReport } from './screens/report';
import './style.css';
import './watt.css';
import './atlas.css';

type ScreenName = 'boot' | 'game';

const app = document.getElementById('app');
if (!app) throw new Error('elemento #app não encontrado');
document.documentElement.lang = settings.lang;

const connBadge = document.createElement('div');
connBadge.id = 'conn-badge';
document.body.appendChild(connBadge);

const net = new Net();

let current: ScreenName = 'boot';
let pendingName = '';
let gameScreen: GameScreen | null = null;
let gamePaused = false;
let gameSession: 'arena' | 'home' | 'raid' = 'home';
// A short network hiccup reconnects on its own; only a lasting drop is shown.
let connLostTimer: number | null = null;
let lastSettlements: number | null = null;
let myId = -1;
let lastSkirmish: SkirmishOptions = savedSkirmishOptions();
let reportView: BattleReport | null = null;

// ---------------------------------------------------------------- skirmish

function startSkirmish(options: SkirmishOptions): void {
  lastSkirmish = options;
  net.send({ type: 'startSkirmish', ...options });
}
const skirmishLauncher = new SkirmishLauncher(startSkirmish);
document.body.appendChild(skirmishLauncher.el);
function returnToCity(): void {
  reportView?.el.remove();
  reportView = null;
  net.send({ type: 'enterHome' });
}

// ---------------------------------------------------------------- ledger page

const ledgerPage = new LedgerPage({
  onClose: () => ledgerPage.hide(),
  onSettle: () => net.send({ type: 'ledger', action: { kind: 'settle' } }),
  onRetryAnchor: (id) => net.send({ type: 'ledger', action: { kind: 'anchor', id } }),
});
document.body.appendChild(ledgerPage.el);
function openLedger(): void {
  ledgerPage.show();
  net.send({ type: 'ledger', action: { kind: 'open' } });
}

// ---------------------------------------------------------------- settings

const settingsOverlay = new SettingsOverlay({
  onMusicVol: (v) => { music.setVolume(v); settings.musicVol = v; saveSettings(); },
  onSfxVol: (v) => { gameScreen?.setSfxVolume(v); settings.sfxVol = v; saveSettings(); },
  onRenderScale: (s) => { gameScreen?.setRenderScale(s); settings.renderScale = s; saveSettings(); },
  onLang: (lang) => {
    applyLang(lang);
    saveSettings();
    document.documentElement.lang = lang;
    gearBtn.title = t('opt.title');
    gearBtn.setAttribute('aria-label', t('opt.title'));
    bootStatus.textContent = L('Opening your city…', 'Abrindo sua cidade…', 'Abriendo tu ciudad…');
    gameScreen?.retranslate();
    settingsOverlay.retranslate();
    ledgerPage.retranslate();
  },
  // In the city there is nothing to leave; in a skirmish, leaving concedes.
  onLeaveRoom: () => {
    settingsOverlay.hide();
    if (gameSession === 'arena') returnToCity();
  },
});
document.body.appendChild(settingsOverlay.el);

const gearBtn = document.createElement('button');
gearBtn.id = 'settings-gear';
gearBtn.title = t('opt.title');
gearBtn.setAttribute('aria-label', t('opt.title'));
gearBtn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
gearBtn.addEventListener('click', () => settingsOverlay.show());
document.body.appendChild(gearBtn);

// ---------------------------------------------------------------- boot view

const bootEl = document.createElement('div');
bootEl.className = 'boot-screen';
bootEl.innerHTML = '<div class="boot-mark">AGE OF AI</div>';
const bootStatus = document.createElement('p');
bootStatus.className = 'boot-status';
bootStatus.textContent = L('Opening your city…', 'Abrindo sua cidade…', 'Abriendo tu ciudad…');
const bootRetry = document.createElement('button');
bootRetry.className = 'boot-retry';
bootRetry.textContent = L('Open my city here', 'Abrir minha cidade aqui', 'Abrir mi ciudad aquí');
bootRetry.hidden = true;
bootRetry.addEventListener('click', () => { bootRetry.hidden = true; bootStatus.textContent = L('Opening your city…', 'Abrindo sua cidade…', 'Abriendo tu ciudad…'); net.send({ type: 'enterHome' }); });
bootEl.append(bootStatus, bootRetry);

/** Sign in with the saved name, or a generated commander name on first visit. */
let signInAttempt = 0;
function autoSignIn(): void {
  if (!net.isOpen) return;
  const saved = getSavedName();
  const base = saved || `Commander-${getClientId().replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase() || '0001'}`;
  const name = signInAttempt === 0 ? base : `${base.slice(0, 16)}-${Math.floor(10 + Math.random() * 90)}`;
  signInAttempt++;
  pendingName = name;
  net.send({ type: 'setName', name, clientId: getClientId() });
}

function showScreen(name: ScreenName): void {
  current = name;
  app!.innerHTML = '';
  app!.appendChild(name === 'game' && gameScreen ? gameScreen.el : bootEl);
  document.body.classList.toggle('in-game', name === 'game');
  settingsOverlay.setLeaveContext(false, false);
  music.setState(name === 'game' ? 'game' : 'menu');
}

document.addEventListener('pointerdown', () => music.unlock(), { once: true });
music.setVolume(settings.musicVol);
music.setState('menu');

// ---------------------------------------------------------------- network

net.onStatus = (status) => {
  if (status === 'open') {
    connBadge.textContent = '';
    // First connection, or a reconnect: sign in again and reopen the city.
    autoSignIn();
  } else if (status === 'connecting') {
    connBadge.textContent = current === 'boot' ? t('conn.connecting') : '';
  } else if (status === 'closed') {
    if (current === 'game') {
      if (connLostTimer === null) {
        connLostTimer = window.setTimeout(() => {
          connLostTimer = null;
          if (current === 'game') gameScreen?.showConnLost();
        }, 4000);
      }
    } else {
      connBadge.textContent = t('conn.lost_retry');
    }
  }
};

net.onMessage = (msg: ServerMessage) => {
  try {
    dispatch(msg);
  } catch (err) {
    console.error('Erro ao tratar mensagem do servidor:', err);
  }
};

function dispatch(msg: ServerMessage): void {
  switch (msg.type) {
    case 'nameOk': {
      signInAttempt = 0;
      if (pendingName) saveName(pendingName);
      net.send({ type: 'enterHome' });
      break;
    }
    case 'nameTaken': {
      if (signInAttempt < 6) autoSignIn();
      else bootStatus.textContent = t('name.taken');
      break;
    }
    case 'leftRoom': {
      // Sent when this city was opened in another tab or device.
      teardownGame();
      ledgerPage.hide();
      showScreen('boot');
      bootStatus.textContent = t('err.home_taken_over');
      bootRetry.hidden = false;
      break;
    }
    case 'error': {
      if (msg.code) {
        const params: Record<string, string | number> = { ...(msg.params ?? {}) };
        if (typeof params.age === 'number') params.age = AGE_NAMES[params.age] ?? params.age;
        if (typeof params.building === 'string') params.building = BUILDING_NAMES[params.building as BuildingType] ?? params.building;
        toast(t(msg.code, params), 'error');
      } else if (msg.message) {
        toast(msg.message, 'error');
      }
      break;
    }
    case 'chat': {
      gameScreen?.addChat(msg.from, msg.text);
      break;
    }
    case 'gameStart': {
      if (connLostTimer !== null) { clearTimeout(connLostTimer); connLostTimer = null; }
      teardownGame();
      gamePaused = false;
      gameSession = msg.session ?? 'home';
      myId = msg.you;
      reportView?.el.remove();
      reportView = null;
      gameScreen = new GameScreen(msg.map, msg.players, msg.you, {
        onCommand: (cmd: GameCommand) => net.send({ type: 'cmd', cmd }),
        onChat: (text) => net.send({ type: 'chat', text }),
        onTogglePause: () => net.send({ type: 'setPause', paused: !gamePaused }),
        onPing: (x, y) => net.send({ type: 'ping', x, y }),
        onRaid: (action) => net.send({ type: 'raid', action }),
        onOpenLedger: openLedger,
        onSkirmish: () => skirmishLauncher.show(),
        // Reload the city (connection-lost overlay, raid views): back home.
        onBackToLobby: () => net.send(gameSession === 'raid' ? { type: 'raid', action: { kind: 'return' } } : { type: 'enterHome' }),
      }, false, false, 'symbiosis', gameSession);
      showScreen('game');
      settingsOverlay.setLeaveContext(gameSession === 'arena', gameSession === 'arena');
      break;
    }
    case 'gameOver': {
      if (gameSession !== 'arena') break;
      if (msg.report) {
        reportView = new BattleReport(msg.report, myId, !!msg.won, { onHome: returnToCity, onRematch: () => startSkirmish(lastSkirmish) });
        document.body.appendChild(reportView.el);
      } else {
        toast(msg.won ? 'Victory!' : 'Defeat.', 'info');
      }
      break;
    }
    case 'gamePaused': {
      gamePaused = msg.paused;
      gameScreen?.setPaused(msg.paused, msg.by);
      break;
    }
    case 'focus': {
      gameScreen?.focus(msg.x, msg.y);
      break;
    }
    case 'ping': {
      gameScreen?.state.pings.push({ x: msg.x, y: msg.y, at: performance.now(), color: msg.color });
      break;
    }
    case 'snapshot': {
      gameScreen?.state.applySnapshot({
        tick: msg.tick,
        units: msg.units,
        buildings: msg.buildings,
        nodes: msg.nodes,
        sheep: msg.sheep,
        players: msg.players,
        market: msg.market,
        spectators: msg.spectators,
        chain: msg.chain,
        raid: msg.raid,
        home: msg.home,
      });
      break;
    }
    case 'ledger': {
      const view = msg.view as HomeLedgerView;
      if (lastSettlements !== null && view.settlements.length > lastSettlements) gameScreen?.playSettleCue();
      lastSettlements = view.settlements.length;
      ledgerPage.render(view);
      break;
    }
    default:
      break;
  }
}

function teardownGame(): void {
  if (gameScreen) {
    gameScreen.destroy();
    gameScreen = null;
  }
}

// ---------------------------------------------------------------- start

showScreen('boot');
net.connect();
window.addEventListener('pagehide', () => net.close());
