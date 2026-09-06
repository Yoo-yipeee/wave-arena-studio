import * as THREE from 'three';
import { createFieldUniforms } from './shaders/field.js';
import {
  SURFACE_VERT, SURFACE_FRAG, LINE_VERT, LINE_FRAG,
  POINTS_VERT, POINTS_FRAG, BACKDROP_VERT, BACKDROP_FRAG,
  CAUSTIC_VERT, CAUSTIC_FRAG,
} from './shaders/materials.js';
import { SPECTRUM_BINS } from '../analysis/MusicAnalyser.js';
import { FORM_COUNT } from '../performance/Primitives.js';

const PALETTE = {
  deep: new THREE.Color(0x01060d),
  mid:  new THREE.Color(0x1273c4),
  hot:  new THREE.Color(0xcaf0ff),
  backTop: new THREE.Color(0x000106),
  backBottom: new THREE.Color(0x01050b),
  glow: new THREE.Color(0x06243f),
};


/**
 * WaterArena — every renderable in the performance.
 *
 * Body, contour lines, their mirrored twins, mist and backdrop all share one
 * uniform block, so a single field update moves the entire arena coherently.
 */
export class WaterArena {
  constructor(scene, quality) {
    this.radius = 26;
    this.quality = quality;

    const rings = quality.rings;
    const segments = quality.segments;
    const lineStep = quality.lineStep;

    // ---- spectrum texture ---------------------------------------------------
    this.spectrumData = new Uint8Array(SPECTRUM_BINS);
    this.spectrumTex = new THREE.DataTexture(this.spectrumData, SPECTRUM_BINS, 1, THREE.RedFormat);
    this.spectrumTex.minFilter = THREE.LinearFilter;
    this.spectrumTex.magFilter = THREE.LinearFilter;
    this.spectrumTex.wrapS = THREE.ClampToEdgeWrapping;
    this.spectrumTex.needsUpdate = true;

    this.U = createFieldUniforms(THREE, this.spectrumTex, this.radius);
    // 12 pitch classes. A plain uniform array, not a texture — see field.js.
    this.chromaData = this.U.uChromaV.value;
    this._tone = PALETTE.mid.clone();
    this._toneTarget = PALETTE.mid.clone();
    this._foamC = new THREE.Color(0xdff2ff);
    this.identity = null;
    this._pal = null;

    // ---- shared polar geometry ---------------------------------------------
    const { positionAttr, triIndex, lineIndex } = buildPolarDisc(rings, segments, this.radius, lineStep);

    const bodyGeo = new THREE.BufferGeometry();
    bodyGeo.setAttribute('position', positionAttr);
    bodyGeo.setIndex(triIndex);
    // The field displaces far beyond the flat disc; skip auto-culling entirely.
    bodyGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.radius * 3);

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', positionAttr);      // shared buffer, different index
    lineGeo.setIndex(lineIndex);
    lineGeo.boundingSphere = bodyGeo.boundingSphere;

    // ---- materials ----------------------------------------------------------
    const surfaceUniforms = (reflect) => Object.assign({}, this.U, {
      uDeep: { value: PALETTE.deep.clone() },
      uMid: { value: PALETTE.mid.clone() },
      uHot: { value: PALETTE.hot.clone() },
      uOpacity: { value: 0.9 },
      uHeat: { value: 0 },
      uGloss: { value: 0.6 },
      uFoamC: { value: new THREE.Color(0xdff2ff) },
      uFoamAmt: { value: 0.85 },
      uSSS: { value: 0.9 },
      uReflect: { value: reflect },
    });
    const lineUniforms = (reflect) => Object.assign({}, this.U, {
      uMid: { value: PALETTE.mid.clone() },
      uHot: { value: PALETTE.hot.clone() },
      uOpacity: { value: 0.5 },
      uHeat: { value: 0 },
      uReflect: { value: reflect },
    });

