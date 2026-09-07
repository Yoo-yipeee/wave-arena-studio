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
    mood: 'SERENE',   key: 'F',   bpm: '48',  c: 'GOLD' },
  { file: 'monkeys-spinning-monkeys', t: 'Monkeys Spinning Monkeys', a: 'Kevin MacLeod',
    mood: 'WARM',     key: 'C',   bpm: '72?', c: 'EMERALD' },
  { file: 'sneaky-snitch',            t: 'Sneaky Snitch',            a: 'Kevin MacLeod',
    mood: 'WARM',     key: 'D',   bpm: '87?', c: 'EMERALD' },
  { file: 'cipher',                   t: 'Cipher',                   a: 'Kevin MacLeod',
    mood: 'DRIVING',  key: 'E',   bpm: '149', c: 'TURQUOISE' },
  { file: 'the-descent',              t: 'The Descent',              a: 'Kevin MacLeod',
    mood: 'DESOLATE', key: 'Bm?', bpm: '',    c: 'AZURE' },
  { file: 'anguish',                  t: 'Anguish',                  a: 'Kevin MacLeod',
    mood: 'BROODING', key: 'Fm',  bpm: '',    c: 'BLUE' },
  { file: 'ossuary',                  t: 'Ossuary 1 — A Beginning',  a: 'Kevin MacLeod',
    mood: 'DESOLATE', key: 'Dm',  bpm: '',    c: 'INDIGO' },
];

/** Not shipped. Links out; PLAY FROM A TAB carries them in. */
const SONGS = [
  { t: 'Bohemian Rhapsody', v: 'fJ9rUzIMcZQ',  a: 'Queen',              mood: 'SERENE',   key: 'D#',  bpm: '',     c: 'GOLD' },
  { t: 'Girls Like You', v: 'aJOTlE1K90k',     a: 'Maroon 5',           mood: 'SERENE',   key: 'C',   bpm: '58?',  c: 'GOLD' },
  { t: 'Wake Me Up', v: 'IcrbM1l_BoI',         a: 'Avicii',             mood: 'WARM',     key: 'D',   bpm: '115',  c: 'CHARTREUSE' },
  { t: 'Apna Time Aayega', v: 'jFGKJBPFdUA',   a: 'DIVINE · Gully Boy', mood: 'EUPHORIC', key: 'F#',  bpm: '115',  c: 'MINT' },
  { t: 'Gallan Goodiyaan', v: 'jCEdTq3j-0U',   a: 'Dil Dhadakne Do',    mood: 'SERENE',   key: 'D',   bpm: '60',   c: 'EMERALD' },
  { t: 'Ghoomar', v: 'CU1tFtk_NFY',            a: 'Padmaavat',          mood: 'EUPHORIC', key: 'D?',  bpm: '169',  c: 'TURQUOISE' },
  { t: 'Kun Faya Kun', v: 'T94PHkuydcw',       a: 'A. R. Rahman',       mood: 'POISED',   key: 'C#?', bpm: '88?',  c: 'TURQUOISE' },
  { t: 'Believer', v: '7wtfhZwyrcc',           a: 'Imagine Dragons',    mood: 'DRIVING',  key: '',    bpm: '125',  c: 'CYAN' },
  { t: 'Someone Like You', v: 'hLQl3WQQoQ0',   a: 'Adele',              mood: 'STILL',    key: '',    bpm: '67',   c: 'CYAN' },
  { t: 'Tum Hi Ho', v: 'Umqb9KENgmk',          a: 'Arijit Singh',       mood: 'DRIVING',  key: 'Fm?', bpm: '188?', c: 'CYAN' },
  { t: "Don't Stop Me Now", v: 'HgzGwKwLmgM',  a: 'Queen',              mood: 'STILL',    key: 'Dm',  bpm: '78',   c: 'AZURE' },
  { t: 'Blinding Lights', v: '4NRXx6U8ABQ',    a: 'The Weeknd',         mood: 'DESOLATE', key: 'Cm',  bpm: '85',   c: 'BLUE' },
  { t: 'HUMBLE.', v: 'tvTRZJ-4EyI',            a: 'Kendrick Lamar',     mood: 'BROODING', key: 'Cm',  bpm: '75',   c: 'INDIGO' },
  { t: 'Millionaire', v: 'XO8wew38VM8',        a: 'Yo Yo Honey Singh',  mood: 'BROODING', key: 'Dm',  bpm: '96',   c: 'INDIGO' },
];

/**
 * A real video, not a search page.
 *
 * These linked to `youtube.com/results?search_query=...` — which plays nothing.
 * "Open the song, then come back and capture the tab" quietly asked the viewer
 * to go and find the song themselves first, so of course nothing was playing
 * when they returned. Every id below is the official upload (label or artist
 * channel), checked against oEmbed so a dead one cannot ship.
 */
