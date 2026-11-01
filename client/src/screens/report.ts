// Post-battle intelligence: result, side-by-side numbers, army-strength curve,
// what decided the match, the timeline and the commander's record.

import type { MatchReport, PlayerMatchStats, ResourceType } from '@age/shared';
import { el } from '../ui';
import { COMMANDER_INFO, OBJECTIVE_LABEL, OUTCOME_LABEL, clock } from '../game/commanderui';

export interface ReportHandlers {
  onHome: () => void;
  onRematch: () => void;
}

const RES: ResourceType[] = ['energy', 'alloys', 'compute'];
const sum = (r: Record<ResourceType, number>): number => RES.reduce((total, key) => total + r[key], 0);
const int = (n: number): string => Math.round(n).toLocaleString('en-US');

export class BattleReport {
  readonly el: HTMLElement;

  constructor(report: MatchReport, you: number, won: boolean, private handlers: ReportHandlers) {
    this.el = el('div', 'report-overlay');
    const card = el('div', 'report-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Battle report');

    const head = el('header', `report-head ${won ? 'won' : 'lost'}`);
    head.appendChild(el('span', 'report-kicker', 'BATTLE REPORT'));
    head.appendChild(el('h2', '', won ? 'Victory' : 'Defeat'));
    head.appendChild(el('span', 'report-meta', `Duration ${clock(report.durationTicks)} · ${report.players.map((p) => p.name).join(' vs ')}`));
    card.appendChild(head);

    const ordered = [...report.players].sort((a, b) => (a.playerId === you ? -1 : b.playerId === you ? 1 : a.playerId - b.playerId));
    card.appendChild(this.table(ordered));
    if (report.strength.length > 1) card.appendChild(this.chart(report, ordered));

    const why = el('section', 'report-section');
    why.appendChild(el('h3', '', 'What decided it'));
    const list = el('ul', 'report-insights');
    for (const line of report.insights) list.appendChild(el('li', '', line));
    why.appendChild(list);
    card.appendChild(why);

    const mine = ordered[0];
    if (mine?.commander) card.appendChild(this.commander(mine));

    const timeline = el('section', 'report-section');
    timeline.appendChild(el('h3', '', 'Timeline'));
    const events = el('ol', 'report-timeline');
    for (const event of report.timeline) {
      const item = el('li', `report-event ${event.kind}`);
      const player = report.players.find((p) => p.playerId === event.playerId);
      if (player) item.style.setProperty('--who', player.color);
      item.append(el('time', '', clock(event.tick)), el('span', '', event.text));
      events.appendChild(item);
    }
    timeline.appendChild(events);
    card.appendChild(timeline);

    const actions = el('div', 'report-actions');
    const view = el('button', 'report-secondary', 'View battlefield');
    view.addEventListener('click', () => this.el.remove());
    const home = el('button', 'report-secondary', 'Return to city');
    home.addEventListener('click', () => { this.el.remove(); this.handlers.onHome(); });
    const again = el('button', 'report-primary', 'Rematch');
    again.addEventListener('click', () => { this.el.remove(); this.handlers.onRematch(); });
    actions.append(view, home, again);
    card.appendChild(actions);
    this.el.appendChild(card);
  }

  private table(players: PlayerMatchStats[]): HTMLElement {
    const table = el('table', 'report-table');
    const head = el('tr');
    head.appendChild(el('th', '', ''));
    for (const p of players) {
      const th = el('th', '', p.name);
      th.style.color = p.color;
      head.appendChild(th);
    }
    table.appendChild(head);
    const rows: [string, (p: PlayerMatchStats) => string][] = [
      ['Resources gathered', (p) => int(sum(p.gathered))],
      ['Resources spent', (p) => int(sum(p.spent))],
      ['Units produced', (p) => int(p.unitsProduced)],
      ['Units lost', (p) => int(p.unitsLost)],
      ['Enemy units destroyed', (p) => int(p.enemyUnitsKilled)],
      ['Structures destroyed', (p) => int(p.enemyStructuresDestroyed)],
      ['Structures lost', (p) => int(p.structuresLost)],
      ['Resource zones held', (p) => int(p.zonesControlled)],
      ['Peak army', (p) => int(p.peakArmy)],
    ];
    for (const [label, value] of rows) {
      const tr = el('tr');
      tr.appendChild(el('td', '', label));
      for (const p of players) tr.appendChild(el('td', '', value(p)));
      table.appendChild(tr);
    }
    return table;
  }

  /** Army strength over time, one line per player. */
  private chart(report: MatchReport, players: PlayerMatchStats[]): HTMLElement {
    const section = el('section', 'report-section');
    section.appendChild(el('h3', '', 'Army strength'));
    const w = 560;
    const h = 120;
    const max = Math.max(1, ...report.strength.flatMap((s) => Object.values(s.values)));
    const t0 = report.strength[0].tick;
    const t1 = Math.max(t0 + 1, report.strength[report.strength.length - 1].tick);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('class', 'report-chart');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Army strength of each player over the match');
    const base = document.createElementNS(ns, 'line');
    base.setAttribute('x1', '0'); base.setAttribute('x2', String(w));
    base.setAttribute('y1', String(h - 1)); base.setAttribute('y2', String(h - 1));
    base.setAttribute('class', 'report-chart-axis');
    svg.appendChild(base);
    const legend = el('div', 'report-legend');
    for (const p of players) {
      const points = report.strength.map((s) => `${(((s.tick - t0) / (t1 - t0)) * w).toFixed(1)},${(h - 2 - ((s.values[p.playerId] ?? 0) / max) * (h - 8)).toFixed(1)}`);
      const line = document.createElementNS(ns, 'polyline');
      line.setAttribute('points', points.join(' '));
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', p.color);
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(line);
      const key = el('span', '', p.name);
      key.style.setProperty('--who', p.color);
      legend.appendChild(key);
    }
    section.append(svg, legend);
    return section;
  }

  private commander(p: PlayerMatchStats): HTMLElement {
    const c = p.commander!;
    const section = el('section', 'report-section');
    section.appendChild(el('h3', '', `Your commander · ${COMMANDER_INFO[c.persona].name} (${c.autonomy})`));
    const r = c.record;
    section.appendChild(el('p', 'report-record', `${r.decisions} decisions · ${r.playerOrders} of your orders · ${r.completed} completed · ${r.failed} failed · ${r.superseded} superseded · ${r.suggestions} recommendations · ${r.unitsQueued} units and ${r.structuresQueued} structures queued`));
    const key = c.decisions.filter((d) => d.objective !== 'production' && d.objective !== 'prioritize_resource' && d.outcome !== 'suggested').slice(-8).reverse();
    const list = el('ol', 'report-decisions');
    for (const d of key) {
      const item = el('li', `commander-decision ${d.outcome}`);
      const headLine = el('div', 'commander-decision-head');
      headLine.append(el('span', 'commander-badge', OUTCOME_LABEL[d.outcome]), el('span', '', `${clock(d.tick)} · ${OBJECTIVE_LABEL[d.objective]} · ${d.source === 'player' ? 'your order' : 'commander'}`));
      item.append(headLine, el('b', '', d.action), el('span', '', `Observed: ${d.observation}`), el('span', 'commander-expect', `Expected: ${d.expected}`));
      if (d.result) item.appendChild(el('span', 'commander-result', `Result: ${d.result}`));
      list.appendChild(item);
    }
    if (key.length === 0) list.appendChild(el('li', 'commander-empty', 'The commander made no army decisions this match.'));
    section.appendChild(list);
    return section;
  }
}
