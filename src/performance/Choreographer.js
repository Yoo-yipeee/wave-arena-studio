/**
 * Choreographer — the layer that makes this a performance rather than a meter.
 *
 * It consumes the normalized music state, decides which *section* of the song
 * we are in, and emits a set of smoothly-morphing performance parameters plus
 * discrete wave events. Nothing downstream knows about frequencies; the water,
 * camera and atmosphere only read this.
 *
 * The future pipeline (semantic understanding -> performance plan -> choreography)
 * plugs in here: replace or precede `decideSection` with a planned timeline and
 * every other layer keeps working unchanged.
 */

import { FORM_COUNT, FORM_INDEX } from './Primitives.js';

export const SECTION_LABELS = ['STILL', 'QUIET', 'FLOW', 'LIFT', 'PEAK', 'BUILD', 'DROP'];

/**
 * The look, as a continuous ramp rather than eight named rooms.
 *
 * This used to be a table of eight sections — silence, intro, verse, build,
 * drop, chorus, break, outro — with a state machine choosing one, minimum dwell
 * times, and hysteresis bands to stop it flapping. It flapped anyway: measured
 * over twenty seconds of one slow love song the arena passed through verse,
 * build, drop and chorus, and being labelled a "drop" is what made a tender
 * song erupt. Every crossing was a step change in twelve parameters at once,
 * and after the multiplication chain was removed from height, that stepping was
 * the largest remaining source of the randomness this whole thing was accused
 * of.
 *
 * A song does not have eight states. It has an amount of intensity that moves
 * continuously, and a sense of whether it is gathering or spending. So there
 * are two continuous coordinates now and no machine at all:
 *
 *   level  0..1  how big this moment is, against the track's own range
 *   lift   0..1  how much it is gathering toward something
 *
 * `level` comes straight from the plan's relative level, which was always a
 * continuous number — the old machine's whole job was to threshold it into
 * labels and then look those labels back up. That round trip is gone.
 *
 * These anchors are the old table's values placed at the level they described,
 * and blendLook interpolates between them. A drop is still an EVENT, because a
 * drop is a moment rather than a region.
 */
const ANCHORS = [
  { at: 0.00, height: 0.55, spectrumGain: 0.10, complexity: 0.10, chaos: 0.02, symmetry: 2,
    mist: 0.20, spray: 0.00, bloom: 0.55, heat: 0.00, camDist: 40, camHeight: 13.0, fov: 34,
    forms: { voice: 0.20, harmonic: 0.25, radial: 0.06, rings: 0.55, towers: 0.00, walls: 0.10, arches: 0.00, columns: 0.00 } },
  { at: 0.22, height: 0.95, spectrumGain: 0.30, complexity: 0.24, chaos: 0.05, symmetry: 2,
    mist: 0.32, spray: 0.03, bloom: 0.72, heat: 0.06, camDist: 38, camHeight: 12.0, fov: 35,
    forms: { voice: 0.80, harmonic: 0.58, radial: 0.15, rings: 0.60, towers: 0.04, walls: 0.17, arches: 0.05, columns: 0.00 } },
  { at: 0.48, height: 1.75, spectrumGain: 0.62, complexity: 0.45, chaos: 0.10, symmetry: 2,
    mist: 0.40, spray: 0.12, bloom: 0.88, heat: 0.20, camDist: 34, camHeight: 11.0, fov: 37,
    forms: { voice: 1.15, harmonic: 0.85, radial: 0.28, rings: 0.50, towers: 0.18, walls: 0.30, arches: 0.10, columns: 0.10 } },
  { at: 0.76, height: 2.95, spectrumGain: 1.00, complexity: 0.80, chaos: 0.22, symmetry: 4,
    mist: 0.70, spray: 0.55, bloom: 1.15, heat: 0.72, camDist: 41, camHeight: 18.0, fov: 41,
    forms: { voice: 1.25, harmonic: 1.00, radial: 0.45, rings: 0.60, towers: 0.65, walls: 0.40, arches: 0.60, columns: 0.75 } },
  { at: 1.00, height: 3.30, spectrumGain: 1.15, complexity: 0.95, chaos: 0.40, symmetry: 4,
    mist: 0.85, spray: 1.00, bloom: 1.35, heat: 1.00, camDist: 43, camHeight: 21.0, fov: 46,
    forms: { voice: 1.00, harmonic: 1.00, radial: 0.50, rings: 0.75, towers: 0.90, walls: 0.50, arches: 0.45, columns: 0.60 } },
];

