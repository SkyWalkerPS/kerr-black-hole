# kerr-black-hole

A real-time renderer of a spinning black hole, built from scratch on raw WebGPU without an engine or rendering library. Every pixel traces its light ray backwards through the curved spacetime of a Kerr black hole. The dark shadow, the thin photon ring, the far side of the accretion disk bending over and under the hole, and the lensed stars all come out of that ray tracing rather than being painted on. You orbit the hole with the mouse.

**Live:** https://kerr-black-hole-roan.vercel.app

![Opening view](screenshots/opening-view.jpg)

## Run it

You need a browser with WebGPU and a reasonably capable GPU. It was built and tested in Chrome on an M3 Pro MacBook Pro.

Open `index.html` directly in the browser. It is one self-contained 119 KB file with no build step. It works straight from `file://`.

## Controls

| Input | Action |
|---|---|
| Drag, or arrow keys | Orbit the hole |
| Scroll, pinch, or `+` `−` | Move closer or farther |
| `F` | Full screen |
| `H` | Hide or show the settings panel: spin, disk temperature, disk tilt, ray steps, exposure, physical or cinematic color, FPS and GPU time |

URL parameters help with testing:
- `cam=distance,azimuthDeg,elevationDeg` places the camera and `fov=deg` sets the lens.
- `steps=n` sets the ray steps and `scale=0.5` pins the ray-tracing resolution.
- `time=s` freezes the animation and `debug=1` shows a heat map of steps per pixel.
- `spin`, `temperature`, `tilt`, `exposure` and `color=cinematic` preset the panel.

## How it works

### Light rays

Each pixel's ray is a photon traced backwards from the camera through the Kerr metric.

- **Time variable:** the integrator works in Mino time, in which a Kerr photon's radial and polar motion separate.
- **Radius:** it uses w = 1/r. The radial equation becomes a cubic in w, and infinity is simply w = 0, so escaping rays end exactly instead of at some arbitrary far radius.
- **Direction:** the polar and azimuthal motion is a point on the unit sphere plus a frame-dragging rotation about the spin axis. There is no trigonometry and no singularity at the poles.

Rays are stepped with a fourth-order Runge–Kutta–Nyström method, which needs three force evaluations per step.
- Each step turns the ray by a fixed angle: small steps near the hole, larger ones far away.
- A step never closes more than half of the remaining gap to the horizon.
- A ray stops when it escapes, when it comes within 0.3% of the horizon radius, or when the disk has absorbed more than 99.6% of its light.

The default budget is 48 steps per ray; the slider goes to 512. Fewer steps also means coarser ones: at 48 each step is 1.6 times the angle it is at 192. Pixels whose ray needed more than 45 steps, mostly near the photon ring, trace four extra rays to smooth the thin rings.

The camera is a zero-angular-momentum observer. Light travel time is integrated along every ray, with the two terms that blow up toward infinity solved exactly within each step. Each image of the disk therefore shows its turbulence with the right delay.

### Accretion disk

The disk is thin and runs from the innermost stable circular orbit out to 24 M.

- **Temperature:** follows the Page–Thorne flux profile, peaking at 6000 K by default.
- **Color:** each crossing glows as a blackbody at the temperature the camera actually sees, g·T. Here g combines the Doppler shift of the orbiting gas with gravitational redshift. That one factor makes the approaching side brighter and bluer and the inner edge redder. Colors come from a 512-entry table of the Planck spectrum integrated against the CIE color-matching functions.
- **Brightness:** the gas is a slab with optical depth and limb darkening. At grazing angles it gets a finite thickness (2% of the radius) and a density floor, so the thin slab does not break into hard-edged holes when seen edge-on.

The turbulence comes from a baked, tileable 2048 by 512 noise texture with four channels of fractal noise. It moves at each radius's orbital speed, so the inner edge turns much faster than the outer disk. It is drawn as two cross-faded layers per radial zone that restart on a shared clock, which keeps the pattern from winding into thin rings over time.

The Cinematic color mode leans toward Interstellar's warm, symmetric gold. It takes its color from 62% of the gas temperature, keeps beaming mild, and applies a golden grade.

### Sky

The Milky Way band is a cube map with 1024 by 1024 faces, generated on the GPU at startup with a central bulge, cloud structure and dust lanes. It is sampled along each ray's escape direction, using that direction's screen-space derivatives to choose the level of detail.

