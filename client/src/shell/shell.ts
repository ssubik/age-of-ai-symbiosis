// WATT Arena application frame (components/Shell.tsx): left navigation grouped
// by the question each view answers, crumbs + world facts, and the ELON bar.
import { L, fmt, h } from './kit';
import { chainState, onChain, refreshChain } from './data';
import { renderCampaigns, renderCodex, renderLedger, renderProof, renderStewardship, type PageId, type PageNav } from './pages';

export interface ShellDeps {
  /** Content for the Play Realm view (lobby or room), owned by main.ts. */
  playContent: () => HTMLElement;
  playCrumb: () => string;
  onSettings: () => void;
  onNavigate: (page: PageId) => void;
  playerName: () => string;
  /** False before the player has entered a name (guest browsing from the landing page). */
  signedIn: () => boolean;
  onEnterWorld: () => void;
}

interface NavLink { id: PageId | 'settings'; icon: string; label: string; hint: string }

export class Shell {
  readonly el: HTMLElement;
  private nav!: HTMLElement;
  private crumbs!: HTMLElement;
  private facts!: HTMLElement;
  private foot!: HTMLElement;
  private body!: HTMLElement;
  private page: PageId = 'play';
  private matchId: string | undefined;
  private repaintProof: (() => void) | null = null;
  private poll: number | null = null;

  constructor(private deps: ShellDeps) {
    this.el = h('div', 'wattApp');
    this.build();
    onChain(() => {
      this.paintFacts();
      if (this.page === 'proof') this.repaintProof?.();
    });
  }

  private sections(): { group: string; links: NavLink[] }[] {
    return [
      { group: L('Command', 'Comando', 'Mando'), links: [
        { id: 'play', icon: '⌁', label: L('Play Realm', 'Jogar', 'Jugar'), hint: L('Rooms and matches', 'Salas e partidas', 'Salas y partidas') },
      ] },
      { group: L('Civilization', 'Civilização', 'Civilización'), links: [
        { id: 'stewardship', icon: '♜', label: 'Stewardship', hint: L('Contribution and reliability', 'Contribuição e confiabilidade', 'Contribución y fiabilidad') },
      ] },
      { group: L('World', 'Mundo', 'Mundo'), links: [
        { id: 'ledger', icon: '≡', label: L('Commons Ledger', 'Ledger comum', 'Ledger común'), hint: L('Every posting, hash-chained', 'Cada lançamento, encadeado', 'Cada asiento, encadenado') },
        { id: 'campaigns', icon: '◇', label: L('Campaigns', 'Campanhas', 'Campañas'), hint: L('History and audit trail', 'Histórico e auditoria', 'Historial y auditoría') },
      ] },
      { group: L('System', 'Sistema', 'Sistema'), links: [
        { id: 'codex', icon: '?', label: L('Codex', 'Códice', 'Códice'), hint: L('World rules and how to play', 'Regras e como jogar', 'Reglas y cómo jugar') },
        { id: 'proof', icon: '⬡', label: L('Proof layer', 'Camada de prova', 'Capa de prueba'), hint: L('Local audit commitments', 'Compromissos de auditoria', 'Compromisos de auditoría') },
        { id: 'settings', icon: '⚙', label: L('Settings', 'Opções', 'Opciones'), hint: L('Audio, language, display', 'Áudio, idioma, tela', 'Audio, idioma, pantalla') },
      ] },
    ];
  }

  private build(): void {
    this.el.innerHTML = '';
    const brand = h('a', { class: 'brand', href: '#' }, h('i'), ' AGE OF SYMBIOSIS');
    brand.addEventListener('click', (e) => { e.preventDefault(); this.deps.onNavigate('play'); });
    this.nav = h('nav', { class: 'waNav', 'aria-label': 'Sections' }, brand);
    for (const s of this.sections()) {
      const group = h('div', '', h('div', 'waNavGroup', s.group));
      for (const link of s.links) {
        const a = h('a', { class: 'waNavLink', href: '#', 'data-page': link.id }, h('i', { 'aria-hidden': 'true' }, link.icon), h('span', '', link.label, h('small', '', link.hint)));
        a.addEventListener('click', (e) => {
          e.preventDefault();
          if (link.id === 'settings') this.deps.onSettings();
          else this.deps.onNavigate(link.id);
        });
        group.append(a);
      }
      this.nav.append(group);
    }
    this.foot = h('div', 'waNavFoot');
    this.nav.append(this.foot);
    this.crumbs = h('div', 'waCrumbs');
    this.facts = h('div', 'waTopFacts');
    const codex = h('a', { href: '#' }, L('Open Codex →', 'Abrir Códice →', 'Abrir Códice →'));
    codex.addEventListener('click', (e) => { e.preventDefault(); this.deps.onNavigate('codex'); });
    const elonBar = h('div', 'waElonBar',
      h('b', '', L('COMMONS PROTOCOL · ELON', 'PROTOCOLO COMUM · ELON', 'PROTOCOLO COMÚN · ELON')),
      h('span', '', L('Energy · Labor · Obligation · Need — a memory of contribution, never money.', 'Energia · Trabalho · Obrigação · Necessidade — uma memória de contribuição, nunca dinheiro.', 'Energía · Trabajo · Obligación · Necesidad — una memoria de contribución, nunca dinero.')),
      codex);
    this.body = h('div', 'waBody');
    this.el.append(h('div', 'waShell', this.nav, h('div', 'waMain', h('header', 'waTopbar', this.crumbs, this.facts), elonBar, this.body)));
  }

  retranslate(): void {
    this.build();
    this.show(this.page, this.matchId);
  }

