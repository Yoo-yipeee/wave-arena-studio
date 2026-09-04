/**
 * AudioEngine — decode / transport / analyser tap.
 *
 * Everything (uploaded files AND the synthetic demo) becomes an AudioBuffer
 * played through an AudioBufferSourceNode, so the analysis path is identical
 * regardless of source. Nothing leaves the browser.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.source = null;
    this.gain = null;
    this.analyser = null;

    this.title = '';
    this.playing = false;
    this._startedAt = 0;    // ctx.currentTime when playback began
    this._offset = 0;       // position within buffer at _startedAt
    this._volume = 0.85;

    this.onEnded = null;
    this.onTrackLoaded = null;
    this.live = false;        // listening to a microphone rather than a file
    this._liveStart = 0;
  }

  /** Must be called from a user gesture. */
  ensureContext() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });

    this.gain = this.ctx.createGain();
    this.gain.gain.value = this._volume;

    // Short window: sharp in time, blunt in frequency. For transients, onsets
    // and band energies.
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.55;
    this.analyser.minDecibels = -92;
    this.analyser.maxDecibels = -12;

    // Long window: blunt in time, sharp in frequency. For pitch and harmony.
    // These requirements are opposites — at fftSize 2048 a semitone in the bass
    // is narrower than one bin, so chords are unreadable there. Two nodes off
    // the same tap costs one extra FFT and makes both jobs possible.
    this.harmonyAnalyser = this.ctx.createAnalyser();
    this.harmonyAnalyser.fftSize = 8192;
    this.harmonyAnalyser.smoothingTimeConstant = 0.72;
    this.harmonyAnalyser.minDecibels = -95;
    this.harmonyAnalyser.maxDecibels = -18;

    // ---- mid / side, for finding the lead vocal ---------------------------
    // The lead vocal in almost any pop, rock or hip-hop master is panned dead
    // centre while the instruments are spread wide. Building the actual mid
    // (L+R)/2 and side (L-R)/2 SIGNALS and analysing each separately gives a
    // usable vocal estimate. This has to be done in the time domain: an
    // AnalyserNode reports magnitudes only, and |L+R| cannot be recovered from
    // |L| and |R| without the phase between them.
    const splitter = this.ctx.createChannelSplitter(2);
    this._splitter = splitter;
    const midSum = this.ctx.createGain();
    const sideSum = this.ctx.createGain();
    const half = () => { const g = this.ctx.createGain(); g.gain.value = 0.5; return g; };
    const minusHalf = () => { const g = this.ctx.createGain(); g.gain.value = -0.5; return g; };

    const mL = half(), mR = half(), sL = half(), sR = minusHalf();
    splitter.connect(mL, 0); splitter.connect(mR, 1);
    splitter.connect(sL, 0); splitter.connect(sR, 1);
    mL.connect(midSum); mR.connect(midSum);
    sL.connect(sideSum); sR.connect(sideSum);

    this.midAnalyser = this.ctx.createAnalyser();
    this.sideAnalyser = this.ctx.createAnalyser();
    for (const a of [this.midAnalyser, this.sideAnalyser]) {
      a.fftSize = 4096;                 // ~11 Hz bins: resolves sung fundamentals
      a.smoothingTimeConstant = 0.4;    // low, so phrasing stays crisp
      a.minDecibels = -100;
      a.maxDecibels = -10;
    }
    midSum.connect(this.midAnalyser);
    sideSum.connect(this.sideAnalyser);

    // Tap post-gain so the visual follows what is actually heard.
    this.gain.connect(this.analyser);
    this.gain.connect(this.harmonyAnalyser);
    this.gain.connect(splitter);
    this.gain.connect(this.ctx.destination);
    return this.ctx;
  }

  async resume() {
    this.ensureContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  async loadArrayBuffer(arrayBuffer, title) {
    this.ensureContext();
    this.stop();
    this.buffer = await this.ctx.decodeAudioData(arrayBuffer);
    this.title = title;
    this._offset = 0;
    if (this.onTrackLoaded) this.onTrackLoaded(this);
    return this.buffer;
  }

  async loadFile(file) {
    const ab = await file.arrayBuffer();
    const title = file.name.replace(/\.[^.]+$/, '');
    return this.loadArrayBuffer(ab, title);
  }

  setBuffer(buffer, title) {
    this.stop();
    this.buffer = buffer;
    this.title = title;
    this._offset = 0;
    if (this.onTrackLoaded) this.onTrackLoaded(this);
  }

  /**
   * Listen to the microphone instead of a file.
   *
   * The mic is connected to the analysers ONLY, never to the destination:
   * routing live input to the speakers is an instant feedback loop through
   * whatever the room can hear.
   */
  async useMicrophone() {
    this.ensureContext();
    await this.resume();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.stop();
    this._micStream = stream;
    this._micSrc = this.ctx.createMediaStreamSource(stream);
    for (const node of [this.analyser, this.harmonyAnalyser, this._splitter]) {
      if (node) this._micSrc.connect(node);
    }
    this.buffer = null;
    this.live = true;
    this.playing = true;
    this.title = 'LIVE INPUT';
    this._liveStart = this.ctx.currentTime;
    if (this.onTrackLoaded) this.onTrackLoaded(this);
    return stream;
  }

  stopMicrophone() {
    if (this._micSrc) { try { this._micSrc.disconnect(); } catch (e) {} this._micSrc = null; }
    if (this._micStream) { for (const t of this._micStream.getTracks()) t.stop(); this._micStream = null; }
    this.live = false;
    this.playing = false;
  }

  play() {
    if (this.live) { this.playing = true; return; }
    if (!this.buffer || this.playing) return;
    this.resume();

    // Release any previous source before starting a new one.
    if (this.source) {
      this.source.onended = null;
      try { this.source.disconnect(); } catch (e) { /* already gone */ }
      this.source = null;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    src.onended = () => {
      // `onended` is dispatched asynchronously, so by the time it runs this
      // source may already have been replaced — pressing play immediately after
      // a track finishes is enough to hit that. A stale handler must not
      // rewind and stop the source that superseded it.
      if (this.source !== src || src._intentionalStop) return;
      this.playing = false;
      this._offset = 0;
      if (this.onEnded) this.onEnded();
    };
    src.start(0, Math.min(this._offset, this.buffer.duration - 0.02));
    this._startedAt = this.ctx.currentTime;
    this.source = src;
    this.playing = true;
  }

  pause() {
    if (this.live) { this.playing = false; return; }
    if (!this.playing) return;
    this._offset = this.currentTime;
    this.stop();
  }

  stop() {
    if (this.source) {
      this.source._intentionalStop = true;
      try { this.source.stop(); } catch (e) { /* already stopped */ }
      this.source.disconnect();
      this.source = null;
    }
    this.playing = false;
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  /** Return to the start without playing. */
  rewind() { this.stop(); this._offset = 0; }

  seek(t) {
    if (!this.buffer) return;
    const target = Math.max(0, Math.min(t, this.buffer.duration - 0.05));
    const wasPlaying = this.playing;
    this.stop();
    this._offset = target;
    if (wasPlaying) this.play();
  }

  setVolume(v) {
    this._volume = v;
    if (this.gain) this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  get volume() { return this._volume; }

  get currentTime() {
    if (this.live) return this.ctx ? this.ctx.currentTime - this._liveStart : 0;
    if (!this.buffer) return 0;
    if (!this.playing) return this._offset;
    return Math.min(this._offset + (this.ctx.currentTime - this._startedAt), this.buffer.duration);
  }

  get duration() { return this.live ? 0 : (this.buffer ? this.buffer.duration : 0); }
  get progress() { return this.duration ? this.currentTime / this.duration : 0; }
}

export function formatTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

/**
 * Loudness pre-scan over the decoded buffer.
 *
 * Returns the scrubber envelope AND a reference level for the analyser. Having
 * a whole-track reference before the first frame is what lets a quiet intro
 * actually look quiet: a running auto-gain has nothing to compare against yet,
 * so it normalises near-silence up to full scale.
 */
export function computePeaks(buffer, bins = 420) {
  const n = buffer.length;
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const step = Math.floor(n / bins) || 1;

  const rms = new Float32Array(bins);
  const width = new Float32Array(bins);
  const high = new Float32Array(bins);

  // One-pole high-pass (~1.5 kHz) over the mid signal. A modern master is
  // compressed so hard that its RMS barely moves between a verse and a chorus,
  // but the top end and the stereo width still open right up — so those carry
  // the structure that level no longer does.
  const alpha = 0.824;
  let hp = 0, prevMid = 0;
  let bi = 0, cnt = 0, sM = 0, sS = 0, sH = 0;
  for (let i = 0; i < n; i++) {
    const mid = (L[i] + R[i]) * 0.5;
    const side = (L[i] - R[i]) * 0.5;
    hp = alpha * (hp + mid - prevMid);
    prevMid = mid;
    sM += mid * mid; sS += side * side; sH += hp * hp;
    if (++cnt >= step && bi < bins) {
      const m = Math.sqrt(sM / cnt), sd = Math.sqrt(sS / cnt);
      rms[bi] = m;
      width[bi] = sd / (m + sd + 1e-9);
      high[bi] = Math.sqrt(sH / cnt);
      bi++; cnt = 0; sM = 0; sS = 0; sH = 0;
    }
  }
  for (; bi < bins; bi++) { rms[bi] = rms[bi - 1] || 0; width[bi] = width[bi - 1] || 0; high[bi] = high[bi - 1] || 0; }

  let max = 1e-6;
  for (let i = 0; i < bins; i++) if (rms[i] > max) max = rms[i];

  // 92nd percentile: the track's loud plateau, immune to a single transient.
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const refRms = Math.max(sorted[Math.floor(bins * 0.92)] || max, 0.008);

  const shaped = new Float32Array(bins);
  for (let i = 0; i < bins; i++) shaped[i] = Math.pow(rms[i] / max, 0.72);
  return { peaks: shaped, rms, width, high, refRms };
}
