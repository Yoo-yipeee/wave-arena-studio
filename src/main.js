/**
 * WAVE ARENA — v0
 *
 *   AudioEngine -> MusicAnalyser -> Choreographer -> WaterArena -> Stage -> UI
 *
 * Each stage only knows the shape of the one before it. The visual engine has
 * no reference to any DOM element, and the UI has no reference to any shader.
 */
import * as THREE from 'three';
import { AudioEngine, computePeaks } from './audio/AudioEngine.js';
import { renderDemoTrack, DEMO_TITLE } from './audio/DemoTrack.js';
import { MusicAnalyser } from './analysis/MusicAnalyser.js';
import { Choreographer } from './performance/Choreographer.js';
import { TrackPlan } from './performance/TrackPlan.js';
import { SongIdentity } from './performance/SongIdentity.js';
import { WaterArena } from './water/WaterArena.js';
import { Stage, CinematicCamera, detectQuality, QualityGovernor } from './renderer/Stage.js';
import { UI } from './ui/UI.js';
import { Touch } from './ui/Touch.js';
import { Recorder } from './ui/Recorder.js';
import { Settings } from './ui/Settings.js';
import { TestSet } from './ui/TestSet.js';
import { Library, slugify } from './library/Library.js';

const quality = detectQuality();
const stage = new Stage(document.getElementById('stage'), quality);
const arena = new WaterArena(stage.scene, quality);
const camera = new CinematicCamera(stage.camera);
const choreo = new Choreographer();
const engine = new AudioEngine();
const ui = new UI();
const canvas = document.getElementById('stage');

// The viewer can disturb the pond: a thrown ripple enters the same impulse
// buffer the music uses, so hand and kick drum interfere with each other.
const touch = new Touch(canvas, stage.camera, choreo, arena.radius);

const recorder = new Recorder(canvas, engine);
recorder.onState = (on) => ui.setRecording(on);
// The fourth argument is the File, and dropping it left the SHARE button
// permanently hidden — which on a phone is the entire path from "that looked
// good" to it actually being posted.
recorder.onClip = (url, name, bytes, file) => ui.showClip(url, name, file);

// Keep the frame rate honest on whatever machine this turns out to be.
const governor = new QualityGovernor(stage, arena);

const settings = new Settings();
settings.onChange = (v) => {
  camera.cuts = v.camera === 'cuts';
  arena.setCausticsWanted(v.caustics === 'on');
  touch.enabled = v.ripples === 'on';
  if (identity) { identity.paletteMode = v.palette; identity._recompute(); arena.setIdentity(identity); }
};
ui.on.settings = () => settings.toggle();

// The fourteen songs this build was tuned against. The audio is not shipped —
// it is commercial music — so the list links out and tab capture carries it in.
const testSet = new TestSet();
ui.on.testset = () => testSet.toggle();

// The shipped Creative Commons tracks. This is the only entry point that needs
// nothing whatsoever from the viewer — no file, no second tab, no microphone —
// and the only one that works on iOS, where tab capture does not exist.
testSet.onPlay = (path, title) => {
  engine.ensureContext();
  beginTrack(async () => {
    const res = await fetch(path);
    if (!res.ok) throw new Error('demo fetch failed: ' + res.status);
    await engine.loadArrayBuffer(await res.arrayBuffer(), title);
  }, 'LOADING ' + title.toUpperCase());
};

// ---------------------------------------------------------------------------
// The shared library — one curator adds, everybody plays
// ---------------------------------------------------------------------------
const library = new Library();

// Step two of "bring your own": the song is now playing over there, so capture
// it. This needs its own click — getDisplayMedia demands a fresh user gesture,
// and the one that opened YouTube was spent in another tab.
testSet.onPickTab = () => ui.emit('tab');

testSet.onPlayLibrary = (track, title) => {
  engine.ensureContext();
  beginTrack(async () => {
    const res = await fetch(library.audioUrl(track.path));
    if (!res.ok) throw new Error('library fetch failed: ' + res.status);
    await engine.loadArrayBuffer(await res.arrayBuffer(), title);
  }, 'LOADING ' + String(title).toUpperCase().slice(0, 34),
     'THAT LIBRARY TRACK COULD NOT BE LOADED');
};

/**
 * The library is optional furniture. If Supabase is unreachable, rate limited,
 * or simply not configured in a fork, the app must lose one section and nothing
 * else — every other way in still works with no network at all.
 */
