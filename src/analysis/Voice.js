/**
 * VoiceAnalyser — find the singer, and follow them.
 *
 * In a lyric-driven song the voice is the thing you feel. Everything else in
 * this pipeline measures the mix as a whole, which is why a vocal-led track
 * used to read as "loud, then louder": the one element carrying the meaning
 * was invisible to it.
 *
 * There is no source separation here. Instead it leans on a property that
 * holds for almost every pop, rock and hip-hop master: **the lead vocal is
 * panned dead centre, and most other elements are not**. Summing to mid
 * (L+R)/2 and difference to side (L-R)/2 gives a usable lead-vocal estimate —
 * the same trick karaoke centre-cancellation uses, run forwards instead of
 * backwards. Energy that is strong in mid and weak in side, inside the vocal
 * band, is almost certainly the singer.
 *
 * From that it derives presence, melody pitch, vocal effort (a croon and a
 * belt differ in spectral tilt, not just level), vibrato and phrasing.
 */

const LO_HZ = 80;        // bottom of the sung fundamental range
const HI_HZ = 1100;      // top of the sung fundamental range
const BAND_LO = 180;     // vocal band for presence
const BAND_HI = 5000;

export class VoiceAnalyser {
  constructor(midNode, sideNode, sampleRate) {
    this.mid = midNode;
    this.side = sideNode;
    this.bins = midNode.frequencyBinCount;
    this.binHz = sampleRate / midNode.fftSize;

    this.dbM = new Float32Array(this.bins);
    this.dbS = new Float32Array(this.bins);
    this.linM = new Float32Array(this.bins);
    this.linS = new Float32Array(this.bins);
    this.centre = new Float32Array(this.bins);   // centre-dominant energy

    this.loBin = Math.max(2, Math.floor(LO_HZ / this.binHz));
    this.hiBin = Math.min(this.bins - 2, Math.ceil(HI_HZ / this.binHz));
    this.bandLo = Math.max(2, Math.floor(BAND_LO / this.binHz));
    this.bandHi = Math.min(this.bins - 2, Math.ceil(BAND_HI / this.binHz));

    this.hps = new Float32Array(this.hiBin + 2);

    this._pitchHz = 0;
    this._cand = [];             // recent raw f0 estimates, for median filtering
    this._pitchHist = [];        // recent f0, for vibrato
    this._presence = 0;
    this._sinceOnset = 9;
    this._phraseOn = false;
    this._phraseT = 0;
    this._gapT = 9;
    this._effortRaw = 0;

    this.state = {
      presence: 0,     // 0 no lead vocal .. 1 clearly singing
      pitch: 0,        // 0..1 within this singer's observed range
      pitchHz: 0,
      pitchConf: 0,
      effort: 0,       // 0 soft croon .. 1 full belt
      vibrato: 0,
      onset: false,    // a new sung note
      phrase: 0,       // 0..1 envelope across the current sung phrase
      gap: 1,          // 0 singing .. 1 long instrumental gap
      centreRatio: 0,  // how mono/centred the mix is right now
      grit: 0,         // 0 clean and sustained .. 1 raw, strained, distorted
    };

    // The singer's range is learned from the track rather than assumed, so a
    // bass voice and a soprano both use the full height of the arena.
    this._loSeen = 400; this._hiSeen = 400;
  }

  reset() {
    this._pitchHz = 0; this._cand.length = 0; this._pitchHist.length = 0;
    this._presence = 0; this._sinceOnset = 9;
    this._phraseOn = false; this._phraseT = 0; this._gapT = 9; this._effortRaw = 0;
    this._loSeen = 400; this._hiSeen = 400;
    const s = this.state;
    s.presence = 0; s.pitch = 0; s.pitchHz = 0; s.pitchConf = 0;
    s.effort = 0; s.vibrato = 0; s.onset = false; s.phrase = 0; s.gap = 1;
    s.centreRatio = 0; s.grit = 0;
  }

