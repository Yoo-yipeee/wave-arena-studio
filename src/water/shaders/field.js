/**
 * The shared wave field — an actual water surface rather than a sum of shapes.
 *
 * The previous version added gaussian bumps, lobes and rings at fixed radii
 * straight into the height. That is a terrain generator: the result reads as a
 * graph of the music, not as water, because nothing in it obeys how water
 * behaves. Real water only ever does one thing — a disturbance spreads outward,
 * loses energy, and interferes with every other disturbance.
 *
 * So the music no longer draws shapes. It places SOURCES, and the surface is
 * the superposition of the waves they radiate:
 *
 *   displacement = gerstner swell        ambient, always breathing
 *                + radiating sources     music-driven, propagating, interfering
 *                + transient impulses    strikes: kick, snare, drops
 *                + capillary detail      fine ripples riding the big ones
 *
 * Two details carry most of the realism. Gerstner waves displace HORIZONTALLY
 * as well as vertically, which is what gives water its pinched crests and broad
 * flat troughs — a pure sine surface always looks like rubber. And source
 * amplitude falls as 1/sqrt(distance), because a circular wavefront spreads its
 * energy around an ever-growing circumference.
 */
export const FIELD_GLSL = /* glsl */`
#define TAU 6.28318530718
#define INV_TAU 0.15915494309
#define MAX_IMPULSES 8

uniform float uTime;
uniform float uAmp, uMids, uHighs;
uniform float uScale, uComplexity, uChaos, uFlow;
uniform float uRingRadius;
uniform float uEruption, uShock, uAwake;
uniform float uPace;    // 1.0 = 120 BPM; scales wavelength as well as speed
uniform float uGrain;   // song identity: 0 glassy .. 1 broken and foaming
uniform float uSpread;  // song identity: how wide the pool sits
// How far a wave carries before it is gone. These were fixed constants, which
// made reach the one obviously watery property the music could not touch: a
// sustained legato record and a dry percussive one sent their swells exactly
// the same distance. Low damping is an ocean, high damping is a puddle.
uniform float uDamp;       // spatial decay per unit distance
uniform float uRingDecay;  // how fast a struck ring dies with age
uniform float uRadius;
uniform float uForm[8];
uniform sampler2D uSpectrum;
// Chroma used to be a 12-texel texture. Sampling it cost twelve VERTEX texture
// fetches inside harmonicSources, and waveDisplace is evaluated three to five
// times per vertex across a hundred thousand vertices — several million vertex
// fetches a frame, on hardware where a vertex fetch is one of the slowest
// things you can ask for. Twelve floats in a uniform array are the same numbers
// with none of the cost.
uniform float uChromaV[12];
uniform float uTonic, uMode;
uniform float uVoicePresence, uVoicePitch, uEffort, uVibrato, uGrit;
uniform vec4 uImpulseA[MAX_IMPULSES];   // xz origin, birth time, strength
uniform vec4 uImpulseB[MAX_IMPULSES];   // speed, width, kind, -

// --- hashing / noise -------------------------------------------------------
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

// --- samplers --------------------------------------------------------------
float spec(float t) { return texture2D(uSpectrum, vec2(clamp(t, 0.0, 1.0), 0.5)).r; }

// ---------------------------------------------------------------------------
// A point on the surface disturbed continuously, radiating rings outward.
// Amplitude falls as 1/sqrt(d) because a circular front spreads its energy
// around a growing circumference — this is why real ripples fade the way they
// do, and getting it wrong is most of why fake water looks fake.
// ---------------------------------------------------------------------------
float radiate(vec2 p, vec2 c, float amp, float k, float speed, float ph) {
  float d = distance(p, c);
  float spread = inversesqrt(1.0 + d * 0.55);
  return sin(d * k - uTime * speed + ph) * amp * spread * exp(-d * uDamp);
}

// ---------------------------------------------------------------------------
// Gerstner wave. The horizontal term is the whole point: water particles move
// in circles, not up and down, which pinches the crests and flattens the
// troughs. Without it a surface reads as rubber sheeting however it is lit.
// ---------------------------------------------------------------------------
vec3 gerstner(vec2 p, vec2 dir, float lambda, float steep, float amp, float speed) {
  float k = TAU / lambda;
  float f = k * dot(dir, p) - uTime * speed;
  float c = cos(f);
  return vec3(dir.x * steep * amp * c, amp * sin(f), dir.y * steep * amp * c);
}

vec3 swell(vec2 p) {
  float e = 0.45 + uAmp * 0.75;
  // A slow song does not just move slower — it moves in LONGER waves. Scaling
  // speed alone left a ballad looking like a fast song in slow motion, all the
  // same choppy detail simply dragging.
  float lam = mix(1.75, 0.78, clamp(uPace, 0.3, 1.7) / 1.7);
  vec3 s = vec3(0.0);
  // Wavelengths sized to the pool, not to an ocean. At 34 units across a
  // 26-unit arena there was barely one cycle of the largest wave in frame, so
  // the surface read as a smooth mound instead of moving water.
  // A spectrum, not a single scale: a few long swells carry the shape and the
  // short ones ride on top of them. Only the short ones and the surface looks
  // like sand; only the long ones and it looks like a mound.
  s += gerstner(p, normalize(vec2( 0.86,  0.51)), 24.0 * lam, 0.66, 0.72 * e, 0.52 * uFlow);
  s += gerstner(p, normalize(vec2(-0.44,  0.90)), 15.0 * lam, 0.60, 0.48 * e, 0.74 * uFlow);
  s += gerstner(p, normalize(vec2( 0.31, -0.95)),  9.0 * lam, 0.50, 0.30 * e, 1.02 * uFlow);
  s += gerstner(p, normalize(vec2(-0.92, -0.39)),  5.5 * lam, 0.40, 0.18 * e, 1.38 * uFlow);
  s += gerstner(p, normalize(vec2( 0.62, -0.78)),  3.2 * lam, 0.32, 0.10 * e, 1.80 * uFlow);
  return s;
}

// --- the music, as sources on the water ------------------------------------

// Twelve pitch classes standing around the pool, each disturbing the surface as
// strongly as that note is sounding. The rings they throw off interfere, and
// that interference is what makes the pattern look found rather than drawn.
float harmonicSources(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float amp = uChromaV[i];
    if (amp < 0.06) continue;
    float a = (fi / 12.0 + uTonic / 12.0) * TAU;
    vec2 c = vec2(cos(a), sin(a)) * uRingRadius;
    // minor ripples tighter and colder, major broader and calmer
    float k = mix(1.55, 1.05, uMode * 0.5 + 0.5) * mix(0.55, 1.25, clamp(uPace, 0.3, 1.7) / 1.7);
    h += radiate(p, c, amp * amp, k, 2.3 * uFlow, fi * 1.7);
  }
  return h * 0.78;
}

// The singer, disturbing the middle of the pool. Pitch is a quality here: a
// high note tightens the ripples, a low one makes them long and heavy.
float voiceSource(vec2 p) {
  float amp = uVoicePresence * (0.25 + uEffort * 1.25);
  if (amp < 0.02) return 0.0;
  // Longer waves than the original tuning. A tight wavenumber turned the singer
  // into a spike at the exact centre of the pool — the "too literal ridge" —
  // whereas a voice carrying a room is felt as the whole body of water moving.
  float k = mix(0.34, 1.02, uVoicePitch) * mix(0.6, 1.2, clamp(uPace, 0.3, 1.7) / 1.7);
  float wob = uVibrato * 0.3 * sin(uTime * 5.4);
  float h = radiate(p, vec2(0.0), amp, k + wob, 1.85 * uFlow, 0.0);
  // strain roughens the water it disturbs
  float tear = uGrit * 0.3 + uEffort * uVoicePresence * 0.42;
  h *= 1.0 + tear * 0.32 * sin(length(p) * 3.1 - uTime * 4.6);
  // 0.58, not the 1.85 this was written with.
  //
  // That gain was set when the voice was the loudest thing in the field. Since
  // then the forms were normalised to unit amplitude, the Choreographer took
  // ownership of crest height in world units, and a gamma curve was put on the
  // height drive — all of it tuned by eye against a build where this function
  // was returning zero on its first line and nobody could see it. Switched back
  // on at the old gain the singer alone out-drove the entire ambient swell by
  // half again, saturated the foam and steepness terms, and blew the frame to
  // white. The channel was right; only its scale belonged to a different era.
  return h * 0.58;
}

// The mix's own spectrum, as fine texture on the water.
//
// This is the "radial" form, and until now it was dead: the Choreographer has
// always computed a weight for it, the section tables have always carried a
// value, and no shader ever read either — so a bright, busy record and a dark
// sparse one produced identical surface detail. Angle around the pool maps to
// frequency, so a wide mix disturbs the whole rim and a narrow one disturbs one
// arc of it, and the ripple wavelength shortens as the energy climbs the band.
float spectralSkin(vec2 p) {
  float r = length(p);
  float a = atan(p.y, p.x) * INV_TAU + 0.5;        // 0..1 around the pool
  float band = spec(a);
  return sin(r * (1.1 + band * 3.2) - uTime * 2.1 * uFlow)
    * band * band * exp(-r * 0.05);
}

// A front crossing the pool, the way wind or a passing wake does.
float travellingFront(vec2 p) {
  float head = uTime * 0.09;
  vec2 d = vec2(cos(head), sin(head));
  float x = dot(p, d);
  return sin(x * 0.62 - uTime * 2.4 * uFlow) * exp(-abs(x) * 0.012) * (0.4 + uMids * 0.7);
}

// --- transient strikes ------------------------------------------------------
float impulses(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < MAX_IMPULSES; i++) {
    vec4 A = uImpulseA[i];
    vec4 B = uImpulseB[i];
    if (A.w <= 0.001) continue;
    float age = uTime - A.z;
    if (age < 0.0 || age > 4.2) continue;
    float d = distance(p, A.xy);
    float dd = (d - age * B.x) / max(B.y, 0.4);
    // a leading crest with a short wake, spreading and dying like a real ring
    float ring = sin(dd * 2.4) * exp(-dd * dd);
    float decay = exp(-age * uRingDecay) * inversesqrt(1.0 + d * 0.5);
    float kind = B.z > 1.5 ? 2.2 : (B.z > 0.5 ? 0.85 : 1.0);
    h += ring * decay * A.w * kind;
  }
  return h;
}

// --- the surface ------------------------------------------------------------
vec3 waveDisplace(vec2 p) {
  float r = length(p);
  float edge = 1.0 - smoothstep(uRadius * 0.56 * uSpread, uRadius * uSpread, r);

  vec3 g = swell(p);
  float h = g.y;

  h += uForm[0] * voiceSource(p);
  h += uForm[1] * harmonicSources(p);
  if (uForm[2] > 0.02) h += uForm[2] * spectralSkin(p) * 0.45;
  h += uForm[5] * travellingFront(p) * 0.5;
  h += uForm[3] * sin(r * 0.68 - uTime * 1.9 * uFlow) * exp(-r * 0.03) * 0.5;

  h += impulses(p) * 0.85;

  // The song's own grain, as surface texture. A distorted, percussive record
  // has broken water; a clean sustained one has glass.
  h += (fbm(p * 3.4 + vec2(uTime * 0.9, uTime * 0.7)) - 0.5) * uGrain * 0.34;

  // capillary detail — the fine ripples that ride the big ones and catch light
  float capT = uTime * mix(0.45, 1.15, clamp(uPace, 0.3, 1.7) / 1.7);
  float cap = fbm(p * mix(1.1, 2.2, clamp(uPace, 0.3, 1.7) / 1.7) + vec2(capT, -capT * 0.72)) - 0.5;
  h += cap * (0.13 + uHighs * 0.28) * (0.4 + uComplexity * 0.7);

  // Turbulence when the music turns harsh, and the arena-wide events.
  //
  // Both are guarded on their own uniform. An fbm is three octaves of value
  // noise — twelve hashes — and this function runs three to five times per
  // vertex, so skipping one is worth real time. These branches are on uniforms,
  // so every invocation in a warp takes the same side and the GPU never has to
  // execute both: this is the one kind of shader branch that is genuinely free.
  // uEruption is zero for all but a few seconds of a song.
  if (uChaos > 0.005) {
    h += (fbm(p * 0.34 + vec2(uTime * 0.22, uTime * 0.19)) - 0.5) * uChaos * 1.1;
  }
  if (uEruption > 0.004) {
    h += uEruption * (0.9 + 0.7 * fbm(p * 0.14 - uTime * 0.5)) * exp(-r * 0.035) * 1.0;
  }
  h += uShock * exp(-r * 0.05) * 0.3;

  h *= uScale * edge * uAwake;

  // Horizontal motion scales with the vertical so crests stay pinched at any
  // size, and is damped at the rim so the disc keeps a clean silhouette.
  vec2 lateral = vec2(g.x, g.z) * uScale * 0.5 * edge * uAwake;
  return vec3(lateral.x, h, lateral.y);
}

float waveHeight(vec2 p) { return waveDisplace(p).y; }

/**
 * How broken the water is at p, 0..1.
 *
 * Two sources, because whitewater has two causes. Steep water is water that is
 * about to break, so slope drives most of it. And foam LINGERS — the surface
 * stays white for a moment after the wave has gone through, which is most of
 * what makes real whitewater read as whitewater. Without a simulation buffer
 * that persistence is recovered from the impulse ages: each ring knows how long
 * ago it passed a point, so the wake behind it can still be foaming.
 */
float foamAt(vec2 p, float steep) {
  // Foam starts where water is genuinely about to break, not merely sloping.
  // The old threshold caught most of the surface once the crests grew, so a
  // loud passage turned the whole pool white and the colour — the thing that
  // was supposed to tell one song from another — went with it.
  float f = smoothstep(0.90, 2.10, steep);

  // wake foam: just behind a passing front, fading with the ring's age
  for (int i = 0; i < MAX_IMPULSES; i++) {
    vec4 A = uImpulseA[i];
    vec4 B = uImpulseB[i];
    if (A.w <= 0.001) continue;
    float age = uTime - A.z;
    if (age < 0.0 || age > 3.4) continue;
    float d = distance(p, A.xy);
    float behind = (age * B.x - d) / max(B.y, 0.4);   // >0 once the front has passed
    if (behind < 0.0 || behind > 2.6) continue;
    f += (1.0 - behind / 2.6) * exp(-age * 0.85) * A.w * 0.42;
  }

  // Broken up so it reads as clumps of bubbles rather than a painted band.
  // Deliberately not called p-a-t-c-h: that is a reserved word in GLSL ES 3.00,
  // which three compiles to on WebGL2, and it fails at link time rather than
  // at compile time so the error points nowhere near the cause.
  float bubbles = fbm(p * 2.6 + vec2(uTime * 0.22, -uTime * 0.17));
  f *= 0.45 + bubbles * 0.95;
  return clamp(f * (0.6 + uGrain * 0.8), 0.0, 1.0);
}
`;