async function refreshLibrary() {
  try {
    testSet.setLibrary(await library.list());
  } catch (err) {
    console.warn('library unavailable:', err.message);
    testSet.setLibrary(null, err);
  }
}
refreshLibrary();

// The curator's door is not on the landing page. It opens only with ?admin,
// which keeps a sign-in form off a page that is otherwise entirely public.
// Arriving back from a sign-in link is itself a request for the curator door,
// so a returning token opens it even without ?admin in the address. That lets
// the redirect URL stay free of a query string — see Library.sendMagicLink —
// which is what stops the link being bounced to the Site URL and a 404.
const RETURNING_FROM_SIGN_IN = /[#&]access_token=/.test(location.hash);
if (new URLSearchParams(location.search).has('admin') || RETURNING_FROM_SIGN_IN) {
  library.captureSessionFromUrl();
  (async () => {
    await library.refreshIdentity();
    testSet.showAdmin({ signedIn: library.signedIn, admin: library.admin, email: library.email });
    // Coming back from the email means the next thing wanted is the upload
    // form, not a landing page with no sign that anything happened.
    if (RETURNING_FROM_SIGN_IN) {
      testSet.open();
      ui.toast(!library.signedIn ? 'THAT SIGN-IN LINK WAS REJECTED — ASK FOR A NEW ONE'
               : library.admin ? 'SIGNED IN — READY TO ADD TRACKS'
                               : 'SIGNED IN, BUT NOT ON THE CURATOR LIST');
    }
  })();

  testSet.onSignIn = async (email) => {
    testSet.setStatus('SENDING…');
    try {
      await library.sendMagicLink(email);
      testSet.setStatus('LINK SENT — OPEN IT ON THIS DEVICE', 'ok');
    } catch (err) {
      testSet.setStatus(String(err.message || err).toUpperCase().slice(0, 120), 'bad');
    }
  };

  testSet.onPasteLink = async (url) => {
    testSet.setStatus('CHECKING THE LINK…');
    try {
      await library.useLink(url);
      await library.refreshIdentity();
      testSet.showAdmin({ signedIn: library.signedIn, admin: library.admin, email: library.email });
      // refreshIdentity drops the session if the server rejects it, so a token
      // that parsed but is expired or forged must not be reported as a sign-in.
      if (!library.signedIn) {
        testSet.setStatus('THAT LINK WAS REJECTED — ASK FOR A NEW ONE', 'bad');
      } else {
        testSet.setStatus(library.admin ? 'SIGNED IN' : 'SIGNED IN, BUT NOT A CURATOR',
          library.admin ? 'ok' : 'bad');
      }
    } catch (err) {
      testSet.setStatus(String(err.message || err).toUpperCase().slice(0, 140), 'bad');
    }
  };

  testSet.onSignOut = () => {
    library.signOut();
    testSet.showAdmin({ signedIn: false, admin: false, email: '' });
  };

  /**
   * Analyse before uploading, so a library row carries the same reading the
   * picker shows for everything else — and so the curator sees what they are
   * about to publish before it goes up.
   */
  testSet.onUpload = async (items) => {
    // Each entry is { file, title, artist } — the title has already been
    // cleaned of filename junk and, where it mattered, corrected by hand.
    const queue = (Array.isArray(items) ? items : [items])
      .map(it => (it && it.file ? it : { file: it, title: '', artist: '' }));
    const done = [], failed = [];

    // Sequential on purpose. Analysis decodes the whole file into memory and
    // upload competes for the same connection, so running a dozen at once is a
    // good way to make every one of them slower and some of them fail. One at a
    // time, and one failure never takes the rest of the batch with it.
    for (let i = 0; i < queue.length; i++) {
      const { file, artist } = queue[i];
      const title = (queue[i].title || file.name.replace(/\.[^.]+$/, '')).slice(0, 120);
      const nth = queue.length > 1 ? '(' + (i + 1) + '/' + queue.length + ') ' : '';
      const label = title.slice(0, 26).toUpperCase();
      try {
        testSet.setStatus(nth + 'READING ' + label + '…');
        const ctx = engine.ensureContext();
        const buf = await ctx.decodeAudioData(await file.arrayBuffer());
        const env = computePeaks(buf);
        const id = new SongIdentity(buf, env);
        id.paletteMode = settings.get('palette');
        id._recompute();
        const card = id.card();

        testSet.setStatus(nth + 'UPLOADING ' + label + ' · '
          + (file.size / 1048576).toFixed(1) + ' MB…');
        await library.upload(file, slugify(title || file.name), {
          title,
          artist: (artist || '').slice(0, 120),
          duration: buf.duration,
          mood: card.mood,
          key_name: card.key || null,
          bpm: card.bpm || null,
          colour: card.colour,
          hue: card.hue,
          key_sure: !!card.keySure,
          bpm_sure: !!card.bpmSure,
        });
        done.push(card.colour);
        // Show it landing rather than making the whole batch finish first.
        refreshLibrary();
      } catch (err) {
        failed.push(label + ': ' + String(err.message || err).slice(0, 60));
        console.error('upload failed for', file.name, err);
      }
    }

    if (queue.length === 1) {
      testSet.setStatus(failed.length ? failed[0].toUpperCase().slice(0, 130)
        : 'ADDED — ' + done[0], failed.length ? 'bad' : 'ok');
    } else {
      // A batch has to report both halves: silently dropping the ones that
      // failed is how a library ends up with holes nobody knows about.
      testSet.setStatus(
        ('ADDED ' + done.length + ' OF ' + queue.length
          + (failed.length ? ' · FAILED: ' + failed.join(' | ') : '')).toUpperCase().slice(0, 220),
        failed.length ? 'bad' : 'ok');
    }
    refreshLibrary();
  };

}

ui.on.record = () => {
  if (!Recorder.supported) { ui.toast('RECORDING IS NOT SUPPORTED IN THIS BROWSER'); return; }
  if (!engine.buffer) { ui.toast('PLAY SOMETHING FIRST'); return; }
  recorder.toggle();
};

arena.setPixelRatio(stage.pixelRatio);
stage.onResize = (pr) => { arena.setPixelRatio(pr); ui.redrawPeaks(); };

// A lost GL context is otherwise indistinguishable from the app having crashed:
// the canvas simply stays black and nothing is logged. Say so, and drop to the
// cheapest settings on the way back so the same load does not lose it again.
stage.onContextLost = () => ui.toast('GRAPHICS CONTEXT LOST — RECOVERING');
stage.onContextRestored = () => {
  governor._apply(Math.max(governor.level, 3));
  ui.toast('RECOVERED');
};

// The module got this far, so three.js resolved and the renderer built.
document.body.classList.add('booted');

// Tab audio is the shortest way in, but it does not exist on iOS Safari, so
// the button asks before it offers itself.
ui.enableTabEntry(AudioEngine.tabAudioSupported);

let analyser = null;
let identity = null;
let awake = 0.22;          // how "alive" the field is: landing 0.22 -> performance 1
let started = false;
let looping = false;       // a track is loaded and the arena is live
let last = performance.now();

// Settings.apply() runs inside the Settings constructor, before onChange can be
// assigned, so nothing was ever applied at startup: a saved preference showed
// as selected in the panel and only took effect once it was toggled. It has to
// happen down here — the handler closes over `identity`, which is declared
// above but is still in its temporal dead zone until this point.
settings.apply();

// Idle music state so the arena breathes before anything is loaded.
const idleMusic = {
  amplitude: 0, sub: 0, bass: 0, mids: 0, highs: 0, air: 0,
  kick: 0, snare: 0, hat: 0, beat: 0, beatPulse: 0,
  energy: 0, energyShort: 0, energyLong: 0, rise: 0, flux: 0,
  bpm: 0, beatPhase: 0, beatConfidence: 0, beatDensity: 0,
  spectrum: new Float32Array(128),
  harmony: null, voice: null,
  time: 0, progress: 0, playing: false, silence: 1, onset: null,
};

// ---------------------------------------------------------------------------
// Track loading
// ---------------------------------------------------------------------------
// While the viewer is on the OTHER tab, this one is not compositing, so
// requestAnimationFrame stops and with it the whole analysis loop. That matters
// specifically for tab capture, because changing the song means going to the
// YouTube tab — exactly when we are blind. The gap between the two songs
// happens while no frames run, so the change detector never sees it and the
// arena comes back still wearing the previous song's reading.
//
// Coming back after being away long enough to have changed something is itself
// the signal. Treat it as a possible new song rather than pretending we watched.
let _hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { _hiddenAt = performance.now(); return; }
  const away = (performance.now() - _hiddenAt) / 1000;
  if (!engine.live || !identity || _hiddenAt === 0 || away < 3) return;
  identity.resetLive();
  choreo.resetLive();
  _sinceNew = 0;
  ui.toast('WELCOME BACK — RE-READING');
});

