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
import { Stage, CinematicCamera, detectQuality } from './renderer/Stage.js';
import { UI } from './ui/UI.js';
import { Touch } from './ui/Touch.js';
import { Recorder } from './ui/Recorder.js';
import { Settings } from './ui/Settings.js';

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
recorder.onClip = (url, name) => ui.showClip(url, name);
const settings = new Settings();
settings.onChange = (v) => {
  camera.cuts = v.camera === 'cuts';
  arena.caustics.visible = v.caustics === 'on';
  touch.enabled = v.ripples === 'on';
  if (identity) { identity.paletteMode = v.palette; identity._recompute(); arena.setIdentity(identity); }
};
ui.on.settings = () => settings.toggle();

ui.on.record = () => {
  if (!Recorder.supported) { ui.toast('RECORDING IS NOT SUPPORTED IN THIS BROWSER'); return; }
  if (!engine.buffer) { ui.toast('PLAY SOMETHING FIRST'); return; }
  recorder.toggle();
};

arena.setPixelRatio(stage.pixelRatio);
stage.onResize = (pr) => { arena.setPixelRatio(pr); ui.redrawPeaks(); };

let analyser = null;
let identity = null;
let awake = 0.22;          // how "alive" the field is: landing 0.22 -> performance 1
let started = false;
let looping = false;       // a track is loaded and the arena is live
let last = performance.now();

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
async function beginTrack(loader, label) {
  ui.showLoading(label);
  try {
    await engine.resume();
    await loader();
  } catch (err) {
    console.error(err);
    ui.hideLoading();
    ui.toast('COULD NOT DECODE THAT FILE — TRY MP3, WAV OR M4A');
    return;
  }

  if (!analyser) analyser = new MusicAnalyser(
    engine.analyser, engine.ctx.sampleRate, engine.harmonyAnalyser,
    engine.midAnalyser, engine.sideAnalyser,
  );

  // Read the whole track before a single frame is drawn: level envelope for the
  // scrubber, loudness reference for the analyser, structure for the plan.
  const env = computePeaks(engine.buffer);
  const { peaks, refRms } = env;
  analyser.resetTrack(refRms);
  choreo.resetTrack(new TrackPlan(env, refRms, engine.duration));

  // The song's world, decided before a frame is drawn.
  identity = new SongIdentity(engine.buffer, env);
  identity.paletteMode = settings.get('palette');
  identity._recompute();
  arena.setIdentity(identity);

  ui.hideLoading();
  ui.setLive(false);
  ui.enterPerformance(engine.title, engine.duration, peaks);

  // Cinematic entry: the arena wakes, the camera settles in.
  camera.impulse(0.55);
  started = true;

  engine.play();
  ui.setPlaying(true);
  ui.hideEnded();
  ui.showHint();
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

ui.on.mic = async () => {
  engine.ensureContext();
  ui.showLoading('LISTENING');
  try {
    await engine.useMicrophone();
  } catch (err) {
    console.error(err);
    ui.hideLoading();
    ui.toast('COULD NOT ACCESS THE MICROPHONE');
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
  identity = SongIdentity.live();
  identity.paletteMode = settings.get('palette');
  identity._recompute();
  arena.setIdentity(identity);

  ui.hideLoading();
  ui.enterPerformance('LIVE INPUT', 0, new Float32Array(0));
  ui.setLive(true);
  ui.setPlaying(true);
  ui.showHint();
  camera.impulse(0.5);
  started = true;
};

ui.on.toggle = () => {
  if (!engine.buffer) return;
  engine.toggle();
  ui.setPlaying(engine.playing);
  if (engine.playing) camera.impulse(0.2);
};

ui.on.seek = (p) => { engine.seek(p * engine.duration); };
ui.on.nudge = (d) => { engine.seek(engine.currentTime + d); };
ui.on.volume = (v) => engine.setVolume(v);

ui.on.reset = () => {
  if (engine.live) engine.stopMicrophone();
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
ui.on.moment = () => {
  if (!Recorder.supported) { ui.toast('RECORDING IS NOT SUPPORTED IN THIS BROWSER'); return; }
  if (!engine.buffer || !choreo.plan) { ui.toast('PLAY SOMETHING FIRST'); return; }
  if (recorder.recording) { recorder.stop(); return; }

  const drops = choreo.plan.drops;
  const best = drops.length
    ? drops.reduce((a, b) => (choreo.plan.levelAt(b) > choreo.plan.levelAt(a) ? b : a))
    : engine.duration * 0.55;

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
  // Say so, and offer the two things anyone actually wants next.
  ui.showEnded();
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

  const music = analyser
    ? analyser.update(dtSmooth, engine.currentTime, engine.progress, engine.playing)
    : idleMusic;

  const perf = choreo.update(dt, music);
  if (identity) {
    if (music.harmony) identity.observe(music.harmony, dtSmooth);
    if (music.pace) identity.observePace(music.pace, dtSmooth);
  }

  // choreography events -> camera
  for (const ev of choreo.events) {
    if (ev.type === 'drop') { camera.impulse(1.15); camera.cutFor('drop', perf.section); }
    else if (ev.type === 'settle') camera.cutFor('settle', perf.section);
    else if (ev.type === 'surge') { camera.impulse(0.35 + ev.strength * 1.6); camera.cutFor('surge', perf.section); }
    else if (ev.type === 'section') { camera.impulse(0.22); camera.cutFor('section', ev.to); }
    else if (ev.type === 'kick' && perf.section === 'drop') camera.impulse(0.07 * ev.strength);
  }

  // Derived, never assigned from events — an event-driven version got stuck at
  // a damped value after a track ended and crippled every subsequent replay.
  const awakeTarget = started ? 1 : 0.22;
  awake += (awakeTarget - awake) * (1 - Math.exp(-dtSmooth * (awakeTarget > awake ? 0.9 : 1.6)));
  stage.fade += (1 - stage.fade) * (1 - Math.exp(-dt * 1.1));   // fade up from black

  arena.syncImpulses(choreo.impulseA, choreo.impulseB, choreo.time);
  arena.update(dt, music, perf, awake, dtSmooth);
  camera.update(dt, perf, music, dtSmooth);
  perf.focusY = camera.focusY;
  stage.render(dt, perf);

  ui.update(now, engine, perf);
  if (started) {
    const h = music.harmony;
    ui.setInfo([
      h && h.tonicName && h.confidence > 0.25 ? h.tonicName : null,
      music.bpm > 40 ? Math.round(music.bpm) + ' BPM' : null,
      identity ? identity.describe().hue + '\u00b0' : null,
    ]);
  }
  if (recorder.recording) ui.setRecordTime(recorder.elapsed);
}

// Fade up from black on first paint.
requestAnimationFrame((t) => { last = t; frame(t); });

// Expose the pipeline for tinkering from the console.
window.WAVE = {
  engine, arena, choreo, stage, camera, ui, touch, recorder, settings, THREE,
  get music() { return analyser?.state; },
  get analyser() { return analyser; },
  get plan() { return choreo.plan?.describe(); },
  get identity() { return identity?.describe(); },
};
