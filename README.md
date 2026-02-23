# Quantum Field Consciousness

An interactive 3D art installation that visualizes quantum field theory and speculative consciousness
models as a living, navigable light sculpture. The physics is metaphorical — tuned for visual beauty
rather than numerical accuracy — but the underlying equations, terminology, and structural ideas are
drawn from real theoretical frameworks.

---

## Intent

The piece asks a single question visually: *what would it look like if consciousness emerged from
quantum fields?*

Three interacting quantum fields — Higgs, electron, and photon — evolve continuously across a 28×28×28
spatial lattice. Virtual particle pairs flicker into and out of existence, annihilate in bursts of
light, and remain entangled across distance as visible threads. On top of this substrate, two
speculative models of consciousness — Orchestrated Objective Reduction (Orch-OR) and Integrated
Information Theory (IIT) — are computed live and expressed as glowing regions that pulse, collapse,
and re-emerge.

A heart-shaped attractor can be dialled in, causing the field to stochastically orient itself toward
that form — a way of asking whether intention can shape quantum probability.

The result is not a simulation of a real physical system. It is a meditation on emergence, coherence,
and the idea that awareness might be a phase transition in information.

---

## Running the Project

Requires Node.js 18 or higher and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in a browser. The field begins evolving immediately.

```bash
npm run build   # production bundle → dist/
npm run preview # serve the dist/ bundle locally
```

---

## Controls

A panel appears in the top-right corner. All parameters update live.

### Simulation

| Control | Default | Effect |
|---------|---------|--------|
| Mode | `loop` | Starting configuration — see presets below |
| Field Speed | 1.0 | Multiplier on the internal simulation timestep |
| Injection Rate | 4.0 | Virtual particle pairs spawned per second |
| Apply Mode | — | Resets the field and particles to the selected mode |

**Presets**

- **loop** — Low Gaussian noise throughout the lattice; Higgs field near its vacuum expectation
  value. The default living state.
- **bigbang** — A concentrated energy packet at the origin; fields are strongly excited and
  radiate outward from the centre.
- **higgs** — The Higgs field is set to a large-amplitude standing wave pattern; other fields
  are near vacuum.
- **consciousness** — The electron field is initialised as coherent standing waves with a spatial
  frequency chosen to excite the Orch-OR measure quickly.
- **antimatter** — The electron field is set in alternating-phase domains; pair creation and
  annihilation events are dense.

### Fields

| Control | Default | Effect |
|---------|---------|--------|
| Higgs VEV | 0.8 | Vacuum expectation value — the resting amplitude the Higgs field is attracted to |
| Yukawa Coupling | 0.3 | Strength of the Higgs–electron mass coupling term |
| Photon Damping | 0.05 | Velocity damping on the photon field |

### Consciousness

| Control | Default | Effect |
|---------|---------|--------|
| Enabled | on | Enables/disables the Orch-OR and IIT computations entirely |
| Orch-OR Threshold | 0.95 | Coherence level at which a cell "collapses" and fires a flash |
| Growth Rate | 0.8 | How quickly coherence accumulates from electron and photon activity |
| IIT Smoothing | 0.15 | Temporal smoothing weight for the Φ (integrated information) values |

The Orch-OR model builds coherence at each grid cell from local electron and photon activity,
subtracting deviation from the Higgs vacuum. When a cell crosses the threshold it fires (visible
as a gold flash in the consciousness overlay) and resets to zero.

The IIT model approximates Φ as the average cosine similarity between each cell and its six
neighbours, minus the weakest pairwise coupling — a proxy for how much the cell's local information
is *integrated* rather than decomposable.

Lowering the Orch-OR threshold to 0.4–0.6 produces frequent, visible gold flashes across the
lattice.

### Heart Attractor

| Control | Default | Effect |
|---------|---------|--------|
| Probability / Strength | 0.0 | Likelihood that each surface cell is pulled toward the heart configuration each timestep |
| Show Heart Glow | on | Toggles the dedicated pink/magenta glow layer |

