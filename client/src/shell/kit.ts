// DOM ports of WATT Arena's UI primitives (apps/web/components/ui.tsx): same
// markup and class names, so watt.css styles them identically.
import { getLang } from '../i18n';

type Child = Node | string | null | undefined | false;

/** Inline trilingual copy for the WATT views (English is the reference). */
export function L(en: string, pt: string, es: string): string {
  const lang = getLang();
  return lang === 'pt' ? pt : lang === 'es' ? es : en;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> | string = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (typeof attrs === 'string') {
    if (attrs) node.className = attrs;
  } else {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

export function pageHead(eyebrow: string, title: string, lede: string, note?: Child): HTMLElement {
  return h('div', 'waHead', h('div', 'waEyebrow', eyebrow), h('h1', '', title), h('p', '', lede), note ? noteBox(note) : null);
}

export function noteBox(...children: Child[]): HTMLElement {
  return h('div', 'waNote', h('span', { 'aria-hidden': 'true' }, '›'), h('div', '', ...children));
}

export function rich(bold: string, rest: string): DocumentFragment {
  const f = document.createDocumentFragment();
  f.append(h('b', '', bold), ` ${rest}`);
  return f;
}

export function panel(opts: { title: string; subtitle?: string; tools?: Child; foot?: Child; body?: 'default' | 'flush' | 'table' }, ...children: Child[]): HTMLElement {
  const body = opts.body ?? 'default';
  return h('section', 'waPanel',
    h('div', 'waPanelHead',
      h('div', '', h('h2', '', opts.title), opts.subtitle ? h('p', '', opts.subtitle) : null),
      opts.tools ? h('div', 'waPanelTools', opts.tools) : null),
    h('div', body === 'default' ? 'waPanelBody' : `waPanelBody ${body}`, ...children),
    opts.foot ? h('div', 'waPanelFoot', opts.foot) : null);
}

export function tile(label: string, value: string, unit?: string, foot?: Child): HTMLElement {
  return h('div', 'waTile', h('label', '', label), h('b', '', value, unit ? h('span', '', unit) : null), foot ? h('small', '', foot) : null);
}

export function hero(label: string, value: string, caption: string, ...children: Child[]): HTMLElement {
  return h('div', 'waHero', h('div', 'waHeroFigure', h('label', '', label), h('b', '', value), h('small', '', caption)), ...children);
}

export type Tone = 'neutral' | 'good' | 'warning' | 'critical';

export function badge(tone: Tone, text: string): HTMLElement {
  const icon = tone === 'good' ? '✓' : tone === 'warning' ? '!' : tone === 'critical' ? '×' : '•';
  return h('span', tone === 'neutral' ? 'waBadge' : `waBadge ${tone}`, h('i', { 'aria-hidden': 'true' }, icon), text);
}

export function meter(label: string, value: number, max: number, display: string, color: string): HTMLElement {
  const pct = max === 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  const fill = h('div', 'waMeterFill');
  fill.style.width = `${pct}%`;
  fill.style.setProperty('--meter', color);
  const track = h('div', { class: 'waMeterTrack', role: 'meter', 'aria-label': label, 'aria-valuetext': display }, fill);
  track.style.setProperty('--meter', color);
  return h('div', 'waMeter', h('div', 'waMeterTop', h('span', '', label), h('b', '', display)), track);
}

export function readout(items: { label: string; value: string }[]): HTMLElement {
  return h('div', 'waReadout', ...items.map((i) => h('span', '', h('small', '', i.label), h('b', '', i.value))));
}

export function defs(items: { term: string; body: Child }[]): HTMLElement {
  return h('dl', 'waDefs', ...items.map((i) => h('div', '', h('dt', '', i.term), h('dd', '', i.body))));
}

export function ownerTag(name: string, color: string): HTMLElement {
  const dot = h('i', { 'aria-hidden': 'true' });
  dot.style.background = color;
  return h('span', 'waOwner', dot, name);
}

export function table(head: { label: string; num?: boolean }[], rows: Child[][]): HTMLElement {
  return h('div', 'waTableWrap', h('table', 'waTable',
    h('thead', '', h('tr', '', ...head.map((c) => h('th', c.num ? 'num' : '', c.label)))),
    h('tbody', '', ...rows.map((r) => h('tr', '', ...r.map((cell, i) => h('td', head[i]?.num ? 'num' : '', cell)))))));
}

export function grid(kind: '' | 'two' | 'wide', ...children: Child[]): HTMLElement {
  return h('div', kind ? `waGrid ${kind}` : 'waGrid', ...children);
}

export function code(text: string, title?: string): HTMLElement {
  const c = h('code', '', text);
  if (title) c.title = title;
  return c;
}

export function shortHash(hash: string | null | undefined, head = 10, tail = 6): string {
  if (!hash) return '—';
  return hash.length > head + tail + 1 ? `${hash.slice(0, head)}…${hash.slice(-tail)}` : hash;
}

export function fmt(n: number, digits = 0): string {
  return n.toLocaleString(getLang() === 'en' ? 'en-US' : getLang() === 'pt' ? 'pt-BR' : 'es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(ppm: number): string {
  return `${fmt(ppm / 10_000, 2)}%`;
}
