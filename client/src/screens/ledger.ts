// City ledger page: the hash-chained log of the city's activity, the ELON
// balance and its settlements, and where each settlement is anchored.

import type { ElonSettlement, HomeLedgerView } from '@age/shared';
import { L } from '../i18n';
import { el } from '../ui';

export interface LedgerDeps {
  onClose: () => void;
  onSettle: () => void;
  onRetryAnchor: (id: string) => void;
}

const short = (hash: string) => (hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash);
const time = (at: number) => new Date(at).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });

const STATUS_TEXT: Record<ElonSettlement['status'], () => string> = {
  pending: () => L('Anchoring…', 'Ancorando…', 'Anclando…'),
  disabled: () => L('In city ledger (chain off)', 'No ledger da cidade (chain desligada)', 'En el ledger (chain apagada)'),
  local: () => L('Local anchor', 'Âncora local', 'Ancla local'),
  simulated: () => L('Simulated', 'Simulado', 'Simulado'),
  submitted: () => L('Submitted', 'Enviado', 'Enviado'),
  confirmed: () => L('Confirmed on chain', 'Confirmado na chain', 'Confirmado en la chain'),
  failed: () => L('Anchor failed', 'Âncora falhou', 'Ancla fallida'),
  skipped: () => L('Skipped', 'Ignorado', 'Omitido'),
};

const KIND_TEXT: Record<string, () => string> = {
  genesis: () => L('Genesis', 'Gênese', 'Génesis'),
  build: () => L('Build', 'Obra', 'Obra'),
  upgrade: () => L('Upgrade', 'Melhoria', 'Mejora'),
  manufacture: () => L('Factory', 'Fábrica', 'Fábrica'),
  research: () => L('Research', 'Pesquisa', 'Investigación'),
  raid: () => L('Raid', 'Ataque', 'Ataque'),
  defense: () => L('Defense', 'Defesa', 'Defensa'),
  elon: () => 'ELON',
  settlement: () => L('Settlement', 'Liquidação', 'Liquidación'),
};

export class LedgerPage {
  readonly el = el('section', 'ledger-page hidden');
  private body = el('div', 'ledger-body');
  private view: HomeLedgerView | null = null;

