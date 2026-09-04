import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * FINAL — depth of field, tone mapping, colour space and grade in ONE pass.
 *
 * This used to be four passes: bloom -> OutputPass -> DOF -> grade. Measured on
 * an Intel Iris Xe at 2880x1620 that chain cost 38ms of a 57ms frame, and the
 * three post passes alone cost 12-13ms EACH while doing almost no arithmetic.
 * The reason is bandwidth, not maths: every full-screen pass reads and writes a
 * half-float RGBA buffer, which at that resolution is ~75MB of memory traffic
 * per pass, and an integrated GPU shares that bandwidth with the CPU. The
 * number of texture taps barely matters. The number of PASSES is everything.
 *
 * So the taps here are cheap and the passes are not, and all three collapse.
 *
 * Order is deliberate: blur first, in linear HDR, then tone map, then encode,
 * then grade. Blurring before tone mapping is also the physically sensible
 * order — an out-of-focus highlight should spread its real energy and only then
 * be rolled off, which is what makes a bright crest go soft instead of grey.
 */
const FINAL = {
  uniforms: {
    tDiffuse: { value: null },
    uFocus: { value: 0.55 },      // screen-Y of the focus band
    uRange: { value: 0.22 },      // how tall the sharp band is
    uStrength: { value: 1.0 },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uExposure: { value: 1.25 },
    uTime: { value: 0 },
    uVignette: { value: 0.62 },
    uGrain: { value: 0.028 },
    uAber: { value: 0.9 },
    uFade: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uFocus, uRange, uStrength, uExposure;
    uniform float uTime, uVignette, uGrain, uAber, uFade;
    uniform vec2 uTexel;
    varying vec2 vUv;

    // Eight-point disc, offsets paired opposite so the kernel stays symmetric
    // and a crest does not appear to drift as it goes out of focus.
    const vec2 D0 = vec2( 0.94,  0.34);
    const vec2 D1 = vec2(-0.94, -0.34);
    const vec2 D2 = vec2( 0.34, -0.94);
    const vec2 D3 = vec2(-0.34,  0.94);
    const vec2 D4 = vec2( 0.71,  0.71);
    const vec2 D5 = vec2(-0.71, -0.71);
    const vec2 D6 = vec2( 1.55,  0.00);
    const vec2 D7 = vec2( 0.00, -1.55);

    vec3 discBlur(vec2 uv, vec2 r) {
      vec3 c = texture2D(tDiffuse, uv).rgb * 0.20;
      c += texture2D(tDiffuse, uv + D0 * r).rgb * 0.115;
      c += texture2D(tDiffuse, uv + D1 * r).rgb * 0.115;
      c += texture2D(tDiffuse, uv + D2 * r).rgb * 0.115;
      c += texture2D(tDiffuse, uv + D3 * r).rgb * 0.115;
      c += texture2D(tDiffuse, uv + D4 * r).rgb * 0.095;
      c += texture2D(tDiffuse, uv + D5 * r).rgb * 0.095;
      c += texture2D(tDiffuse, uv + D6 * r).rgb * 0.075;
      c += texture2D(tDiffuse, uv + D7 * r).rgb * 0.075;
      return c;
    }

    // three.js ACESFilmicToneMapping, reproduced so the OutputPass that used to
    // apply it can be dropped. Matching it exactly matters — the whole palette
    // was tuned through this curve.
    vec3 RRTAndODTFit(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 acesFilmic(vec3 color) {
      const mat3 IN = mat3(
        0.59719, 0.07600, 0.02840,
        0.35458, 0.90834, 0.13383,
        0.04823, 0.01566, 0.83777);
      const mat3 OUT = mat3(
         1.60475, -0.10208, -0.00327,
        -0.53108,  1.10813, -0.07276,
        -0.07367, -0.00605,  1.07602);
      color *= uExposure / 0.6;
      color = IN * color;
      color = RRTAndODTFit(color);
      color = OUT * color;
      return clamp(color, 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c) {
      return mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92,
                 vec3(lessThanEqual(c, vec3(0.0031308))));
    }

    void main(){
      vec2 uv = vUv;
      vec2 ctr = uv - 0.5;
      float d = length(ctr);

      float blur = smoothstep(uRange, uRange + 0.34, abs(uv.y - uFocus)) * uStrength;
      float k = uAber * 0.006 * d * d;

      vec3 col;
      if (blur < 0.004) {
        // The sharp band takes three taps at most, and one where there is no
        // fringe either. More than half the frame goes down this path.
        if (k < 0.00002) {
          col = texture2D(tDiffuse, uv).rgb;
        } else {
          col = vec3(
            texture2D(tDiffuse, uv + ctr * k).r,
            texture2D(tDiffuse, uv).g,
            texture2D(tDiffuse, uv - ctr * k).b);
        }
      } else {
        vec2 r = uTexel * blur * 9.0;
        // The fringe offsets the whole sample disc per channel, so blur and
        // aberration compose instead of fighting. Laying a sharp fringe over a
        // blurred image is what makes cheap chromatic aberration read as a bug.
        vec3 g = discBlur(uv, r);
        if (k < 0.00002) {
          col = g;
        } else {
          col = vec3(discBlur(uv + ctr * k, r).r, g.g, discBlur(uv - ctr * k, r).b);
        }
      }

      col = toSRGB(acesFilmic(col));
      col *= 1.0 - uVignette * smoothstep(0.30, 1.05, d);
      float gr = fract(sin(dot(uv * vec2(97.3, 131.7) + uTime * 0.41, vec2(12.9898, 78.233))) * 43758.5453);
      col += (gr - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, 0.0) * uFade, 1.0);
    }
  `,
};

/**
 * A starting guess at what this machine can do, refined at runtime.
 *
 * It is only a guess: user agent and core count say almost nothing about GPU
 * fill rate, and the two machines this most needs to get right — a thin laptop
 * with integrated graphics, and a phone — are exactly the ones that look
 * capable on paper. QualityGovernor below measures the truth and corrects it,
 * so this has only to be roughly right, and must never be catastrophically
 * wrong in the direction of asking for too much.
 */
export function detectQuality() {
  const ua = navigator.userAgent;
  // A viewport of zero means the document has not been laid out yet. That used
  // to read as "tiny screen" and locked a desktop into the low tier for the
  // whole session, which is why this build could come up soft on a good
  // machine. With no real measurement, assume desktop and let the governor take
  // it back if that was optimistic.
  const w = window.innerWidth || document.documentElement.clientWidth || 0;
  const h = window.innerHeight || document.documentElement.clientHeight || 0;

  const mobile = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua)
    || (navigator.maxTouchPoints > 1 && w > 0 && w < 1100);
  const small = w > 0 && h > 0 && Math.min(w, h) < 620;
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;

  if (mobile || small || weak) {
    return {
      tier: 'low', rings: 104, segments: 200, lineStep: 3,
      particles: 700, particleSize: 2.4, maxDpr: 1.15,
      bloomRes: 0.35, causticGrid: 80,
    };
  }
  return {
    tier: 'high', rings: 168, segments: 320, lineStep: 3,
    particles: 1500, particleSize: 2.1, maxDpr: 1.5,
    // Bloom is a blur. Computing it at full resolution and then blurring it is
    // paying twice for the same softness — at 0.4 it is indistinguishable and
    // the pass runs six times cheaper.
    bloomRes: 0.4, causticGrid: 112,
  };
}

export class Stage {
  constructor(canvas, quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // The scene is never drawn to the default framebuffer — every pixel goes
      // through the composer — so an MSAA backbuffer was being allocated and
      // then thrown away. It cost memory and bandwidth and antialiased nothing.
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      depth: true,
    });
    this.renderer.setClearColor(0x000208, 1);
    // Tone mapping happens in FINAL now. Leaving it on here would apply the
    // curve twice to anything three tone maps itself.
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 900);
    this.camera.position.set(0, 14, 40);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.60, 0.62);
    this.composer.addPass(this.bloom);

    this.final = new ShaderPass(FINAL);
    this.final.renderToScreen = true;
    this.composer.addPass(this.final);

    this.fade = 0;         // 0 = black, 1 = fully visible
    this.ready = false;
    this.dprScale = 1;     // the governor's multiplier on maxDpr
    this.lost = false;
    this.resize();
    window.addEventListener('resize', () => this.resize(), { passive: true });

    // A window resize event never fires for a container that is simply laid out
    // late, so watch the canvas itself and pick up its real size when it lands.
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas);
    }

    // A dropped GL context is otherwise a permanently black canvas with nothing
    // in the console to say why. Integrated GPUs drop it under exactly the load
    // this scene used to create, so this is not a theoretical case.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      if (this.onContextLost) this.onContextLost();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.resize();
      if (this.onContextRestored) this.onContextRestored();
    });
  }

  get pixelRatio() {
    return Math.max(0.6, Math.min(window.devicePixelRatio || 1, this.quality.maxDpr) * this.dprScale);
  }

  resize() {
    // Never let a dimension reach zero. In a hidden iframe, or a container that
    // has not been laid out yet, the viewport reads 0 — which builds zero-sized
    // render targets and makes every draw fail with an incomplete framebuffer
    // until some later resize happens to rescue it.
    const w = Math.max(1, window.innerWidth | 0);
    const h = Math.max(1, window.innerHeight | 0);
    this.ready = w > 1 && h > 1;

    const pr = this.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.setSize(
      Math.max(1, Math.round(w * pr * this.quality.bloomRes)),
      Math.max(1, Math.round(h * pr * this.quality.bloomRes)),
    );
    this.final.uniforms.uTexel.value.set(1 / Math.max(1, w * pr), 1 / Math.max(1, h * pr));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.onResize) this.onResize(pr);
  }

  render(dt, perf) {
    // Nothing to draw into yet; drawing anyway just logs GL errors every frame.
    if (!this.ready || this.lost) return;
    const u = this.final.uniforms;
    u.uTime.value += dt;
    u.uFade.value = this.fade;
    this.bloom.strength = 0.26 + perf.bloom * 0.26 + perf.eruption * 0.34;
    this.bloom.radius = 0.52 + perf.intensity * 0.22;
    this.bloom.threshold = 0.74 - perf.heat * 0.12;
    // Focus follows the water: the horizon sits higher in frame on a wide shot.
    u.uFocus.value += ((perf.focusY ?? 0.55) - u.uFocus.value) * 0.06;
    u.uStrength.value = this.quality.tier === 'low' ? 0.55 : 1.0;
    this.composer.render(dt);
  }
}

/**
 * QualityGovernor — hold the frame rate, spend whatever is left over on looks.
 *
 * A quality tier guessed from the user agent is a claim about hardware that is
 * wrong often enough to matter, and when it is wrong there is no recovery: the
 * arena simply runs at fifteen frames a second for the rest of the session.
 * Measuring is strictly better, because the thing actually worth protecting is
 * not a resolution or an effect, it is the frame rate that makes water look
 * like water. Choppy water does not read as water at any resolution.
 *
 * The budget is spent in the order things are missed least: internal resolution
 * first (the image is soft, bloomed and grainy by design, so this costs almost
 * nothing visually), then the caustics, then the reflection. Steps down are
 * quick and steps back up are slow and need real headroom, so one stutter
 * cannot start an oscillation.
 */
const STEPS = [
  { dpr: 1.00, caustics: true,  reflect: true },
  { dpr: 0.82, caustics: true,  reflect: true },
  { dpr: 0.70, caustics: true,  reflect: true },
  { dpr: 0.70, caustics: false, reflect: true },
  { dpr: 0.58, caustics: false, reflect: true },
  { dpr: 0.58, caustics: false, reflect: false },
];

export class QualityGovernor {
  constructor(stage, arena) {
    this.stage = stage;
    this.arena = arena;
    // Start one step down rather than at the top. Opening soft and sharpening
    // within a few seconds is a far better first impression than opening at
    // fifteen frames a second and recovering — the second one has already told
    // the viewer the page is broken. A machine with headroom climbs to full
    // almost immediately; one without never had it to spend.
    this.level = 1;
    this.ms = 16.7;
    this._hold = 2.0;      // settle before judging; startup frames are not typical
    this._good = 0;
    this.enabled = true;
    this.onChange = null;
    this._apply(this.level);
  }

  /** @param {number} rawDt unclamped seconds since the previous frame */
  update(rawDt) {
    if (!this.enabled) return;
    // A backgrounded tab, or a decode that blocked the main thread, produces a
    // huge dt that says nothing at all about how fast the GPU is.
    if (rawDt > 0.5) { this._hold = 1.0; return; }
    this.ms += (rawDt * 1000 - this.ms) * 0.06;

    if (this._hold > 0) { this._hold -= rawDt; return; }

    if (this.ms > 26 && this.level < STEPS.length - 1) {
      this._apply(this.level + 1);
      this._hold = 1.6;
      this._good = 0;
    } else if (this.ms < 13.5 && this.level > 0) {
      // Only climb back after a sustained stretch of genuine headroom.
      this._good += rawDt;
      if (this._good > 6) { this._apply(this.level - 1); this._hold = 2.5; this._good = 0; }
    } else {
      this._good = 0;
    }
  }

  _apply(level) {
    this.level = level;
    const s = STEPS[level];
    this.stage.dprScale = s.dpr;
    this.stage.resize();
    this.arena.setCausticsAllowed(s.caustics);
    this.arena.setReflectionAllowed(s.reflect);
    if (this.onChange) this.onChange(level, s);
  }

  describe() {
    return {
      level: this.level, ms: +this.ms.toFixed(1),
      fps: Math.round(1000 / this.ms), step: STEPS[this.level],
    };
  }
}

/**
 * Shot vocabulary.
 *
 * `distMul`/`heightMul` scale whatever framing the section already asked for,
 * so a shot is a lens on the performance rather than a fixed position that
 * would override it. `focusY` tells the DOF pass where the water sits in frame
 * for that angle.
 */
const SHOTS = {
  wide:     { distMul: 1.14, heightMul: 1.15, fovAdd: -2, focusY: 0.55, hold: 9 },
  low:      { distMul: 0.80, heightMul: 0.30, fovAdd: 7,  focusY: 0.46, hold: 6 },
  overhead: { distMul: 0.72, heightMul: 3.10, fovAdd: 2,  focusY: 0.50, hold: 7 },
  close:    { distMul: 0.66, heightMul: 0.72, fovAdd: 9,  focusY: 0.50, hold: 5 },
};

/**
 * CinematicCamera — the arena is the hero; the camera only breathes with it.
 *
 * It also CUTS. A single unbroken orbit is screensaver language: nothing ever
 * arrives, because the eye has already seen where the camera is going. Music
 * video language is to cut on the downbeat of a change — so a drop cuts low to
 * the surface where the water towers over the lens, and a breakdown cuts
 * overhead, which is the only angle that shows the interference pattern the
 * twelve harmonic sources are making.
 */
export class CinematicCamera {
  constructor(camera) {
    this.cam = camera;
    this.az = Math.PI * 0.5;
    this.dist = 30;
    this.height = 5;
    this.fov = 38;
    this.shake = 0;
    this.push = 0;
    this.target = new THREE.Vector3(0, 1.4, 0);
    this._t = 0;
    this._look = new THREE.Vector3(0, 1.4, 0);

    // When false the camera never cuts: one unbroken, slowly evolving framing.
    // Calmer, and better for long listening; the cutting version is better for
    // a clip. Which one is right is a matter of taste, so it is a setting.
    this.cuts = true;
    this.shot = 'wide';
    this._shotHeld = 0;
    this._cutFlash = 0;
    this.focusY = 0.55;
  }

  /** Hard cut to a shot. Ignored if the current one has not had its hold. */
  cut(name, force = false) {
    if (!this.cuts) return false;
    const cur = SHOTS[this.shot];
    if (!force && this._shotHeld < (cur ? cur.hold : 6)) return false;
    if (name === this.shot) return false;
    this.shot = name;
    this._shotHeld = 0;
    this._cutFlash = 1;
    // A cut is instantaneous: jump the rig rather than easing, or it reads as
    // a swoop, which is the opposite of what a cut is for.
    this.az += 1.9 + Math.random() * 2.2;
    this._snap = true;
    return true;
  }

  /** Pick a shot appropriate to what just happened. */
  cutFor(evType, section) {
    if (!this.cuts) return false;
    if (evType === 'drop') return this.cut(Math.random() < 0.62 ? 'low' : 'close', true);
    if (evType === 'settle') return this.cut('overhead');
    if (evType === 'surge') return this.cut(Math.random() < 0.5 ? 'close' : 'wide');
    if (section === 'break' || section === 'intro') return this.cut('overhead');
    return this.cut(Math.random() < 0.5 ? 'wide' : 'low');
  }

  /** Short cinematic shove — used on drops and section changes. */
  impulse(strength = 1) {
    this.shake = Math.min(1.4, this.shake + strength);
    this.push = Math.min(1.2, this.push + strength * 0.85);
  }

  update(dt, perf, music, dtSmooth = dt) {
    this._t += dt;
    const t = this._t;

    // slow orbit — faster when the arena is energetic, never fast enough to notice
    this.az += dt * (0.026 + perf.intensity * 0.05);

    this.push *= Math.exp(-dtSmooth * 1.35);
    this.shake *= Math.exp(-dtSmooth * 2.2);

    // A portrait viewport sees far less width, so the arena has to sit further
    // back to stay whole. Without this the water crops to the frame edges on
    // phones and stops reading as an object in a space.
    const aspectComp = 1 + Math.max(0, 1.25 - this.cam.aspect) * 0.55;

    const shot = SHOTS[this.shot] || SHOTS.wide;
    this._shotHeld += dt;
    this._cutFlash *= Math.exp(-dt * 6);
    this.focusY += (shot.focusY - this.focusY) * (1 - Math.exp(-dtSmooth * 2.0));

    // A cut lands immediately; everything after it eases as usual.
    const k = this._snap ? 1 : 1 - Math.exp(-dtSmooth * 1.6);
    this._snap = false;
    this.dist += (perf.camDist * aspectComp * shot.distMul - this.push * 4.6 - this.dist) * k;

    // Skimming the surface only works while the lens stays ABOVE it. A low
    // angle set as a fixed fraction of the section height put the camera
    // underwater the moment a chorus grew, and the shot went black.
    const crestTop = perf.height * 2.7 + 1.6;
    const wantHeight = Math.max(perf.camHeight * shot.heightMul, crestTop);
    this.height += (wantHeight - this.height) * k;
    this.fov += (perf.fov + shot.fovAdd - this.fov) * (this._snap ? 1 : 1 - Math.exp(-dtSmooth * 2.4));

    // handheld micro-motion, layered so it never reads as a loop
    const hx = Math.sin(t * 0.37) * 0.28 + Math.sin(t * 0.91 + 1.3) * 0.14;
    const hy = Math.sin(t * 0.29 + 2.1) * 0.22 + Math.sin(t * 0.73) * 0.10;

    // beat-locked shake, strongest during drops
    const s = this.shake * (0.5 + perf.intensity);
    const sx = (Math.sin(t * 41.0) + Math.sin(t * 27.3)) * 0.5 * s * 0.34;
    const sy = (Math.sin(t * 33.7) + Math.sin(t * 51.1)) * 0.5 * s * 0.26;

    const x = Math.cos(this.az) * this.dist + hx + sx;
    const z = Math.sin(this.az) * this.dist + hx * 0.4;
    const y = this.height + hy + sy + music.bass * 0.5;

    this.cam.position.set(x, y, z);

    // look slightly above the surface; lift the framing when the arena erupts
    const ty = 1.2 + perf.intensity * 2.4 + perf.eruption * 3.0;
    this._look.x += (hx * 0.3 - this._look.x) * (1 - Math.exp(-dtSmooth * 2));
    this._look.y += (ty - this._look.y) * (1 - Math.exp(-dtSmooth * 1.2));
    this._look.z += (0 - this._look.z) * (1 - Math.exp(-dtSmooth * 2));
    this.cam.lookAt(this._look);

    if (Math.abs(this.cam.fov - this.fov) > 0.01) {
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