    this.bodyMat = new THREE.ShaderMaterial({
      uniforms: surfaceUniforms(0), vertexShader: SURFACE_VERT, fragmentShader: SURFACE_FRAG,
      transparent: true, depthWrite: true, depthTest: true, side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    this.bodyReflMat = new THREE.ShaderMaterial({
      uniforms: surfaceUniforms(1), vertexShader: SURFACE_VERT, fragmentShader: SURFACE_FRAG,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    this.lineMat = new THREE.ShaderMaterial({
      uniforms: lineUniforms(0), vertexShader: LINE_VERT, fragmentShader: LINE_FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    this.lineReflMat = new THREE.ShaderMaterial({
      uniforms: lineUniforms(1), vertexShader: LINE_VERT, fragmentShader: LINE_FRAG,
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    // ---- meshes -------------------------------------------------------------
    this.body = new THREE.Mesh(bodyGeo, this.bodyMat);
    this.body.frustumCulled = false;
    this.body.renderOrder = 1;

    this.lines = new THREE.LineSegments(lineGeo, this.lineMat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 2;

    // mirrored twins — the arena stands on its own reflection
    this.bodyRefl = new THREE.Mesh(bodyGeo, this.bodyReflMat);
    this.bodyRefl.scale.y = -1;
    this.bodyRefl.position.y = -0.06;
    this.bodyRefl.frustumCulled = false;
    this.bodyRefl.renderOrder = 0;

    this.linesRefl = new THREE.LineSegments(lineGeo, this.lineReflMat);
    this.linesRefl.scale.y = -1;
    this.linesRefl.position.y = -0.06;
    this.linesRefl.frustumCulled = false;
    this.linesRefl.renderOrder = 0;

    // ---- atmosphere ---------------------------------------------------------
    const pCount = quality.particles;
    const pPos = new Float32Array(pCount * 3);
    const pSeed = new Float32Array(pCount);
    for (let i = 0; i < pCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = this.radius * Math.sqrt(Math.random()) * 0.92;
      pPos[i * 3] = Math.cos(a) * r;
      pPos[i * 3 + 1] = 0;
      pPos[i * 3 + 2] = Math.sin(a) * r;
      pSeed[i] = Math.random();
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('aSeed', new THREE.BufferAttribute(pSeed, 1));
    pGeo.boundingSphere = bodyGeo.boundingSphere;

    this.mistMat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, this.U, {
        uMist: { value: 0.2 },
        uSpray: { value: 0 },
        uSize: { value: quality.particleSize },
        uPixelRatio: { value: 1 },
        uMidC: { value: new THREE.Color(0x2a7fc0) },
        uHotC: { value: new THREE.Color(0xd6f4ff) },
      }),
      vertexShader: POINTS_VERT, fragmentShader: POINTS_FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    this.mist = new THREE.Points(pGeo, this.mistMat);
    this.mist.frustumCulled = false;
    this.mist.renderOrder = 3;

    // ---- caustics on the floor ---------------------------------------------
    // Light focused through the surface onto the bottom. It puts something
    // BELOW the water instead of only a mirror, which is most of what makes a
    // pool read as having depth rather than being a sheet.
    // The caustic vertex shader evaluates the height field FIVE times per
    // vertex to take a laplacian, so this grid is the single most expensive
    // number in the arena: at 168 it cost more field evaluations than the water
    // body itself. The result is a soft, blurred, additive pattern, so a coarser
    // grid is very nearly invisible and pays for itself several times over.
    const cGrid = quality.causticGrid || (quality.tier === 'low' ? 80 : 112);
    const cGeo = new THREE.PlaneGeometry(this.radius * 2.3, this.radius * 2.3, cGrid, cGrid);
    cGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.radius * 3);
    this.causticMat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, this.U, {
        uFloorY: { value: -7.5 },
        uCausticGain: { value: 2.2 },
        uCausticAmt: { value: 0.5 },
        uCausticC: { value: new THREE.Color(0x9fd9ff) },
      }),
      vertexShader: CAUSTIC_VERT, fragmentShader: CAUSTIC_FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.caustics = new THREE.Mesh(cGeo, this.causticMat);
    this.caustics.frustumCulled = false;
    this.caustics.renderOrder = -0.5;

    // ---- backdrop -----------------------------------------------------------
    this.backdropMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: PALETTE.backTop.clone() },
        uBottom: { value: PALETTE.backBottom.clone() },
        uGlow: { value: PALETTE.glow.clone() },
        uGlowStrength: { value: 0.5 },
        uTime: { value: 0 },
      },
      vertexShader: BACKDROP_VERT, fragmentShader: BACKDROP_FRAG,
      side: THREE.BackSide, depthWrite: false,
    });
    this.backdrop = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 24), this.backdropMat);
    this.backdrop.renderOrder = -1;

    scene.add(this.backdrop, this.caustics, this.bodyRefl, this.linesRefl, this.body, this.lines, this.mist);

  }