const SCALARS = ['height', 'spectrumGain', 'complexity', 'chaos', 'symmetry',
  'mist', 'spray', 'bloom', 'heat', 'camDist', 'camHeight', 'fov'];

/** Scratch look, filled each frame so nothing is allocated in the loop. */
const LOOK = { forms: {} };
for (const nm of SCALARS) LOOK[nm] = 0;

/**
 * Interpolate the anchors at `level`, then let `lift` colour it.
 *
 * Lift is what a build feels like: rougher, more spray, the camera higher, the
 * vertical forms pushing up — and the water held slightly BACK, because a build
 * that is already at full height leaves the release nowhere to go.
 */
function blendLook(level, lift) {
  const t = level < 0 ? 0 : level > 1 ? 1 : level;
  let i = 0;
  while (i < ANCHORS.length - 2 && t > ANCHORS[i + 1].at) i++;
  const a = ANCHORS[i], b = ANCHORS[i + 1];
  const f = (t - a.at) / (b.at - a.at);
  for (const nm of SCALARS) LOOK[nm] = a[nm] + (b[nm] - a[nm]) * f;
  for (const nm in a.forms) LOOK.forms[nm] = a.forms[nm] + (b.forms[nm] - a.forms[nm]) * f;

  LOOK.chaos += lift * 0.20;
  LOOK.spray += lift * 0.22;
  LOOK.complexity += lift * 0.22;
  LOOK.camHeight += lift * 3.2;
  LOOK.forms.towers += lift * 0.38;
  LOOK.forms.columns += lift * 0.28;
  LOOK.height *= 1 - lift * 0.10;
  return LOOK;
}

/**
 * A name for the HUD only. Nothing visual depends on it any more.
 *
 * Sticky, because a continuous level crossing a fixed threshold dithers across
 * it: measured over one song the readout changed 73 times, which is a flicker
 * rather than a label. The bands have to be left by a clear margin, not merely
 * touched. This costs nothing — no part of the arena reads it.
 */
const LABEL_BANDS = [
  ['STILL', 0.10], ['QUIET', 0.30], ['FLOW', 0.58], ['LIFT', 0.84], ['PEAK', 2],
];
function labelFor(level, lift, sinceDrop, prev) {
  if (sinceDrop < 3.0) return 'DROP';
  if (lift > 0.45) return 'BUILD';
  const M = 0.05;
  for (let i = 0; i < LABEL_BANDS.length; i++) {
    const [name, top] = LABEL_BANDS[i];
    const lo = i === 0 ? -1 : LABEL_BANDS[i - 1][1];
    // the band you are already in is widened by the margin on both sides
    const grow = name === prev ? M : -M;
    if (level > lo - grow && level <= top + grow) return name;
  }
  return prev || 'FLOW';
}

/**
 * Phrase variants — every 8 bars the emphasis rotates, so a repeated chorus
 * reads as choreography rather than noise. Each entry is a multiplier set.
 */
const PHRASE_VARIANTS = [
  { voice: 1.0, harmonic: 1.0, radial: 1.0, rings: 1.0, towers: 1.0, walls: 1.0, arches: 1.0, columns: 1.0 },
  { voice: 1.0, harmonic: 1.0, radial: 0.8, rings: 1.2, towers: 0.5, walls: 1.5, arches: 0.6, columns: 1.3 },
  { voice: 1.0, harmonic: 1.1, radial: 1.15, rings: 0.7, towers: 1.4, walls: 0.5, arches: 1.4, columns: 0.7 },
  { voice: 1.0, harmonic: 0.95, radial: 0.9, rings: 1.1, towers: 0.9, walls: 1.2, arches: 0.8, columns: 1.4 },
];

