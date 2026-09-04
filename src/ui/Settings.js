/**
 * Settings — the choices that are genuinely a matter of taste.
 *
 * These began life as separate builds, which meant asking someone to pick a
 * URL before they had seen anything. None of them is more correct than the
 * others: a cutting camera makes a better fifteen-second clip and an unbroken
 * one is better to sit with for an album; full-spectrum colour separates songs
 * harder, while staying in one hue family looks more like a single product.
 * So they are options, chosen after you can see what they do, and remembered.
 */
const KEY = 'wave-arena:settings';

export const OPTIONS = [
  {
    id: 'camera', label: 'CAMERA', def: 'cuts',
    choices: [
      { v: 'orbit', label: 'ORBIT', hint: 'one unbroken shot, slowly circling' },
      { v: 'cuts', label: 'CINEMATIC', hint: 'cuts angle on drops and breakdowns' },
    ],
  },
  {
    id: 'palette', label: 'COLOUR', def: 'full',
    choices: [
      { v: 'blue', label: 'BLUE', hint: 'one hue family, the signature look' },
      { v: 'full', label: 'SPECTRUM', hint: 'each song picks its own colour' },
    ],
  },
  {
    id: 'caustics', label: 'CAUSTICS', def: 'on',
    choices: [
      { v: 'off', label: 'OFF', hint: 'nothing beneath the surface' },
      { v: 'on', label: 'ON', hint: 'focused light on the floor below' },
    ],
  },
  {
    id: 'ripples', label: 'TOUCH', def: 'on',
    choices: [
      { v: 'off', label: 'OFF', hint: '' },
      { v: 'on', label: 'ON', hint: 'click the water to throw ripples' },
    ],
  },
];

export class Settings {
  constructor() {
    this.values = {};
    for (const o of OPTIONS) this.values[o.id] = o.def;
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      for (const o of OPTIONS) {
        if (saved[o.id] && o.choices.some(c => c.v === saved[o.id])) {
          this.values[o.id] = saved[o.id];
        }
      }
    } catch (e) { /* private mode, blocked storage — defaults are fine */ }

    this.onChange = null;
    this._build();
    this.apply();
  }

  get(id) { return this.values[id]; }
  is(id, v) { return this.values[id] === v; }

  set(id, v) {
    if (this.values[id] === v) return;
    this.values[id] = v;
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch (e) { /* ignore */ }
    this._paint();
    this.apply();
  }

  apply() { if (this.onChange) this.onChange(this.values); }

  _build() {
    const panel = document.createElement('div');
    panel.id = 'settings';
    panel.innerHTML = `
      <div class="set-inner">
        <div class="set-title">HOW YOU WANT IT</div>
        <div class="set-rows"></div>
        <button class="set-done">DONE</button>
      </div>`;
    document.body.appendChild(panel);
    this.el = panel;
    this._rows = panel.querySelector('.set-rows');

    for (const o of OPTIONS) {
      const row = document.createElement('div');
      row.className = 'set-row';
      row.innerHTML = `<div class="set-label">${o.label}</div><div class="set-opts"></div>`;
      const box = row.querySelector('.set-opts');
      for (const c of o.choices) {
        const b = document.createElement('button');
        b.dataset.opt = o.id;
        b.dataset.val = c.v;
        b.innerHTML = `${c.label}${c.hint ? `<em>${c.hint}</em>` : ''}`;
        b.addEventListener('click', () => this.set(o.id, c.v));
        box.appendChild(b);
      }
      this._rows.appendChild(row);
    }

    panel.querySelector('.set-done').addEventListener('click', () => this.close());
    panel.addEventListener('click', (e) => { if (e.target === panel) this.close(); });
    this._paint();
  }

  _paint() {
    for (const b of this._rows.querySelectorAll('button')) {
      b.classList.toggle('on', this.values[b.dataset.opt] === b.dataset.val);
    }
  }

  open() { this.el.classList.add('on'); }
  close() { this.el.classList.remove('on'); }
  toggle() { this.el.classList.toggle('on'); }
}