  setPixelRatio(pr) { this.mistMat.uniforms.uPixelRatio.value = pr; }

  /**
   * Visibility has two independent owners: the viewer, who picked a setting,
   * and the governor, which is trying to hold the frame rate. Both have to
   * agree before something is drawn, or whichever spoke last wins and toggling
   * a setting silently undoes a performance decision (or the reverse).
   */
  setCausticsAllowed(on) { this._causticsOk = on; this._syncVisibility(); }
  setCausticsWanted(on) { this._causticsWant = on; this._syncVisibility(); }
  setReflectionAllowed(on) { this._reflectOk = on; this._syncVisibility(); }

  _syncVisibility() {
    this.caustics.visible = this._causticsOk !== false && this._causticsWant !== false;
    const r = this._reflectOk !== false;
    this.bodyRefl.visible = r;
    this.linesRefl.visible = r;
  }

  /** Hand the arena the song's world. */
  setIdentity(identity) {
    this.identity = identity;
    this._pal = identity.palette();
    const m = identity.material();
    // A wide, dynamic record earns a wider pool; a broken one foams more.
    this.mistMat.uniforms.uSize.value = this.quality.particleSize * (0.8 + m.spray * 0.7);
  }

  /** Push a frame of music + choreography into the field. */
  update(dt, music, perf, awake, dtSmooth = dt) {
    const U = this.U;
    U.uTime.value += dt;

    U.uAmp.value = music.amplitude;
    U.uMids.value = music.mids;
    U.uHighs.value = music.highs;

    // perf.height is already in world units — the field is normalised so this
    // is simply "how tall are the crests right now".
    U.uScale.value = perf.height;
    U.uComplexity.value = perf.complexity;
    U.uChaos.value = perf.chaos;
    // ---- how the water moves, from the tempo alone -------------------------
    //
    // Wave motion is a property of the SONG, not of the moment. Energy changes
    // how BIG the waves are; it does not change how fast water travels, any
    // more than shouting makes the sea quicker. Driving speed from a live
    // per-frame reading is what let a chorus outrun its own verse and what let
    // a 63 BPM ballad move faster than a 125 BPM rock track.
    //
    // Two numbers, both from tempo, both held steady for the whole song:
    //
    //   uLambda   how long the waves are. Slow song, long waves.
    //   uGravity  chosen so the dominant swell takes exactly TWO BEATS to pass.
    //
    // Everything else follows from omega = sqrt(g*k) in the shader, so the
    // whole surface is automatically coherent: the long swells roll at the
    // song's pulse and the small chop rides on top at its own correct rate.
    const bpm = Math.min(170, Math.max(50,
      (this.identity && this.identity.bpmOffline > 40) ? this.identity.bpmOffline
        : (music.bpm > 40 ? music.bpm : 110)));
    const lam = Math.min(1.55, Math.max(0.72, 1.55 - bpm / 150));
    const beatsPerSwell = 2.0;
    const w0 = (2 * Math.PI) / ((60 / bpm) * beatsPerSwell);
    const lam0 = 15.0 * lam;                       // the dominant swell
    const grav = w0 * w0 * lam0 / (2 * Math.PI);   // invert omega = sqrt(g*k)

    U.uLambda.value += (lam - U.uLambda.value) * (1 - Math.exp(-dt * 0.5));
    U.uGravity.value += (grav - U.uGravity.value) * (1 - Math.exp(-dt * 0.5));
    U.uRingRadius.value = perf.ringRadius;
    U.uEruption.value = perf.eruption;
    U.uShock.value = perf.shock;
    U.uAwake.value = awake;
    // Colour is keyed to how tall the water is *expected* to be right now, so a
    // calm section still reads as luminous water rather than fading to black.
    // Crest reference. Too low and every wave saturates to white, losing the
    // dark troughs that give water its depth; too high and it all goes flat.
    const href = Math.max(0.7, perf.height * 1.55);
    U.uHeightRef.value += (href - U.uHeightRef.value) * (1 - Math.exp(-dtSmooth * 1.4));

    for (let i = 0; i < FORM_COUNT; i++) U.uForm.value[i] = perf.forms[i];

    // ---- harmony -----------------------------------------------------------
    const h = music.harmony;
    if (h) {
      const c = h.chroma;
      for (let i = 0; i < 12; i++) {
        this.chromaData[i] = Math.max(0, Math.min(1, c[i]));
      }

      // Assigned, not interpolated: the tonic is circular, so easing from 11.9
      // to 0.1 would sweep the long way round and visibly spin the arena. It is
      // already smoothed around the circle inside HarmonyAnalyser.
      U.uTonic.value = h.tonic;
      U.uMode.value += (h.mode - U.uMode.value) * (1 - Math.exp(-dt * 0.8));

      // Colour comes from the song's identity, not from the moment. The live
      // reading only nudges lightness, so the world stays recognisably itself
      // while still breathing with the music.
    }

    if (this.identity) {
      const p2 = this._pal;
      const lift = 0.82 + perf.intensity * 0.35;
      this._toneTarget.setRGB(p2.mid.r * lift, p2.mid.g * lift, p2.mid.b * lift);
      this._tone.lerp(this._toneTarget, 1 - Math.exp(-dt * 0.6));

      for (const mat of [this.bodyMat, this.bodyReflMat, this.lineMat, this.lineReflMat]) {
        mat.uniforms.uMid.value.copy(this._tone);
      }
      this.bodyMat.uniforms.uDeep.value.setRGB(p2.deep.r, p2.deep.g, p2.deep.b);
      this.bodyReflMat.uniforms.uDeep.value.setRGB(p2.deep.r, p2.deep.g, p2.deep.b);
      for (const mat of [this.bodyMat, this.bodyReflMat, this.lineMat, this.lineReflMat]) {
        mat.uniforms.uHot.value.setRGB(p2.hot.r, p2.hot.g, p2.hot.b);
      }
      this.backdropMat.uniforms.uGlow.value.setRGB(p2.glow.r, p2.glow.g, p2.glow.b);
      this.mistMat.uniforms.uHotC.value.setRGB(p2.hot.r, p2.hot.g, p2.hot.b);
      this.mistMat.uniforms.uMidC.value.setRGB(p2.mid.r, p2.mid.g, p2.mid.b);
      this.causticMat.uniforms.uCausticC.value.setRGB(
        p2.mid.r * 0.9 + 0.1, p2.mid.g * 0.9 + 0.1, p2.mid.b * 0.9 + 0.1);

      const mm = this.identity.material();
      U.uGrain.value = mm.roughness;
      U.uSpread.value = mm.spread;

      // How far this song's waves carry. A sustained, legato record sends a
      // swell clear across the pool; a dry percussive one has its energy die
      // close to where it landed.
      const ph = this.identity.physics();
      U.uDamp.value += (ph.damping - U.uDamp.value) * (1 - Math.exp(-dt * 0.5));
      U.uRingDecay.value += (ph.ringDecay - U.uRingDecay.value) * (1 - Math.exp(-dt * 0.5));

      // A harsh, strained record has rougher water for its whole length, not
      // only in the moments where the live analyser happens to catch a
      // dissonance. Tension is a property of the song, so it belongs here with
      // the rest of the identity rather than in the frame-by-frame reading.
      U.uChaos.value = Math.min(1.2, U.uChaos.value + this.identity.tension * 0.40);
      this.bodyMat.uniforms.uGloss.value = mm.glassiness;
      this.bodyReflMat.uniforms.uGloss.value = mm.glassiness;

      // Foam tinted just off the water's own colour rather than pure white, so
      // it belongs to the song's world instead of sitting on top of it.
      const p3 = this._pal;
      // Foam keeps more of the song's colour than it used to. Real whitewater
      // is white, but pushing it 45% of the way to pure white meant the
      // brightest, most eye-catching part of the frame was identical on every
      // track, and on a warm palette it dragged the whole surface grey.
      this._foamC.setRGB(
        Math.min(1, p3.hot.r * 0.74 + 0.26),
        Math.min(1, p3.hot.g * 0.74 + 0.26),
        Math.min(1, p3.hot.b * 0.74 + 0.26),
      );
      for (const mat of [this.bodyMat, this.bodyReflMat]) {
        mat.uniforms.uFoamC.value.copy(this._foamC);
        // Capped. Above 1 the foam mix saturates and the water stops being a
        // colour at all, which costs exactly the per-song identity the rest of
        // this file works to establish.
        mat.uniforms.uFoamAmt.value = Math.min(1.05, 0.42 + mm.roughness * 0.6 + perf.intensity * 0.28);
        // Glassy water scatters more, but at 0.55+0.7 the glassiest records
        // reached 1.12 and blew out hardest — the calmest songs were the
        // brightest, which is backwards.
        mat.uniforms.uSSS.value = 0.30 + mm.glassiness * 0.40;
      }
    }

    // ---- voice -------------------------------------------------------------
    // Without this block the shader's uVoicePresence, uVoicePitch, uEffort,
    // uVibrato and uGrit all sit at zero forever, and voiceSource() returns on
    // its first line every time — so the singer never touches the water at all.
    // That is exactly what had happened here: the wiring was lost when this
    // build's ancestor was forked, and the whole vocal channel has been dead
    // ever since while every layer above it went on computing weights for it.
    const v = music.voice;
    if (v) {
      U.uVoicePresence.value += (v.presence - U.uVoicePresence.value) * (1 - Math.exp(-dt * 7));
      // the melody ridge glides rather than snaps, or every note is a jolt
      U.uVoicePitch.value += (v.pitch - U.uVoicePitch.value) * (1 - Math.exp(-dt * 9));
      U.uEffort.value += (v.effort - U.uEffort.value) * (1 - Math.exp(-dt * 5));
      U.uVibrato.value += (v.vibrato - U.uVibrato.value) * (1 - Math.exp(-dt * 4));
      U.uGrit.value += ((v.grit || 0) - U.uGrit.value) * (1 - Math.exp(-dt * 3));
    }

    // spectrum -> texture
    const sp = music.spectrum;
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      this.spectrumData[i] = Math.max(0, Math.min(255, sp[i] * 255)) | 0;
    }
    this.spectrumTex.needsUpdate = true;