// ---------------------------------------------------------------------------
// Live input: noticing that the song changed
// ---------------------------------------------------------------------------
//
// A file has a beginning, so the arena knows when to form a new opinion. A tab
// does not: the playlist moves on and the audio simply becomes a different song
// mid-stream, with nothing to mark it.
//
// The mark that does exist is the gap. Track changes on any player leave a
// short near-silence between songs, and that is enough — a gap long enough to
// be a change rather than a rest, followed by sound coming back.
let _gap = 0;             // seconds of near-silence so far
let _sawGap = false;      // a long enough one happened; waiting for audio again
let _heardSound = false;  // there was music BEFORE the gap
let _sinceNew = 1e9;      // stops a stuttering stream re-triggering repeatedly
let _newSongCard = 0;

const GAP_ENOUGH = 0.45;  // below this it is a breath, not a track change
const RETRIGGER_LOCK = 8;

// Capturing a tab that turns out to be making no sound is the most likely way
// this goes wrong after the picker closes — the wrong tab, a paused video, or
// the "share tab audio" box left unticked, which Chrome does not tick for you.
// Until now that produced a flat pool and no explanation whatsoever.
let _quietLive = 0;
let _saidQuiet = false;

function watchForQuietTab(music, dt) {
  if (music.silence > 0.55) {
    _quietLive += dt;
    if (_quietLive > 5.5 && !_saidQuiet) {
      _saidQuiet = true;
      ui.toast('NO SOUND FROM THAT TAB — IS IT PLAYING, AND DID YOU TICK "SHARE TAB AUDIO"?');
    }
  } else {
    _quietLive = 0;
    _saidQuiet = false;      // say it again if it happens later, but not while it lasts
  }
}

