// Tela 5: Fim de jogo — overlay "Vitória!" (dourado) ou "Derrota" com nome
// do vencedor e botão "Voltar ao lobby".

import { el } from '../ui';
import { t } from '../i18n';

export interface GameOverDeps {
  onBackToLobby: () => void;
}

export class GameOverScreen {
  readonly el: HTMLElement;
  private titleEl: HTMLElement;
  private infoEl: HTMLElement;
  private contributionEl: HTMLElement;

  constructor(private deps: GameOverDeps) {
    this.el = el('div', 'overlay hidden');
    const card = el('div', 'panel card');
    this.titleEl = el('h1', 'result-title');
    this.infoEl = el('p', 'subtitle');
    this.contributionEl = el('div', 'result-contributions hidden');
    const btn = el('button', 'btn primary', t('common.back_lobby'));
    btn.addEventListener('click', () => this.deps.onBackToLobby());
    card.appendChild(this.titleEl);
    card.appendChild(this.infoEl);
    card.appendChild(this.contributionEl);
    card.appendChild(btn);
    this.el.appendChild(card);
  }

  show(youWon: boolean, winnerName: string, contributions?: { name: string; elon: number }[]): void {
    if (youWon) {
      this.titleEl.textContent = t('over.victory');
      this.titleEl.className = 'result-title win';
      this.infoEl.textContent = t('over.victory_desc');
    } else {
      this.titleEl.textContent = t('over.defeat');
      this.titleEl.className = 'result-title lose';
      this.infoEl.textContent = t('over.defeat_desc', { winner: winnerName });
    }
    this.contributionEl.innerHTML = '';
    this.contributionEl.classList.toggle('hidden', !contributions?.length);
    if (contributions?.length) {
      this.contributionEl.appendChild(el('strong', '', t('over.contributions')));
      for (const item of [...contributions].sort((a, b) => b.elon - a.elon || a.name.localeCompare(b.name))) {
        const row = el('div', 'result-contribution-row');
        row.appendChild(el('span', '', item.name));
        row.appendChild(el('b', '', `${item.elon} ELON`));
        this.contributionEl.appendChild(row);
      }
    }
    this.el.classList.remove('hidden');
  }

  hide(): void {
    this.el.classList.add('hidden');
  }
}
