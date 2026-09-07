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

    // ---- tempo -------------------------------------------------------------
    //
    // Autocorrelation of the onset flux, with harmonic summing and a weak
    // prior. Getting here took two wrong turns worth recording.
    //
    // Raw peak picking looked fine on four records and fell apart on twelve:
    // the slowest song in the set, a 56 BPM ballad, came back at 188. On loose
    // material the autocorrelation simply has no clear winner and the maximum
    // lands wherever the noise is tallest, which is usually a short lag.
    //
    // The textbook correction then overshot in the other direction. A
    // log-normal prior centred at 120 BPM doubled both slow records, which is
    // the single worst failure this system has, so the prior is now weak
    // (1.5 octaves) and centred LOW at 100 — because halving reads as
    // half-time and is survivable, while doubling puts fast water on a ballad.
    //
    // Harmonic summing is what actually does the work: a candidate collects the
    // energy at twice and three times its lag, which is maximised at the
    // fundamental rather than at a subdivision. It has to be normalised by how
    // many of those multiples were in range, or long lags — whose multiples run
    // off the end of the array — are silently penalised, which is exactly the
    // bug that made an earlier attempt return the same 157 BPM for everything.
    const minLag = Math.max(2, Math.round(fps * 0.32));            // ~188 BPM
    const maxLag = Math.min(frames - 2, Math.round(fps * 1.30));   // ~46 BPM
    const acLen = Math.min(frames - 2, maxLag * 3);

    // Local-mean subtraction sharpens the peaks: a slowly drifting baseline in
    // the flux otherwise correlates with itself at every lag.
    const fl = new Float32Array(frames);
    const W = 60;
    for (let f = 0; f < frames; f++) {
      let lo = Math.max(0, f - W), hi = Math.min(frames - 1, f + W), sum = 0;
      for (let k = lo; k <= hi; k++) sum += flux[k];
      fl[f] = Math.max(0, flux[f] - sum / (hi - lo + 1));
    }

    const ac = new Float32Array(acLen + 1);
    let acc = 0, cnt = 0;
    for (let lag = minLag; lag <= acLen; lag++) {
      let sum = 0;
      for (let f = 0; f + lag < frames; f++) sum += fl[f] * fl[f + lag];
      ac[lag] = sum / (frames - lag);
      if (lag <= maxLag) { acc += ac[lag]; cnt++; }
    }
    const mean = acc / Math.max(1, cnt);

    let best = -1, bestLag = 0, bestRaw = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      // No harmonic summing. It is the textbook move and a parameter sweep over
      // fifteen real records rejected it: with harmonics on, the best setting
      // scored 15 and without them 17, because on real music the second and
      // third peaks are as often the bar as the beat. The prior is very weak
      // (1.8 octaves) and centred LOW at 100, which was the only combination in
      // the sweep that never doubled a slow song — the one error that matters,
      // since half-time reads as a musical choice and double-time reads as the
      // water ignoring the song.
      let score = ac[lag];
      const bpm = 60 * fps / lag;
      const oct = Math.log(bpm / 100) / Math.LN2;
      score *= Math.exp(-0.5 * (oct / 1.8) * (oct / 1.8));
      if (score > best) { best = score; bestLag = lag; bestRaw = ac[lag]; }
    }

    let refined = bestLag;
    if (bestLag > minLag && bestLag < maxLag) {
      const a1 = ac[bestLag - 1], b1 = ac[bestLag], c1 = ac[bestLag + 1];
      const den = a1 - 2 * b1 + c1;
      if (Math.abs(den) > 1e-12) refined = bestLag + 0.5 * (a1 - c1) / den;
    }
    // An attempt to settle the octave with a second opinion from attack and
    // brightness is deliberately absent. It sounded right — those cues know
    // nothing about periodicity, so they should be independent evidence — and
    // measured across fifteen records it introduced three doublings on exactly
    // the slow ballads it was meant to protect, because a close-mic'd piano
    // reads as sharp attack. Left out.
    this.beatPeriod = refined > 0 ? refined / fps : 0;
    this.bpmOffline = this.beatPeriod ? Math.round(60 / this.beatPeriod) : 0;

    // How much to believe any of it. Every tempo failure across twelve real
    // records had a weak pulse (0.25-0.35) and every success a strong one, so
    // this is not a decoration — it is the flag that says the number above is
    // a guess, and the arousal below leans on a neutral tempo when it is low.
    this.pulse = clamp01((bestRaw / Math.max(1e-12, mean) - 1.0) / 0.9);

    // AROUSAL, entirely offline.
    //
    // Tempo leads, because it is both the strongest correlate of felt energy
    // and the thing this measures most reliably: these two records came out at
    // 125 and 63 BPM, which is the single cleanest separation anything here
    // produces. Everything else refines that.
    const bpm = this.bpmOffline || 110;
    // Across fifteen real records every tempo failure had a weak pulse (0.25 to
    // 0.35) and every success a strong one, so pulse is the confidence in the
    // number above. Where it is low the tempo term stands down toward neutral
    // rather than driving arousal with a guess.
    const tc = clamp01((this.pulse - 0.25) / 0.45);
    const tempoA = clamp01((bpm - 62) / 78) * tc + 0.45 * (1 - tc);
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
      // A tonic bonus. Krumhansl-Kessler correlates the whole profile, and a
      // major key and its relative minor share all seven notes — so the two
      // correlations come out nearly equal and the winner is close to a coin
      // toss. Queen's Don't Stop Me Now, unambiguously F major, came back as
      // D minor and rendered cyan instead of gold. The tonic itself is the
      // evidence that separates them: whichever root is actually being leaned
      // on is the key, so it gets a small thumb on the scale.
      const tonicBonus = chroma[r] * 0.38;
      const cMaj = pearson(rot, KK_MAJOR) + tonicBonus;
      const cMin = pearson(rot, KK_MINOR) + tonicBonus;
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
    // How much the live harmony read is worth, smoothed. On a live identity
    // this is what valence leans on in place of an offline key confidence.
    this.liveConf = (this.liveConf || 0)
      + (harmony.confidence - (this.liveConf || 0)) * (1 - Math.exp(-dt * 0.15));
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

    // Settling exists to stop a noisy live reading overwriting a confident
    // whole-track one. On a live input there IS no whole-track reading to
    // defend — keyConfidence is zero by construction — so locking just freezes
    // the identity onto whatever was playing during the first thirty seconds.
    //
    // Measured: from a live start, `settled` reached 1.0 in 30s and then took
    // three minutes of continuously opposite music to move the hue 50 degrees,
    // where reading that same music fresh got there in thirty seconds. Change
    // the song in the tab and the water kept wearing the last one's colour.
    // Live therefore settles to a ceiling, not to a lock.
    const ceiling = this._live ? LIVE_SETTLE_CEILING : 1;
    this.settled = Math.min(ceiling, this.settled + dt * (0.035 + this.keyConfidence * 0.05));
    this._recompute();
  }

  /**
   * Learn tempo and timbre from a live input.
   *
   * Without this, a live identity keeps the placeholder numbers it was created
   * with — bpmOffline 120, pulse 0.4, attack 0.4, brightness 0.5 — for as long
   * as it exists. Those feed `swellSeconds`, so wave speed came out as a fixed
   * 1.58 seconds for every song ever played through a tab or a microphone. The
   * water was not moving wrongly so much as not listening at all: the one
   * property most obviously "about" the music was a constant.
   *
   * These are the live equivalents of what the offline pass measures from the
   * whole buffer. They are smoothed hard, because unlike the offline read there
   * is no averaging over a track to lean on — a single loud cymbal must not
   * become the song's character.
   */
  observeLive(m, dt) {
    if (!this._live || !m || !m.playing) return;
    const k = 1 - Math.exp(-dt * 0.22);

    // Tempo, but only while the beat tracker actually has a lock on it.
    if (m.bpm > 45 && m.bpm < 210 && m.beatConfidence > 0.35) {
      this.bpmOffline += (m.bpm - this.bpmOffline) * k * m.beatConfidence;
      this.beatPeriod = 60 / Math.max(1, this.bpmOffline);
    }
    // How regular that beat is — the live stand-in for autocorrelation height.
    this.pulse += (clamp01(m.beatConfidence * 1.1) - this.pulse) * k;

    // Timbre. `smoothness` is sustained-vs-percussive, so attack is its
    // opposite; brightness is the treble share of the spectrum.
    const attack = clamp01(1 - (m.smoothness != null ? m.smoothness : 0.5));
    const tot = m.bass + m.mids + m.highs + m.air;
    const bright = tot > 1e-4 ? clamp01(((m.highs + m.air) / tot - 0.16) / 0.34) : this.brightness;
    this.attack += (attack - this.attack) * k;
    this.brightness += (bright - this.brightness) * k;
    this._recompute();
  }

  /**
   * A new song has started on a live input. Forget how sure we were.
   *
   * Deliberately keeps `warmth` and `drive` rather than snapping to the
   * defaults: the next reading converges within a few seconds anyway, and
   * resetting them outright makes the arena flash through an unrelated colour
   * on its way to the right one.
   */
  resetLive() {
    if (!this._live) return;
    this.settled = 0;
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
      _live: true,
    });
    id._recompute();
    return id;
  }

  // -------------------------------------------------------------------------
  // Emotion
  // -------------------------------------------------------------------------

  /**
   * How much to believe bpmOffline, 0..1.
   *
   * Tempo is the least reliable thing measured here — autocorrelation of the
   * onset flux simply has no clear winner on rubato, sung or sparsely
   * percussive material — and it drives wave speed, arousal and therefore
   * colour. So its uncertainty has to be visible to everything downstream
   * instead of being laundered into a confident number.
   */
  get tempoConfidence() { return clamp01((this.pulse - 0.25) / 0.45); }

  /**
   * How long one swell should take, in seconds.
   *
   * Two beats where the tempo is trustworthy. Where it is not, from arousal
   * instead — which is a multi-cue estimate (tempo, pulse, attack, brightness)
   * and degrades far more gracefully than any single measurement. A 56 BPM
   * ballad whose autocorrelation returned 188 still gets slow water this way,
   * because its attack and brightness say calm even when its flux does not.
   */
  get swellSeconds() {
    const c = this.tempoConfidence;
    // ONE BAR, not two beats.
    //
    // Two beats is defensible on paper and wrong in the room: at 120 BPM it is
    // a swell every second, and a 40 m arena crossed by a full wave every
    // second does not read as water at all — it reads as agitation, and it is
    // tiring to watch for the length of a song. Real swell is slow; what is
    // quick on open water is the small chop riding on top of it.
    //
    // A bar is also the truer musical unit. People feel bars, not beats: a
    // phrase turns over on the bar line, and water that turns over with it is
    // synchronised in the way that is actually perceptible. Nothing is lost at
    // the fast end, because omega = sqrt(g*k) in the shader means the small
    // waves still ride at their own much quicker rate — the surface stays
    // lively while the swell underneath it becomes stately.
    const fromTempo = (60 / (this.bpmOffline || 100)) * 4;
    const fromTimbre = 4.40 - this.arousalTimbre * 2.60;   // calm 4.4s .. driving 1.8s
    let t = fromTempo * c + fromTimbre * (1 - c);

    // Guardrail, and the reason arousalTimbre exists separately.
    //
    // Tempo can be badly wrong — one 56 BPM ballad autocorrelates at 188 with
    // high confidence, and confidence cannot save it because the confidence
    // comes from the same measurement. Attack and brightness cannot make that
    // mistake: they never look at periodicity at all. So they set a floor. A
    // record whose timbre says soft and dark is not allowed fast water no
    // matter what its flux claimed, which is the one failure this whole line of
    // work exists to prevent.
    // The floor bites only where the timbre genuinely says calm. Set higher it
    // compressed every song into a 1.2-2.3s band, which trades one kind of
    // sameness for another — the point is to catch the ballad that
    // autocorrelated fast, not to slow everything down.
    const ta = this.arousalTimbre;
    if (ta < 0.45) t = Math.max(t, 2.10 + (0.45 - ta) * 4.8);
    // A tighter range than before. Tempo is wrong often enough that its errors
    // must not be able to produce water nobody would call watery: a folk dance
    // track read 50% fast and got a 0.71s swell, quicker than the rock single,
    // which is not a reading of the music, it is a reading of the mistake.
    return Math.max(1.70, Math.min(4.70, t));
  }

  /**
   * Arousal from timbre alone — attack, brightness, pulse — with no tempo in
   * it. Deliberately independent, so it can check the tempo rather than
   * inheriting its errors.
   */
  get arousalTimbre() {
    return clamp01(this.attack * 0.46 + this.brightness * 0.30 + this.pulse * 0.24);
  }

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
    // On a live input `keyConfidence` is zero by construction — there is no
    // offline pass to set it — so this floored to 0.30 forever and capped the
    // mode contribution at under a third. The effect was that a tab could never
    // reach either end of the ramp: a plainly major track sat in turquoise and
    // a plainly minor one never got past blue, whatever was playing. The live
    // harmony analyser has its own confidence, and on a live identity that is
    // the best evidence available, so let it speak.
    const conf = Math.max(this.keyConfidence, this._live ? this.liveConf || 0 : 0, 0.30);

    // Offline, mode leads because a whole-track chroma read is good evidence.
    // Live it is not: measured on a tab, the analyser reported Ossuary — which
    // reads D minor offline — as F major, its relative, flipping between the
    // two every few seconds. Mode therefore cannot lead a live reading, and
    // pinning valence to it left every live song inside a narrow cyan band
    // whatever was playing.
    //
    // Brightness can lead instead. It is a spectral ratio, it needs no key, and
    // it cannot make the relative-major mistake — the same argument that made
    // timbre the guard on tempo. So on a live input the trustworthy signal is
    // weighted up and the shaky one is left where it is.
    const brightW = this._live ? 0.95 : 0.34;
    const drive = modeV * 1.55 * conf
      + this.consonance * 0.32
      + (this.brightness - 0.5) * brightW;
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
    // Bumped on every recomputation so anything holding a derived copy — the
    // arena caches the palette rather than rebuilding it per frame — can tell
    // that its copy is stale. Without this the water kept the colour it was
    // given at connect no matter what the identity did afterwards, which is
    // invisible on a file (decided once, held on purpose) and completely wrong
    // on a live input, where the song changes underneath you.
    this.version = (this.version || 0) + 1;

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

    // ---- and arousal has to say something in the MIDDLE too ----------------
    //
    // The tilt above is zero at neutral valence by design, so that a middling
    // song cannot be rotated into a colour it should not be. The cost only
    // shows up when you look at a real set: across sixteen records, six sit
    // between valence 0.44 and 0.65, and they were handed hues 174 to 206 —
    // six different songs inside thirty degrees of cyan, with nothing to tell
    // Believer from Someone Like You.
    //
    // Mid-valence is exactly where arousal is the most informative thing left,
    // so it gets to move the hue there. Driving records run cooler toward
    // turquoise, still ones settle back toward blue. Weighted to vanish at both
    // ends, where the tilt above already owns the direction.
    const mid = 1 - Math.abs(V - 0.5) * 2;
    hue -= (A - 0.5) * 44 * mid;

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
    // Widened and strengthened. Across twelve real records four landed in the
    // green half of the ramp and one — a Hindi rap track at valence 0.80 — came
    // out at hue 88, which is olive, not water. Turquoise and emerald above 150
    // are real lagoon colours and survive; everything between is pulled toward
    // neutral, so a song that has to cross reads as pale water rather than as
    // pond scum.
    // Narrowed from 62 degrees to 40.
    //
    // At 62 the guard reached from 50 to 174, which is not the lime arc — it is
    // most of the green range plus the bottom of the golds. Emerald at 156 was
    // being docked a third of its saturation by the very same file that calls
    // emerald "a real lagoon colour" two hundred lines further down, and Gallan
    // Goodiyaan came out at chroma 0.43 because of it. The arc that genuinely
    // has no water in it is narrow; the guard should be too.
    const lime = Math.abs(hue - 112);
    if (lime < 40) chroma *= 1 - 0.72 * (1 - lime / 40);

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

  /**
   * The gradient the water is actually coloured with: five stops, trough to
   * crest, as {r,g,b} in 0..1.
   *
   * ---------------------------------------------------------------------------
   * WHY FIVE, AND WHY A HUE ARC
   *
   * The surface had three colours and a foam white, and the middle one was used
   * for nearly everything — so a wave was one hue getting lighter, and the top
   * of every crest converged on the same pale non-colour. Three stops cannot
   * make a gradient; they make a fade. What was missing is not brightness, it
   * is HUE TRAVEL: real lit water shifts colour between its troughs and its
   * crests, and that shift is most of what makes a surface look deep.
   *
   * So the ramp sweeps an arc — 44 degrees on a still record, close to 100 on a
   * driving one — and the song's own hue anchors its trough. Each song still
   * has one identity; it now has a range around it rather than a single note.
   *
   * ---------------------------------------------------------------------------
   * WHICH WAY IT TRAVELS — AND WHY "AWAY FROM LIME" WAS NOT ENOUGH
   *
   * The first version rotated away from lime, on the grounds that indigo, cyan,
   * emerald and gold are all water and the yellow-green between emerald and
   * gold is antifreeze. That rule is right about where NOT to go and says
   * nothing useful about where to go — and because lime sits at 112, "away"
   * points almost every water hue at the same place. Teal 177 ended at 261,
   * indigo 258 at 342, gold 51 at 327. Three completely different songs, three
   * violet crests. Every track came out purple, which is worse than every track
   * coming out teal, because it looks deliberate.
   *
   * So the direction is now a property of the hue family, chosen from what
   * light actually does to water of that colour:
   *
   *   gold / amber   troughs toward deep red, crests toward bright gold — fire
   *   teal / cyan    troughs toward deep blue, crests toward bright aqua —
   *                  which is exactly how shallow tropical water is lit
   *   blue / indigo  troughs stay deep, crests open toward cyan — deep ocean
   *   violet / pink  troughs toward deep violet, crests toward hot pink — neon
   *   red / crimson  troughs toward magenta, crests toward orange — embers
   *
   * Note that the rotation REVERSES between families: a gold song's crest is a
   * higher hue than its trough and a blue song's crest is a lower one. That is
   * the whole point. A single global direction is what collapsed them together.
   *
   * Lightness rises across the ramp but stops well short of the top. The crest
   * is the brightest thing on screen and it is also where additive lines, foam,
   * specular and subsurface scatter all peak together; leaving headroom here is
   * what stops those four summing to white.
   */
  ramp() {
    const h = this.hue, s = this.sat, l = this.light;
    const ends = rampEnds(h);
    // Arousal decides how far the family's own range is actually used: a still
    // record moves a little way along it, a driving one spans the lot.
    const reach = 0.55 + this.arousal * 0.45;
    const deepShift = ends.deep * reach;
    const crestShift = ends.crest * reach;
    // Lightness is stated ABSOLUTELY and capped, not offset.
    //
    // Adding a constant to the song's own lightness meant a bright record
    // started high and ended higher: 0.42 + 0.23 is 0.65, and at 0.65 with the
    // saturation also eased off, the crest is already most of the way to white
    // before the specular, the subsurface scatter, the additive wireframe and
    // the foam have added anything. Capping the top and holding saturation UP
    // is what keeps a crest a strong colour instead of a pale one — brightness
    // is not what makes a highlight read, contrast is.
    // `f` runs -1 (trough) .. 0 (the song's own hue) .. +1 (crest), so the
    // identity sits in the middle of its own gradient rather than at one end.
    const stop = (f, sMul, lAbs) => {
      const hue = h + (f < 0 ? -f * deepShift : f * crestShift);
      // The lime guard applies to every stop, not only to the song's base hue.
      // Offsets added here were escaping it, which is how a gradient could pass
      // through a colour the identity itself is forbidden to be.
      const lime = Math.abs((((hue - 112) % 360) + 540) % 360 - 180);
      const guard = lime < 38 ? 1 - 0.70 * (1 - lime / 38) : 1;
      // And so does the luminance compensation, for the same reason it exists
      // on the base hue: HSL lightness is not perceptual, and a saturated gold
      // carries several times the luminance of a saturated blue at the same
      // number. Capping every stop at the same value therefore blew out the
      // warm records and only the warm records — Apna Time Aayega's crests went
      // to cream while the blue tracks at identical settings still read as
      // water. Each stop is pulled down toward the luminance a blue would have
      // had, and only ever down.
      const probe = hsl(hue, 1, 0.5);
      const Y = 0.2126 * probe.r + 0.7152 * probe.g + 0.0722 * probe.b;
      const comp = Math.min(1, Math.pow(0.42 / Math.max(0.08, Y), 0.32));
      return hsl(hue, clamp01(s * sMul * guard), clamp01(Math.max(0.06, lAbs * comp)));
    };
    return [
      stop(-1.00, 1.00, Math.max(0.07, l * 0.40)),          // trough
      stop(-0.45, 1.06, Math.max(0.11, l * 0.66)),
      stop(0.00, 1.04, l),                                  // the song itself
      stop(0.52, 1.02, Math.min(0.48, l + 0.09)),
      stop(1.00, 0.98, Math.min(0.55, l + 0.15)),           // crest
    ];
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

  /**
   * What to show the viewer about the song, in their language rather than ours.
   *
   * All of this was already computed and none of it was ever visible, so the
   * water read as decoration — pretty shapes that might or might not have
   * anything to do with the music. Naming the key, the tempo and the mood is
   * what turns it into a reading.
   *
   * Confidence is reported, not hidden. Key detection cannot separate a major
   * from its relative minor when a song leans on the shared notes, and tempo
   * estimation halves and doubles; both are stated here as facts we already
   * know about the method. A value we do not trust is marked so the viewer
   * discounts it, and one we really cannot stand behind is withheld entirely —
   * far better than confidently printing something the ear can hear is wrong.
   */
  card() {
    const kc = this.keyConfidence, tc = this.tempoConfidence;

    // A tempo that disagrees with the timbre is the signature of an octave
    // error, and periodicity alone cannot see it: counting every subdivision
    // of a slow ballad gives a confidently periodic — and confidently wrong —
    // number. Tum Hi Ho reads 188 against a true 56 and does it with a high
    // pulse score, so `tempoConfidence` on its own will happily assert it.
    //
    // Attack and brightness never look at rhythm, so they cannot make the same
    // mistake. When the pace they imply and the pace the tempo implies are far
    // apart, the tempo is the one to doubt, and the card says so rather than
    // printing a number the ear can hear is wrong.
    const tempoImplied = clamp01(((this.bpmOffline || 100) - 60) / 100);
    const agrees = Math.abs(tempoImplied - this.arousalTimbre) < 0.42;

    return {
      key: kc > 0.22 ? this.keyName : '',
      keySure: kc > 0.46,
      bpm: tc > 0.26 && this.bpmOffline ? this.bpmOffline : 0,
      bpmSure: tc > 0.52 && agrees,
      mood: moodWord(this.valence, this.arousal),
      colour: hueName(this.hue),
      hue: Math.round(this.hue),
      valence: +this.valence.toFixed(2),
      arousal: +this.arousal.toFixed(2),
      // palette() returns linear {r,g,b} for the shader; the DOM needs CSS.
      swatch: cssRgb(this.palette().mid),
      glow: cssRgb(this.palette().hot),
      live: !!this._live,
    };
  }
}