/** Uniform block shared by every material that samples the field. */
export function createFieldUniforms(THREE, spectrumTexture, radius) {
  return {
    uTime: { value: 0 },
    uAmp: { value: 0 }, uMids: { value: 0 }, uHighs: { value: 0 },
    uScale: { value: 0.16 }, uComplexity: { value: 0.1 },
    uChaos: { value: 0.02 }, uFlow: { value: 0.3 },
    uRingRadius: { value: 9 },
    uEruption: { value: 0 }, uShock: { value: 0 }, uAwake: { value: 0.25 },
    uPace: { value: 0.75 },
    uGrain: { value: 0.3 }, uSpread: { value: 1.0 },
    uDamp: { value: 0.042 }, uRingDecay: { value: 1.25 },
    uHeightRef: { value: 1.0 },
    uRadius: { value: radius },
    uForm: { value: new Float32Array(8) },
    uSpectrum: { value: spectrumTexture },
    uChromaV: { value: new Float32Array(12) },
    uTonic: { value: 0 }, uMode: { value: 0 },
    uVoicePresence: { value: 0 }, uVoicePitch: { value: 0 }, uEffort: { value: 0 },
    uVibrato: { value: 0 }, uGrit: { value: 0 },
    uImpulseA: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
    uImpulseB: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
  };
}
