# Contributing to WAVE ARENA

Thanks for being here. This project is an engine for an opinion, and the opinion
is negotiable — most of what makes it look the way it does is a judgement call
that could reasonably have gone another way.

You do not need permission to start. Fork it, change it, show me.

---

## Getting running (60 seconds)

```bash
git clone https://github.com/Yoo-yipeee/wave-arena-studio.git
cd wave-arena-studio
node server.js
```

Open **http://localhost:5173**.

That is the whole setup. No `npm install`, no bundler, no build step, no test
runner. Edit a file, reload the page. three.js is vendored in `vendor/`, so
there are no dependencies to resolve and no off-origin requests at runtime.

You need a static server only because ES modules will not load over `file://`.
Any static server works; `server.js` is just a zero-dependency one.

---

## Where things live

The pipeline is one direction, and each stage only knows the shape of the one
before it:

```
AudioEngine → MusicAnalyser → Choreographer → WaterArena → Stage → UI
```

**If you want to change how the song is understood** → `src/performance/SongIdentity.js`

The offline read. Runs once, before playback. Key, mode, tempo, valence,
arousal, and the colour that comes out of them. This is where the hue ramp is,
and the emotion model, and the confidence estimates.

**If you want to change how the water behaves** → `src/performance/Choreographer.js`

Music in, water parameters out — height, form weights, camera, heat, chaos. The
per-frame decisions.

**If you want to change how the water looks** → `src/water/shaders/`

`field.js` is displacement (where the surface goes), `materials.js` is shading
(what it looks like when it gets there).

**If you want to change the picture** → `src/renderer/Stage.js`

Scene, camera behaviour, post-processing, and the adaptive quality governor.

**If you want to change what it hears** → `src/analysis/`

Per-frame band energies, onsets, beat tracking, harmony, and the lead-vocal
extraction.

---

## The one rule that matters

**Test against real music. Several songs. Different genres. And watch them.**

This is not a style preference, it is the hardest-won lesson in the project.

A tempo change once scored better on a synthetic test corpus and badly broke
real music — 63 BPM became 130, 58 became 116. The corpus was invalid in a way
that was invisible from the numbers: a stereo wobble in the generator gave every
synthetic track the same component, so the "improvement" was measuring an
artefact of the test itself.

Audio analysis is full of traps like this. A change can look correct in every
metric and be obviously wrong the moment you watch it with a song you know.

So:

- Try at least 4–5 real tracks, deliberately different from each other.
- Include something slow and sung, and something loud and percussive — those two
  break in opposite directions.
- **Actually look at it.** Numbers going up is not evidence.
- Record a clip (the lightning bolt does it hands-free) and put it in the PR.

A clip is the best bug report and the best pull request description this project
can receive.

---

## Ideas worth stealing

Not a roadmap — a list of things I would find genuinely interesting to see:

**Change the reading**
- A different emotion model (Thayer, or a genre classifier, or something new)
- Better key detection — the relative major/minor confusion is unsolved and real
- Fix a tempo octave error without breaking the tracks that currently work
- Lyrics or language awareness

**Change the look**
- Your own hue ramp — nine stops in `SongIdentity.js`, and yours will suit some
  music better than mine
- A new form in `field.js` (the existing ones: towers, walls, arches, columns,
  rings)
- **A different substance entirely.** The engine maps music onto a displacement
  field with a material. Sand, cloth, mercury, fire, cymatics on a steel plate —
  the Choreographer barely needs to know it changed.

**Change the reach**
- Mobile: layout and a proper quality ladder. Probably the highest-impact work
  available right now.
- WebXR
- DMX or MIDI out, so this drives real lights instead of pixels
- Genre tunings — it was tuned on Bollywood, pop, rock and qawwali; jazz, metal,
  classical, electronic and hip-hop all deserve their own hands on the dials

---

## House style

- **Comments explain *why*, not *what*.** The code says what it does. If you
  replace a constant, say what the old value got wrong — that is the part nobody
  can reconstruct later.
- Match the surrounding code. It has a voice; please keep it.
- Small, focused pull requests over large ones.
- Plain JavaScript, ES modules, no build step. Please do not add a toolchain.
- No new runtime dependencies without a good reason. Vendor it if you must.

---

## Things not to do

- **Do not commit audio.** `test-audio/` is gitignored for a reason — most music
  is copyrighted and this repo is public. Test locally with your own files.
- Do not route the microphone to the speakers. It is connected to the analysers
  only, and that is deliberate — anything else is an instant feedback loop.
- Do not send audio anywhere. "Nothing leaves your machine" is a promise the
  project makes on its landing page and it should stay true.

---

## Reporting a bug

Open an issue with:

- what song, and roughly where in it
- what you expected versus what happened
- a clip if you can — hit the lightning bolt, it captures the biggest moment
  automatically and hands you an MP4

"The water goes flat during the chorus of X" is a great bug report. Please
don't attach the song itself.

---

## Licence

MIT. By contributing, you agree your contribution is licensed the same way.
