/**
 * TrackPlan — a structural read of the whole song, computed once at load time.
 *
 * The section machine used to infer structure from a few seconds of history,
 * which is guesswork: a loud verse and a real drop sit within a few percent of
 * each other, and a rear-view window cannot tell "this is loud" from "this is
 * the loudest thing in the song". But the entire buffer is already decoded
 * before the first frame, so the structure does not have to be guessed at all.
 *
 * This is the local, no-model version of the eventual
 *   SONG -> analysis -> understanding -> performance plan -> choreography
 * pipeline. Swapping in a smarter planner later means replacing this class;
 * the Choreographer's interface to it (`levelAt`, `riseAt`, `dropNear`) stays.
 */
export class TrackPlan {
  /**
   * @param {Float32Array} rms   per-bin RMS envelope of the whole track
   * @param {number} refRms      the track's loud-plateau RMS
   * @param {number} duration    seconds
   */
  constructor(env, refRms, duration) {
    const rms = env.rms || env;                 // tolerate a bare array
    const n = rms.length;
    this.n = n;
    this.duration = duration;
    this.binDur = duration / n;

    // Level: where each moment sits in the track's own dynamic range.
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = Math.min(1, Math.pow(rms[i] / refRms, 0.85));

    // How compressed is this master? A wide level curve carries structure on
    // its own; a flat one does not, and needs help.
    const sortedRaw = Array.from(raw).sort((a, b) => a - b);
    const p10 = sortedRaw[Math.floor(n * 0.10)] || 0;
    const p90 = sortedRaw[Math.floor(n * 0.90)] || 1;
    this.flatness = clamp01(1 - (p90 - p10) / 0.42);

    if (env.high && env.width && this.flatness > 0.05) {
      // Top end and stereo width still open up in a chorus even when the level
      // meter has been squashed flat. Lean on them in proportion to how little
      // the level curve has left to say.
      const hi = normalise(env.high), wd = normalise(env.width);
      const w = this.flatness;
      for (let i = 0; i < n; i++) {
        const alt = hi[i] * 0.62 + wd[i] * 0.38;
        raw[i] = raw[i] * (1 - w * 0.55) + alt * (w * 0.55);
      }
    }

    this.level = smooth(raw, Math.max(1, Math.round(0.9 / this.binDur)));

    // Rise: how much louder than ~2.5 s ago.
    const back = Math.max(1, Math.round(2.5 / this.binDur));
    this.rise = new Float32Array(n);
    for (let i = 0; i < n; i++) this.rise[i] = this.level[i] - this.level[Math.max(0, i - back)];

    // Loud plateau of this particular track, for relative thresholds.
    const sorted = Array.from(this.level).sort((a, b) => a - b);
    this.peakLevel = Math.max(0.25, sorted[Math.floor(n * 0.97)] || 1);

    // ---- rank map: where each moment sits in the track's OWN distribution --
    //
    // Level as a fraction of the peak sounds right and is nearly useless on a
    // modern master. Measured across a full play of two records, the quartiles
    // of that fraction were 0.79 / 0.84 / 0.88 and 0.73 / 0.81 / 0.91 — a song
    // spends its whole length within a few percent of its own ceiling, because
    // that is exactly what mastering is for. The water inherited it: on the rap
    // track the interquartile range of crest height was 0.36 world units out of
    // 6.2, which is a still image, and the only thing left moving was noise.
    //
    // Ranking fixes it without inventing anything. The quietest moment of THIS
    // song maps to 0 and the loudest to 1 whatever the compression did, so the
    // full range of the arena is always in use and a verse is always visibly
    // smaller than its chorus. A little of the absolute ratio is kept so a track
    // with genuinely no dynamics is not pumped into fake ones.
    this.levelRank = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = this.level[i];
      let lo = 0, hi = n - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
      this.levelRank[i] = n > 1 ? lo / (n - 1) : 0;
    }

