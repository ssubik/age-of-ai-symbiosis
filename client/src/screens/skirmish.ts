// Skirmish launcher: pick an AI commander, its autonomy and the opponent, then
// leave the city for a 1v1 match (the vertical slice). The city is saved first.

import type { BotDifficulty, CommanderAutonomy, CommanderPersona } from '@age/shared';
import { el } from '../ui';
import { AUTONOMY_INFO, COMMANDER_INFO } from '../game/commanderui';

export interface SkirmishOptions {
  persona: CommanderPersona;
  autonomy: CommanderAutonomy;
  difficulty: BotDifficulty;
}

const STORAGE_KEY = 'ageofai:skirmish';

export function savedSkirmishOptions(): SkirmishOptions {
  const fallback: SkirmishOptions = { persona: 'sentinel', autonomy: 'assisted', difficulty: 'normal' };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<SkirmishOptions> | null;
    if (!raw) return fallback;
    return {
      persona: raw.persona && raw.persona in COMMANDER_INFO ? raw.persona : fallback.persona,
      autonomy: raw.autonomy && raw.autonomy in AUTONOMY_INFO ? raw.autonomy : fallback.autonomy,
      difficulty: raw.difficulty && ['easy', 'normal', 'hard', 'expert'].includes(raw.difficulty) ? raw.difficulty : fallback.difficulty,
    };
  } catch {
    return fallback;
  }
}

export class SkirmishLauncher {
  readonly el: HTMLElement;
  private options = savedSkirmishOptions();

  constructor(private onStart: (options: SkirmishOptions) => void) {
    this.el = el('div', 'skirmish-overlay hidden');
    this.el.addEventListener('click', (event) => { if (event.target === this.el) this.hide(); });
    this.render();
  }

  show(): void { this.render(); this.el.classList.remove('hidden'); }
  hide(): void { this.el.classList.add('hidden'); }

  private render(): void {
    this.el.innerHTML = '';
    const card = el('div', 'skirmish-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Skirmish');
    card.appendChild(el('h2', '', 'Skirmish'));
    card.appendChild(el('p', 'skirmish-lede', 'A 1v1 match: destroy the enemy Command Core. Your AI commander executes strategy within the authority you give it — you can always override it.'));

    card.appendChild(el('span', 'skirmish-label', 'AI COMMANDER'));
    const personas = el('div', 'skirmish-personas');
    for (const persona of ['vanguard', 'sentinel', 'architect'] as CommanderPersona[]) {
      const info = COMMANDER_INFO[persona];
      const button = el('button', `skirmish-persona${persona === this.options.persona ? ' active' : ''}`);
      button.append(el('strong', '', info.name), el('em', '', info.style), el('span', '', info.blurb));
      button.addEventListener('click', () => { this.options.persona = persona; this.render(); });
      personas.appendChild(button);
    }
    card.appendChild(personas);

    const segmented = <T extends string>(label: string, values: T[], current: T, help: (value: T) => string, set: (value: T) => void): void => {
      card.appendChild(el('span', 'skirmish-label', label));
      const row = el('div', 'skirmish-segmented');
      for (const value of values) {
        const button = el('button', value === current ? 'active' : '', value);
        button.title = help(value);
        button.addEventListener('click', () => { set(value); this.render(); });
        row.appendChild(button);
      }
      card.appendChild(row);
      card.appendChild(el('span', 'skirmish-help', help(current)));
    };
    segmented('AUTONOMY', ['manual', 'assisted', 'autonomous'] as CommanderAutonomy[], this.options.autonomy, (v) => AUTONOMY_INFO[v], (v) => { this.options.autonomy = v; });
    const difficultyHelp: Record<BotDifficulty, string> = {
      easy: 'Passive opponent: never attacks first. Good for learning the controls.',
      normal: 'Attacks once it gathers an army of about nine.',
      hard: 'Larger economy, attacks earlier.',
      expert: 'Starting resource bonus and early aggression.',
    };
    segmented('OPPONENT', ['easy', 'normal', 'hard', 'expert'] as BotDifficulty[], this.options.difficulty, (v) => difficultyHelp[v], (v) => { this.options.difficulty = v; });

    const actions = el('div', 'skirmish-actions');
    const cancel = el('button', 'skirmish-cancel', 'Back to city');
    cancel.addEventListener('click', () => this.hide());
    const start = el('button', 'skirmish-start', 'Start match');
    start.addEventListener('click', () => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.options)); } catch { /* storage blocked */ }
      this.hide();
      this.onStart({ ...this.options });
    });
    actions.append(cancel, start);
    card.appendChild(actions);
    this.el.appendChild(card);
  }
}