/** Crest height ceiling, world units — the arena is 26 units across. */
const MAX_HEIGHT = 6.2;

/**
 * Shaping exponent on the height driver.
 *
 * It reserves the top of the frame for the moment that earns it: a passage at
 * 60% of full energy renders at about half height, so a drop still has
 * somewhere to go.
 *
 * It used to be 1.85, applied to an eight-term product divided by the ceiling.
 * That made it an EXPANDER at the bottom of its range, which is exactly where
 * quiet music lives: a 50% change in a small input became a 2.1x change in
 * rendered height, so a hushed passage flickered between low and flat. It now
 * applies to a single normalised 0..1 driver and is much gentler.
 */
const HEIGHT_GAMMA = 1.35;

/** How long before a planned drop the arena starts building. */
const BUILD_LEAD = 8.0;

const MAX_IMPULSES = 8;

export class Choreographer {
  constructor() {
    this.section = 'STILL';
    this.prevSection = 'STILL';
    this.sectionTime = 0;
    this.time = 0;
    this.phrase = 0;
    this.level = 0;

    this.p = {
      height: 0.7, spectrumGain: 0.1, complexity: 0.1, chaos: 0.02, symmetry: 2,
      mist: 0.2, spray: 0, bloom: 0.55, heat: 0, camDist: 40, camHeight: 13.0, fov: 34,
      forms: new Float32Array(FORM_COUNT),
      eruption: 0, shock: 0, intensity: 0, shake: 0, ringRadius: 9, ringWidth: 7,
      // exposed for the UI
      section: 'STILL', level: 0, bpm: 0, pace: 0.75, smoothness: 0.5,
    };
    this.p.forms[FORM_INDEX.rings] = 0.55;

    // impulse ring buffer: xz origin, birth, strength / speed, width, kind
    this.impulseA = new Float32Array(MAX_IMPULSES * 4);
    this.impulseB = new Float32Array(MAX_IMPULSES * 4);
    this._imp = 0;

    this.plan = null;
    this.identity = null;
    this.events = [];   // consumed each frame by camera / spray
    this.resetTrack();
  }

  /**
   * Clear everything that belongs to one song.
   *
   * Without this a second track inherits the first one's loudness ceiling,
   * section state, phrase clock and rolling histories — so it opens mid-chorus
   * with the wrong dynamics for its first half-minute.
   */
  resetTrack(plan = null, identity = null) {
    this.plan = plan;
    this.identity = identity;
    this.section = 'STILL';
    this.prevSection = 'STILL';
    this.sectionTime = 0;
    this.time = 0;
    this.phrase = -1;

    this._bassHist = [];
    this._riseHist = [];
    this._hiHist = [];
    this._sinceDrop = 99;
    this._eMax = 0.05;       // loudest the track has been (slowly forgetting)
    this._sinceSurge = 99;
    this._jump = 0;
    this._seekGuard = 0;
    this._lastTime = 0;
    this._lastWall = 0;
    this._sectionStart = 0;      // all in MUSIC time, not render time
    this._lastDropTime = -999;
    this._lastSurgeTime = -999;
    this._toDrop = null;
    this._anticipation = 0;
    this._voiceSeen = 0;
    this._firedDrop = -1;
    this._quietFor = 0;
    this._energy = 0;
    this.level = 0;
    this._lastLevel = 0;
    this._lastSettle = -999;
    this.events.length = 0;

    const p = this.p;
    p.eruption = 0; p.shock = 0; p.shake = 0; p.intensity = 0;
    p.height = 0.7; p.heat = 0; p.spray = 0;
    for (let i = 0; i < FORM_COUNT; i++) p.forms[i] = 0;
    p.forms[FORM_INDEX.rings] = 0.55;
    p.section = 'STILL';
  }

