/**
 * TestSet — the fourteen songs this build was tuned against, and what it reads
 * in each of them.
 *
 * Why a list of links rather than fourteen embedded files: all of this is
 * commercial music. Shipping the audio in a public repository would be
 * straightforward infringement, and "nothing is uploaded, nothing is stored"
 * is a promise this project makes on its own landing page. So the songs stay
 * where they legally live, and tab capture — which already exists — carries
 * them in.
 *
 * The readings below are not decoration. They are what the analyser actually
 * returned for each track, printed here BEFORE you play it, so the claim is on
 * the table first and you can catch it being wrong. Two of them are wrong on
 * purpose-of-honesty grounds and say so: a `?` marks a reading the confidence
 * estimate does not stand behind.
 */

const SWATCH = {
  GOLD: '#c9a227', CHARTREUSE: '#9aa832', MINT: '#4fb87a', EMERALD: '#2f9e6b',
  TURQUOISE: '#2fb6a8', CYAN: '#2aa8c4', AZURE: '#3f7fd0', BLUE: '#4657c8',
  INDIGO: '#6b3fc4', VIOLET: '#8f3fc4', MAGENTA: '#c43f9e', AMBER: '#c47a27',
};

// mood / key / bpm / colour are measured, not chosen. A trailing ? is a
// reading the analyser itself flags as low confidence.
const SONGS = [
  { t: 'Bohemian Rhapsody',  a: 'Queen',            mood: 'SERENE',   key: 'D#',  bpm: '',      c: 'GOLD' },
  { t: 'Girls Like You',     a: 'Maroon 5',         mood: 'SERENE',   key: 'C',   bpm: '58?',   c: 'GOLD' },
  { t: 'Wake Me Up',         a: 'Avicii',           mood: 'WARM',     key: 'D',   bpm: '115',   c: 'CHARTREUSE' },
  { t: 'Apna Time Aayega',   a: 'DIVINE · Gully Boy', mood: 'EUPHORIC', key: 'F#', bpm: '115',  c: 'MINT' },
  { t: 'Gallan Goodiyaan',   a: 'Dil Dhadakne Do',  mood: 'SERENE',   key: 'D',   bpm: '60',    c: 'EMERALD' },
  { t: 'Ghoomar',            a: 'Padmaavat',        mood: 'EUPHORIC', key: 'D?',  bpm: '169',   c: 'TURQUOISE' },
  { t: 'Kun Faya Kun',       a: 'A. R. Rahman',     mood: 'POISED',   key: 'C#?', bpm: '88?',   c: 'TURQUOISE' },
  { t: 'Believer',           a: 'Imagine Dragons',  mood: 'DRIVING',  key: '',    bpm: '125',   c: 'CYAN' },
  { t: 'Someone Like You',   a: 'Adele',            mood: 'STILL',    key: '',    bpm: '67',    c: 'CYAN' },
  { t: 'Tum Hi Ho',          a: 'Arijit Singh',     mood: 'DRIVING',  key: 'Fm?', bpm: '188?',  c: 'CYAN' },
  { t: "Don't Stop Me Now",  a: 'Queen',            mood: 'STILL',    key: 'Dm',  bpm: '78',    c: 'AZURE' },
  { t: 'Blinding Lights',    a: 'The Weeknd',       mood: 'DESOLATE', key: 'Cm',  bpm: '85',    c: 'BLUE' },
  { t: 'HUMBLE.',            a: 'Kendrick Lamar',   mood: 'BROODING', key: 'Cm',  bpm: '75',    c: 'INDIGO' },
  { t: 'Millionaire',        a: 'Yo Yo Honey Singh', mood: 'BROODING', key: 'Dm', bpm: '96',    c: 'INDIGO' },
];

/** A search, not a specific upload — links to one video rot, and often to a rip. */
const searchUrl = (s) =>
  'https://www.youtube.com/results?search_query=' +
  encodeURIComponent(s.a + ' ' + s.t);

export class TestSet {
  constructor() {
    this.el = null;
    this._build();
  }

  _build() {
    const panel = document.createElement('div');
    panel.id = 'testset';
    panel.innerHTML = `
      <div class="ts-inner">
        <div class="ts-head">
          <div class="ts-title">THE TEST SET</div>
          <div class="ts-sub">
            Fourteen songs this build was tuned against, and what it reads in each.
            Open one, then come back and press <b>PLAY FROM A TAB</b>.
          </div>
        </div>
        <div class="ts-rows"></div>
        <div class="ts-foot">
          The audio is not shipped with this app — it is copyrighted, and nothing here
          is uploaded or stored. A <b>?</b> marks a reading the analyser does not
          stand behind.
        </div>
        <button class="ts-done">CLOSE</button>
      </div>`;
    document.body.appendChild(panel);
    this.el = panel;

    const rows = panel.querySelector('.ts-rows');
    for (const s of SONGS) {
      const a = document.createElement('a');
      a.className = 'ts-row';
      a.href = searchUrl(s);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      const facts = [s.mood, s.key, s.bpm ? s.bpm + ' BPM' : '', s.c]
        .filter(Boolean)
        .map(x => `<b${/\?$/.test(x) ? ' class="soft"' : ''}>${x}</b>`)
        .join('<i></i>');
      a.innerHTML =
        `<span class="ts-dot" style="--c:${SWATCH[s.c] || '#7fd8ff'}"></span>
         <span class="ts-name"><b>${s.t}</b><em>${s.a}</em></span>
         <span class="ts-read">${facts}</span>`;
      rows.appendChild(a);
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
