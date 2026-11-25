# Suturing practice

Practise closing a wound with five interrupted stitches on a virtual pad, in the browser, with a webcam. Your
pinch points hold the instruments (needle holder and forceps) and each step tells you what to do next. The video
stays in the browser, and nothing is sent anywhere.

This is practice on a pad, not training for a real patient. The steps, marks and tolerances are placeholders until a
clinician reviews them.

## Run it

```
cd knot_trainer
npm install        # first time only
npm run dev
```

Open the address it prints (normally http://localhost:5173) in Chrome. The page opens on a card with **Start with my
camera** and **Watch a demo**. The demo plays a scripted run through all five stitches and needs no camera. The first
camera start loads about 22 MB of hand-tracking files from your own machine.

`npm run check` type-checks and `npm run build` makes a production copy in `dist/`. `npm run deploy` builds and
publishes it to the `gh-pages` branch, which GitHub Pages serves. The site uses relative paths, so it works at the
root of a domain or under a sub-path such as `/suturing-practice/`.

## What you do

You close the wound with five stitches, starting in the middle and working outward (positions 3, 2, 4, 1, 5 along the
wound, so the edges stay level). Each stitch has four steps:

1. **Hold the wound edge.** Pinch with your forceps hand and hold the forceps on the ring at the near edge of the wound.
2. **Position the needle.** Keep the forceps held. Touch the needle tip to the entry ring and hold still.
3. **Pass the needle across.** Keep the forceps held. Follow the line from the entry ring to the exit ring, between the
   guide lines.
4. **Draw the thread through.** You can let go of the forceps. Draw the needle holder straight up along the line until
   the wound edges meet at that stitch.

Before the first stitch you pick up the needle holder by pinching with your needle-holder hand. At the end the page
shows the time for each stitch, needle drops, times you left the lane, forceps slips, skipped steps and your distance
from the line. **Skip step** moves a stuck trainee on, and is counted.

A small dot marks each instrument's tip, so it is plain where the tip is. The forceps ring turns amber if the forceps
slip while they are needed.

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

## Limits

- The camera cannot measure depth, so "passing through tissue" is following a path on the screen.
- The real wrist roll of needle driving is not read. The page uses the direction your hand points as a stand-in, and
  only as a tip.
- The thread is a drawn curve, not physics. Drawing it through brings the wound edges together at that stitch, but
  the knots are not in this page yet.
- The order of the stitches, the marks and every tolerance live in `src/suture/pad.ts` and `src/suture/steps.ts`.

## Layout

- `index.html`: the page
- `public/`: the hand worker, the hand model and the tracker runtime
- `src/capture/`: the camera and the tracker client
- `src/suture/`: the page. The logic (`pad`, `steps`, `grip`, `identity`, `pipeline`, `filter`) has no camera or
  drawing code, so it can be driven by scripted hands (`script.ts`, `synthetic.ts`); `render.ts` and `main.ts` draw it
  and wire it up
- `NOTICE.md`: third-party files and their licences