function watchForNewSong(music, dt) {
  _sinceNew += dt;
  if (music.silence > 0.55) {
    _gap += dt;
    // A change of song is sound, then a gap, then sound. Without the first of
    // those, the silence that exists before any audio has arrived counted as a
    // gap, so connecting to a tab fired "NEW SONG" about half a second in —
    // every single time, resetting the reading at the very moment it was
    // starting to form one.
    if (_gap > GAP_ENOUGH && _heardSound) _sawGap = true;
    return;
  }
  _heardSound = true;
  if (_sawGap && _sinceNew > RETRIGGER_LOCK) {
    _sinceNew = 0;
    identity.resetLive();   // stop defending the previous song's reading
    choreo.resetLive();     // and its loudness scale, which belonged to that song
    ui.toast('NEW SONG — READING IT');
    // Show the new reading once there has been enough music to have one.
    clearTimeout(_newSongCard);
    _newSongCard = setTimeout(() => {
      if (engine.live && identity) ui.showIdentity(identity.card(), 3600);
    }, 9000);
  }
  _gap = 0;
  _sawGap = false;
}

/**
 * Let the renderer paint before the next blocking step.
 *
 * requestAnimationFrame does not fire in a tab that is not compositing — a
 * background tab, a minimised window, an occluded pane. Waiting on it alone
 * meant that dropping a song and then switching tabs left the load parked
 * forever on "READING THE LEVELS", which is a thing people genuinely do while
 * a file decodes. The timeout guarantees the analysis finishes either way; the
 * frame is a nicety for when someone is actually watching.
 */
const nextFrame = () => new Promise(resolve => {
  let done = false;
  const go = () => { if (!done) { done = true; resolve(); } };
  requestAnimationFrame(go);
  setTimeout(go, 120);
});

