/**
 * SongIdentity — what kind of song this is, decided once, then held.
 *
 * The other builds ask "what is happening right now". This asks "what IS this
 * track", and answers before a frame is drawn. That answer becomes the song's
 * world: its colour, the material its water is made of, how it moves, and how
 * the camera behaves around it. Two songs at identical loudness should not look
 * alike, and the only way to guarantee that is to let something constant about
 * each one drive the look.
 *
 * The offline half is measured from the decoded buffer in the time domain,
 * which is cheap and needs no FFT:
 *
 *   grain      zero-crossing rate — distortion, noise, cymbals, fry
 *   brightness high-band energy against the whole
 *   attack     how sharply the envelope rises — percussive against sustained
 *   range      how much dynamic range survived mastering
 *   width      stereo spread
 *
 * The tonal half — key and mode — comes from the live HarmonyAnalyser and is
 * folded in as it converges, then held steady. Colour that keeps drifting mid
 * song reads as a bug, not as identity.
 */

/**
 * Anchor hues, bilinear over (mode, pace).
 *
 * Timbre was the obvious axis and turned out to be the wrong one: measured
 * across two very different records, zero-crossing rate came out 0.052 against
 * 0.054 and high-band ratio 0.38 against 0.36. Modern mastering flattens
 * spectra, so timbre barely separates contemporary productions at all.
 *
 * Mode and pace do separate them, and they map onto colour the way people
 * already hear music: minor and slow is melancholy, minor and fast is
 * aggression, major and slow is warmth, major and fast is joy.
 */
const HUE = {
  minorSlow: 268,   // indigo / violet — melancholy
  minorFast: 352,   // crimson — aggression
  majorSlow: 390,   // 30deg, amber — warmth
  majorFast: 412,   // 52deg, gold — joy
};

export class SongIdentity {
  /**
   * @param {AudioBuffer} buffer decoded track
   * @param {object} env output of computePeaks: { rms, width, high }
   */
  constructor(buffer, env) {
    const L = buffer.getChannelData(0);
    const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
    const n = buffer.length;

    // ---- grain: zero-crossing rate of the mid signal ----------------------
    // A clean sustained voice or a piano crosses zero at its fundamental; fuzz,
    // cymbals and vocal fry cross constantly. It separates timbre without an
    // FFT, which matters when this has to run before playback starts.
    //
    // Measured over CONTIGUOUS windows. Striding through the buffer to save
    // time aliases high frequencies down and scrambles the crossings — sampled
    // that way a tender ballad measured grainier than a distorted rock record.
    const WINDOWS = 160, WIN = 4096;
    let zcrSum = 0, winCount = 0;
    for (let w = 0; w < WINDOWS; w++) {
      const start = Math.floor((w / WINDOWS) * (n - WIN - 1));
      if (start < 0) break;
      let cross = 0, prev = (L[start] + R[start]) * 0.5, energy = 0;
      for (let i = 1; i < WIN; i++) {
        const v = (L[start + i] + R[start + i]) * 0.5;
        if ((v > 0 && prev <= 0) || (v < 0 && prev >= 0)) cross++;
        energy += v * v;
        prev = v;
      }
      // skip near-silent windows; their crossings are noise, not timbre
      if (energy / WIN < 1e-6) continue;
      zcrSum += cross / WIN;
      winCount++;
    }
    const zcr = winCount > 0 ? zcrSum / winCount : 0.1;
    this.zcr = zcr;
    this.grain = clamp01((zcr - 0.045) / 0.16);

    // ---- brightness, attack, range, width from the envelope ---------------
    const rms = env.rms, high = env.high, width = env.width;
    const bins = rms.length;
    let hiSum = 0, loSum = 0, wSum = 0, rise = 0;
    for (let i = 0; i < bins; i++) {
      hiSum += high[i];
      loSum += rms[i];
      wSum += width[i];
      if (i > 0) rise += Math.max(0, rms[i] - rms[i - 1]);
    }
    this.hiRatio = hiSum / Math.max(1e-9, loSum);
    this.brightness = clamp01((this.hiRatio - 0.22) / 0.30);
    this.attack = clamp01(((rise / Math.max(1e-9, loSum)) - 0.055) / 0.09);
    this.width = clamp01((wSum / bins) * 2.4);

    const sorted = Array.from(rms).sort((a, b) => a - b);
    const p10 = sorted[Math.floor(bins * 0.10)] || 0;
    const p90 = sorted[Math.floor(bins * 0.90)] || 1;
    this.range = clamp01((p90 - p10) / Math.max(1e-9, p90) * 1.35);

    // ---- tonal half, filled in from live analysis -------------------------
    this.paletteMode = 'full';   // 'full' | 'blue'
    this.warmth = 0.5;      // 0 fully minor .. 1 fully major
    this.drive = 0.45;      // 0 slow and still .. 1 fast and driving
    this.settled = 0;       // how much the tonal half has converged

    this.hue = 0; this.sat = 0; this.light = 0;
    this._recompute();
  }

