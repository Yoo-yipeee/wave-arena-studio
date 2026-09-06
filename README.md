# WAVE ARENA

Turn music into a visual performance. Drop a song, press play, watch a body of
water perform it.

### ▶ [Open it](https://yoo-yipeee.github.io/wave-arena-studio/)

Press **ENTER DEMO** for a built-in track, drop in an mp3 of your own, or use
**USE MICROPHONE** and play to it. Audio is decoded and analysed entirely in
your browser and never leaves your machine.

**This is the one to use.** It is the superset: the camera, colour, caustics
and touch options that used to be separate builds are settings here, chosen
after you can see what they do.

There is one other build, and it is a genuinely different reading rather than a
preset — [**WAVE ARENA VOICE**](https://github.com/Yoo-yipeee/wave-arena-voice)
([open it](https://yoo-yipeee.github.io/wave-arena-voice/)), where the singer
leads instead of the mix.

---

## How you want it

The differences between those builds turned out not to be right-and-wrong but
taste, so they are settings rather than separate URLs — chosen after you can
see what they do, and remembered.

| | |
|---|---|
| **Camera** | one unbroken circling shot, or cuts on drops and breakdowns |
| **Colour** | one blue hue family, or each song picking its own from the full spectrum |
| **Caustics** | focused light on the floor beneath the water |
| **Touch** | click the water to throw ripples into it |

A cutting camera makes a better fifteen-second clip; an unbroken one is better
to sit with for an album. Full-spectrum colour separates songs harder; a single
hue family looks more like one product. Neither is correct.

## Clips

The record dot captures canvas and audio locally into a file you can save. The
lightning bolt captures **the song's biggest moment** hands-free — the
structural plan already located the drops before playback began, so it seeks a
few seconds ahead of the largest one, records through it, and hands you the
clip.

MP4 is tried before WebM: WebM is the better-supported capture format in
browsers, but X/Twitter, Instagram and iOS Photos all reject a .webm upload, so
defaulting to it produces a clip that plays perfectly where it was made and can
be shared nowhere. Frames are composited through a 2D canvas so the song title
and a watermark can be drawn into them.

## What it actually listens to

Not just loudness. Chroma, key and mode; the lead vocal, found by mid/side
because it is panned centre while the instruments are wide; vocal effort, since
a belt is brighter than a croon rather than merely louder; and pace measured
from how often musical events happen, because two songs can share a tempo and
feel nothing alike.

The whole track is read before a frame is drawn, so a build is the run-up to a
drop the arena already knows is coming.