  update(dt, playing) {
    const s = this.state;
    s.onset = false;
    this._sinceOnset += dt;

    if (!playing) {
      const k = 1 - Math.exp(-dt * 2.0);
      s.presence += (0 - s.presence) * k;
      s.effort += (0 - s.effort) * k;
      s.phrase += (0 - s.phrase) * k;
      s.gap += (1 - s.gap) * k;
      return s;
    }

    this.mid.getFloatFrequencyData(this.dbM);
    this.side.getFloatFrequencyData(this.dbS);

    // ---- centre-dominant spectrum -----------------------------------------
    let midSum = 0, sideSum = 0, centreSum = 0;
    let lowE = 0, highE = 0, voxSum = 0, fullSum = 0;
    let gLog = 0, gArith = 0, gN = 0;
    for (let i = this.bandLo; i <= this.bandHi; i++) {
      const m = this.dbM[i] > -100 ? Math.pow(10, this.dbM[i] * 0.05) : 0;
      const sd = this.dbS[i] > -100 ? Math.pow(10, this.dbS[i] * 0.05) : 0;
      this.linM[i] = m; this.linS[i] = sd;
      // Weight by how centred this bin is. A bin equally present in mid and
      // side is a wide instrument and contributes almost nothing.
      const centred = m > 1e-9 ? Math.max(0, (m - sd) / (m + sd + 1e-9)) : 0;
      const c = m * centred;
      this.centre[i] = c;
      midSum += m; sideSum += sd; centreSum += c;
      fullSum += m;
      const hz = i * this.binHz;
      if (hz < 1500) lowE += c; else highE += c;
      // formant / presence region — where a voice lives regardless of panning
      if (hz > 300 && hz < 3500) voxSum += m;
      // spectral flatness of the centre channel: a raw, distorted, strained
      // voice is noisy and flat; a clean sustained one is peaky
      if (hz > 400 && hz < 4000) { gLog += Math.log(c + 1e-9); gArith += c; gN++; }
    }

    if (gN > 0) {
      const gm = Math.exp(gLog / gN), am = gArith / gN + 1e-9;
      s.grit += (clamp01((gm / am) * 2.4) - s.grit) * (1 - Math.exp(-dt * 3));
    }

    s.centreRatio = midSum > 1e-9 ? clamp01(1 - sideSum / (midSum + sideSum)) : 1;

    // ---- presence ----------------------------------------------------------
    // Measured from formant-band energy first, with centre-dominance only as a
    // bonus. Keying it on centring alone inverted on exactly the moments that
    // matter most: a big chorus doubles and spreads the vocal wide, so the
    // centre measure collapsed right when the singing was at its most powerful
    // — presence read 0.19 in Believer's choruses against 0.94 in its verses.
    const band = fullSum > 1e-9 ? voxSum / fullSum : 0;
    const centreBonus = 0.58 + 0.42 * s.centreRatio;
    const rawPresence = clamp01(band * 2.3) * centreBonus;

    // ---- melody pitch, by harmonic product spectrum -------------------------
    // Multiplying the spectrum by decimated copies of itself makes the true
    // fundamental the only place where every harmonic lines up. Robust in a
    // dense mix, where simple peak-picking finds the loudest partial instead.
    let best = 0, bestBin = 0;
    for (let i = this.loBin; i <= this.hiBin; i++) {
      let v = this.centre[i];
      const i2 = i * 2, i3 = i * 3;
      v *= i2 <= this.bandHi ? this.centre[i2] + 1e-7 : 1e-7;
      v *= i3 <= this.bandHi ? this.centre[i3] + 1e-7 : 1e-7;
      this.hps[i] = v;
      if (v > best) { best = v; bestBin = i; }
    }

    // Sub-harmonic check. HPS with three harmonics still latches onto the 2nd
    // partial when it is the strongest, reporting the note an octave high. If
    // there is real energy an octave down, that is the fundamental.
    if (bestBin >= this.loBin * 2) {
      const half = bestBin >> 1;
      if (half >= this.loBin && this.hps[half] > best * 0.30) { bestBin = half; best = this.hps[half]; }
    }

    let conf = 0;
    if (bestBin > 0 && best > 0) {
      // prominence against the median of the HPS
      let sum = 0, n = 0;
      for (let i = this.loBin; i <= this.hiBin; i += 3) { sum += this.hps[i]; n++; }
      const mean = n ? sum / n : 0;
      conf = clamp01(mean > 1e-20 ? Math.log10(best / mean) / 2.6 : 0);

      const l = this.hps[bestBin - 1] || 0, r = this.hps[bestBin + 1] || 0;
      const den = l - 2 * best + r;
      const shift = den !== 0 ? 0.5 * (l - r) / den : 0;
      const hz = (bestBin + shift) * this.binHz;

      if (conf > 0.34 && rawPresence > 0.20 && hz > LO_HZ && hz < HI_HZ) {
        // Octave errors are the classic HPS failure; a jump of close to an
        // octave from a stable pitch is far more likely to be one than a real
        // interval, so fold it back.
        let f = hz;
        if (this._pitchHz > 0) {
          const ratio = f / this._pitchHz;
          if (ratio > 1.85 && ratio < 2.15) f *= 0.5;
          else if (ratio > 0.46 && ratio < 0.54) f *= 2;
        }
        // Median of the last five estimates. A dense mix throws the occasional
        // wild frame — a partial winning, a cymbal, a guitar note crossing the
        // vocal — and averaging drags the melody towards those outliers where a
        // median simply discards them.
        this._cand.push(f);
        if (this._cand.length > 5) this._cand.shift();
        const sorted = this._cand.slice().sort((x, y) => x - y);
        const med = sorted[sorted.length >> 1];

        const jump = this._pitchHz > 0 ? Math.abs(Math.log2(med / this._pitchHz)) : 0;
        // glide for small intervals, snap for real leaps
        const k = jump > 0.28 ? 0.5 : 1 - Math.exp(-dt * 11);
        if (this._pitchHz === 0) this._pitchHz = med;
        else this._pitchHz += (med - this._pitchHz) * k;

        // ~2 semitones and a longer refractory. At 1.1 semitones the residual
        // jitter in the pitch track registered as notes: 5.6 "sung notes" per
        // second in a ballad, which made a slow song look busy.
        if (jump > 0.16 && this._sinceOnset > 0.22) {
          s.onset = true; this._sinceOnset = 0;
          // Vibrato is wobble *within* a held note. Carrying the history across
          // a note change measures the interval instead and pins it at 1.
          this._pitchHist.length = 0;
        }

        this._loSeen = Math.min(this._loSeen, this._pitchHz);
        this._hiSeen = Math.max(this._hiSeen, this._pitchHz);
      }
    }
    s.pitchConf += (conf - s.pitchConf) * (1 - Math.exp(-dt * 6));
    s.pitchHz = this._pitchHz;

    // normalise into the singer's own observed range (min a major sixth wide)
    const lo = this._loSeen, hi = Math.max(this._hiSeen, this._loSeen * 1.7);
    s.pitch = this._pitchHz > 0
      ? clamp01(Math.log2(this._pitchHz / lo) / Math.max(0.3, Math.log2(hi / lo)))
      : 0;

    // ---- vibrato -----------------------------------------------------------
    // Only sample inside a held note; the history is cleared at each onset.
    if (this._sinceOnset > 0.12) this._pitchHist.push(this._pitchHz);
    if (this._pitchHist.length > 26) this._pitchHist.shift();
    if (this._pitchHist.length <= 12) {
      s.vibrato *= Math.exp(-dt * 2.5);      // too little of the note to judge
    } else {
      let mean = 0;
      for (const v of this._pitchHist) mean += v;
      mean /= this._pitchHist.length;
      let dev = 0;
      for (const v of this._pitchHist) dev += Math.abs(v - mean);
      dev /= this._pitchHist.length;
      const cents = mean > 1e-6 ? (dev / mean) * 1731 : 0;   // ~cents of wobble
      s.vibrato += (clamp01(cents / 70) - s.vibrato) * (1 - Math.exp(-dt * 3));
    }

    // ---- effort ------------------------------------------------------------
    // A belt is not merely louder than a croon: it is brighter. Spectral tilt
    // inside the centre channel separates the two even after compression has
    // levelled everything.
    const tilt = (lowE + highE) > 1e-9 ? highE / (lowE + highE) : 0;
    this._effortRaw = clamp01(tilt * 2.3) * 0.65 + clamp01(rawPresence * 1.3) * 0.35;
    s.effort += (this._effortRaw - s.effort) * (1 - Math.exp(-dt * 5));

    // ---- presence + phrasing ------------------------------------------------
    this._presence += (rawPresence - this._presence)
      * (1 - Math.exp(-dt * (rawPresence > this._presence ? 9 : 2.4)));
    s.presence = this._presence;

    const singing = this._presence > 0.24 && s.pitchConf > 0.22;
    if (singing) {
      if (!this._phraseOn) { this._phraseOn = true; this._phraseT = 0; }
      this._phraseT += dt;
      this._gapT = 0;
    } else {
      this._phraseOn = false;
      this._gapT += dt;
    }
    // rises quickly as a phrase gets going, falls away in the breath after it
    s.phrase += ((singing ? Math.min(1, 0.35 + this._phraseT * 1.1) : 0) - s.phrase)
      * (1 - Math.exp(-dt * 4));
    s.gap += (clamp01(this._gapT / 2.2) - s.gap) * (1 - Math.exp(-dt * 1.6));

    return s;
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