  /** Called when the element is mounted/unmounted so chain polling only runs while visible. */
  setVisible(visible: boolean): void {
    if (visible && this.poll === null) {
      void refreshChain();
      this.poll = window.setInterval(() => void refreshChain(), 10_000);
    } else if (!visible && this.poll !== null) {
      window.clearInterval(this.poll);
      this.poll = null;
    }
  }

  get current(): PageId {
    return this.page;
  }

  show(page: PageId, matchId?: string): void {
    this.page = page;
    this.matchId = matchId;
    this.repaintProof = null;
    for (const a of this.nav.querySelectorAll<HTMLElement>('.waNavLink')) {
      if (a.dataset.page === page) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    const titles: Record<PageId, string> = {
      play: this.deps.playCrumb(),
      stewardship: 'Stewardship',
      ledger: L('Commons Ledger', 'Ledger comum', 'Ledger común'),
      campaigns: L('Campaigns', 'Campanhas', 'Campañas'),
      codex: L('Codex', 'Códice', 'Códice'),
      proof: L('Proof Layer', 'Camada de Prova', 'Capa de Prueba'),
    };
    this.crumbs.innerHTML = '';
    const root = h('a', { class: 'waLink', href: '#' }, 'Age of Symbiosis');
    root.addEventListener('click', (e) => { e.preventDefault(); this.deps.onNavigate('play'); });
    this.crumbs.append(h('span', '', root), h('span', '', h('em', { 'aria-hidden': 'true' }, '/ '), h('b', '', titles[page])));
    if (matchId && page !== 'play') this.crumbs.append(h('span', '', h('em', { 'aria-hidden': 'true' }, '/ '), h('b', '', matchId)));

    this.body.innerHTML = '';
    this.body.classList.toggle('waPlay', page === 'play');
    const nav: PageNav = { go: (p, id) => (id ? this.show(p, id) : this.deps.onNavigate(p)) };
    switch (page) {
      case 'play':
        if (this.deps.signedIn()) this.body.append(this.deps.playContent());
        else this.body.append(this.guestCard());
        break;
      case 'stewardship': renderStewardship(this.body, nav, matchId); break;
      case 'ledger': renderLedger(this.body, nav, matchId); break;
      case 'campaigns': renderCampaigns(this.body, nav); break;
      case 'codex': renderCodex(this.body, nav); break;
      case 'proof': this.repaintProof = renderProof(this.body, nav); break;
    }
    this.body.scrollTop = 0;
    window.scrollTo(0, 0);
    this.paintFacts();
  }

  /** Re-mounts the Play Realm content (lobby ↔ room) without touching the frame. */
  refreshPlay(): void {
    if (this.page === 'play') this.show('play');
  }

  private guestCard(): HTMLElement {
    const btn = h('button', 'button', L('Enter the world →', 'Entrar no mundo →', 'Entrar al mundo →'));
    btn.addEventListener('click', () => this.deps.onEnterWorld());
    return h('div', 'waHead',
      h('div', 'waEyebrow', L('Play Realm', 'Jogar', 'Jugar')),
      h('h1', '', L('Choose a commander name to play', 'Escolha um nome de comandante para jogar', 'Elige un nombre de comandante para jugar')),
      h('p', '', L('Rooms, bots, and matches open once you enter the world. Every other page works without signing in.', 'Salas, bots e partidas abrem depois de entrar no mundo. As outras páginas funcionam sem entrar.', 'Salas, bots y partidas se abren al entrar al mundo. Las demás páginas funcionan sin entrar.')),
      h('div', { style: 'margin-top:18px' }, btn));
  }

  private paintFacts(): void {
    const { status, unreachable } = chainState();
    const chainText = unreachable ? L('Server unreachable', 'Servidor fora do ar', 'Servidor inaccesible')
      : !status ? '…'
        : status.mode === 'rpc'
          ? status.online ? L(`Online · block ${fmt(status.block ?? 0)}`, `Online · bloco ${fmt(status.block ?? 0)}`, `Online · bloque ${fmt(status.block ?? 0)}`) : L('Node offline', 'Nó offline', 'Nodo offline')
          : status.mode === 'local' ? L('Local proofs', 'Provas locais', 'Pruebas locales') : L('Proofs off', 'Provas desligadas', 'Pruebas desactivadas');
    const record = status ? L(`${fmt(status.archives)} archived · ${fmt(status.commitments)} on-chain`, `${fmt(status.archives)} arquivadas · ${fmt(status.commitments)} on-chain`, `${fmt(status.archives)} archivadas · ${fmt(status.commitments)} on-chain`) : '…';
    const signed = this.deps.signedIn();
    this.facts.innerHTML = '';
    this.facts.append(
      h('span', '', L('Commander', 'Comandante', 'Comandante'), h('b', '', signed ? this.deps.playerName() : L('Guest', 'Visitante', 'Visitante'))),
      h('span', '', L('Proof chain', 'Cadeia de prova', 'Cadena de prueba'), h('b', '', chainText)),
      h('span', '', L('Record', 'Registro', 'Registro'), h('b', '', record)),
    );
    this.foot.innerHTML = '';
    this.foot.append(
      h('b', '', status?.mode === 'rpc' && status.online ? `Anvil · chain ${status.chainId ?? '?'}` : L('Proof layer', 'Camada de prova', 'Capa de prueba')),
      status?.contract ? `Registry ${status.contract.slice(0, 8)}…${status.contract.slice(-4)}` : L('Ledger archived locally', 'Ledger arquivado localmente', 'Ledger archivado localmente'),
      h('br'),
      L('Every Symbiosis match is hash-chained.', 'Toda partida Simbiose é encadeada por hash.', 'Toda partida Simbiosis se encadena por hash.'),
    );
  }
}
