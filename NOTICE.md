# Third-party material

- **spatial-mirror** by Sujal Raj Pradhan (https://github.com/SujalPradhan/spatial-mirror), MIT licence, text in
  `LICENSES/spatial-mirror-MIT.txt`. `public/hand-worker.js` is adapted from that repository's hand worker, and the
  vendored MediaPipe files below were taken from its `public/` folder. The ideas of per-hand pose matching with a hold
  time (its `/follow` page) are the reference for later milestones.
- **MediaPipe Tasks Vision** 1.1.1 (Google), Apache-2.0, text in `public/vendor/mediapipe/LICENSE.txt`.
  Files: `public/vendor/mediapipe/vision_bundle.js` and `public/vendor/mediapipe/wasm/vision_wasm_internal.{js,wasm}`.
  Only the SIMD runtime is kept; the tracker picks it by default in any current browser.
- **Hand landmarker model** (Google, Apache-2.0): `public/models/hand_landmarker.task`.
  Source: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
  SHA-256 `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` (as recorded by spatial-mirror, and checked here).