  /** Emit an expanding wave impulse into the field. */
  emit(x, z, strength, speed = 7.5, width = 4.0, kind = 0) {
    const i = this._imp % MAX_IMPULSES;
    this._imp++;
    this.impulseA[i * 4 + 0] = x;
    this.impulseA[i * 4 + 1] = z;
    this.impulseA[i * 4 + 2] = this.time;
    this.impulseA[i * 4 + 3] = strength;
    this.impulseB[i * 4 + 0] = speed;
    this.impulseB[i * 4 + 1] = width;
    this.impulseB[i * 4 + 2] = kind;
    this.impulseB[i * 4 + 3] = 0;
  }

  /**
   * How big this moment is, 0..1, continuously.
   *
   * With a plan this is simply the track's own relative level — the number the
   * old state machine spent forty lines thresholding into labels so it could
   * look the labels back up in a table. Without a plan (live input) it is
   * inferred from energy against a slowly-forgetting maximum.
   */
  _measureLevel(m) {
    if (!m.playing || this._quietFor > 0.55) return 0;

    if (this.plan) {
      const L = this.plan.relLevelAt(m.time);
      // An outro should settle even if its level holds up.
      const fade = m.progress > 0.90 ? 1 - (m.progress - 0.90) * 4.0 : 1;
      return clamp01(L * Math.max(0.45, fade));
    }

    // live: energy against what this input has recently reached
    const e = m.energyShort;
    return clamp01(e / Math.max(0.12, this._eMax * 0.92));
  }


  /** Energy climbing steadily over ~5 s — the signature of a build. */
  _sustainedRise() {
    const h = this._riseHist;
    if (h.length < 200) return false;
    return avg(h.slice(-60)) - avg(h.slice(0, 60)) > 0.020;
  }


