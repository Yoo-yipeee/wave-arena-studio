/**
 * Recorder — capture the performance as a shareable clip.
 *
 * Everything stays on the machine: frames and audio are muxed locally and the
 * file is handed straight to the user. Nothing is uploaded anywhere.
 *
 * Two decisions matter for a clip that is actually going to get posted.
 *
 * MP4 is tried first. WebM is the better-supported capture format in browsers
 * and the obvious default, but X/Twitter, Instagram and iOS Photos all reject
 * a .webm upload — so defaulting to it produces a file that plays perfectly on
 * the machine that made it and cannot be shared anywhere.
 *
 * And frames are composited through a 2D canvas rather than captured from the
 * WebGL canvas directly, which costs one blit per frame and buys somewhere to
 * draw the song title and a watermark. A clip that travels without saying
 * where it came from is a clip that brings nobody back.
 */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

const WATERMARK = 'WAVE ARENA';

export class Recorder {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.engine = engine;
    this.recording = false;
    this.startedAt = 0;
    this._chunks = [];
    this._rec = null;
    this._raf = 0;
    this.onState = null;         // (recording, seconds) => void
    this.onClip = null;          // (url, filename, bytes, file) => void
  }

  static get supported() {
    return typeof MediaRecorder !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  get elapsed() { return this.recording ? (performance.now() - this.startedAt) / 1000 : 0; }

  toggle(seconds) { return this.recording ? this.stop() : this.start(seconds); }

  /** @param {number} [seconds] stop automatically after this long */
  start(seconds) {
    if (this.recording || !Recorder.supported) return false;

    const w = this.canvas.width, h = this.canvas.height;
    const comp = this._comp || (this._comp = document.createElement('canvas'));
    comp.width = w; comp.height = h;
    const ctx = comp.getContext('2d');

    const title = (this.engine.title || '').slice(0, 46);
    const scale = Math.max(1, w / 1280);

    const draw = () => {
      ctx.drawImage(this.canvas, 0, 0, w, h);
      ctx.save();
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = '#dff2ff';
      ctx.textBaseline = 'bottom';
      ctx.font = `500 ${Math.round(15 * scale)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.letterSpacing = `${Math.round(4 * scale)}px`;
      ctx.fillText(WATERMARK, Math.round(34 * scale), h - Math.round(34 * scale));
      if (title) {
        ctx.globalAlpha = 0.34;
        ctx.font = `400 ${Math.round(12 * scale)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.letterSpacing = `${Math.round(2 * scale)}px`;
        ctx.fillText(title, Math.round(34 * scale), h - Math.round(58 * scale));
      }
      ctx.restore();
      this._raf = requestAnimationFrame(draw);
    };
    draw();

    const stream = comp.captureStream(60);

    // Tap the audio graph without disturbing playback.
    const actx = this.engine.ctx;
    if (actx && this.engine.gain) {
      if (!this._dest) {
        this._dest = actx.createMediaStreamDestination();
        this.engine.gain.connect(this._dest);
      }
      for (const t of this._dest.stream.getAudioTracks()) stream.addTrack(t);
    }

    const mime = MIME_CANDIDATES.find(m => MediaRecorder.isTypeSupported(m)) || '';
    try {
      this._rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12e6 } : undefined);
    } catch (e) {
      console.error('recorder failed to start', e);
      cancelAnimationFrame(this._raf);
      return false;
    }

    this._chunks.length = 0;
    this._rec.ondataavailable = (e) => { if (e.data && e.data.size) this._chunks.push(e.data); };
    this._rec.onstop = () => {
      cancelAnimationFrame(this._raf);
      const type = this._rec.mimeType || 'video/webm';
      const blob = new Blob(this._chunks, { type });
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      const name = (this.engine.title || 'wave-arena').replace(/[^\w\-]+/g, '_').slice(0, 40) + '.' + ext;
      const url = URL.createObjectURL(blob);
      let file = null;
      try { file = new File([blob], name, { type }); } catch (e) { /* older browsers */ }
      if (this.onClip) this.onClip(url, name, blob.size, file);
    };

    this._rec.start(250);
    this.recording = true;
    this.startedAt = performance.now();
    if (this.onState) this.onState(true, 0);

    if (seconds) {
      clearTimeout(this._auto);
      this._auto = setTimeout(() => this.stop(), seconds * 1000);
    }
    return true;
  }

  stop() {
    if (!this.recording) return false;
    clearTimeout(this._auto);
    this.recording = false;
    try { this._rec.stop(); } catch (e) { /* already stopped */ }
    if (this.onState) this.onState(false, 0);
    return true;
  }
}