At 0 there is no influence. As the value increases, the electron field near the heart surface is
stochastically nudged toward a high-amplitude configuration. At low values the heart flickers into
and out of existence in patches; at high values it becomes persistent. The glow layer only lights
up where the field has actually oriented — you are seeing field activity, not a static overlay.

The heart is defined by the implicit surface `(x² + 9z²/4 + y² − 1)³ − x²y³ − 9z²y³/80 = 0`,
a classical 3D heart curve, scaled to fill roughly 70% of the field volume.

### Rendering

| Control | Default | Effect |
|---------|---------|--------|
| Field Layout | `cubic` | Switches between regular cubic grid and octahedral (FCC close-packed) point arrangement |
| Bloom Strength | 1.8 | Intensity of the UnrealBloom glow pass |
| Bloom Radius | 0.6 | Spread radius of the bloom |
| Bloom Threshold | 0.1 | Luminance threshold below which bloom is not applied |
| Field Volume | on | The 21,952-point field lattice |
| Particles | on | Virtual particle pairs |
| Entanglement Threads | on | Lines connecting entangled particle pairs |
| Annihilation Flashes | on | Expanding ring bursts at annihilation sites |
| Consciousness Overlay | on | The 343-point coarse Orch-OR / IIT overlay |

**Field Layout — Octahedral mode**: When set to `octahedral`, odd y-layers shift by half a cell
in both x and z. Each point moves to sit above the midpoint of its four lower-layer neighbours,
creating an FCC (face-centred cubic) close-packed arrangement where every set of six neighbouring
points occupies the vertices of a virtual octahedron. The transition is animated over ~0.4 seconds.

### Camera

| Control | Default | Effect |
|---------|---------|--------|
| Auto Rotate | off | Slowly orbits the camera around the field |
| Rotation Speed | 0.5 | Auto-rotate angular speed |

Click and drag to orbit manually. Scroll to zoom. The camera starts at z = 45, looking at the origin.

---

## Implementation

### Tech stack

- **Three.js r175** — WebGL rendering
- **lil-gui 0.21** — control panel
- **Vite 6** — dev server and build

### File structure

```
src/
├── main.js            Scene, camera, post-processing, GUI, fixed-timestep loop
├── QuantumField.js    28³ field simulation (Velocity Verlet)
├── ParticleSystem.js  Particle pool, virtual pairs, annihilation, entanglement
├── Consciousness.js   Orch-OR and IIT Φ models
└── QuantumRenderer.js Six rendering layers, all custom GLSL shaders
```

### Simulation loop (`main.js`)

The render loop and the physics loop are decoupled. The internal simulation timestep is fixed at
`SIM_DT = 0.004` s (250 Hz). Each animation frame, wall-clock time is accumulated and consumed in
fixed steps, capped at four sub-steps per frame to prevent spiral-of-death when the browser tab
is backgrounded. The Consciousness module runs every fourth simulation step. Rendering happens once
per animation frame after all sub-steps complete.

### Field simulation (`QuantumField.js`)

A 28×28×28 spatial lattice (21,952 cells) stores three scalar fields — Higgs, electron, photon —
plus velocity arrays for each. Integration uses the Velocity Verlet algorithm, which is
time-reversible and conserves energy better than Euler integration at the same step size.

Field dynamics:

- **Higgs**: Mexican-hat (double-well) potential centred on the vacuum expectation value, plus
  a quadratic coupling to the electron field. This causes spontaneous symmetry breaking and mass
  generation.
- **Electron**: Wave equation with a mass term and a Yukawa coupling to the Higgs. The Higgs
  amplitude modulates the electron's effective mass.
- **Photon**: Massless wave equation driven by the electron current (time-derivative of the
  electron field), with a small damping term.

Spatial derivatives use a six-neighbour finite-difference Laplacian with periodic boundary
conditions, so energy leaving one face re-enters from the opposite face.

The heart attractor is precomputed as a signed implicit function evaluated at every cell. During
each update step, surface cells are sampled stochastically against the `heartStrength` parameter
and receive a drift force toward the heart-surface amplitude plus a random kick.

