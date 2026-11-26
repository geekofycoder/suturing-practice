# Suturing and guidewire practice

Two practice activities in the browser, each driven by a webcam. Your pinch points hold virtual instruments and each
step tells you what to do next. The video stays in the browser, and nothing is sent anywhere.

- **Suturing** (`index.html`): close a wound with five interrupted stitches on a virtual pad.
- **Guidewire insertion** (`guidewire.html`): the guidewire steps of the Seldinger technique for a central venous
  catheter, on a simple drawing of the vein.

These are practice on a screen, not training for a real patient. A clinician has not reviewed either activity. The
steps, marks and tolerances are placeholders until one does.

## Run it

```
cd knot_trainer
npm install        # first time only
npm run dev
```

Open the address it prints (normally http://localhost:5173) in Chrome. The suturing page opens first; the tabs at the
top switch to the guidewire page (`/guidewire.html`). Each page opens on a card with **Start with my camera** and
**Watch a demo**. The demo plays a scripted run through every step and needs no camera. The first camera start loads
about 22 MB of hand-tracking files from your own machine.

`npm run check` type-checks, `npm test` runs the offline checks (scripted hands, no browser or camera) and
`npm run build` makes a production copy in `dist/`. `npm run deploy` builds and
publishes it to the `gh-pages` branch, which GitHub Pages serves. The site uses relative paths, so it works at the
root of a domain or under a sub-path such as `/suturing-practice/`.

# Suturing practice

## What you do

You close the wound with five stitches, starting in the middle and working outward (positions 3, 2, 4, 1, 5 along the
wound, so the edges stay level). Each stitch has four steps:

1. **Hold the wound edge.** Pinch with your forceps hand and hold the forceps on the ring at the near edge of the wound.
2. **Position the needle.** Keep the forceps held. Touch the needle tip to the entry ring and hold still.
3. **Pass the needle across.** Keep the forceps held. Follow the line from the entry ring to the exit ring, between the
   guide lines.
4. **Draw the thread through.** You can let go of the forceps. Draw the needle holder straight up along the line in
   one steady pull until the wound edges meet at that stitch. If you stop for about two seconds, let go of the
   needle holder, or drift off the line, the thread slips back, the wound springs open at that stitch, and you try
   again. The page warns you after about a second of stopping. After a slip, bring the needle holder back down to the
   exit ring before the next pull counts.

Before the first stitch you pick up the needle holder by pinching with your needle-holder hand. At the end the page
shows the time for each stitch, needle drops, times you left the lane, forceps slips, times the thread slipped back,
skipped steps and your distance from the line. **Skip step** moves a stuck trainee on, and is counted.

A small dot marks each instrument's tip, so it is plain where the tip is. The forceps ring turns amber if the forceps
slip while they are needed.

The wound is drawn to look like skin: an irregular edge, a pink flush around it, pores, and a seam that stays level at
both edges. As each stitch is drawn tight the skin bunches in small folds beside it, a dimple forms at each puncture,
and the closed edges stand up a little along the seam. A placed stitch is a taut thread across the wound with a knot
to one side of it and two short cut ends, as on a real interrupted stitch. When the last stitch is in, the wound heals
over from the middle outward and settles into a faint pink line. With "reduce motion" set in the system, healing is a
short fade. Over the live camera the pad is translucent and all of this is drawn fainter, so your hands show through.

# Guidewire insertion practice

## What you do

The needle is already in the vein and blood is flowing. You work through 14 steps in six phases. Each step says what
to do, why, and where it comes from. The instruments lie along a vertical axis, with the skin as a line across it.

1. **Hold the access.** Steady the needle hub with your free hand. Take the syringe off with the other hand while
   the free hand covers the hub, then confirm the blood is dark and not pulsing.
2. **Wire in.** Feed the wire through the needle in short strokes (pinch, push, open, slide back), to 12 to 15 cm.
   Then take hold of the wire at the skin with the free hand, so one hand always has it.
3. **Needle off.** Pull the needle up and off over the wire while the free hand holds the wire.
4. **Tract.** Pick up the scalpel for a small nick beside the wire. Thread the dilator onto the wire, slide it in
   just through the vein wall, then take it off.
5. **Catheter.** Thread the catheter onto the wire until the wire shows at the back of the hub. Grip the wire at the
   hub with one hand, then advance the catheter in steps with the other, to 10 to 13.5 cm, keeping its tip short of
   the wire tip.
6. **Wire out.** Hold the catheter and draw the wire out in steps, then carry the wire to the waste tray.

What the page checks:

- Someone must always be holding the wire. Letting go is counted only when your hand is in view and open, never when
  the tracker loses it.
- The hub stays covered while the syringe is off, which stands for the risk of an air embolism.
- A simulated ECG shows extra beats when the wire goes too deep and a fast run when it goes far too deep. Pull back
  and it settles.
- The catheter tip cannot pass the wire tip.
- Pulling the wire right out takes you back to the blood check.
- **Scenario: the wire meets resistance** adds a drill. The wire stops at 9 cm. Pushing on counts as forcing. Backing
  off a little clears it and the wire goes on.
- **Skip step** moves a stuck trainee on, and is counted. At the end the page shows the time, wire and hub lapses,
  forcing, time with extra beats, the deepest wire, the catheter depth and skipped steps.

Each hand works in its own column, left and right of the axis, and the instruments have drawn handles out to those
columns. That is a concession to the webcam, which loses a hand when the hands overlap. It is not real technique. The
lengths above the skin are not to scale, and the camera cannot measure depth or force, so "resistance" is a scripted
stop and "forcing" is pushing on past it.

## Where the steps come from

The page lists its sources and placeholders under **Where the steps come from**, built from `src/guidewire/content.ts`,
which holds every step, number and source in one file for review.

- Merck Manual, internal jugular vein cannulation, ultrasound-guided: the step order, covering the hub, the dark
  non-pulsing blood, holding the wire at all times, removing the needle over the wire, the nick, dilating, threading
  the catheter, stopping at ectopic beats, not forcing the wire, and what to do on resistance.
- AMBOSS, central venous access: catheter depth for a right internal jugular (about 16 cm).
- A randomised comparison of three guidewire insertion depths: more arrhythmias as the wire goes deeper.
- The English never-event database for retained guidewires (PSNet): checking the whole wire is out and accounted for.

Placeholders, where no source states the value or the page chose its own:

- The wire window is 12 to 15 cm. Merck gives 10 to 15 cm for a right-sided vein; the lower end is raised so the wire
  tip stays ahead of the catheter.
- The depth where the ECG shows extra beats (17.5 cm) and a run (20 cm) are simulation choices.
- The catheter window is 10 to 13.5 cm. AMBOSS gives about 16 cm; the page keeps the catheter shorter so it stays on
  the wire.
- The resistance depth for the drill, and how much pushing counts as forcing.
- How far the dilator goes in (Merck gives no distance).
- Which way the blade faces (Merck says only to avoid the wire).
- Holding the needle still while the wire goes in is common practice, not stated on the Merck page.
- Checking the wire and binning it comes from the retention literature, not from Merck.

## Not in this version

Ultrasound-guided vein puncture, and the drill where the wire resists on the way back and the needle and wire have to
come out together. Merck also describes things this page does not simulate, and the page lists them on the step they
belong to: an optional ultrasound check that the wire has entered the vein, a venous-waveform or IV-tubing check of
the blood before dilating, ultrasound to check the catheter is in the vein, flushing the ports, securing and dressing
the site, and the chest X-ray. The last four show as a checklist at the end and are not interactive.

# Both activities

## Settings

- Needle holder in your right or left hand (the layout mirrors).
- CPU or GPU for the hand model. The default is CPU; try GPU if the instruments lag behind your hands.
- The translucent hint hands, and outlines of your hands.
- **Swap left and right** is a last resort: the page works out left and right from where your hands are on the
  screen, and only uses the tracker's own labels when a single hand is visible.

## How it copes with a real tracker

- The pad is translucent over the live picture, so your real hands show through it.
- An instrument stays in your hand through a flicker in the pinch or a short loss of the hand. It is dropped only when
  your hand has been open for about 0.3 s or out of sight for about 0.6 s.
- Positions are smoothed, because the tracker reports about 15 times a second on a CPU.
- No step needs your two hands to overlap, because overlaps lose a hand. The forceps ring sits well to the side of the
  needle's line for that reason.
- If the needle hand drops out for a moment while you keep moving, the pass catches up when it reappears.

## Suturing limits

- The camera cannot measure depth, so "passing through tissue" is following a path on the screen.
- The real wrist roll of needle driving is not read. The page uses the direction your hand points as a stand-in, and
  only as a tip.
- The thread is a drawn curve, not physics. Drawing it through brings the wound edges together at that stitch. Each
  knot is drawn for you when the stitch is placed; tying knots is not practised in this version.
- "The thread slips back" is a rule of this practice page so that a half-finished pull is tried again. It is not how
  thread behaves in tissue.
- The order of the stitches, the marks and every tolerance live in `src/suture/pad.ts` and `src/suture/steps.ts`.

## Testing

`npm test` drives both activities with scripted hands, with no camera. It checks the rules (letting go of the wire, a
hand that is out of view, forcing, a wire too deep, the waste tray), recovery after the tracker loses a hand part-way
through pulling the needle or pushing the catheter, and the whole demo for each hand, scenario and camera shape. The
demo is also run with jitter, swapped or identical left/right labels, and 0.2 to 0.3 s dropouts while a hand is
holding. The demo itself does not retry a step after a dropout in the middle of a move, so those cases are covered by
the recovery checks instead.

In Chrome, both pages were run through the scripted demo end to end, at the root and under a sub-path. With a fake
camera, only these were tried: starting the camera, the hand model loading, Skip, Start over and stopping the camera.

Not tested: real hands in front of a real webcam, the GPU option, and anything on a phone beyond checking that the
page does not scroll sideways (the two-hand view is meant for a laptop or desktop).

## Layout

- `index.html` and `guidewire.html`: the two pages
- `public/`: the hand worker, the hand model and the tracker runtime
- `src/capture/`: the camera and the tracker client
- `src/common/`: shared by both pages: hand input, filtering, grip and left/right identity, the `Rig` that turns two
  hands into two instruments, scripted hands, the canvas helpers and the page styles
- `src/suture/`: the suturing page. The logic (`pad`, `steps`, `pipeline`) has no camera or drawing code, so it can be
  driven by scripted hands (`script.ts`); `render.ts` and `main.ts` draw it and wire it up
- `src/guidewire/`: the guidewire page. `content.ts` (steps, numbers, sources), `layout.ts`, `machine.ts` (the step
  machine, no camera or drawing), `ecg.ts`, `script.ts` (the demo), `render.ts`, `main.ts`
- `scripts/`: the offline checks and the deploy script
- `NOTICE.md`: third-party files and their licences
