// Tela 5: Fim de jogo — battlefield result plus the WATT Arena stewardship
// record (standing + stewardship + reliability) and the on-chain receipt.

import type { MatchCommitment, Standing } from '@age/shared';
import { t } from '../i18n';
import { L, badge, defs, code, fmt, grid, h, meter, panel, pct, shortHash } from '../shell/kit';
import { proofTone, stewardshipTable } from '../shell/pages';
import { SEAT_COLORS } from '../shell/data';

export interface GameOverDeps {
  onBackToLobby: () => void;
  onOpenStewardship: () => void;
}

export class GameOverScreen {
  readonly el: HTMLElement;
  private card: HTMLElement;
  private proofSlot: HTMLElement;
  private awaitingProof = false;

  constructor(private deps: GameOverDeps) {
    this.el = h('div', 'overlay hidden wattApp wattResult');
    this.card = h('div', 'wattResultCard');
    this.proofSlot = h('div', '');
    this.el.append(this.card);
  }

  show(youWon: boolean, winnerName: string, contributions?: { name: string; elon: number }[], awaitingProof = false, standings?: Standing[]): void {
    this.awaitingProof = awaitingProof;
    this.card.innerHTML = '';
    this.proofSlot = h('div', '');
    const verdict = h('h1', `result-title ${youWon ? 'win' : 'lose'}`, youWon ? t('over.victory') : t('over.defeat'));
    const sub = h('p', 'wattResultSub', youWon ? t('over.victory_desc') : t('over.defeat_desc', { winner: winnerName }));
    this.card.append(h('div', 'waHead', h('div', 'waEyebrow', L('Match settled', 'Partida encerrada', 'Partida cerrada')), verdict, sub));

    if (standings?.length) {
      const top = standings[0];
      const ids = [...new Set(standings.map((s) => s.playerId))].sort((a, b) => a - b);
      const color = (id: number): string => SEAT_COLORS[Math.max(0, ids.indexOf(id)) % SEAT_COLORS.length];
      this.card.append(
        h('div', 'waHero',
          h('div', 'waHeroFigure',
            h('label', '', L('Most reliable steward', 'Steward mais confiável', 'Steward más fiable')),
            h('b', '', top.name),
            h('small', '', L(`${fmt(top.score, 2)} ELON = ${fmt(top.standing)} standing + ${fmt(top.stewardship)} stewardship + ${fmt(top.bonus, 2)} for ${pct(top.reliabilityPpm)} reliability.`,
              `${fmt(top.score, 2)} ELON = ${fmt(top.standing)} de standing + ${fmt(top.stewardship)} de stewardship + ${fmt(top.bonus, 2)} por ${pct(top.reliabilityPpm)} de confiabilidade.`,
              `${fmt(top.score, 2)} ELON = ${fmt(top.standing)} de standing + ${fmt(top.stewardship)} de stewardship + ${fmt(top.bonus, 2)} por ${pct(top.reliabilityPpm)} de fiabilidad.`)))),
        grid('', panel({ title: L('Final table', 'Tabela final', 'Tabla final'), subtitle: L('Score = ELON standing + stewardship value + reliability bonus. Victory is decided separately, on the battlefield.', 'Pontuação = standing ELON + stewardship + bônus de confiabilidade. A vitória é decidida à parte, no campo de batalha.', 'Puntuación = standing ELON + stewardship + bono de fiabilidad. La victoria se decide aparte, en el campo de batalla.'), body: 'table' }, stewardshipTable(standings))),
        grid('two',
          panel({ title: L('Reliability', 'Confiabilidade', 'Fiabilidad'), subtitle: L('Share of declared need served.', 'Parcela da necessidade declarada atendida.', 'Parte de la necesidad declarada atendida.') },
            ...standings.map((r) => meter(r.name, r.reliabilityPpm, 1_000_000, pct(r.reliabilityPpm), color(r.playerId)))),
          this.proofSlot),
      );
    } else if (contributions?.length) {
      this.card.append(grid('', panel({ title: t('over.contributions') }, ...contributions.map((c) => h('div', 'result-contribution-row', h('span', '', c.name), h('b', '', `${c.elon} ELON`))))));
    }
    this.paintPending();

    const back = h('button', 'button', t('common.back_lobby'));
    back.addEventListener('click', () => this.deps.onBackToLobby());
    const record = h('button', 'ghost', L('Open the stewardship record →', 'Abrir o registro de stewardship →', 'Abrir el registro de stewardship →'));
    record.addEventListener('click', () => this.deps.onOpenStewardship());
    this.card.append(h('div', 'heroActions', back, standings?.length ? record : null));
    this.el.classList.remove('hidden');
  }

  private paintPending(): void {
    this.proofSlot.innerHTML = '';
    if (!this.awaitingProof) return;
    this.proofSlot.append(panel({ title: t('proof.title'), subtitle: t('proof.sealing'), tools: badge('warning', L('Sealing', 'Selando', 'Sellando')) },
      h('p', 'wattResultSub', L('The server is sealing the last ledger block, archiving the match, and submitting its commitment.', 'O servidor está selando o último bloco, arquivando a partida e enviando o compromisso.', 'El servidor está sellando el último bloque, archivando la partida y enviando el compromiso.'))));
  }

  showProof(proof: MatchCommitment): void {
    const pt = proofTone(proof as never);
    const status = proof.status === 'confirmed'
      ? t('proof.confirmed', { block: proof.blockNumber ?? '?', chain: proof.chainId ?? '?' })
      : proof.status === 'failed'
        ? t('proof.failed', { error: proof.error ?? '?' })
        : t(`proof.${proof.status}`);
    this.proofSlot.innerHTML = '';
    this.proofSlot.append(panel({ title: t('proof.title'), subtitle: status, tools: badge(pt.tone, pt.text) },
      defs([
        { term: L('Match', 'Partida', 'Partida'), body: code(proof.matchId) },
        { term: L('Ledger', 'Ledger', 'Ledger'), body: proof.ledgerHead ? code(`${fmt((proof.ledgerHeight ?? 0) + 1)} · ${shortHash(proof.ledgerHead, 10, 6)}`, proof.ledgerHead) : '—' },
        { term: L('Archive', 'Arquivo', 'Archivo'), body: code(shortHash(proof.archiveHash, 14, 6), proof.archiveHash) },
        { term: L('Transaction', 'Transação', 'Transacción'), body: proof.transactionHash ? code(shortHash(proof.transactionHash, 12, 6), proof.transactionHash) : '—' },
      ])));
  }

  hide(): void {
    this.el.classList.add('hidden');
  }
}
