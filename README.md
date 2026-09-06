# WAVE ARENA

**Give it a song. It reads the whole track, decides what that song *is*, and
performs it as a body of water.**

### ▶ [Open it](https://yoo-yipeee.github.io/wave-arena-studio/) — no install, no sign-up, no upload

![WAVE ARENA](docs/hero.jpg)

<p align="center">
  <img src="docs/violet.jpg" width="49%" alt="Blinding Lights — DESOLATE, Cm, 85 BPM, blue" />
  <img src="docs/gold.jpg" width="49%" alt="Girls Like You — SERENE, C, gold" />
</p>

<p align="center"><em>Three songs, three worlds. Nobody chose those colours by
hand — the key, the mode and the pace did.</em></p>

Not a spectrum analyser with a nice skin. Before a single frame is drawn it
finds the key and the mode, the tempo and how much to trust it, the lead vocal
and how hard it is being sung, where the drops are, and how loud the song is
*relative to itself*. Then it decides a colour, a wave speed, a water material
and a camera — and holds them, because a song that keeps changing its mind
reads as a bug.

Everything runs in your browser. Your audio is decoded and analysed locally and
never leaves your machine — there is no server, no upload, and no account.

---

## Three ways in

| | |
|---|---|
| **▶ Play from a tab** | Have Spotify, YouTube or anything else playing in another tab, and pick it. Nothing to download, nothing to find. **Start here.** |
| **Drop a song** | An mp3 / wav / m4a from your machine. The best-looking option, because the whole track can be read in advance. |
| **Use microphone** | Point it at a speaker, or play an instrument into it. |

There is also **ENTER DEMO** — an 88-second track synthesised on the fly, with a
real arrangement, so you can see it work with nothing to hand.

### The test set

**TRY THE TEST SET** on the landing page lists the fourteen songs this build was
tuned against, together with **what the analyser actually reads in each one** —
before you play it, so the claim is on the table first and you can catch it
being wrong.

| | | | |
|---|---|---|---|
| Bohemian Rhapsody — Queen | SERENE | D# | **gold** |
| Girls Like You — Maroon 5 | SERENE | C · 58? BPM | **gold** |
| Wake Me Up — Avicii | WARM | D · 115 BPM | **chartreuse** |
| Apna Time Aayega — DIVINE | EUPHORIC | F# · 115 BPM | **mint** |
| Gallan Goodiyaan | SERENE | D · 60 BPM | **emerald** |
| Ghoomar — Padmaavat | EUPHORIC | D? · 169 BPM | **turquoise** |
| Kun Faya Kun — A. R. Rahman | POISED | C#? · 88? BPM | **turquoise** |
| Believer — Imagine Dragons | DRIVING | 125 BPM | **cyan** |
| Someone Like You — Adele | STILL | 67 BPM | **cyan** |
| Tum Hi Ho — Arijit Singh | DRIVING | Fm? · 188? BPM | **cyan** |
| Don't Stop Me Now — Queen | STILL | Dm · 78 BPM | **azure** |
| Blinding Lights — The Weeknd | DESOLATE | Cm · 85 BPM | **blue** |
| HUMBLE. — Kendrick Lamar | BROODING | Cm · 75 BPM | **indigo** |
| Millionaire — Yo Yo Honey Singh | BROODING | Dm · 96 BPM | **indigo** |

