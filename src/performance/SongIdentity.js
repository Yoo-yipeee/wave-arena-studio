/**
 * SongIdentity — what kind of song this is, decided before a frame is drawn.
 *
 * The other layers ask "what is happening right now". This asks "what IS this
 * track", and the answer becomes the song's world: its colour, the material its
 * water is made of, how far a wave carries across the pool. Two songs at the
 * same loudness must not look alike, and the only way to guarantee that is to
 * let something constant about each one drive the look.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS WAS REWRITTEN
 *
 * The previous version drove hue from ONE axis — perceived pace — with a small
 * brightness nudge. Two maximally different records (a driving minor-key rock
 * single and a slow Hindi love song) came out at hue 264 and 263. One degree.
 * Invisible. Worse, pace was learned live and started at the same default for
 * every track, so every song opened the same indigo and only began to separate
 * half a minute in, if at all.
 *
 * Two things were wrong. Mode — major against minor, the single most
 * emotionally loaded fact about a piece of music — contributed nothing to hue
 * at all. And every axis that could have separated songs was either measured
 * live (too late) or measured in a way that modern mastering flattens (timbre:
 * the two records above returned zero-crossing rates of 0.052 and 0.054).
 *
 * ---------------------------------------------------------------------------
 * THE MODEL
 *
 * Colour now comes from where the song sits on the two axes music psychology
 * actually uses for emotion — Russell's circumplex:
 *
 *   VALENCE   dark and sad  ..  bright and glad     (mode, consonance, timbre)
 *   AROUSAL   still and calm .. driving and intense (tempo, pulse, attack)
 *
 * Two axes cannot both own one hue dimension without colliding, and two
 * attempts to make them proved it. Blending four emotional corners as hue
 * ANGLES swept through red, so every song with an uncertain mode came out
 * crimson. Blending the same corners in Cartesian a/b landed on orange,
 * because the two high-arousal anchors pointed the same direction.
 *
 * So the axes divide the work instead:
 *
 *   VALENCE owns HUE, along a monotonic path that never wraps —
 *     indigo 258 -> blue -> cyan 182 -> turquoise -> emerald -> gold 38.
 *     Every point on it is a colour water is allowed to be, so a wrong
 *     midpoint is impossible by construction rather than by tuning.
 *
 *   AROUSAL owns CHROMA and LIGHTNESS, where it cannot collide, plus a tilt
 *     that takes the sad end toward violet and the glad end toward orange
 *     while leaving the neutral middle cyan — still the right home for this.
 *
 * ---------------------------------------------------------------------------
 * EVERYTHING THAT MATTERS IS MEASURED OFFLINE
 *
 * Tempo, pulse strength, chroma, key and mode are all extracted from the
 * decoded buffer before playback starts, so the world is fully formed on the
 * first frame instead of converging during the first verse. The live analysers
 * then refine it, weighted so it settles rather than drifts — colour that keeps
 * moving mid-song reads as a bug, not as identity.
 *
 * Measured over four records — a rock single, a Hindi love song, a party rap
 * track and an acoustic cover — this spans 38 to 229 degrees of hue where the
 * previous version spanned one.
 */

/** Krumhansl-Kessler key profiles, as used by the live HarmonyAnalyser. */
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Consonance weight per interval class; thirds/fourths/fifths sweet, ic1 and the tritone harsh. */
const IC_WEIGHT = [0.0, -1.0, -0.45, 0.85, 1.0, 0.95, -0.8];

export class SongIdentity {
  /**
   * @param {AudioBuffer} buffer decoded track
   * @param {object} env output of computePeaks: { rms, width, high }
   */
  constructor(buffer, env) {
    const L = buffer.getChannelData(0);
    const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
    const n = buffer.length;
    const sr = buffer.sampleRate;
    this.duration = buffer.duration;

    // ---- grain: zero-crossing rate of the mid signal ----------------------
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
      if (energy / WIN < 1e-6) continue;   // near-silent: crossings are noise
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

    // ---- rhythm, offline ---------------------------------------------------
    this._measureRhythm(L, R, n, sr);
    // ---- harmony, offline --------------------------------------------------
    this._measureChroma(L, R, n, sr);

    // ---- live refinements, seeded from the offline reading -----------------
    this.paletteMode = 'full';   // 'full' | 'blue'
    this.warmth = this.keyMode * 0.5 + 0.5;   // 0 fully minor .. 1 fully major
    this.drive = this.arousalOffline;         // 0 slow and still .. 1 fast and driving
    this.settled = 0;

    this.hue = 0; this.sat = 0; this.light = 0;
    this._recompute();
  }

