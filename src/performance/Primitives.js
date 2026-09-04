/**
 * The vocabulary the water can "speak" — now a set of DISTURBANCES rather than
 * a set of shapes.
 *
 * These used to be GLSL functions that drew geometry straight into the height
 * field: gaussian bumps, lobes, rings at fixed radii. That is why the surface
 * read as terrain. Water does not hold a shape — it carries waves away from
 * whatever disturbed it.
 *
 * So each entry here now names a *source* on the pool, and the Choreographer's
 * weight for it says how hard that source is being driven. The surface is
 * whatever the superposition of their radiated waves happens to be, which is
 * why the resulting pattern looks found rather than drawn. The wave physics
 * itself lives in `water/shaders/field.js`.
 *
 *   voice     the singer, disturbing the centre of the pool
 *   harmonic  twelve pitch classes around the rim, one per note sounding
 *   radial    fine spectral texture riding the surface
 *   rings     a slow concentric swell breathing through the middle
 *   walls     a front crossing the pool, like wind or a passing wake
 *
 * `towers`, `arches` and `columns` are retained as names so the Choreographer's
 * section tables and phrase variants stay intact, but they no longer place
 * sources of their own — they were the most obviously artificial of the old
 * shapes, static bumps sitting on the water instead of moving through it.
 */
export const FORM_NAMES = ['voice', 'harmonic', 'radial', 'rings', 'towers', 'walls', 'arches', 'columns'];
export const FORM_INDEX = FORM_NAMES.reduce((o, n, i) => (o[n] = i, o), {});
export const FORM_COUNT = FORM_NAMES.length;