const watchUrl = (s) =>
  s.v ? 'https://www.youtube.com/watch?v=' + s.v + '&autoplay=1'
      : 'https://www.youtube.com/results?search_query=' + encodeURIComponent(s.a + ' ' + s.t);

/**
 * The '?' marks a reading the analyser does not stand behind, and it has to
 * carry the dimmed class with it.
 *
 * This tested for '?' at the END of the finished string, which worked for a key
 * ("Fm?") and silently failed for every tempo, because a tempo is composed into
 * "188? BPM" and ends in "BPM". So the one reading most likely to be wrong —
 * Tum Hi Ho's 188 against a true 56 — was being printed at full confidence,
 * which is worse than not marking anything at all. Test the value, not the
 * sentence it ends up inside.
 */
const facts = (s) => {
  const parts = [
    { v: s.mood, soft: false },
    { v: s.key, soft: /\?/.test(String(s.key || '')) },
    { v: s.bpm ? String(s.bpm).replace('?', '') + ' BPM' : '',
      soft: /\?/.test(String(s.bpm || '')) },
    { v: s.c, soft: false },
  ];
  return parts
    .filter(p => p.v)
    .map(p => `<b${p.soft ? ' class="soft"' : ''}>${esc(p.v)}</b>`)
    .join('<i></i>');
};