    // heat drives how far the palette pushes toward white
    const heat = perf.heat;
    this.bodyMat.uniforms.uHeat.value = heat;
    this.bodyReflMat.uniforms.uHeat.value = heat;
    this.lineMat.uniforms.uHeat.value = heat;
    this.lineReflMat.uniforms.uHeat.value = heat;

    this.lineMat.uniforms.uOpacity.value = 0.62 + perf.intensity * 0.42;
    this.lineReflMat.uniforms.uOpacity.value = 0.44 + perf.intensity * 0.36;
    this.bodyMat.uniforms.uOpacity.value = 0.44 + perf.intensity * 0.28;

    this.mistMat.uniforms.uMist.value = perf.mist;
    this.mistMat.uniforms.uSpray.value = perf.spray;

    this.backdropMat.uniforms.uTime.value = U.uTime.value;
    // caustics strengthen as the water gets busier, and vanish when it is still
    this.causticMat.uniforms.uCausticAmt.value = 0.16 + perf.intensity * 0.42;
    this.causticMat.uniforms.uFloorY.value = -6.0 - perf.height * 1.1;

    this.backdropMat.uniforms.uGlowStrength.value = 0.14 + perf.intensity * 0.30 + perf.eruption * 0.25;
  }

  /** Copy the choreographer's impulse ring buffer into uniforms. */
  syncImpulses(impulseA, impulseB, choreoTime) {
    const A = this.U.uImpulseA.value;
    const B = this.U.uImpulseB.value;
    // The shader's clock is uTime; the choreographer's is its own. Rebase.
    const offset = this.U.uTime.value - choreoTime;
    for (let i = 0; i < A.length; i++) {
      A[i].set(impulseA[i * 4], impulseA[i * 4 + 1], impulseA[i * 4 + 2] + offset, impulseA[i * 4 + 3]);
      B[i].set(impulseB[i * 4], impulseB[i * 4 + 1], impulseB[i * 4 + 2], impulseB[i * 4 + 3]);
    }
  }

  dispose() {
    this.body.geometry.dispose();
    this.lines.geometry.dispose();
    this.mist.geometry.dispose();
    this.backdrop.geometry.dispose();
    this.caustics.geometry.dispose();
    [this.bodyMat, this.bodyReflMat, this.lineMat, this.lineReflMat, this.mistMat,
      this.backdropMat, this.causticMat]
      .forEach(m => m.dispose());
    this.spectrumTex.dispose();
  }
}