async function beginTrack(loader, label, failMsg) {
  ui.showLoading(label);
  try {
    await engine.resume();
    await loader();
  } catch (err) {
    console.error(err);
    ui.hideLoading();
    // A dropped file that will not decode and a library track that will not
    // download are different problems, and telling someone to try a different
    // format when the fetch 404'd sends them off fixing the wrong thing.
    ui.toast(failMsg || 'COULD NOT DECODE THAT FILE — TRY MP3, WAV OR M4A');
    return;
  }

  if (!analyser) analyser = new MusicAnalyser(
    engine.analyser, engine.ctx.sampleRate, engine.harmonyAnalyser,
    engine.midAnalyser, engine.sideAnalyser,
  );

  // Read the whole track before a single frame is drawn: level envelope for the
  // scrubber, loudness reference for the analyser, structure for the plan.
  //
  // These two steps run on the main thread for a few hundred milliseconds on a
  // long song, and they used to run back to back immediately after the decode,
  // so the idle water froze mid-motion — which reads as the page having hung
  // at exactly the moment the viewer is deciding whether this thing works.
  // Yielding a frame between them costs nothing and keeps the arena alive
  // through the wait, and naming each step means the wait says what it is
  // doing rather than showing an unmoving bar.
  ui.setLoadingLabel('READING THE LEVELS');
  await nextFrame();
  const env = computePeaks(engine.buffer);
  const { peaks, refRms } = env;
  analyser.resetTrack(refRms);
  choreo.resetTrack(new TrackPlan(env, refRms, engine.duration));

  ui.setLoadingLabel('FINDING THE KEY AND THE PULSE');
  await nextFrame();
  // The song's world, decided before a frame is drawn.
  identity = new SongIdentity(engine.buffer, env);
  identity.paletteMode = settings.get('palette');
  identity._recompute();
  arena.setIdentity(identity);
  // The Choreographer needs it too: how activated the song is decides how big
  // the arena is ever allowed to get, which level relative to the track's own
  // plateau can never tell it.
  choreo.identity = identity;

  ui.hideLoading();
  ui.setLive(false);
  ui.enterPerformance(engine.title, engine.duration, peaks);

  // Cinematic entry: the arena wakes, the camera settles in.
  camera.impulse(0.55);
  started = true;

  engine.play();
  ui.setPlaying(true);
  ui.hideEnded();
  // The reading the decode resolves into. It lands with the first frames
  // rather than after them, so the wait ends in the answer instead of in
  // nothing, and the hint waits its turn rather than fighting the card.
  ui.showIdentity(identity.card());
  setTimeout(() => ui.showHint(), 4600);
}

ui.on.file = (file) => {
  if (!/^audio\//.test(file.type) && !/\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(file.name)) {
    ui.toast('THAT DOES NOT LOOK LIKE AN AUDIO FILE');
    return;
  }
  engine.ensureContext();
  beginTrack(() => engine.loadFile(file), 'READING ' + file.name.slice(0, 34).toUpperCase());
};

ui.on.demo = () => {
  engine.ensureContext();
  beginTrack(async () => {
    const buf = await renderDemoTrack(engine.ctx);
    engine.setBuffer(buf, DEMO_TITLE);
  }, 'COMPOSING DEMO PERFORMANCE');
};

ui.on.mic = () => beginLive(() => engine.useMicrophone(), 'LISTENING', 'mic');

/**
 * Play from another browser tab.
 *
 * This is the entry that matters. Everything else assumes the viewer has a
 * loose audio file, and almost nobody does any more — they have a tab with
 * something already playing in it. Taking the audio from that tab is both the
 * shortest way in and a cleaner signal than the microphone.
 */
ui.on.tab = () => beginLive(() => engine.useTabAudio(), 'PICK THE TAB', 'tab');