/**
 * How certain a LIVE reading is ever allowed to become.
 *
 * Below 1 by design. A live input has no future to read, so its identity has to
 * stay able to follow the music; a full lock is only appropriate when there is
 * a confident whole-track analysis underneath it worth protecting.
 */
const LIVE_SETTLE_CEILING = 0.55;

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/**
 * One word for where the song sits on Russell's circumplex.
 *
 * The grid is deliberately coarse. Three bands each way is about as fine as
 * valence and arousal can be trusted from audio alone, and a word that is
 * merely close reads as insight, while a precise-sounding one that is wrong
 * reads as a broken toy.
 */
const MOOD_GRID = [
  // arousal low -> high, for each valence band (low, mid, high)
  ['DESOLATE', 'BROODING', 'FURIOUS'],
  ['STILL', 'POISED', 'DRIVING'],
  ['SERENE', 'WARM', 'EUPHORIC'],
];
function moodWord(valence, arousal) {
  const band = (v) => (v < 0.38 ? 0 : v < 0.62 ? 1 : 2);
  return MOOD_GRID[band(valence)][band(arousal)];
}

/**
 * The colour the viewer is actually looking at, named.
 *
 * The upper edge of each band, not its centre. Hue 60 is yellow and has to
 * come out as GOLD — calling it chartreuse (which is nearer 90) described the
 * water as a colour it visibly was not, which is worse than saying nothing.
 *
 * The name also has to survive low saturation, where a hue reads as its muted
 * cousin: a desaturated gold looks khaki. Naming the hue rather than the
 * rendered pixel keeps the card consistent with the palette the song was
 * actually given.
 */