  /**
   * Tempo and pulse strength, from a short-time energy envelope.
   *
   * This is the axis that separates a ballad from a banger, and until now it
   * was only ever measured live — so it could not colour the first frame. An
   * envelope at 512-sample hops is cheap (one pass, no FFT), and
   * autocorrelating its flux gives the tempo and how REGULAR the pulse is,
   * which are different things: a metronomic house track and a rubato piano
   * piece can share a tempo and feel nothing alike.
   */
  _measureRhythm(L, R, n, sr) {
    const HOP = 512;
    const frames = Math.max(4, Math.floor(n / HOP));
    const env = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      const s = f * HOP;
      let sum = 0;
      for (let i = 0; i < HOP; i++) {
        const v = (L[s + i] + R[s + i]) * 0.5;
        sum += v * v;
      }
      env[f] = Math.sqrt(sum / HOP);
    }

    // Positive difference of the log envelope: a rise in level, scale-free, so
    // a quiet passage's onsets count as much as a loud one's.
    const flux = new Float32Array(frames);
    for (let f = 1; f < frames; f++) {
      flux[f] = Math.max(0, Math.log(env[f] + 1e-5) - Math.log(env[f - 1] + 1e-5));
    }

    // Adaptive threshold over a moving window: a fixed one counts nothing in
    // the intro and everything in the chorus.
    const fps = sr / HOP;
    // A refractory period, and a threshold that has to be genuinely cleared.
    // Without both, this counted 13.6 "onsets" a second on two different
    // records — every ripple in the envelope — which is not a musical rate at
    // all, and it saturated the arousal axis so a ballad and a rock single came
    // out identically frantic. No player articulates thirteen times a second;
    // 70ms between events is already fast for a human.