### Particle system (`ParticleSystem.js`)

A pool of 300 particle slots. A free-list plus an active `Set` give O(1) allocation and
deallocation. Particle types: electron (blue), positron (red), photon (gold), Higgs (violet),
anti-Higgs (cyan).

Virtual pairs are spawned at field hotspots — the highest-energy point sampled from eight random
candidates. Each pair shares a `pairWith` index and an `entangledWith` index. When a pair's
members come within 1.5 world units of each other they annihilate: three photon particles are
spawned, an annihilation flash is registered, and the nearest grid cell receives a coherence boost.

Particle motion: velocity integration with a drag coefficient of 0.99, a gradient force from the
local Higgs field, and periodic boundary wrapping.

### Consciousness models (`Consciousness.js`)

Runs every fourth simulation step, compensating by receiving `4 × SIM_DT` as its effective
timestep.

**Orch-OR**: Each cell accumulates coherence from electron and photon activity weighted against
local Higgs deviation from vacuum. When coherence crosses the threshold it fires (`orchFlash = 1`)
and resets. The threshold, growth rate, and effective timestep are all live parameters.

**IIT Φ approximation**: For each cell and each of its six neighbours, the cosine similarity
between the two three-element field-state vectors `[h, e, p]` is used as a mutual-information
proxy. Φ is the mean similarity minus the weakest pairwise coupling, representing integrated
information minus the weakest partition. A temporal exponential moving average smooths the result.

### Rendering (`QuantumRenderer.js`)

Six rendering layers, all using `THREE.AdditiveBlending` with `depthWrite: false`. All materials
are custom `ShaderMaterial` instances; no Three.js built-in materials are used in the art layers.

| Layer | Geometry | What it shows |
|-------|----------|---------------|
| 1 — Field volume | `Points`, 21,952 verts | Field amplitudes and consciousness values as coloured glowing points |
| 2 — Particles | `Points`, 300 verts | Virtual particle pairs with type-specific GLSL effects |
| 3 — Entanglement | `LineSegments`, up to 300 verts | Traveling-wave lines between entangled pairs |
| 4 — Annihilation | 20 billboard `Mesh` instances | Expanding ring wavefront at annihilation sites |
| 5 — Consciousness overlay | `Points`, 343 verts (7³ subsample) | Coarse Orch-OR flash and IIT Φ values |
| 6 — Heart glow | `Points`, ~2,000–4,000 verts | Stochastic electron activity on the heart surface |

**Layer 1 shader**: Point size scales with total field energy plus IIT Φ, with a slow sinusoidal
breathing modulation. Colour is a weighted blend of gold (Higgs deviation), blue (electron
amplitude), white (photon amplitude), and cyan (Orch-OR coherence), with a purple tint from Φ.
A glowing ring appears at the Orch-OR threshold boundary.

**Layer 2 shader**: Type-specific effects — photons render a time-rotating cross pattern from
`atan2`; Higgs bosons render inward-traveling concentric rings.

**Layer 3 shader**: Each line carries a parameter `t ∈ [0, 1]` from start to end vertex. The
fragment shader computes `sin(t × 20 − time × 5)` for a traveling wave, with endpoint glow and
a blue-to-pink colour gradient along the length.

**Layer 6 shader**: Point size and alpha are driven by `aGlow` — computed each frame as
`√(e² + ė²) × heartSurface[i] × 3`, clamped to [0, 1]. Only cells where the electron field
is genuinely active glow; the shape emerges from the simulation, not from a fixed overlay.

**Post-processing**: `EffectComposer → RenderPass → UnrealBloomPass → OutputPass` with
`ACESFilmic` tone mapping.

**Octahedral layout**: Two full position arrays (`_cubicPositions`, `_octaPositions`) are
precomputed at startup. A scalar `_fieldLerpT` advances toward 0 or 1 each frame; during
transition the working buffer is filled by a lerp loop over all 65,856 floats and the GPU
attribute is marked `needsUpdate`. The transition takes ~22 frames at 60 fps.