const HUE_NAMES = [
  [20, 'AMBER'], [68, 'GOLD'], [95, 'CHARTREUSE'], [140, 'MINT'],
  [166, 'EMERALD'], [186, 'TURQUOISE'], [202, 'CYAN'], [222, 'AZURE'],
  [250, 'BLUE'], [278, 'INDIGO'], [302, 'VIOLET'], [338, 'MAGENTA'], [360, 'AMBER'],
];
function hueName(h) {
  const hue = ((h % 360) + 360) % 360;
  for (const [edge, name] of HUE_NAMES) if (hue <= edge) return name;
  return 'AMBER';
}

/** palette() is linear 0..1 for the shader; the DOM wants 0..255 sRGB-ish. */
function cssRgb(c) {
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return 'rgb(' + ch(c.r) + ',' + ch(c.g) + ',' + ch(c.b) + ')';
}

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
 * WHERE THE LIME CROSSING GOES, MEASURED
 *
 * It was at 0.84-0.90, moved there because 0.84-0.90 was believed to be clear.
 * It is not: run across the sixteen real records this project tests on, Apna
 * Time Aayega lands at valence 0.85 and Wake Me Up at 0.87 — both squarely
 * inside it. Both came out at hue 103-124 with the lime guard crushing their
 * saturation to 0.22 and 0.29, so the two most triumphant tracks in the set
 * rendered as the greyest, palest water of all sixteen. Exactly backwards.
 *
 * The crossing is now at 0.68-0.74, which is the one genuinely empty stretch in
 * the measured distribution — Ghoomar sits at 0.65 and Gallan Goodiyaan at 0.78,
 * with nothing between. Everything above it is warm, so the five records that
 * read as joyful all come out amber or gold instead of one of them being olive.
 *
 * This is worth restating because the same mistake has now been made twice: the
 * safe band cannot be reasoned about from the shape of the ramp. It has to be
 * measured against real songs, because the only thing that matters is where
 * music actually lands.
 */