The stars are procedural and drawn at full screen resolution:
- **Spread:** five layers of stars sit on cube-face grids. Each layer covers 2.5 magnitudes and holds ten times as many stars as the layer above, so faint stars are many and bright ones few.
- **Size:** each star is about one physical pixel wide, and the two brightest layers get a soft halo.
- **Lensing:** magnification comes from the 2 by 2 Jacobian of the escape direction, so stars brighten where lensing magnifies them.
- **Density:** the faint layers get denser inside the Milky Way band.
- **Unresolved stars:** stars too small to resolve fade to black instead of being averaged into a grey glow.

### Post-processing

Rendering is HDR from start to finish.
- **Bloom:** a 6-level chain fed by the disk emission, with a Karis average on the first level.
- **Auto-exposure:** a small bloom level is read back from the GPU into a log-luminance histogram. Exposure then sets the disk mid-tones to a fixed key while keeping the brightest 0.5% of pixels in range.
- **Final image:** AgX tone mapping, a slight vignette, and film grain that is weaker in the blacks.

### Dynamic resolution

The ray tracing runs at an internal resolution between 30% and 100% of the screen.
- GPU timestamp queries time the trace and everything else separately, and a controller aims for 11 ms of GPU time per frame.
- It cuts resolution quickly after a slow frame and keeps probing upward while under budget. On Apple Silicon a light load lowers the GPU clock, which would otherwise trap the resolution low.
- Render targets are allocated in 10% steps and drawn into a sub-rectangle, so resolution changes rarely reallocate them.
- On 120 Hz displays, rendering is paced to 60 fps.

## Performance

On an M3 Pro with an 18-core GPU, at the 16-inch MacBook Pro's native 3456 by 2234, scripted 30-second camera flights in headless Chrome held 60 fps.
- Each flight ran 1,795 frames, none over the 16.7 ms frame budget.
- GPU time at the 99th percentile was between 12.5 and 12.8 ms. This covers a run at maximum spin and one at the 14-inch size.
- Those flights ran at 192 ray steps. With the current default of 48, the opening view takes about 7 ms of GPU time per frame at full resolution.

## How it's checked

Everything in `tools/` drives the real page in headless Chrome on the GPU.
- **Physics self-test:** runs the shipped shader against double-precision references. Rays agree with an independent Boyer–Lindquist integrator to a median of about 0.0002 radians, and the shadow outline matches Bardeen's exact formula to within 0.0008 M at spins 0, 0.9 and 0.998.
- **Input test:** drives real mouse, wheel, touch and keyboard events.
- **Screenshots and benchmarks:** render fixed views and measure GPU time per frame and the time between frames.

See [tools/README.md](tools/README.md) for each script.

## Known limitations

- Only Chrome has been tested.
- The disk is geometrically thin: the ray tracer treats it as a plane and uses thickness only for shading. There is no corona or jet, and the disk does not light itself.
- The camera is a static observer even while it orbits, so its own motion adds no aberration or Doppler shift.
- Zoom moves the camera while the lens stays at 110°, so close views stretch strongly toward the screen edges.
- At the default 48 steps, the higher-order photon rings are approximate. Raise Ray steps in the panel for more accuracy.
- Spin runs from 0 to 0.998, with the disk always orbiting the same way the hole spins.
- The stars and galaxy are procedural, not a real star catalogue, and the disk turbulence is a noise texture, not a fluid simulation.

## How it was made

I built this with Claude Code (Opus 5.5).

**The brief.** I asked for a Kerr black hole ray traced per pixel in raw WebGPU, as one HTML file. It needed a Doppler-beamed blackbody disk, a lensed starfield, a film look, free-fly controls and a settings panel. The hard requirement was a steady 60 fps on an M3 Pro, proven by measuring frame times in headless Chrome. The design and code were up to Claude.

**The checks.** It verified its own work in three ways:
- the shader against double-precision references;
- screenshots from several angles, compared with the EHT image of M87*, Interstellar and published Kerr ray-traced images;
- frame times from scripted camera flights.

**After I tried it,** I asked for an orbit-only camera that opens on the framing I liked with the settings panel showing. I also asked for a truly black sky with sharp stars, because the first version's sky looked grey with stars like polka dots, and for 48 ray steps by default.

## Repository layout

| Path | Contents |
|---|---|
| `index.html` | The whole renderer: page, settings panel, WGSL shaders and JavaScript |
| `tools/` | Headless Chrome checks: physics self-test, double-precision Kerr reference, input test, screenshots, benchmarks and sky measurement |
| `screenshots/` | README image and reference views |