  constructor(private readonly deps: LedgerDeps) {
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'City ledger');
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.deps.onClose(); });
    this.el.appendChild(this.body);
    this.paint();
  }

  show(): void {
    this.el.classList.remove('hidden');
    this.el.tabIndex = -1;
    this.el.focus();
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  render(view: HomeLedgerView): void {
    this.view = view;
    this.paint();
  }

  retranslate(): void {
    this.paint();
  }

  private paint(): void {
    const v = this.view;
    const b = this.body;
    b.innerHTML = '';
    const top = el('header', 'ledger-top');
    const titles = el('div', 'ledger-titles');
    titles.appendChild(el('span', 'ledger-kicker', L('City ledger', 'Ledger da cidade', 'Ledger de la ciudad')));
    titles.appendChild(el('h1', '', v?.city ?? L('Loading…', 'Carregando…', 'Cargando…')));
    top.appendChild(titles);
    const back = el('button', 'ledger-back', L('← Back to city', '← Voltar à cidade', '← Volver a la ciudad'));
    back.addEventListener('click', () => this.deps.onClose());
    top.appendChild(back);
    b.appendChild(top);
    if (!v) return;

    const chips = el('div', 'ledger-chips');
    chips.appendChild(el('span', `ledger-chip ${v.verified ? 'ok' : 'bad'}`, v.verified
      ? L('✓ Chain verified', '✓ Cadeia verificada', '✓ Cadena verificada')
      : L('✕ Verification failed', '✕ Verificação falhou', '✕ Verificación fallida')));
    chips.appendChild(el('span', 'ledger-chip', `${L('Block', 'Bloco', 'Bloque')} #${v.height} · ${short(v.head)}`));
    const chainText = v.chain.mode === 'rpc'
      ? `${L('Anchoring to contract', 'Ancorando no contrato', 'Anclando en el contrato')} ${short(v.chain.contract ?? '')}`
      : v.chain.mode === 'local'
        ? L('Local anchor (dev)', 'Âncora local (dev)', 'Ancla local (dev)')
        : L('Chain anchoring off · hash-chained locally', 'Âncora na chain desligada · encadeado localmente', 'Anclaje apagado · encadenado localmente');
    chips.appendChild(el('span', `ledger-chip ${v.chain.mode === 'rpc' ? 'ok' : 'warn'}`, chainText));
    if (v.pending) chips.appendChild(el('span', 'ledger-chip', `${v.pending} ${L('pending, sealed every minute', 'pendentes, selados a cada minuto', 'pendientes, sellados cada minuto')}`));
    b.appendChild(chips);

    const primer = el('section', 'ledger-primer');
    const concept = (icon: string, title: string, text: string, foot: string) => {
      const card = el('article', 'ledger-primer-card');
      card.appendChild(el('span', 'ledger-primer-icon', icon));
      const copy = el('div');
      copy.appendChild(el('h2', '', title));
      copy.appendChild(el('p', '', text));
      copy.appendChild(el('small', '', foot));
      card.appendChild(copy);
      primer.appendChild(card);
    };
    concept('E', L('ELON is contribution', 'ELON é contribuição', 'ELON es contribución'), L(
      'Energy, Labor, Obligation and Need. Earn standing by building useful infrastructure, producing responsibly and serving needs.',
      'Energia, Trabalho, Obrigação e Necessidade. Ganhe reputação construindo infraestrutura útil, produzindo com responsabilidade e atendendo necessidades.',
      'Energía, Trabajo, Obligación y Necesidad. Gana reputación construyendo infraestructura útil, produciendo responsablemente y atendiendo necesidades.'), L(
      'Non-transferable · not cryptocurrency · not a wallet balance',
      'Não transferível · não é criptomoeda · não é saldo de carteira',
      'No transferible · no es criptomoneda · no es saldo de cartera'));
    concept('▦', L('The ledger preserves history', 'O ledger preserva o histórico', 'El ledger preserva el historial'), L(
      'Important actions become linked records. Changing an older record would break the hashes that follow it.',
      'Ações importantes viram registros encadeados. Alterar um registro antigo quebraria os hashes seguintes.',
      'Las acciones importantes se vuelven registros enlazados. Cambiar uno antiguo rompería los hashes siguientes.'), L(
      'The authoritative server still decides every move and result',
      'O servidor autoritativo ainda decide cada ação e resultado',
      'El servidor autoritativo sigue decidiendo cada acción y resultado'));
    concept('◇', L('Blockchain is an optional receipt', 'Blockchain é um recibo opcional', 'Blockchain es un recibo opcional'), L(
      'When enabled, only a final ledger hash is anchored to a contract. It proves which record existed; it does not run the match or store ordinary gameplay.',
      'Quando ativada, apenas um hash final do ledger é ancorado em um contrato. Ele prova qual registro existia; não executa a partida nem guarda o gameplay comum.',
      'Cuando está activa, solo un hash final del ledger se ancla en un contrato. Prueba qué registro existía; no ejecuta la partida ni guarda el juego normal.'), L(
      'No token · no NFT · no pay-to-win · the game works with chain off',
      'Sem token · sem NFT · sem pay-to-win · o jogo funciona com a chain desligada',
      'Sin token · sin NFT · sin pay-to-win · el juego funciona con la cadena apagada'));
    b.appendChild(primer);

    // ELON balance and settlement.
    const grid = el('div', 'ledger-grid');
    const elon = el('article', 'ledger-card ledger-elon');
    elon.appendChild(el('h2', '', 'ELON'));
    const big = el('div', 'ledger-big', v.elon.balance.toFixed(2));
    elon.appendChild(big);
    const stats = el('dl', 'ledger-stats');
    const stat = (k: string, val: string) => { const d = el('div'); d.appendChild(el('dt', '', k)); d.appendChild(el('dd', '', val)); stats.appendChild(d); };
    stat(L('Capacity', 'Capacidade', 'Capacidad'), String(v.elon.capacity));
    stat(L('Per minute', 'Por minuto', 'Por minuto'), `+${v.elon.perMinute}`);
    stat(L('Settled total', 'Total liquidado', 'Total liquidado'), String(v.elon.settledTotal));
    elon.appendChild(stats);
    const whole = Math.floor(v.elon.balance);
    const settle = el('button', 'ledger-settle', whole >= 1
      ? L(`Settle ${whole} ELON`, `Liquidar ${whole} ELON`, `Liquidar ${whole} ELON`)
      : L('Nothing to settle yet', 'Nada para liquidar ainda', 'Nada que liquidar aún'));
    settle.disabled = whole < 1;
    settle.addEventListener('click', () => { settle.disabled = true; this.deps.onSettle(); });
    elon.appendChild(settle);
    elon.appendChild(el('p', 'ledger-note', L(
      'Settling records whole ELON in a sealed ledger block. If blockchain anchoring is enabled, only that block hash is submitted as a receipt.',
      'Liquidar registra o ELON inteiro em um bloco selado do ledger. Se a ancoragem blockchain estiver ativa, apenas o hash desse bloco é enviado como recibo.',
      'Liquidar registra el ELON entero en un bloque sellado del ledger. Si el anclaje blockchain está activo, solo el hash de ese bloque se envía como recibo.')));
    grid.appendChild(elon);

    const sets = el('article', 'ledger-card');
    sets.appendChild(el('h2', '', L('Settlements', 'Liquidações', 'Liquidaciones')));
    if (!v.settlements.length) sets.appendChild(el('p', 'ledger-note', L('No settlements yet.', 'Nenhuma liquidação ainda.', 'Aún no hay liquidaciones.')));
    else {
      const wrap = el('div', 'ledger-scroll');
      const table = el('table', 'ledger-table');
      table.innerHTML = `<thead><tr><th>${L('When', 'Quando', 'Cuándo')}</th><th>ELON</th><th>${L('Block', 'Bloco', 'Bloque')}</th><th>${L('Anchor', 'Âncora', 'Ancla')}</th><th>Tx</th><th></th></tr></thead>`;
      const tb = el('tbody');
      for (const s of v.settlements) {
        const tr = el('tr');
        tr.appendChild(el('td', '', time(s.at)));
        tr.appendChild(el('td', 'num', String(s.amount)));
        tr.appendChild(el('td', 'num', `#${s.ledgerHeight}`));
        const st = el('td');
        st.appendChild(el('span', `ledger-status ${s.status}`, STATUS_TEXT[s.status]()));
        if (s.error) st.title = s.error;
        tr.appendChild(st);
        tr.appendChild(el('td', 'mono', s.transactionHash ? short(s.transactionHash) : short(s.ledgerHead)));
        const act = el('td');
        if (s.status === 'failed' || s.status === 'pending') {
          const retry = el('button', 'ledger-retry', L('Retry anchor', 'Tentar de novo', 'Reintentar'));
          retry.addEventListener('click', () => this.deps.onRetryAnchor(s.id));
          act.appendChild(retry);
        }
        tr.appendChild(act);
        tb.appendChild(tr);
      }
      table.appendChild(tb);
      wrap.appendChild(table);
      sets.appendChild(wrap);
    }
    grid.appendChild(sets);
    b.appendChild(grid);

    // Blocks, newest first, each pointing at its parent.
    const chain = el('article', 'ledger-card');
    chain.appendChild(el('h2', '', L('Blocks', 'Blocos', 'Bloques')));
    const strip = el('ol', 'ledger-blocks');
    for (const blk of v.blocks) {
      const li = el('li', 'ledger-block');
      li.appendChild(el('strong', '', `#${blk.height}`));
      li.appendChild(el('span', 'mono', short(blk.hash)));
      li.appendChild(el('span', 'mono dim', `← ${short(blk.prevHash)}`));
      li.appendChild(el('span', 'dim', `${blk.txCount} tx · ${time(blk.at)}`));
      strip.appendChild(li);
    }
    chain.appendChild(strip);
    b.appendChild(chain);

    // Activity log.
    const log = el('article', 'ledger-card');
    log.appendChild(el('h2', '', L('Activity', 'Atividade', 'Actividad')));
    const wrap = el('div', 'ledger-scroll');
    const table = el('table', 'ledger-table');
    table.innerHTML = `<thead><tr><th>${L('When', 'Quando', 'Cuándo')}</th><th>${L('Type', 'Tipo', 'Tipo')}</th><th>${L('Event', 'Evento', 'Evento')}</th><th>${L('Amount', 'Valor', 'Valor')}</th><th>${L('Block', 'Bloco', 'Bloque')}</th><th>Hash</th></tr></thead>`;
    const tb = el('tbody');
    for (const tx of v.txs) {
      const tr = el('tr');
      tr.appendChild(el('td', '', time(tx.at)));
      const k = el('td');
      k.appendChild(el('span', `ledger-kind ${tx.kind}`, (KIND_TEXT[tx.kind] ?? (() => tx.kind))()));
      tr.appendChild(k);
      tr.appendChild(el('td', '', tx.label));
      tr.appendChild(el('td', 'num', tx.amount ? String(tx.amount) : '—'));
      tr.appendChild(el('td', 'num', tx.block !== undefined ? `#${tx.block}` : L('pending', 'pendente', 'pendiente')));
      tr.appendChild(el('td', 'mono', short(tx.hash)));
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    wrap.appendChild(table);
    log.appendChild(wrap);
    b.appendChild(log);
  }
}