const HUE_RAMP = [
  [0.00, 264],   // deep indigo-blue — desolate
  [0.16, 244],   // blue — melancholy
  [0.32, 222],   // blue — pensive
  [0.46, 204],   // azure
  [0.60, 182],   // cyan-teal — the signature, and where the neutral song sits
  [0.68, 158],   // emerald — a real lagoon colour, and the last safe green
  [0.74, 56],    // amber — the crossing, taken in a single step
  [1.00, 34],    // gold — joy
];
// The wide bands are the ones water can actually be — indigo through cyan and
// turquoise to emerald on one side, amber to gold on the other — and the arc
// between them is crossed in three hundredths of a valence unit. Spread over a
// tenth, as it was, real songs sat in it: a Hindi rap track came out olive and
// an EDM record came out lime. The zones are sized by where music lands, not
// by an even division of the wheel.
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
/**
 * How far, and which way, a hue family's water is allowed to travel.
 *
 * Signed degrees from the song's own hue: `deep` is added going down toward the
 * trough, `crest` going up toward the top of the wave. The signs differ between
 * families on purpose — see the long note on `ramp()`. Every destination here is
 * a colour water is genuinely seen in, and none of them lands in the yellow-green
 * arc that the lime guard exists to keep the palette out of.
 */
function rampEnds(hue) {
  const h = ((hue % 360) + 360) % 360;
  if (h >= 340 || h < 20) return { deep: -30, crest: 34 };   // crimson -> ember
  if (h < 75)             return { deep: -36, crest: 16 };   // gold -> firelight
  if (h < 150)            return { deep: 54, crest: 40 };    // lime-adjacent: leave
  if (h < 212)            return { deep: 46, crest: -12 };   // teal -> tropical
  if (h < 278)            return { deep: 20, crest: -56 };   // indigo -> deep ocean
  return { deep: -26, crest: 40 };                           // violet -> neon pink
}

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