async function beginLive(getStream, label, kind) {
  engine.ensureContext();
  ui.showLoading(label);
  try {
    await getStream();
  } catch (err) {
    ui.hideLoading();
    // Cancelling the picker is a decision, not a failure, and must not be
    // shouted at the viewer as though something broke.
    if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) return;
    console.error(err);
    if (err && err.code === 'NO_TAB_AUDIO') {
      ui.toast('NO AUDIO IN THAT SHARE — PICK A TAB AND TICK "SHARE TAB AUDIO"');
    } else if (kind === 'tab') {
      ui.toast('COULD NOT CAPTURE THAT TAB');
    } else {
      ui.toast('COULD NOT ACCESS THE MICROPHONE');
    }
    return;
  }
  if (!analyser) analyser = new MusicAnalyser(
    engine.analyser, engine.ctx.sampleRate, engine.harmonyAnalyser,
    engine.midAnalyser, engine.sideAnalyser,
  );
  // No pre-scan is possible on a live signal: there is no future to read. The
  // analyser gets a nominal reference and the Choreographer falls back to the
  // live-inference path it already keeps for exactly this case.
  analyser.resetTrack(0.09);
  choreo.resetTrack(null);
  _gap = 0; _sawGap = false; _heardSound = false; _sinceNew = 1e9;
  _quietLive = 0; _saidQuiet = false;
  identity = SongIdentity.live();
  identity.paletteMode = settings.get('palette');
  identity._recompute();
  arena.setIdentity(identity);
  choreo.identity = identity;

  ui.hideLoading();
  ui.enterPerformance(engine.title, 0, new Float32Array(0));
  ui.setLive(true);
  ui.setPlaying(true);
  ui.hideEnded();
  // A live signal has no future to read, so the card says what it is reading
  // rather than claiming a key and a tempo it cannot yet know.
  ui.showIdentity(identity.card(), 3400);
  setTimeout(() => ui.showHint(), 3800);
  camera.impulse(0.5);
  started = true;
}

ui.on.toggle = () => {
  if (!engine.buffer) return;
  engine.toggle();
  ui.setPlaying(engine.playing);
  if (engine.playing) camera.impulse(0.2);
};

ui.on.seek = (p) => { engine.seek(p * engine.duration); };
ui.on.nudge = (d) => { engine.seek(engine.currentTime + d); };
ui.on.volume = (v) => engine.setVolume(v);

// Chrome's own "stop sharing" bar can end a tab capture at any moment, and
// without this the arena keeps performing a signal that is no longer arriving.
engine.onLiveEnded = () => {
  if (!engine.live) return;
  engine.stopLive();
  ui.setLive(false);
  ui.setPlaying(false);
  ui.backToLanding();
  started = false;
  ui.toast('SHARING STOPPED');
};

ui.on.reset = () => {
  if (engine.live) engine.stopLive();
  ui.setLive(false);
  engine.rewind();
  ui.setPlaying(false);
  ui.backToLanding();
  started = false;
};

ui.on.loop = () => { looping = !looping; ui.setLoop(looping); };

/**
 * Capture the song's biggest moment, hands-free.
 *
 * TrackPlan already located the drops before playback began, so the one clip
 * most worth posting is a known timestamp — there is no reason to make anyone
 * hunt for it with a record button. Starts a little early so the run-up is in
 * frame, because a drop with nothing before it does not read as a drop.
 */
/**
 * Where the song's biggest moment is, or -1 if we cannot say.
 *
 * TrackPlan located the drops before playback began, so this is a known
 * timestamp rather than something anyone should have to hunt for.
 */
function bestMoment() {
  if (!engine.buffer || !choreo.plan) return -1;
  const drops = choreo.plan.drops;
  if (drops.length) {
    return drops.reduce((a, b) => (choreo.plan.levelAt(b) > choreo.plan.levelAt(a) ? b : a));
  }
  return engine.duration > 20 ? engine.duration * 0.55 : -1;
}

function formatClock(s) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return m + ':' + String(r).padStart(2, '0');
}

ui.on.moment = () => {
  if (!Recorder.supported) { ui.toast('RECORDING IS NOT SUPPORTED IN THIS BROWSER'); return; }
  if (!engine.buffer || !choreo.plan) { ui.toast('PLAY SOMETHING FIRST'); return; }
  if (recorder.recording) { recorder.stop(); return; }

  const found = bestMoment();
  const best = found >= 0 ? found : engine.duration * 0.55;

  const lead = 3.5, len = 13;
  engine.seek(Math.max(0, best - lead));
  if (!engine.playing) { engine.play(); ui.setPlaying(true); }
  ui.toast('CAPTURING THE DROP');
  recorder.start(len);
};
ui.on.again = () => { engine.rewind(); engine.play(); ui.setPlaying(true); };

