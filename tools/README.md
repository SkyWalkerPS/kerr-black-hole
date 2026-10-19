# Checks for the black hole renderer

Everything here drives the real `../index.html` in headless Chrome on the machine's GPU, or checks the physics in double precision with plain Node. Nothing to install: the Chrome driver (`cdp.mjs`) uses Node's built-in WebSocket. It needs Node and Google Chrome.

Run from this folder.

| Command | What it checks |
|---|---|
| `node geodesic-lab.mjs [schwarzschild\|kerr\|shadow\|cost\|all]` | The ray integrator in double precision, against three independent references: the exact Schwarzschild bending integral, a separate Boyer-Lindquist Hamiltonian integrator, and Bardeen's analytic shadow outline. Also reports steps per pixel. |
| `node selftest.mjs` | The shipped WGSL integrator, run through a compute shader in the page, against those same references. Exits non-zero on failure. |
| `node interact.mjs <out-dir>` | Real keyboard, mouse, wheel and touch input. Checks the opening view (orbit 25.6 M, 5.8°, 110° lens, panel open, no hint); that fly keys do nothing; drag to orbit; scroll, + − and two-finger pinch to zoom; arrow keys; H for the panel; panel sliders; and a phone-sized screen starting with the panel hidden and a gesture hint. Also checks the "needs WebGPU" message. |
| `node mobile.mjs` | Phone emulation (390×844 and 844×390 at 3×, touch). Checks the turn-sideways prompt, the 2× pixel cap, the compact panel fitting without scrolling, the settings button, one-finger orbit, pinch zoom and slider taps. Screenshots go to `screenshots/mobile/` (not committed). |
| `node measure-sky.mjs <shot.png> [...]` | Reports a screenshot's dark-sky black level (median of the darkest quarter of 96 px tiles, 0–255), star pixel coverage and tile-to-tile steps. Works on any screenshot, not just ones from these tools. |
| `node shoot.mjs <out-dir> [view ...]` | Screenshots of named camera views. Env: `VIEWPORT=1728x1117 DPR=2 SCALE=0.75 QUERY=... PANEL=1 CLIP=x,y,w,h`. The panel is hidden (`panel=0`) unless `PANEL=1`. |
| `node bench.mjs [view ...]` | GPU time per frame from timestamp queries for fixed views, with the page's adaptive resolution running. Env: `UNPACED=1` keeps the GPU busy for stable profiling; `SCALE=` pins the resolution. |
| `node flight.mjs` | A 30-second camera flight (far, close dive, skim the disk, orbit) at the 16-inch MacBook Pro's native 3456x2234. Reports frame intervals, GPU time percentiles and frames over the 16.7 ms budget. Env: `SPIN=0.998`, `VIEWPORT=1512x982` (14-inch). |

## How the ray integrator works (kerr-reference.mjs mirrors the WGSL)

- Time variable: Mino time, in which the radial and polar motions of a Kerr photon separate.
- Radius: w = 1/r. The radial equation becomes the cubic `w'' = w (c0 + c1 w + c2 w^2)`, and infinity is just w = 0, reached in finite Mino time.
- Polar and azimuthal motion: a point m on the unit sphere obeying `m'' = -(Q+L^2) m + a^2 E^2 u (z - 2u m)` with u = m_z, plus a frame-dragging rotation `phi' = a w (2E - a L w) / (1 - 2w + a^2 w^2)` about the spin axis. No trig and no pole singularity.
- Integrator: Runge-Kutta-Nystrom order 4 (three force evaluations per step). Each step turns the ray by a fixed angle on the sphere (0.1 rad near the hole, 0.35 far away). Steps also limit the change in w, halve the remaining gap to the horizon, and limit the frame-dragging angle inside the disk zone.
- Light travel time: the two singular terms of dt/dlambda (E/w^2 and 2E/w) are integrated exactly across each step, which keeps the disk animation's timing right even for a distant camera.
- Camera: a zero-angular-momentum observer (ZAMO). A pixel's ray is the time-reversed photon, with local energy -1 and spatial direction along the pixel.