    // Pulse: how strongly periodic the flux is over plausible beat periods.
    // A peak that stands well clear of the mean means a steady grid underneath.
    const minLag = Math.max(2, Math.round(fps * 0.30));    // 200 BPM
    const maxLag = Math.min(frames - 2, Math.round(fps * 1.20));  // 50 BPM
    let best = 0, acc = 0, cnt = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let f = 0; f + lag < frames; f++) s += flux[f] * flux[f + lag];
      s /= (frames - lag);
      acc += s; cnt++;
      if (s > best) { best = s; this.beatPeriod = lag / fps; }
    }
    const mean = acc / Math.max(1, cnt);
    this.pulse = clamp01((best / Math.max(1e-12, mean) - 1.0) / 0.9);
    this.bpmOffline = this.beatPeriod ? Math.round(60 / this.beatPeriod) : 0;

    // AROUSAL, entirely offline.
    //
    // Tempo leads, because it is both the strongest correlate of felt energy
    // and the thing this measures most reliably: these two records came out at
    // 125 and 63 BPM, which is the single cleanest separation anything here
    // produces. Everything else refines that.
    const bpm = this.bpmOffline || 110;
    const tempoA = clamp01((bpm - 62) / 78);        // 62 BPM -> 0, 140 -> 1
    //
    // There is no event-density term here, and that is a deliberate negative
    // result rather than an oversight. Counting note attacks needs a threshold;
    // a per-track threshold is self-normalising, so a dense party track and a
    // sparse acoustic cover both returned about five a second, and an absolute
    // threshold is meaningless across masters that differ by 15dB. Measured
    // across four records that axis spanned 1.05x and carried no information,
    // so it is gone. Tempo, pulse and attack all discriminate properly and have
    // taken its weight.
    this.arousalOffline = clamp01(
      tempoA * 0.44 + this.pulse * 0.24 + this.attack * 0.22 + this.brightness * 0.10);
  }

  /**
   * Chroma, key and mode from the buffer, with no FFT.
   *
   * A Goertzel filter evaluates one frequency bin directly, so twelve pitch
   * classes across four octaves cost 48 of them rather than a whole transform.
   * The signal is decimated 4x first — nothing above about 2 kHz carries pitch
   * for this purpose — which both quarters the work and lengthens the effective
   * window, giving the low octaves the frequency resolution they need to tell
   * neighbouring semitones apart.
   */
  _measureChroma(L, R, n, sr) {
    const DEC = 4;
    const srd = sr / DEC;
    const OUT = 2048;                 // decimated samples per window (~186ms)
    const RAW = OUT * DEC;
    const WINDOWS = Math.min(40, Math.max(6, Math.floor(n / RAW)));

    // Octaves 3..6 — where melody and the harmonic core of most records live.
    const freqs = [], pcOf = [];
    for (let pc = 0; pc < 12; pc++) {
      for (let oct = 3; oct <= 6; oct++) {
        const midi = 12 * (oct + 1) + pc;
        freqs.push(440 * Math.pow(2, (midi - 69) / 12));
        pcOf.push(pc);
      }
    }
    const coeff = freqs.map(f => 2 * Math.cos(2 * Math.PI * f / srd));

    const chroma = new Float32Array(12);
    const dec = new Float32Array(OUT);
    let used = 0;
    for (let w = 0; w < WINDOWS; w++) {
      const start = Math.floor((w / WINDOWS) * (n - RAW - 1));
      if (start < 0) break;

      // decimate: a 4-sample box average is a crude low-pass, which is all the
      // anti-aliasing this needs before dropping to 11 kHz
      let energy = 0;
      for (let i = 0; i < OUT; i++) {
        const s = start + i * DEC;
        const v = (L[s] + R[s] + L[s + 1] + R[s + 1] + L[s + 2] + R[s + 2] + L[s + 3] + R[s + 3]) * 0.125;
        dec[i] = v;
        energy += v * v;
      }
      if (energy / OUT < 1e-7) continue;   // silence has no key
      used++;

      for (let k = 0; k < freqs.length; k++) {
        const c = coeff[k];
        let s1 = 0, s2 = 0;
        for (let i = 0; i < OUT; i++) {
          const s0 = dec[i] + c * s1 - s2;
          s2 = s1; s1 = s0;
        }
        const power = s1 * s1 + s2 * s2 - c * s1 * s2;
        chroma[pcOf[k]] += Math.sqrt(Math.max(0, power));
      }
    }

    // normalise to a unit-max vector
    let mx = 1e-9;
    for (let i = 0; i < 12; i++) if (chroma[i] > mx) mx = chroma[i];
    for (let i = 0; i < 12; i++) chroma[i] /= mx;
    this.chroma = chroma;
    this.chromaWindows = used;

    // ---- key and mode, Krumhansl-Kessler over all 12 roots -----------------
    //
    // Correlated, not dotted. A raw dot product is dominated by how loud the
    // chroma is overall, so both profiles score high together and their
    // difference — the only part that carries major against minor — is a sliver
    // of a large number. Pearson removes the mean and the scale, which is why
    // it is the standard formulation, and it took these two tracks from a 0.04
    // margin to something that can actually be read.
    const rot = new Float32Array(12);
    let bestMaj = -2, bestMin = -2, majRoot = 0, minRoot = 0;
    for (let r = 0; r < 12; r++) {
      for (let i = 0; i < 12; i++) rot[i] = chroma[(i + r) % 12];
      const cMaj = pearson(rot, KK_MAJOR);
      const cMin = pearson(rot, KK_MINOR);
      if (cMaj > bestMaj) { bestMaj = cMaj; majRoot = r; }
      if (cMin > bestMin) { bestMin = cMin; minRoot = r; }
    }
    const isMajor = bestMaj >= bestMin;
    const margin = Math.abs(bestMaj - bestMin);
    this.keyRoot = isMajor ? majRoot : minRoot;
    this.keyName = PC_NAMES[this.keyRoot] + (isMajor ? '' : 'm');
    // Correlations run -1..1, so the margin between the two hypotheses is
    // directly meaningful — no arbitrary rescaling of a ratio.
    this.keyMode = (isMajor ? 1 : -1) * clamp01(margin * 3.4);   // -1 minor .. +1 major
    // Confident when the winning key both fits well AND beats its rival.
    this.keyConfidence = clamp01(Math.max(bestMaj, bestMin) * 0.9) * clamp01(margin * 4.5);

    // ---- consonance of the track's own harmonic content --------------------
    // Every pair of sounding pitch classes, weighted by how strongly each is
    // present and by whether that interval is sweet or harsh.
    let cons = 0, wsum = 0;
    for (let a = 0; a < 12; a++) {
      for (let b = a + 1; b < 12; b++) {
        const w = chroma[a] * chroma[b];
        if (w < 0.02) continue;
        let ic = Math.abs(a - b); if (ic > 6) ic = 12 - ic;
        cons += w * IC_WEIGHT[ic];
        wsum += w;
      }
    }
    this.consonance = wsum > 0 ? cons / wsum : 0;   // -1 harsh .. +1 sweet
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
    // The live reading only gets to move what the offline one was unsure of.
    //
    // Without this the two fight, and the noisier one wins by persistence: a
    // C-major acoustic cover read offline at 0.85 confidence was walked down
    // over the first minute of playback, taking its hue from gold at 46 through
    // 67 to 88 — into the one narrow band of the wheel the ramp is built to get
    // past quickly. A colour that keeps moving mid-song reads as a bug, and a
    // whole-track analysis is better evidence than a two-second window.
    const trust = 1 - this.keyConfidence * 0.75;
    const k = (1 - Math.exp(-dt * 0.35)) * (1 - this.settled * 0.92) * conf * trust;
    this.warmth += (target - this.warmth) * k;
    // A confident offline read also locks sooner.
    this.settled = Math.min(1, this.settled + dt * (0.035 + this.keyConfidence * 0.05));
    this._recompute();
  }

  /** Fold in how fast the song feels; settles alongside the tonal half. */
  observePace(pace, dt) {
    const target = clamp01((pace - 0.6) / 0.9);
    // Seeded offline, so this only nudges. It used to be the sole author of
    // hue, starting from the same default for every track.
    this.drive += (target - this.drive) * (1 - Math.exp(-dt * 0.25)) * (1 - this.settled * 0.9) * 0.6;
    this._recompute();
  }

  /**
   * An identity for live input, where there is no buffer to pre-scan.
   * The offline half sits at neutral and the rest is learned from what is
   * actually played, so a live world still forms — it just takes a few seconds.
   */
  static live() {
    const id = Object.create(SongIdentity.prototype);
    Object.assign(id, {
      duration: 0,
      zcr: 0.09, grain: 0.28, hiRatio: 0.32, brightness: 0.5,
      attack: 0.4, width: 0.5, range: 0.6,
      pulse: 0.4, beatPeriod: 0.5, bpmOffline: 120,
      arousalOffline: 0.45,
      chroma: new Float32Array(12), chromaWindows: 0,
      keyRoot: 0, keyMode: 0, keyConfidence: 0, consonance: 0,
      warmth: 0.5, drive: 0.45, settled: 0, paletteMode: 'full',
      hue: 0, sat: 0, light: 0,
    });
    id._recompute();
    return id;
  }

  // -------------------------------------------------------------------------
  // Emotion
  // -------------------------------------------------------------------------

  /** 0 still and calm .. 1 driving and intense. */
  get arousal() {
    // The live pace reading refines the offline one rather than replacing it.
    return clamp01(this.arousalOffline * 0.62 + this.drive * 0.38);
  }

  /** 0 dark and sad .. 1 bright and glad. */
  get valence() {
    // Mode leads, but only as far as the key reading is confident — a densely
    // produced pop record often has no clean answer, and pretending otherwise
    // is how every song ended up the same colour before.
    const modeV = this.warmth - 0.5;
    const conf = Math.max(this.keyConfidence, 0.30);
    const drive = modeV * 1.55 * conf
      + this.consonance * 0.32
      + (this.brightness - 0.5) * 0.34;
    // A soft knee rather than a hard clamp. A confidently major acoustic cover
    // drove this to 1.175 and was cut to 1.0, which means every song from there
    // upward collapsed onto the same gold with no headroom left for anything
    // happier. tanh keeps the spread where most music actually sits and
    // approaches the ends without ever reaching them.
    return 0.5 + 0.5 * Math.tanh(drive * 1.5);
  }

  /** 0 sweet and settled .. 1 harsh and strained. Drives texture, not hue. */
  get tension() {
    return clamp01(this.grain * 0.45 + Math.max(0, -this.consonance) * 0.75);
  }

  _recompute() {
    const V = this.valence, A = this.arousal;

    // ---- hue: valence walks a path that never crosses a wrong colour -------
    //
    // Two axes cannot both own one hue dimension without colliding, and every
    // attempt to blend four corners has failed the same way: opposite anchors
    // average into whatever sits between them. Blending indigo with amber as an
    // ANGLE swept through red; blending crimson with gold in Cartesian a/b
    // landed on orange, because those two anchors point the same direction.
    //
    // So valence — the axis colour actually encodes in every culture, cold and
    // blue for sorrow, warm and gold for joy — owns the hue, and it walks a
    // MONOTONIC path with no wraparound. Every point on the way is a colour
    // water is allowed to be, so there is no midpoint that can come out wrong.
    // Arousal owns intensity instead, where it cannot collide: chroma,
    // lightness, and a small tilt described below.
    const hueBase = rampHue(V);

    // ---- arousal tilts the ends outward, never the middle ------------------
    // Sorrow driven hard is not more blue, it is violet and then magenta —
    // anguish. Joy driven hard is not more gold, it is orange, blazing. Both
    // pushes leave the calm reading untouched and both are unambiguous in
    // direction, so nothing can rotate into a colour it should not be. At the
    // neutral middle the tilt is zero, and the arena stays cyan — which is
    // where this whole thing started, and still the right home for it.
    const low = clamp01((0.5 - V) * 2);      // 1 at fully dark, 0 at neutral
    const high = clamp01((V - 0.5) * 2);     // 1 at fully bright, 0 at neutral
    let hue = hueBase + A * (low * 48 - high * 24);

    // Timbre separates two songs that share a quadrant.
    hue += (this.brightness - 0.5) * 20 + (this.width - 0.5) * 12;

    // ---- chroma and lightness: this is where arousal lives -----------------
    // A driving record is vivid; a still one is deep and muted. A dynamic
    // record with a key you can name commits to its colour; a flat,
    // harmonically ambiguous one stays washed out — saturation as a measure of
    // how much the music is actually willing to say.
    let chroma = 0.26 + A * 0.40 + this.range * 0.14 + this.keyConfidence * 0.12;
    let l = 0.24 + V * 0.14 + A * 0.09 + this.brightness * 0.12;

    // Blue mode folds the emotional range into one hue family, so the product
    // keeps a single recognisable look and songs separate through intensity,
    // shape and motion instead. Chroma and lightness still vary fully, so this
    // is a narrower palette rather than a flat one.
    if (this.paletteMode === 'blue') {
      hue = 248 - clamp01((rampHue(V) - 46) / 212) * 52;   // 248 sad .. 196 glad
      hue += A * (low * 10 - high * 8);
      chroma *= 0.94;
    }

    hue = ((hue % 360) + 360) % 360;

    // Yellow-green is the one arc of the wheel that water never occupies.
    // Indigo, cyan, emerald and gold are all real water; the sharp lime between
    // emerald and gold is antifreeze. The path is allowed to cross it — a very
    // bright major record has to get from teal to gold somehow — but it is not
    // allowed to saturate there.
    const lime = Math.abs(hue - 100);
    if (lime < 55) chroma *= 1 - 0.55 * (1 - lime / 55);

    // ---- equal-looking, not equal-numbered ---------------------------------
    //
    // HSL lightness is not perceptual, and the error is enormous: a fully
    // saturated yellow carries roughly ten times the luminance of a fully
    // saturated blue at the SAME lightness value. So identical numbers gave a
    // gold song a far brighter frame than a blue one — the acoustic cover
    // washed out to cream with no dark background left and none of the depth
    // the blue tracks kept, purely because of where its hue sits.
    //
    // Bright hues are pulled down toward the luminance a blue would have had.
    // Only down, never up: this must not brighten anything that already works.
    const probe = hsl(hue, 1, 0.5);
    const Y = 0.2126 * probe.r + 0.7152 * probe.g + 0.0722 * probe.b;
    const lumComp = Math.min(1, Math.pow(0.45 / Math.max(0.08, Y), 0.30));

    this.hue = hue;
    this.sat = clamp01(chroma);
    this.light = clamp01(l * lumComp);
  }

  /** deep / mid / hot triad for the water, as {r,g,b} in 0..1 */
  palette() {
    const h = this.hue, s = this.sat, l = this.light;
    return {
      deep: hsl(h - 6, Math.min(1, s * 0.85), l * 0.14),
      mid:  hsl(h, s, l),
      // Crests keep the song's colour instead of bleaching out of it. At 0.42
      // saturation and 0.96 lightness the brightest water was very nearly
      // achromatic, so every track converged on the same white at exactly the
      // loudest moment — the one everybody screenshots. Warm palettes suffer
      // this worst: a pale yellow is indistinguishable from cream, so a gold
      // song blew the whole frame out while a blue one still read as water.
      hot:  hsl(h + 14, s * 0.70, Math.min(0.82, l + 0.26)),
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
      spread: 0.88 + this.width * 0.34,      // a wide record spreads across a wider pool
      breath: 0.75 + this.range * 0.5,       // a dynamic record breathes further
    };
  }

  /**
   * How far a wave carries — the damping of the medium.
   *
   * This was a hard-coded constant, identical for every song, which meant the
   * one property most obviously "about" water was the one property the music
   * could not touch. A sustained, legato, reverberant record should send a
   * swell clear across the pool; a dry percussive one should have its energy
   * die close to where it landed. That is a real difference between an ocean
   * and a puddle, and it is also the difference between a ballad and a banger.
   */
  physics() {
    const dry = clamp01(this.attack * 0.62 + this.grain * 0.38);
    return {
      // spatial decay per unit distance: small carries far, large dies near
      damping: 0.020 + dry * 0.055,
      // how long a struck ring survives before it is gone
      ringDecay: 0.85 + dry * 1.05,
    };
  }

  describe() {
    return {
      hue: Math.round(this.hue),
      sat: +this.sat.toFixed(2),
      light: +this.light.toFixed(2),
      valence: +this.valence.toFixed(2), arousal: +this.arousal.toFixed(2),
      tension: +this.tension.toFixed(2),
      warmth: +this.warmth.toFixed(2), drive: +this.drive.toFixed(2),
      keyMode: +this.keyMode.toFixed(2), keyConf: +this.keyConfidence.toFixed(2),
      consonance: +this.consonance.toFixed(2),
      pulse: +this.pulse.toFixed(2),
      bpmOffline: this.bpmOffline,
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

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Pearson correlation — scale and offset free, unlike a raw dot product. */
function pearson(a, b) {
  let ma = 0, mb = 0;
  for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
  ma /= 12; mb /= 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return num / Math.sqrt(Math.max(1e-12, da * db));
}

/**
 * Valence -> hue, as a monotonic non-wrapping path from sorrow to joy.
 *
 * Every stop is a colour water can plausibly be, and because the path only ever
 * decreases, the interpolation between any two points is also on the path. That
 * property is the whole point: it makes a wrong midpoint impossible by
 * construction rather than by tuning.
 *
 * The lime crossing sits between 0.74 and 0.88 and is deliberately narrow.
 * An earlier layout put it at 0.84-0.90, which turned out to be exactly where a
 * confidently major song lands: a C-major acoustic cover came out at valence
 * 0.90 and rendered as muddy olive. That band is not a rare edge case, it is
 * where happy music lives, so the ramp now reaches amber well before it.
 */
const HUE_RAMP = [
  [0.00, 258],   // deep indigo-blue — desolate
  [0.18, 236],   // blue — melancholy
  [0.36, 208],   // blue-cyan — pensive
  [0.52, 182],   // cyan-teal — the signature, and where the neutral song sits
  [0.64, 168],   // turquoise — hopeful
  [0.76, 150],   // emerald — a real lagoon colour, and the last green that is
  [0.80, 104],   // the lime crossing, four points wide and desaturated below
  [0.84, 54],    // amber
  [1.00, 38],    // gold — joy
];
function rampHue(v) {
  const t = clamp01(v);
  for (let i = 1; i < HUE_RAMP.length; i++) {
    const [v1, h1] = HUE_RAMP[i];
    if (t <= v1) {
      const [v0, h0] = HUE_RAMP[i - 1];
      return h0 + (h1 - h0) * ((t - v0) / (v1 - v0));
    }
  }
  return HUE_RAMP[HUE_RAMP.length - 1][1];
}

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