engine.onEnded = () => {
  ui.setPlaying(false);
  if (looping) { engine.rewind(); engine.play(); ui.setPlaying(true); return; }
  // Say so, and offer the things anyone actually wants next — including the
  // clip, which is the only one of them they can take away with them.
  const best = bestMoment();
  ui.showEnded({
    clip: Recorder.supported && best >= 0,
    at: best >= 0 ? formatClock(best) : '',
  });
  // Nothing to damp here: with playback stopped the analyser decays to silence
  // on its own and the arena settles. Forcing the field down instead left the
  // water at a fraction of its height for the whole of any replay.
};

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  // Two steps, deliberately. `dt` advances the simulation (the field's clock and
  // impulse ages) and is clamped hard so a hitch cannot make the water jump.
  // `dtSmooth` drives exponential smoothing, which is stable at any step size —
  // clamping that only makes every transition crawl when frames are dropped.
  const rawDt = (now - last) / 1000;
  const dt = Math.min(rawDt, 1 / 20);
  const dtSmooth = Math.min(rawDt, 0.5);
  last = now;
  governor.update(rawDt);

  const music = analyser
    ? analyser.update(dtSmooth, engine.currentTime, engine.progress, engine.playing)
    : idleMusic;

  const perf = choreo.update(dt, music);
  if (identity) {
    if (music.harmony) identity.observe(music.harmony, dtSmooth);
    if (music.pace) identity.observePace(music.pace, dtSmooth);
    if (engine.live) {
      // Tempo and timbre are placeholders on a live identity until something
      // measures them; without this the swell is a constant for every song.
      identity.observeLive(music, dtSmooth);
      watchForNewSong(music, dtSmooth);
      watchForQuietTab(music, dtSmooth);
    }
  }

  // choreography events -> camera
  for (const ev of choreo.events) {
    if (ev.type === 'drop') { camera.impulse(1.15); camera.cutFor('drop', perf.section); }
    else if (ev.type === 'settle') camera.cutFor('settle', perf.section);
    else if (ev.type === 'surge') { camera.impulse(0.35 + ev.strength * 1.6); camera.cutFor('surge', perf.section); }
    else if (ev.type === 'section') { camera.impulse(0.22); camera.cutFor('section', ev.to); }
    else if (ev.type === 'kick' && perf.level > 0.72) camera.impulse(0.07 * ev.strength);
  }

  // Derived, never assigned from events — an event-driven version got stuck at
  // a damped value after a track ended and crippled every subsequent replay.
  const awakeTarget = started ? 1 : 0.22;
  awake += (awakeTarget - awake) * (1 - Math.exp(-dtSmooth * (awakeTarget > awake ? 0.9 : 1.6)));
  // dtSmooth, not dt. Feeding the clamped simulation dt to the opening fade
  // made the time-to-visible depend on the frame rate: at ten frames a second
  // the clamp discarded half of every elapsed second and the arena sat black
  // for the better part of ten, which reads as a broken page rather than as a
  // fade. Exponential smoothing is stable at any step, so it wants real time.
  stage.fade += (1 - stage.fade) * (1 - Math.exp(-dtSmooth * 1.4));

  arena.syncImpulses(choreo.impulseA, choreo.impulseB, choreo.time);
  arena.update(dt, music, perf, awake, dtSmooth);
  camera.update(dt, perf, music, dtSmooth);
  perf.focusY = camera.focusY;
  stage.render(dt, perf);

  ui.update(now, engine, perf);
  if (started) {
    // Key and tempo are read from the whole track before playback, so show that
    // immediately and let the live analysis take over once it has converged.
    // Waiting for the live reading left the chip blank through the whole intro
    // of every song, which is the part where someone is deciding whether this
    // is doing anything at all.
    const h = music.harmony;
    const key = (h && h.tonicName && h.confidence > 0.25) ? h.tonicName
      : (identity && identity.keyConfidence > 0.10 ? identity.keyName : null);
    const bpm = music.bpm > 40 ? Math.round(music.bpm)
      : (identity && identity.bpmOffline > 40 ? identity.bpmOffline : 0);
    ui.setInfo([
      key,
      bpm ? bpm + ' BPM' : null,
      identity ? Math.round(identity.hue) + '\u00b0' : null,
    ]);
  }
  if (recorder.recording) ui.setRecordTime(recorder.elapsed);
}

// Fade up from black on first paint.
requestAnimationFrame((t) => { last = t; frame(t); });

// Expose the pipeline for tinkering from the console.
window.WAVE = {
  engine, arena, choreo, stage, camera, ui, touch, recorder, settings, governor, THREE,
  get perf() { return governor.describe(); },
  get music() { return analyser?.state; },
  get analyser() { return analyser; },
  get plan() { return choreo.plan?.describe(); },
  get identity() { return identity?.describe(); },
};