  /**
   * Fold in the live key/mode reading. Weighted by confidence and by how long
   * the song has been running, so the world settles rather than flickering.
   */
  observe(harmony, dt) {
    if (!harmony) return;
    const conf = harmony.confidence * (0.35 + harmony.tonalness * 0.65);
    if (conf < 0.05) return;
    const target = harmony.mode * 0.5 + 0.5;
    // converges quickly at first, then locks: identity should not keep moving
    const k = (1 - Math.exp(-dt * 0.35)) * (1 - this.settled * 0.92) * conf;
    this.warmth += (target - this.warmth) * k;
    this.settled = Math.min(1, this.settled + dt * 0.035);
    this._recompute();
  }

  /**
   * An identity for live input, where there is no buffer to pre-scan.
   * The offline half sits at neutral and the tonal and pace halves are learned
   * from what is actually being played, so a live world still forms — it just
   * takes a few seconds rather than arriving complete.
   */
  static live() {
    const id = Object.create(SongIdentity.prototype);
    Object.assign(id, {
      zcr: 0.09, grain: 0.28, hiRatio: 0.32, brightness: 0.5,
      attack: 0.4, width: 0.5, range: 0.6,
      warmth: 0.5, drive: 0.45, settled: 0, paletteMode: 'full',
      hue: 0, sat: 0, light: 0,
    });
    id._recompute();
    return id;
  }

  /** Fold in how fast the song feels; settles alongside the tonal half. */
  observePace(pace, dt) {
    const target = clamp01((pace - 0.6) / 0.9);
    this.drive += (target - this.drive) * (1 - Math.exp(-dt * 0.25)) * (1 - this.settled * 0.9);
    this._recompute();
  }

  _recompute() {
    const w = this.warmth, d = this.drive;

    // Pace leads the hue and mode shifts it.
    //
    // Interpolating minor->major across the wheel put the midpoint in red, so
    // any song whose mode was uncertain — which is most dense pop — landed in
    // crimson regardless of anything else. Two very different records came out
    // at hue 351 and 355. Pace is both the better-measured axis and the wider
    // one, so it now sets the family and mode tilts within it.
    // One axis, no wraparound. Mode was tried as a second hue axis and does not
    // work: from teal, "warmer" means decreasing hue through green or
    // increasing it through violet, and neither reads as warmth. Adding degrees
    // for major made a tender song *cooler*. Mode now shapes depth and
    // saturation instead, where its effect is unambiguous.
    let hue = 186 + d * 172;                    // teal -> indigo -> violet -> crimson
    hue += (this.brightness - 0.5) * 22;

    // Blue mode keeps every song inside one hue family, so the product has a
    // single recognisable look and songs separate through shape and motion
    // instead. The full range separates them harder but gives up the signature.
    if (this.paletteMode === 'blue') hue = 196 + ((hue - 186) / 194) * 52;

    this.hue = ((hue % 360) + 360) % 360;

    // Dynamic range saturates; a squashed master desaturates. Kept below full
    // so nothing ever reads as a primary — this is still meant to be water.
    // Major reads open and lit; minor reads deep and saturated.
    this.sat = clamp01(0.32 + this.range * 0.28 + (1 - w) * 0.18);
    this.light = clamp01(0.30 + this.brightness * 0.20 + w * 0.16);
  }

  /** deep / mid / hot triad for the water, as {r,g,b} in 0..1 */
  palette() {
    const h = this.hue, s = this.sat, l = this.light;
    return {
      deep: hsl(h - 6, Math.min(1, s * 0.85), l * 0.14),
      mid:  hsl(h, s, l),
      hot:  hsl(h + 14, s * 0.42, Math.min(0.96, l + 0.44)),
      glow: hsl(h - 10, s * 0.7, l * 0.30),
    };
  }

  /**
   * How the water behaves as a substance.
   * Grain and attack make it broken and foaming; their absence makes it glassy.
   */
  material() {
    const brokenness = clamp01(this.grain * 0.62 + this.attack * 0.48);
    return {
      roughness: brokenness,
      glassiness: 1 - brokenness,
      spray: clamp01(this.attack * 0.7 + this.grain * 0.45),
      // a wide record spreads across a wider pool
      spread: 0.88 + this.width * 0.34,
      // a dynamic record is allowed to breathe further
      breath: 0.75 + this.range * 0.5,
    };
  }

  describe() {
    return {
      hue: Math.round(this.hue),
      sat: +this.sat.toFixed(2),
      light: +this.light.toFixed(2),
      warmth: +this.warmth.toFixed(2), drive: +this.drive.toFixed(2),
      grain: +this.grain.toFixed(2),
      brightness: +this.brightness.toFixed(2),
      attack: +this.attack.toFixed(2),
      range: +this.range.toFixed(2),
      width: +this.width.toFixed(2),
      zcr: +this.zcr.toFixed(3), hiRatio: +this.hiRatio.toFixed(3),
      settled: +this.settled.toFixed(2),
    };
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** HSL -> linear-ish RGB in 0..1 */
function hsl(hDeg, s, l) {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  if (s <= 0) return { r: l, g: l, b: l };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return { r: hue2rgb(p, q, h + 1 / 3), g: hue2rgb(p, q, h), b: hue2rgb(p, q, h - 1 / 3) };
}
function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
