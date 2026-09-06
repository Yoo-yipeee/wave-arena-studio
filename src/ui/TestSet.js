/**
 * TestSet — the songs you can hear this thing on, in two groups.
 *
 * PLAY NOW ships with the app: Creative Commons tracks that can legally be
 * redistributed, so one click goes straight from a cold landing page to water
 * moving. This is the only entry point that needs nothing at all from the
 * viewer — no file, no other tab, no microphone — and it is the only one that
 * works on iOS, where tab capture does not exist.
 *
 * THE TEST SET is the fourteen commercial songs this build was actually tuned
 * against. That audio is deliberately NOT shipped: it is copyrighted, this
 * repository is public, and "nothing is uploaded, nothing is stored" is a
 * promise the landing page makes. Those rows link out, and tab capture carries
 * the song in.
 *
 * Every reading shown here — mood, key, tempo, colour — is what the analyser
 * actually returned, printed BEFORE you play it. That is the point: it turns
 * each song into a claim you can check rather than something to take on trust.
 * A trailing `?` marks a reading the confidence estimate does not stand behind.
 */

const SWATCH = {
  GOLD: '#c9a227', CHARTREUSE: '#9aa832', MINT: '#4fb87a', EMERALD: '#2f9e6b',
  TURQUOISE: '#2fb6a8', CYAN: '#2aa8c4', AZURE: '#3f7fd0', BLUE: '#4657c8',
  INDIGO: '#6b3fc4', VIOLET: '#8f3fc4', MAGENTA: '#c43f9e', AMBER: '#c47a27',
};

/**
 * Shipped with the app. Kevin MacLeod, incompetech.com, CC BY 4.0 — the licence
 * requires attribution, which is why the credit is in the panel rather than
 * buried in a file nobody opens.
 */
const DEMOS = [
  { file: 'carefree',                 t: 'Carefree',                 a: 'Kevin MacLeod',
    mood: 'SERENE',  key: 'F', bpm: '48',  c: 'GOLD' },
  { file: 'monkeys-spinning-monkeys', t: 'Monkeys Spinning Monkeys', a: 'Kevin MacLeod',
    mood: 'WARM',    key: 'C', bpm: '72?', c: 'EMERALD' },
  { file: 'sneaky-snitch',            t: 'Sneaky Snitch',            a: 'Kevin MacLeod',
    mood: 'WARM',    key: 'D', bpm: '87?', c: 'EMERALD' },
  { file: 'cipher',                   t: 'Cipher',                   a: 'Kevin MacLeod',
    mood: 'DRIVING', key: 'E', bpm: '149', c: 'TURQUOISE' },
];

/** Not shipped. Links out; PLAY FROM A TAB carries them in. */
const SONGS = [
  { t: 'Bohemian Rhapsody',  a: 'Queen',              mood: 'SERENE',   key: 'D#',  bpm: '',     c: 'GOLD' },
  { t: 'Girls Like You',     a: 'Maroon 5',           mood: 'SERENE',   key: 'C',   bpm: '58?',  c: 'GOLD' },
  { t: 'Wake Me Up',         a: 'Avicii',             mood: 'WARM',     key: 'D',   bpm: '115',  c: 'CHARTREUSE' },
  { t: 'Apna Time Aayega',   a: 'DIVINE · Gully Boy', mood: 'EUPHORIC', key: 'F#',  bpm: '115',  c: 'MINT' },
  { t: 'Gallan Goodiyaan',   a: 'Dil Dhadakne Do',    mood: 'SERENE',   key: 'D',   bpm: '60',   c: 'EMERALD' },
  { t: 'Ghoomar',            a: 'Padmaavat',          mood: 'EUPHORIC', key: 'D?',  bpm: '169',  c: 'TURQUOISE' },
  { t: 'Kun Faya Kun',       a: 'A. R. Rahman',       mood: 'POISED',   key: 'C#?', bpm: '88?',  c: 'TURQUOISE' },
  { t: 'Believer',           a: 'Imagine Dragons',    mood: 'DRIVING',  key: '',    bpm: '125',  c: 'CYAN' },
  { t: 'Someone Like You',   a: 'Adele',              mood: 'STILL',    key: '',    bpm: '67',   c: 'CYAN' },
  { t: 'Tum Hi Ho',          a: 'Arijit Singh',       mood: 'DRIVING',  key: 'Fm?', bpm: '188?', c: 'CYAN' },
  { t: "Don't Stop Me Now",  a: 'Queen',              mood: 'STILL',    key: 'Dm',  bpm: '78',   c: 'AZURE' },
  { t: 'Blinding Lights',    a: 'The Weeknd',         mood: 'DESOLATE', key: 'Cm',  bpm: '85',   c: 'BLUE' },
  { t: 'HUMBLE.',            a: 'Kendrick Lamar',     mood: 'BROODING', key: 'Cm',  bpm: '75',   c: 'INDIGO' },
  { t: 'Millionaire',        a: 'Yo Yo Honey Singh',  mood: 'BROODING', key: 'Dm',  bpm: '96',   c: 'INDIGO' },
];