/**
 * A polar disc: dense enough to resolve spectral spikes, with a radius
 * distribution that keeps detail where the arena actually performs.
 * Triangles and contour lines share one position buffer.
 */
function buildPolarDisc(rings, segments, radius, lineStep) {
  const vertCount = 1 + rings * segments;
  const pos = new Float32Array(vertCount * 3);

  // index 0 = centre
  pos[0] = 0; pos[1] = 0; pos[2] = 0;
  const idx = (ring, seg) => 1 + (ring - 1) * segments + (seg % segments);

  for (let i = 1; i <= rings; i++) {
    const t = i / rings;
    const r = radius * Math.pow(t, 1.18);
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const o = idx(i, j) * 3;
      pos[o] = Math.cos(a) * r;
      pos[o + 1] = 0;
      pos[o + 2] = Math.sin(a) * r;
    }
  }

  const tri = [];
  for (let j = 0; j < segments; j++) tri.push(0, idx(1, j), idx(1, j + 1));
  for (let i = 1; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = idx(i, j), b = idx(i, j + 1), c = idx(i + 1, j), d = idx(i + 1, j + 1);
      tri.push(a, c, b, b, c, d);
    }
  }

  const lines = [];
  for (let i = 1; i <= rings; i++) {
    if (i % lineStep !== 0) continue;
    for (let j = 0; j < segments; j++) lines.push(idx(i, j), idx(i, j + 1));
  }

  const Index = vertCount > 65535 ? Uint32Array : Uint16Array;
  return {
    positionAttr: new THREE.BufferAttribute(pos, 3),
    triIndex: new THREE.BufferAttribute(new Index(tri), 1),
    lineIndex: new THREE.BufferAttribute(new Index(lines), 1),
  };
}