    this.drops = this._findDrops(back);
  }

  /**
   * A drop is a large rise that lands near the loudest the track ever gets.
   * Candidates are thinned to the strongest in each neighbourhood so a single
   * event cannot fire twice, and so a long crescendo yields one moment.
   */
  _findDrops(back) {
    // A song has a handful of real moments, not one every few bars. Believer
    // yielded nine, which put almost the whole track inside a build run-up and
    // left the choruses smaller than the verses. Few and decisive beats many
    // and uniform: if everything is an eruption, nothing is.
    const maxDrops = Math.max(2, Math.min(5, Math.round(this.duration / 50)));
    const minGap = Math.max(1, Math.round(14 / this.binDur));
    const riseGate = 0.13;
    const levelGate = this.peakLevel * 0.80;

    const cands = [];
    for (let i = back; i < this.n; i++) {
      if (this.level[i] < levelGate || this.rise[i] < riseGate) continue;
      // local maximum of rise within a short window
      let isPeak = true;
      const w = Math.max(1, Math.round(1.2 / this.binDur));
      for (let j = Math.max(0, i - w); j <= Math.min(this.n - 1, i + w); j++) {
        if (this.rise[j] > this.rise[i]) { isPeak = false; break; }
      }
      if (isPeak) cands.push({ i, score: this.rise[i] + this.level[i] * 0.5 });
    }

    cands.sort((a, b) => b.score - a.score);
    const kept = [];
    for (const c of cands) {
      if (kept.length >= maxDrops) break;
      if (kept.every(k => Math.abs(k.i - c.i) >= minGap)) kept.push(c);
    }
    return kept.map(c => c.i * this.binDur).sort((a, b) => a - b);
  }

  _idx(t) {
    const i = Math.floor(t / this.binDur);
    return i < 0 ? 0 : i >= this.n ? this.n - 1 : i;
  }

  levelAt(t) { return this.level[this._idx(t)]; }
  riseAt(t) { return this.rise[this._idx(t)]; }

  /**
   * How big this moment is against the rest of THIS track, 0..1.
   *
   * Mostly the rank — see the constructor for why a ratio to the peak does not
   * work — with a little of the absolute ratio so a genuinely flat track keeps
   * looking flat rather than being handed dynamics it does not have.
   */
  relLevelAt(t) {
    const i = this._idx(t);
    const ratio = Math.min(1.15, this.level[i] / this.peakLevel);
    return this.levelRank[i] * 0.85 + ratio * 0.15;
  }

  /**
   * Seconds until the next planned drop, or null if none remains.
   * This is what lets the arena *anticipate*: a build is not a thing we detect
   * after the fact, it is the run-up to a drop we already know is coming.
   */
  timeToNextDrop(t) {
    for (let i = 0; i < this.drops.length; i++) {
      if (this.drops[i] > t) return this.drops[i] - t;
    }
    return null;
  }

  /**
   * Index of the most recent planned drop at or before `t`, else -1.
   *
   * Callers latch on the index rather than testing a time window: a window has
   * to be sampled while it is open, and a dropped frame or a throttled tab can
   * step straight over it — silently losing the biggest moment in the song.
   */
  dropIndexBefore(t) {
    let idx = -1;
    for (let i = 0; i < this.drops.length; i++) {
      if (this.drops[i] <= t + 0.12) idx = i; else break;
    }
    return idx;
  }

  dropTime(i) { return this.drops[i]; }

  /** Diagnostics. */
  describe() {
    return {
      duration: +this.duration.toFixed(1),
      peakLevel: +this.peakLevel.toFixed(2),
      compression: +this.flatness.toFixed(2),
      drops: this.drops.map(d => +d.toFixed(1)),
    };
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** Scale an envelope to 0..1 against its own 5th/95th percentiles. */
function normalise(a) {
  const s = Array.from(a).sort((x, y) => x - y);
  const lo = s[Math.floor(a.length * 0.05)] || 0;
  const hi = s[Math.floor(a.length * 0.95)] || 1;
  const out = new Float32Array(a.length);
  const d = Math.max(1e-9, hi - lo);
  for (let i = 0; i < a.length; i++) out[i] = clamp01((a[i] - lo) / d);
  return out;
}

function smooth(a, w) {
  if (w <= 1) return a;
  const n = a.length;
  const out = new Float32Array(n);
  let sum = 0;
  const half = Math.floor(w / 2);
  for (let i = 0; i < n; i++) {
    sum += a[i];
    if (i >= w) sum -= a[i - w];
    const c = Math.min(i, w - 1) + 1;
    out[Math.max(0, i - half)] = sum / c;
  }
  // tail
  for (let i = Math.max(0, n - half); i < n; i++) out[i] = a[i];
  return out;
}