A **?** marks a reading the analyser's own confidence estimate does not stand
behind — see [What is still wrong](#what-is-still-wrong). Those are not
excuses; they are the two known faults, printed where you can see them.

**The audio is not shipped with this app.** It is commercial music, and
"nothing is uploaded, nothing is stored" is a promise this project makes on its
own landing page. The list links out; **PLAY FROM A TAB** carries the song in.

---

## How it actually works

### 1. It reads the whole song first

Everything structural is decided offline, before playback. That is the single
most important design decision in the project, and it is why a build feels like
a run-up to a drop the water already knows is coming.

- **Key and mode** — 48 [Goertzel filters](https://en.wikipedia.org/wiki/Goertzel_algorithm)
  extract a chroma profile without needing an FFT, then Pearson-correlate it
  against the Krumhansl–Kessler key profiles.
- **Tempo** — autocorrelation of the onset envelope, with a log-normal prior
  around 120 BPM and parabolic interpolation for sub-bin precision.
- **Structure** — where the drops are, and the level envelope of the whole track.
- **Loudness, relative to itself** — see below; it matters more than it sounds.

### 2. Colour comes from feeling, not frequency

Mapping bass to red and treble to blue is the obvious thing, and it tells you
nothing about the song. Instead the track is placed on
[Russell's circumplex](https://en.wikipedia.org/wiki/Emotion_classification):

- **Valence** (sad ↔ happy) — mostly major/minor, plus harmonic consonance and
  mix brightness. This picks the **hue**, along a single path that never doubles
  back: deep indigo → blue → cyan → turquoise → emerald → gold.
- **Arousal** (calm ↔ driving) — tempo, pulse strength, attack sharpness. This
  picks **saturation and lightness**.

The hue path is monotonic on purpose, so the colour can never land somewhere
absurd, and the desaturated green–yellow crossing is traversed in three
hundredths of a valence unit so no real song sits in it.

### 3. Speed is physics, not a slider

Wave speed is never set directly. The music chooses only how *long* the waves
are; how fast they travel then follows from the deep-water dispersion relation:

```
ω = √(g·k)
```

Long swells roll slowly, short chop moves quickly, because that is what water
does. This makes combinations that don't exist in reality impossible to draw,
and it is the main reason the surface reads as water rather than as a mesh being
wobbled.

Loudness never affects speed — only size. A chorus cannot outrun its own verse.

### 4. Height has exactly one driver

Height used to be a product of eight terms. Every one was individually
defensible and the result was unpredictable, because multiplication compounds:
when three drifted down together the water went flat, and no single term looked
wrong when you inspected it.

Now one number decides it — loudness and vocal effort combined *before* anything
else sees them, then smoothed. The section sets a **floor and a ceiling** rather
than a multiplier (a multiplier can be driven to zero; a floor cannot), and
kicks, drops and your own clicks **add** rather than multiply, so a kick lifts
the water by a knowable amount whether the passage is loud or quiet.

### 5. Every song uses its full range

Modern masters are compressed flat — almost everything sits near the peak.
Measuring a moment against the track's *peak* therefore made most songs nearly
static.

So each moment is ranked against that track's own distribution of levels
(histogram equalisation). A quiet record gets to use the whole arena; a
brickwalled one still has dynamics. This one change took the loudest test
track's height range from 0.43 to 1.03 world units.

### 6. The shape is found, not drawn

The music never draws a shape. It places **sources** on the water, and the
surface is whatever they add up to:

- the **singer** disturbing the centre (found by mid/side, because vocals are
  panned centre while instruments are wide) — pitch tightens or broadens the
  ripples, effort drives their size
- **twelve pitch classes** standing around the rim, each pushing as hard as that
  note is currently sounding — their interference is what makes the pattern look
  *found* rather than authored
- the **spectrum** as fine texture on top
- **strikes** — kicks, snares, drops and your own clicks — as expanding rings
- **how far any of it carries** depends on the song: sustained and legato travels
  across the whole pool, dry and percussive dies where it landed

---

## Things to try

- **Two different songs back to back.** The contrast is the whole point — one
  song looking good proves nothing.
- **Click the water.** Your ripples enter the same buffer the music uses, so your
  hand and the kick drum interfere with each other.
- **The lightning bolt.** It records *the song's biggest moment* hands-free —
  the structural plan already found the drops, so it seeks a few seconds early,
  records through the peak, and hands you an MP4.
- **The settings panel** (HOW YOU WANT IT). Camera, colour, caustics and touch.
  These used to be four separate builds; the differences turned out to be taste,
  not correctness.

---

## Run it locally

No build step. No dependencies. No bundler.

```bash
git clone https://github.com/Yoo-yipeee/wave-arena-studio.git
cd wave-arena-studio
node server.js
```

Then open **http://localhost:5173**.

`server.js` is a zero-dependency static file server — any static server will do,
and you need one only because ES modules don't load over `file://`. three.js is
vendored in `vendor/`, so there is nothing to install and no off-origin requests
at runtime.

---

## The code

```
index.html                  markup, styles, import map
src/
  main.js                   wiring: the whole pipeline in one readable file
  audio/
    AudioEngine.js          decode, transport, tab/mic capture, analyser taps
    DemoTrack.js            the synthesised demo, written straight to a buffer
  analysis/
    MusicAnalyser.js        per-frame bands, onsets, beat tracking
    Harmony.js              chroma, key, consonance
    Voice.js                lead vocal via mid/side, effort, phrasing
  performance/
    SongIdentity.js         the offline read: key, tempo, valence, arousal, colour
    TrackPlan.js            structure, drops, level ranking
    Choreographer.js        music -> water parameters (height, forms, camera)
    Primitives.js           the form vocabulary
  water/
    WaterArena.js           the simulation surface and its uniforms
    shaders/field.js        displacement: Gerstner, sources, impulses, noise
    shaders/materials.js    surface shading, foam, subsurface scattering
  renderer/
    Stage.js                scene, post-processing, adaptive quality
  ui/                       UI, settings, touch, clip recorder, the test set
```

Two files carry most of the interesting decisions: **`SongIdentity.js`** (what
the song *is*) and **`Choreographer.js`** (what the water does about it). The
comments there explain *why* each constant is what it is, usually including what
was tried before and why it failed. Start there.

---

## What is still wrong

Named rather than hidden, and all three are good places to start:

- **Relative major/minor confusion.** A major key and its relative minor share
  all seven notes, so the two correlations come out nearly equal and the winner
  is close to a coin toss. *Don't Stop Me Now* reads D minor and renders blue
  when it should be gold. A tonic-strength bonus helps but does not fix it.
- **Tempo octave errors.** *Gallan Goodiyaan* halves; *Tum Hi Ho* reads 188
  against a true 56. The water is protected from this — motion falls back to
  timbre when tempo confidence is low, and the swell is clamped — but the number
  itself is still wrong.
- **Mobile.** It runs, but the layout and the quality ladder deserve a proper
  pass. This is probably the highest-impact contribution available.

---

## Contribute your own version

**This is an engine for an opinion, and mine is only one opinion.** The mapping
from music to water is full of judgement calls — which emotion model, which
colour path, what a chorus should look like — and almost all of them could
reasonably be made differently.

If you have a better idea, I would genuinely like to see it.

Good places to start:

- **A different emotion model.** Russell's circumplex is one choice. Try Thayer,
  try a genre classifier, try something you invent.
- **A different colour path.** The hue ramp is nine hand-placed stops in
  `SongIdentity.js`. Yours will be better for some music than mine.
- **New forms.** The shader adds sources together — towers, walls, arches,
  columns, rings. Add one. It is a self-contained function in
  `water/shaders/field.js`.
- **Not water at all.** The engine really maps music onto a displacement field
  with a material. Sand, cloth, mercury, fire, cymatics on a plate — the
  Choreographer barely needs to know.
- **Genre tunings.** It was tuned on Bollywood, pop, rock and qawwali. Jazz,
  metal, classical, electronic and hip-hop deserve their own hands on the dials.
- **Fix a known fault** from the list above.
- **Output to the real world.** DMX or MIDI out, and this drives actual lights.

### How to contribute

Fork it, build your version, open a PR — or just open an issue with a clip and
tell me what you changed. Clips are the best possible bug report here, and the
app records them for you.

There is no build step and no test framework to learn. Edit a file, reload the
page. If you change how the music is read, **please check it against several
real songs across genres before you trust it.** The most expensive mistake in
this project's history was a change that scored better on a synthetic test
corpus and broke real music badly. Watch it. Don't just measure it.

Style: match the surrounding code. Comments explain *why*, not *what* — if you
replace a constant, say what the old one did wrong.

See [CONTRIBUTING.md](CONTRIBUTING.md) for a tour of where things live.

---

## Credits and licence

Built with [three.js](https://threejs.org) (vendored, MIT). This project is MIT
licensed — see [LICENSE](LICENSE). Do whatever you like with it.

There is a second build, **[WAVE ARENA VOICE](https://github.com/Yoo-yipeee/wave-arena-voice)**
([open it](https://yoo-yipeee.github.io/wave-arena-voice/)) — same engine, but
the singer leads instead of the mix. On a ballad that is the difference between
water that answers the drums and water that answers the voice.