/** A search, not a specific upload — links to one video rot, and often to a rip. */
const searchUrl = (s) =>
  'https://www.youtube.com/results?search_query=' + encodeURIComponent(s.a + ' ' + s.t);

const facts = (s) =>
  [s.mood, s.key, s.bpm ? s.bpm + ' BPM' : '', s.c]
    .filter(Boolean)
    .map(x => `<b${/\?$/.test(x) ? ' class="soft"' : ''}>${x}</b>`)
    .join('<i></i>');

export class TestSet {
  constructor() {
    this.onPlay = null;          // (path, title) => void
    this.el = null;
    this._build();
  }

  _build() {
    const panel = document.createElement('div');
    panel.id = 'testset';
    panel.innerHTML = `
      <div class="ts-inner">
        <div class="ts-head">
          <div class="ts-title">PICK A SONG</div>
        </div>
        <div class="ts-scroll">
          <div class="ts-group">PLAY NOW &mdash; SHIPS WITH THE APP</div>
          <div class="ts-rows" id="tsDemos"></div>
          <div class="ts-group">BRING YOUR OWN &mdash; THE TEST SET
            <em>the fourteen this build was tuned against. Open one, come back,
            press PLAY FROM A TAB.</em></div>
          <div class="ts-rows" id="tsSongs"></div>
        </div>
        <div class="ts-foot">
          PLAY NOW tracks are by <b>Kevin MacLeod</b> (incompetech.com), licensed
          <b>CC BY 4.0</b>. The test set is not shipped &mdash; it is commercial music,
          and nothing here is uploaded or stored. A <b>?</b> marks a reading the
          analyser does not stand behind.
        </div>
        <button class="ts-done">CLOSE</button>
      </div>`;
    document.body.appendChild(panel);
    this.el = panel;

    const demos = panel.querySelector('#tsDemos');
    for (const d of DEMOS) {
      const b = document.createElement('button');
      b.className = 'ts-row ts-play';
      b.innerHTML =
        `<span class="ts-dot" style="--c:${SWATCH[d.c] || '#7fd8ff'}"></span>
         <span class="ts-name"><b>${d.t}</b><em>${d.a} &middot; CC BY</em></span>
         <span class="ts-read">${facts(d)}</span>`;
      b.addEventListener('click', () => {
        this.close();
        if (this.onPlay) this.onPlay('./demo-audio/' + d.file + '.mp3', d.t);
      });
      demos.appendChild(b);
    }

    const songs = panel.querySelector('#tsSongs');
    for (const s of SONGS) {
      const a = document.createElement('a');
      a.className = 'ts-row';
      a.href = searchUrl(s);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.innerHTML =
        `<span class="ts-dot" style="--c:${SWATCH[s.c] || '#7fd8ff'}"></span>
         <span class="ts-name"><b>${s.t}</b><em>${s.a}</em></span>
         <span class="ts-read">${facts(s)}</span>`;
      songs.appendChild(a);
    }

    panel.querySelector('.ts-done').addEventListener('click', () => this.close());
    panel.addEventListener('click', (e) => { if (e.target === panel) this.close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  get isOpen() { return this.el.classList.contains('on'); }
  open() { this.el.classList.add('on'); }
  close() { this.el.classList.remove('on'); }
  toggle() { this.el.classList.toggle('on'); }
}