  update(dt, m) {
    this.time += dt;                 // render clock — only for shader impulse rebasing
    this.events.length = 0;

    // Choreographic timing runs on the MUSIC clock, never on accumulated dt.
    // dt is deliberately clamped for simulation stability, so accumulating it
    // makes every section timer run slow whenever the frame rate dips — which
    // stranded the arena in 'drop' for the rest of a track. Deriving from the
    // transport also means seeking lands on the right timings immediately.
    const now = m.time;
    this.sectionTime = Math.max(0, now - this._sectionStart);
    this._sinceDrop = now - this._lastDropTime;
    this._sinceSurge = now - this._lastSurgeTime;

    // A seek makes every rolling history meaningless and would fire a bogus
    // surge from the apparent jump. Drop the histories and hold off briefly.
    //
    // Crucially this is measured against WALL CLOCK, not against music time: a
    // slow frame also advances music time by a large amount, and treating that
    // as a seek re-armed every timer on every frame — which froze the section
    // machine permanently the first time the frame rate dipped.
    const wallNow = performance.now() / 1000;
    const wallDt = this._lastWall ? Math.max(0, wallNow - this._lastWall) : 0;
    this._lastWall = wallNow;
    // Real elapsed time, for every exponential smoothing in this method.
    // Declared here rather than beside the parameter morphing because the
    // continuous level and lift are smoothed too, and they are decided first.
    const sdt = Math.min(0.5, wallDt > 0 ? wallDt : dt);
    // Real elapsed time, for every exponential smoothing in this method.
    // Declared here rather than beside the parameter morphing because the
    // continuous level and lift are smoothed too, and they are decided first.
    const drift = m.time - this._lastTime;
    const isSeek = drift < -0.35 || drift > wallDt + 0.5;

    if (isSeek) {
      this._riseHist.length = 0;
      this._hiHist.length = 0;
      this._bassHist.length = 0;
      this._jump = 0;
      this._seekGuard = 1.2;
      this._sectionStart = m.time;
      this._lastDropTime = -999;
      this._lastSurgeTime = m.time;   // no surge from the jump itself
      // Treat drops before the new position as already spent, so scrubbing
      // backwards re-arms them and scrubbing forwards does not replay them.
      if (this.plan) this._firedDrop = this.plan.dropIndexBefore(m.time - 2.5);
    }
    this._lastTime = m.time;
    if (this._seekGuard > 0) this._seekGuard -= dt;

    // How long the track has been quiet, in music time. Reset the instant sound
    // returns, so the arena wakes on the first frame of a re-entry even though
    // it took half a second to accept that it had stopped.
    this._quietFor = (m.silence > 0.75) ? this._quietFor + dt : 0;

    this._riseHist.push(m.energyShort);
    if (this._riseHist.length > 300) this._riseHist.shift();     // ~5 s
    this._hiHist.push(m.highs);
    if (this._hiHist.length > 300) this._hiHist.shift();
    this._bassHist.push(m.bass);
    if (this._bassHist.length > 260) this._bassHist.shift();      // ~4 s
    // ~35 s half-life: a later, bigger drop can still clear the bar
    this._eMax = Math.max(m.energyShort, this._eMax * Math.exp(-dt * 0.02));

    // Does this track have a singer? Vocal-specific behaviour is scaled by the
    // answer, so a purely instrumental piece keeps the original feel.
    if (m.voice) this._voiceSeen = Math.max(this._voiceSeen * 0.9995, m.voice.presence);
    this._jump = this._riseHist.length > 100
      ? m.energyShort - avg(this._riseHist.slice(-96, -60))
      : 0;

    // ---- continuous structure ---------------------------------------------
    this._toDrop = this.plan ? this.plan.timeToNextDrop(m.time) : null;
    const liftTarget = this._toDrop !== null && this._toDrop <= BUILD_LEAD
      ? clamp01(1 - this._toDrop / BUILD_LEAD)
      : (this._sustainedRise() ? 0.45 : 0);
    this._anticipation += (liftTarget - this._anticipation) * (1 - Math.exp(-sdt * 0.9));

    // Level is smoothed here rather than thresholded. This is the whole of what
    // used to be a state machine with dwell times and hysteresis bands.
    const levelTarget = this._measureLevel(m);
    this.level += (levelTarget - this.level) * (1 - Math.exp(-sdt * (levelTarget > this.level ? 0.85 : 0.5)));

    // A drop is still an EVENT — a moment, not a region. It is the one thing in
    // a song that has to land on the beat it belongs to.
    if (this.plan) {
      const di = this.plan.dropIndexBefore(m.time);
      if (di >= 0 && di !== this._firedDrop && m.time - this.plan.dropTime(di) < 2.5) {
        this._firedDrop = di;
        this._lastDropTime = now;
        this._lastSurgeTime = now;
        this._sinceDrop = 0;
        this._sinceSurge = 0;
        this.p.eruption = 1.0;
        this.p.shake = 1.0;
        this.emit(0, 0, 2.6, 11, 8.0, 2);
        this.events.push({ type: 'drop' });
      }
    }

    // Camera language still wants to know when the arena has settled or surged,
    // so those are derived from the level's own movement rather than from a
    // label having changed.
    const dL = this.level - this._lastLevel;
    this._lastLevel = this.level;
    if (dL < -0.010 && this.level < 0.34 && now - this._lastSettle > 9) {
      this._lastSettle = now;
      this.events.push({ type: 'settle' });
    }

    const label = labelFor(this.level, this._anticipation, this._sinceDrop, this.section);
    if (label !== this.section) {
      this.prevSection = this.section;
      this.section = label;
      this._sectionStart = now;
      this.events.push({ type: 'section', from: this.prevSection, to: label });
    }

    // A sung phrase arriving is an event. It is a lift, not a strike: broad
    // and slow, so it reads as the voice entering rather than a drum hit.
    if (m.voice && m.voice.onset && m.voice.presence > 0.3) {
      const v = m.voice;
      this.emit(0, 0, 0.35 + v.effort * 0.9, 5.5, 7.5, 1);
      this.events.push({ type: 'voice', strength: v.effort * v.presence });
    }

    // A chord change is one of the most felt moments in music and used to
    // produce no visual response at all. It is a reshaping, not an impact:
    // a broad slow swell rather than a percussive ring.
    if (m.harmony && m.harmony.changed && m.harmony.tonalness > 0.3) {
      this.emit(0, 0, 0.5 + m.harmony.change * 0.7, 4.5, 9.0, 1);
      this.events.push({ type: 'harmony', strength: m.harmony.change });
    }

    // A surge is any large, sudden arrival of energy — the moment a chorus
    // lands, a section changes, a beat re-enters. Deliberately independent of
    // the section machine: whether or not we labelled it a drop, the arena
    // should answer a structural moment with a coordinated wave event.
    if (this._sinceSurge > 5.5 && this._seekGuard <= 0 && this._jump > 0.11
        && m.energyShort > 0.42 && this._sinceDrop > 3.0) {
      this._lastSurgeTime = now;
      this._sinceSurge = 0;
      this.p.eruption = Math.max(this.p.eruption, Math.min(0.75, this._jump * 3.2));
      this.p.shake = Math.max(this.p.shake, 0.45);
      this.emit(0, 0, 1.5, 9.5, 6.5, 2);
      this.events.push({ type: 'surge', strength: this._jump });
    }

    // ---- phrase clock ------------------------------------------------------
    const bpm = m.bpm > 40 ? m.bpm : 120;
    const barDur = (60 / bpm) * 4;
    const phrase = Math.floor(m.time / (barDur * 8));
    if (phrase !== this.phrase) { this.phrase = phrase; this.events.push({ type: 'phrase', index: phrase }); }

    // ---- discrete wave events ---------------------------------------------
    if (m.onset) {
      const hot = this.level > 0.70;
      if (m.onset.kick) {
        // Kick: forward shockwave from the heart of the arena.
        // A heavy low hit should read as weight, not as a ripple. More bass
        // means a slower, broader, stronger front — a stomp that moves the
        // whole body of water rather than a thin ring skating over it.
        const jitter = hot ? 2.6 : 0.9;
        const stomp = m.bass;
        this.emit(
          (Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter,
          0.75 + stomp * (hot ? 2.6 : 1.6),
          6.4 - stomp * 1.8, 3.6 + stomp * 5.0, 0,
        );
        this.events.push({ type: 'kick', strength: m.bass });
      }
      if (m.onset.snare) {
        // Snare: a sharper, tighter impulse offset from the centre.
        const a = Math.random() * Math.PI * 2;
        const r = 5 + Math.random() * 9;
        this.emit(Math.cos(a) * r, Math.sin(a) * r, 0.42 + m.mids * 1.0, 10 + m.mids * 5, 2.0, 1);
        this.events.push({ type: 'snare', strength: m.mids });
      }
    }

    // ---- eruption / shock envelopes ----------------------------------------
    this.p.eruption *= Math.exp(-sdt * 0.85);
    this.p.shock = Math.max(this.p.shock * Math.exp(-sdt * 5.0), m.beatPulse * (0.55 + this.level * 0.45));
    this.p.shake *= Math.exp(-sdt * 1.9);

    // ---- parameter morphing -------------------------------------------------
    // Smoothing uses REAL elapsed time. Exponential smoothing is stable for any
    // step, so there is no reason to feed it the clamped simulation dt — doing
    // so made every look converge in slow motion whenever frames were dropped.
    const look = blendLook(this.level, this._anticipation);
    const entering = 1;   // nothing steps any more, so nothing needs easing in
    // Sections that must hit hard morph fast; settling morphs slowly.
    // One rate. The look itself is already continuous, so the only thing this
    // smoothing still has to do is keep live modulation from jittering.
    const rate = 1.6 + this.p.eruption * 6.0;
    const k = 1 - Math.exp(-sdt * rate);
    const p = this.p;

    // Live music modulation on top of the section target.
    const drive = 0.55 + m.amplitude * 0.9;
    const buildRamp = this._anticipation;

    // crest height, in world units
    // Clamped: a track that sits at full scale with no dynamics (a drone, a
    // heavily limited master) otherwise drives this past anything the camera
    // can frame, and the arena becomes a wall.
    // In a lyric-driven song the singer carries the intensity, and a belt can
    // land at the same RMS as the verse that preceded it — modern masters are
    // compressed flat. Vocal effort therefore drives height alongside level,
    // and the arena eases back in the breath between phrases.
    // ---- ONE driver ------------------------------------------------------
    //
    // Height used to be the product of eight terms — section, loudness, voice,
    // build, bass, eruption, breath and arousal — then raised to a power. Every
    // one was individually defensible and the result was unpredictable, because
    // multiplication compounds: when three drifted down together the water went
    // flat, and no single term looked wrong when you inspected it. Nothing was
    // in charge, so nothing could be reasoned about.
    //
    // Now one number decides how big the water is. Loudness and vocal effort
    // are combined into it BEFORE anything else sees them — a sung line and a
    // loud band are two ways of saying the same thing, so whichever is carrying
    // the music wins — and it is smoothed on its own clock so it cannot
    // flicker. Everything else either sets its range or adds to it.
    const vx = m.voice;
    const vocal = vx ? vx.presence * (0.35 + vx.effort * 0.85) : 0;
    const rawEnergy = clamp01(Math.max(m.amplitude, vocal * 0.92));
    this._energy += (rawEnergy - this._energy) * (1 - Math.exp(-sdt * 2.4));
    // How activated the SONG is, not just this moment in it.
    //
    // Section and height came only from level relative to the track's own
    // plateau, which is self-normalising: a hushed acoustic cover holds its
    // level as steadily as a rock chorus does, so it was handed the same crest
    // heights and the same heat, towered to two thirds of the ceiling and blew
    // the frame out. Loudness relative to itself cannot tell a calm record from
    // a driving one. Arousal can, and it is known before the first frame.
    // The section sets a FLOOR and a CEILING rather than a multiplier, so the
    // water has a size it can never fall below while that section lasts. A
    // multiplier can always be driven to zero by whatever is multiplying it;
    // a floor cannot, which is what stops quiet passages going completely flat.
    const lo = look.height * 0.46;
    const hi = look.height * 1.62;
    let hWant = lo + (hi - lo) * Math.pow(this._energy, HEIGHT_GAMMA);

    // Accents ADD. A kick or a drop should lift the water by a knowable amount
    // regardless of how loud the passage already is — as a multiplier the same
    // kick did nothing in a quiet verse and threw the surface through the roof
    // in a chorus.
    hWant += this.p.eruption * 1.25 + m.bass * 0.22 + buildRamp * 0.30;

    // One song-level scale, known before the first frame: a calm record is
    // physically smaller water than a driving one.
    hWant *= this.identity ? (0.62 + this.identity.arousal * 0.52) : 1;

    const wantHeight = Math.min(MAX_HEIGHT, hWant);
    p.height += (wantHeight - p.height) * k;
    p.spectrumGain += (look.spectrumGain * (0.65 + m.amplitude * 0.7) - p.spectrumGain) * k;
    p.complexity += (look.complexity * (1 + buildRamp * 0.5) + m.highs * 0.25 - p.complexity) * k;
    // Dissonance is felt as turbulence: a harsh sonority roughens the surface
    // even at the same loudness as a sweet one.
    const harshness = m.harmony ? Math.max(0, -m.harmony.consonance) * m.harmony.tonalness : 0;
    p.chaos += (look.chaos * (1 + buildRamp) + m.highs * 0.12 + harshness * 0.16 - p.chaos) * k;
    // There is no `flow` any more. How fast the water moves is now a
    // consequence of how long its waves are, decided from the song's tempo in
    // WaterArena and resolved by omega = sqrt(g*k) in the shader. A section
    // cannot make water travel faster, because loudness does not do that to
    // water. It only makes the waves bigger.
    p.symmetry += (look.symmetry - p.symmetry) * (1 - Math.exp(-sdt * 0.8));
    p.mist += (look.mist * (0.7 + m.amplitude * 0.6) - p.mist) * (1 - Math.exp(-sdt * 1.1));
    p.spray += (look.spray * (0.4 + m.beatPulse * 1.2) - p.spray) * (1 - Math.exp(-sdt * 3.5));
    p.bloom += (look.bloom * (0.85 + m.amplitude * 0.35) - p.bloom) * (1 - Math.exp(-sdt * 1.6));
    // a belt brightens the water the way it brightens the mix
    const wantHeat = Math.min(1.02, (look.heat * (0.6 + m.energyShort * 0.8)
      + this.p.eruption * 0.5 + (vx ? vx.presence * vx.effort * 0.28 : 0))
      * (this.identity ? 0.58 + this.identity.arousal * 0.52 : 1));
    p.heat += (wantHeat - p.heat) * (1 - Math.exp(-sdt * 2.0));
    // Frame the water we actually have, not the water the section nominally wants.
    // Headroom: the frame should always have room above the water, so the one
    // moment that does reach the top reads as reaching the top.
    const distForHeight = look.camDist * (1.02 + Math.max(0, p.height - 2.6) * 0.07);
    p.camDist += (distForHeight - p.camDist) * (1 - Math.exp(-sdt * 0.55));
    p.camHeight += (look.camHeight - p.camHeight) * (1 - Math.exp(-sdt * 0.55));
    p.fov += (look.fov + this.p.eruption * 4 - p.fov) * (1 - Math.exp(-sdt * 1.2));

    // Spectrum ring geometry breathes with the section.
    const targetR = 8.5 + (1 - m.bass) * 3.0 + (this.section === 'drop' ? 1.5 : 0);
    const targetW = 5.0 + m.amplitude * 5.0 + (this.section === 'chorus' ? 2.0 : 0);
    p.ringRadius += (targetR - p.ringRadius) * (1 - Math.exp(-sdt * 0.9));
    p.ringWidth += (targetW - p.ringWidth) * (1 - Math.exp(-sdt * 0.9));

    // ---- form weights -------------------------------------------------------
    const harm = m.harmony;
    const tonalness = harm ? harm.tonalness : 0;
    const presence = m.voice ? m.voice.presence : 0;
    const variant = PHRASE_VARIANTS[this.phrase % PHRASE_VARIANTS.length];
    const fk = 1 - Math.exp(-sdt * (this.section === 'drop' ? 4.0 : 1.1));
    for (const name in FORM_INDEX) {
      const idx = FORM_INDEX[name];
      let target = (look.forms[name] || 0) * (variant[name] || 1);
      // Live nudges so forms answer the mix, not just the section label.
      //
      // Harmony used to be gated on tonalness alone, which backfired badly on
      // exactly the songs this build is for: a loud, distorted, vocal-led
      // master has few clean spectral peaks, so tonalness reads low and the
      // harmonic form was suppressed right when it mattered. A confident lead
      // vocal is itself proof the music is pitched.
      const pitched = Math.max(tonalness, presence * 0.9);
      if (name === 'harmonic') target *= 0.35 + pitched * 1.05;
      if (name === 'voice') target *= 0.12 + presence * 1.38;
      if (name === 'towers') target *= 0.6 + m.bass * 0.9;
      if (name === 'columns') target *= 0.6 + m.mids * 0.9;
      if (name === 'arches') target *= 0.6 + m.highs * 0.8;
      if (name === 'walls') target *= 0.7 + m.mids * 0.6;
      p.forms[idx] += (Math.min(1.4, target) * entering - p.forms[idx]) * fk;
    }

    p.intensity += (clamp01(m.energyShort * 0.7 + m.amplitude * 0.3 + this.p.eruption * 0.5) - p.intensity)
      * (1 - Math.exp(-sdt * 2.2));
    p.section = this.section;
    p.level = this.level;
    p.bpm = m.bpm;
    p.pace = m.pace || 0.75;
    p.smoothness = m.smoothness || 0.5;
    return p;
  }
}

function avg(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