/**
 * Library rows come out of the database, so they are data rather than markup —
 * even with a single trusted curator, text from a table has no business being
 * parsed as HTML.
 */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export class TestSet {
  constructor() {
    this.onPlay = null;          // (path, title)  — a track that ships with the app
    this.onPlayLibrary = null;   // (url, title)   — a track from the shared library
    this.onSignIn = null;        // (email)
    this.onSignOut = null;
    this.onUpload = null;        // (file)
    this.onPickTab = null;       // "the song is playing over there, capture it"
    this.onPasteLink = null;     // (url) — rescue a sign-in link that went astray
    this.el = null;
    this._build();
  }

  /**
   * Step two of "bring your own".
   *
   * Opening the song was never the whole job — the point is to watch it here,
   * and picking a row used to leave you on YouTube with no hint that anything
   * else was expected. getDisplayMedia needs its own user gesture, and it has
   * to be made once the song is actually playing, so the panel waits with a
   * single obvious button for when you come back.
   */
  armTabPick(title) {
    const wrap = this.el.querySelector('#tsPick');
    wrap.hidden = false;
    wrap.querySelector('#tsPickTitle').textContent = title || 'that song';
    this.el.querySelector('.ts-inner').scrollTop = 0;
    wrap.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  disarmTabPick() {
    const wrap = this.el.querySelector('#tsPick');
    if (wrap) wrap.hidden = true;
  }

  /**
   * The library arrives after the panel does — it is a network round trip and
   * the panel must not wait on it. Rows are appended when they land.
   */
  setLibrary(tracks, err) {
    const box = this.el.querySelector('#tsLibrary');
    const group = this.el.querySelector('#tsLibGroup');
    box.innerHTML = '';
    if (err) {
      group.hidden = false;
      box.innerHTML = '<div class="ts-note">The library could not be reached. '
        + 'Everything else on this page still works.</div>';
      return;
    }
    if (!tracks || !tracks.length) { group.hidden = true; return; }
    group.hidden = false;
    for (const t of tracks) {
      const b = document.createElement('button');
      b.className = 'ts-row ts-play';
      // The database keeps confidence as booleans; the row convention here is a
      // trailing '?'. Without this the library would show every reading as
      // certain, which is exactly the dishonesty the card exists to avoid.
      const meta = {
        mood: t.mood,
        key: t.key_name ? t.key_name + (t.key_sure ? '' : '?') : '',
        bpm: t.bpm ? t.bpm + (t.bpm_sure ? '' : '?') : '',
        c: t.colour,
      };
      const sub = [t.artist, t.licence].filter(Boolean).join(' · ');
      b.innerHTML =
        `<span class="ts-dot" style="--c:${SWATCH[t.colour] || '#7fd8ff'}"></span>
         <span class="ts-name"><b>${esc(t.title)}</b><em>${esc(sub)}</em></span>
         <span class="ts-read">${facts(meta)}</span>`;
      b.addEventListener('click', () => {
        this.close();
        if (this.onPlayLibrary) this.onPlayLibrary(t, t.title);
      });
      box.appendChild(b);
    }
  }

  /** Only ever shown when the page was opened with ?admin. */
  showAdmin(state) {
    const wrap = this.el.querySelector('#tsAdmin');
    const body = this.el.querySelector('#tsAdminBody');
    wrap.hidden = false;
    body.innerHTML = '';

    if (!state.signedIn) {
      body.innerHTML = `
        <div class="ts-note">Sign in to add tracks. A one-time link is emailed to you —
          there is no password on this page.</div>
        <div class="ts-form">
          <input type="email" id="tsEmail" placeholder="you@example.com" autocomplete="email" />
          <button id="tsSend">SEND LINK</button>
        </div>
        <div class="ts-status" id="tsStatus"></div>
        <div class="ts-note" style="margin-top:14px">
          <b>Link points at localhost, or won't open?</b> Supabase falls back to its
          configured Site URL when a redirect is not on its allow-list, which is how a
          link ends up pointing somewhere that does not exist. The link still contains a
          valid one-time token, so paste the whole thing here and it will be used
          directly.
        </div>
        <div class="ts-form">
          <input type="email" id="tsPaste" placeholder="paste the whole link from the email" />
          <button id="tsUse">USE LINK</button>
        </div>`;
      const send = () => {
        const v = body.querySelector('#tsEmail').value.trim();
        if (v && this.onSignIn) this.onSignIn(v);
      };
      body.querySelector('#tsSend').addEventListener('click', send);
      body.querySelector('#tsEmail').addEventListener('keydown', e => {
        if (e.key === 'Enter') send();
      });
      const use = () => {
        const v = body.querySelector('#tsPaste').value.trim();
        if (v && this.onPasteLink) this.onPasteLink(v);
      };
      body.querySelector('#tsUse').addEventListener('click', use);
      body.querySelector('#tsPaste').addEventListener('keydown', e => {
        if (e.key === 'Enter') use();
      });
      return;
    }

    if (!state.admin) {
      body.innerHTML = `
        <div class="ts-note">Signed in as <b>${esc(state.email || '')}</b>, but this account
          is not on the curator list, so it cannot add tracks.</div>
        <div class="ts-form"><button id="tsOut">SIGN OUT</button></div>
        <div class="ts-status" id="tsStatus"></div>`;
      body.querySelector('#tsOut').addEventListener('click', () => this.onSignOut && this.onSignOut());
      return;
    }

    body.innerHTML = `
      <div class="ts-note">Signed in as <b>${esc(state.email || '')}</b>. Pick an audio file —
        it is analysed here first, so the library shows its reading like everything else.
        <b>Only add music you have the right to share.</b></div>
      <div class="ts-form">
        <input type="file" id="tsFile" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac" />
        <button id="tsOut">SIGN OUT</button>
      </div>
      <div class="ts-status" id="tsStatus"></div>`;
    body.querySelector('#tsFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f && this.onUpload) this.onUpload(f);
    });
    body.querySelector('#tsOut').addEventListener('click', () => this.onSignOut && this.onSignOut());
  }

  setStatus(msg, kind) {
    const s = this.el.querySelector('#tsStatus');
    if (!s) return;
    s.textContent = msg || '';
    s.className = 'ts-status' + (kind ? ' ' + kind : '');
  }

  _build() {
    const panel = document.createElement('div');
    panel.id = 'testset';
    panel.innerHTML = `
      <div class="ts-inner">
        <div class="ts-head">
          <div class="ts-title">PICK A SONG</div>
        </div>
        <div id="tsPick" hidden>
          <div class="ts-pick">
            <div class="ts-pick-h">NOW PLAYING IT IN THE OTHER TAB?</div>
            <div class="ts-pick-s">Start <b id="tsPickTitle"></b> over there, then come
              back and pick that tab. Tick <b>share tab audio</b> in the box Chrome shows.</div>
            <button id="tsPickBtn">PICK THE TAB</button>
          </div>
        </div>
        <div class="ts-scroll">
          <div class="ts-group">PLAY NOW &mdash; SHIPS WITH THE APP</div>
          <div class="ts-rows" id="tsDemos"></div>

          <div class="ts-group" id="tsLibGroup" hidden>THE LIBRARY
            <em>added by the curator, playable by anyone.</em></div>
          <div class="ts-rows" id="tsLibrary"></div>

          <div class="ts-group">BRING YOUR OWN &mdash; THE TEST SET
            <em>the fourteen this build was tuned against. Open one, come back,
            press PLAY FROM A TAB.</em></div>
          <div class="ts-rows" id="tsSongs"></div>

          <div id="tsAdmin" hidden>
            <div class="ts-group">CURATOR</div>
            <div class="ts-admin" id="tsAdminBody"></div>
          </div>
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
      a.href = watchUrl(s);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.innerHTML =
        `<span class="ts-dot" style="--c:${SWATCH[s.c] || '#7fd8ff'}"></span>
         <span class="ts-name"><b>${esc(s.t)}</b><em>${esc(s.a)}</em></span>
         <span class="ts-read">${facts(s)}</span>`;
      // The link still opens normally — middle-click and "open in new tab" keep
      // working — but choosing a song here is a statement of intent to watch it,
      // so the panel turns into step two instead of dropping you on YouTube and
      // leaving you to work out what to do next.
      a.addEventListener('click', () => this.armTabPick(s.t));
      songs.appendChild(a);
    }

    panel.querySelector('#tsPickBtn').addEventListener('click', () => {
      this.disarmTabPick();
      this.close();
      if (this.onPickTab) this.onPickTab();
    });

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
