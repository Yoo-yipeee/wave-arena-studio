import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Depth of field, as a tilt-shift band rather than a true depth blur.
 *
 * A real DOF pass needs the depth buffer, which means rendering the scene a
 * second time — and this scene's cost is almost entirely in a very heavy vertex
 * shader, so that would roughly halve the frame rate for an effect that is pure
 * polish. On a near-horizontal water shot, distance correlates almost perfectly
 * with screen height anyway: the far rim sits high in frame, the near rim low.
 * Blurring by distance from a horizontal focus band gives the same read for one
 * cheap pass, which is why tilt-shift has always looked like DOF on landscapes.
 */
const DOF = {
  uniforms: {
    tDiffuse: { value: null },
    uFocus: { value: 0.55 },      // screen-Y of the focus band
    uRange: { value: 0.22 },      // how tall the sharp band is
    uStrength: { value: 1.0 },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uFocus, uRange, uStrength;
    uniform vec2 uTexel;
    varying vec2 vUv;

    void main(){
      float d = abs(vUv.y - uFocus);
      float blur = smoothstep(uRange, uRange + 0.34, d) * uStrength;
      if (blur < 0.004) { gl_FragColor = texture2D(tDiffuse, vUv); return; }

      // 12-tap poisson-ish disc: enough for a soft bokeh at this radius
      vec2 r = uTexel * blur * 9.0;
      vec3 c = texture2D(tDiffuse, vUv).rgb * 0.18;
      c += texture2D(tDiffuse, vUv + vec2( 0.94,  0.34) * r).rgb * 0.082;
      c += texture2D(tDiffuse, vUv + vec2(-0.94, -0.34) * r).rgb * 0.082;
      c += texture2D(tDiffuse, vUv + vec2( 0.34, -0.94) * r).rgb * 0.082;
      c += texture2D(tDiffuse, vUv + vec2(-0.34,  0.94) * r).rgb * 0.082;
      c += texture2D(tDiffuse, vUv + vec2( 0.71,  0.71) * r).rgb * 0.082;
      c += texture2D(tDiffuse, vUv + vec2(-0.71, -0.71) * r).rgb * 0.082;
      c += texture2D(tDiffuse, vUv + vec2( 0.71, -0.71) * r).rgb * 0.082;
      c += texture2D(tDiffuse, vUv + vec2(-0.71,  0.71) * r).rgb * 0.082;
      c += texture2D(tDiffuse, vUv + vec2( 1.60,  0.00) * r).rgb * 0.045;
      c += texture2D(tDiffuse, vUv + vec2(-1.60,  0.00) * r).rgb * 0.045;
      c += texture2D(tDiffuse, vUv + vec2( 0.00,  1.60) * r).rgb * 0.045;
      c += texture2D(tDiffuse, vUv + vec2( 0.00, -1.60) * r).rgb * 0.045;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

/** Grade pass: vignette, edge chromatic aberration, film grain, global fade. */
const GRADE = {
  uniforms: {
    tDiffuse: { value: null },
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
    uniform float uTime, uVignette, uGrain, uAber, uFade;
    varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float d = length(c);
      float k = uAber * 0.006 * d * d;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * k).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * k).b;
      col *= 1.0 - uVignette * smoothstep(0.30, 1.05, d);
      float g = fract(sin(dot(uv * vec2(97.3, 131.7) + uTime * 0.41, vec2(12.9898, 78.233))) * 43758.5453);
      col += (g - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, 0.0) * uFade, 1.0);
    }
  `,
};

export function detectQuality() {
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua)
    || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
  const small = Math.min(window.innerWidth, window.innerHeight) < 620;
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;

  if (mobile || small || weak) {
    return {
      tier: 'low', rings: 104, segments: 200, lineStep: 3,
      particles: 800, particleSize: 2.4, maxDpr: 1.5,
      antialias: false, bloomRes: 0.5,
    };
  }
  return {
    tier: 'high', rings: 190, segments: 384, lineStep: 3,
    particles: 1900, particleSize: 2.1, maxDpr: 2,
    antialias: true, bloomRes: 1,
  };
}

export class Stage {
  constructor(canvas, quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.antialias,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.setClearColor(0x000208, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 900);
    this.camera.position.set(0, 14, 40);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.60, 0.62);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.dof = new ShaderPass(DOF);
    this.composer.addPass(this.dof);

    this.grade = new ShaderPass(GRADE);
    this.grade.renderToScreen = true;
    this.composer.addPass(this.grade);

    this.fade = 0;         // 0 = black, 1 = fully visible
    this.ready = false;
    this.resize();
    window.addEventListener('resize', () => this.resize(), { passive: true });

    // A window resize event never fires for a container that is simply laid out
    // late, so watch the canvas itself and pick up its real size when it lands.
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas);
    }
  }

  get pixelRatio() { return Math.min(window.devicePixelRatio || 1, this.quality.maxDpr); }

  resize() {
    // Never let a dimension reach zero. The constructor sizes the stage
    // immediately, and in a hidden iframe or a container that has not been laid
    // out yet the viewport reads 0 — which builds zero-sized render targets and
    // makes every draw fail with an incomplete framebuffer until some later
    // resize happens to rescue it.
    const w = Math.max(1, window.innerWidth | 0);
    const h = Math.max(1, window.innerHeight | 0);
    this.ready = w > 1 && h > 1;

    const pr = this.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.setSize(
      Math.max(1, Math.round(w * this.quality.bloomRes)),
      Math.max(1, Math.round(h * this.quality.bloomRes)),
    );
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.onResize) this.onResize(pr);
  }

  render(dt, perf) {
    // Nothing to draw into yet; drawing anyway just logs GL errors every frame.
    if (!this.ready) return;
    this.grade.uniforms.uTime.value += dt;
    this.grade.uniforms.uFade.value = this.fade;
    this.bloom.strength = 0.26 + perf.bloom * 0.26 + perf.eruption * 0.34;
    this.bloom.radius = 0.52 + perf.intensity * 0.22;
    this.bloom.threshold = 0.74 - perf.heat * 0.12;
    // Focus follows the water: the horizon sits higher in frame on a wide shot.
    this.dof.uniforms.uFocus.value += ((perf.focusY ?? 0.55) - this.dof.uniforms.uFocus.value) * 0.06;
    this.dof.uniforms.uStrength.value = this.quality.tier === 'low' ? 0.55 : 1.0;
    this.composer.render(dt);
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
