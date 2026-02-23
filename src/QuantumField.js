// QuantumField.js — 28³ grid simulation, Velocity Verlet wave equations

export const N = 28;
export const N2 = N * N;
export const N3 = N * N * N;
export const WORLD_RANGE = 14; // ±14 units
export const VEV = 0.8; // Higgs vacuum expectation value

export class QuantumField {
  constructor() {
    // Field amplitudes
    this.higgs    = new Float32Array(N3);
    this.electron = new Float32Array(N3);
    this.photon   = new Float32Array(N3);

    // Velocities (Verlet)
    this.higgsVel    = new Float32Array(N3);
    this.electronVel = new Float32Array(N3);
    this.photonVel   = new Float32Array(N3);

    // Consciousness data (written by Consciousness.js)
    this.phi           = new Float32Array(N3);
    this.orchCoherence = new Float32Array(N3);
    this.orchFlash     = new Uint8Array(N3);

    // Heart attractor (precomputed geometry, set once)
    this.heartSurface         = new Float32Array(N3); // proximity to heart surface [0..1]
    this.heartInterior        = new Float32Array(N3); // 1.0 inside heart, 0.0 outside
    this.heartStrength        = 0.0;                  // 0=no influence, 1=strong pull
    this._heartSurfaceCells   = null;                 // Int32Array of near-surface indices
    this._heartInteriorCells  = null;                 // Int32Array of interior indices

    // Temp acceleration buffers (reused each step)
    this._higgsAcc    = new Float32Array(N3);
    this._electronAcc = new Float32Array(N3);
    this._photonAcc   = new Float32Array(N3);

    this._buildHeartField();
    this.init('loop');
  }

  // --- index helpers ---
  idx(x, y, z) {
    // wrap periodically
    const xi = ((x % N) + N) % N;
    const yi = ((y % N) + N) % N;
    const zi = ((z % N) + N) % N;
    return xi + yi * N + zi * N2;
  }

  coords(i) {
    const z = (i / N2) | 0;
    const y = ((i - z * N2) / N) | 0;
    const x = i - y * N - z * N2;
    return [x, y, z];
  }

  // World position for a grid index
  worldPos(i) {
    const [x, y, z] = this.coords(i);
    const scale = (2 * WORLD_RANGE) / N;
    return [
      (x - N / 2 + 0.5) * scale,
      (y - N / 2 + 0.5) * scale,
      (z - N / 2 + 0.5) * scale,
    ];
  }

  // --- Gaussian noise helper ---
  _gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // --- Presets ---
  init(mode) {
    this.higgs.fill(VEV);
    this.electron.fill(0);
    this.photon.fill(0);
    this.higgsVel.fill(0);
    this.electronVel.fill(0);
    this.photonVel.fill(0);

    switch (mode) {
      case 'loop':
        for (let i = 0; i < N3; i++) {
          this.higgs[i]    = VEV + this._gauss() * 0.05;
          this.electron[i] = this._gauss() * 0.1;
          this.photon[i]   = this._gauss() * 0.05;
        }
        break;

      case 'bigbang': {
        const cx = N >> 1, cy = N >> 1, cz = N >> 1;
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
          const r2 = (x-cx)**2 + (y-cy)**2 + (z-cz)**2;
          const env = Math.exp(-r2 / 4);
          const i = this.idx(x, y, z);
          this.higgs[i]       = VEV + env * (this._gauss() * 0.8 + 1.0);
          this.electron[i]    = env * this._gauss() * 1.2;
          this.photon[i]      = env * this._gauss() * 0.8;
          this.higgsVel[i]    = this._gauss() * 0.3 * env;
          this.electronVel[i] = this._gauss() * 0.5 * env;
          this.photonVel[i]   = this._gauss() * 0.3 * env;
        }
        break;
      }

      case 'higgs': {
        for (let i = 0; i < N3; i++) {
          this.higgs[i]    = VEV + Math.sin(i * 0.17) * 0.6;
          this.higgsVel[i] = Math.cos(i * 0.23) * 0.15;
          this.electron[i] = this._gauss() * 0.02;
          this.photon[i]   = this._gauss() * 0.01;
        }
        break;
      }

      case 'consciousness': {
        // Standing waves — coherent patterns
        for (let x = 0; x < N; x++)
        for (let y = 0; y < N; y++)
        for (let z = 0; z < N; z++) {
          const i = this.idx(x, y, z);
          const kx = (2 * Math.PI * 2) / N;
          const ky = (2 * Math.PI * 3) / N;
          const kz = (2 * Math.PI * 2) / N;
          this.electron[i]    = Math.sin(x*kx) * Math.cos(y*ky) * Math.sin(z*kz) * 0.8;
          this.higgs[i]       = VEV + Math.cos(x*kx + y*ky) * 0.2;
          this.orchCoherence[i] = 0.5 + Math.sin(x*kx) * Math.sin(y*ky) * 0.4;
        }
        break;
      }

      case 'antimatter': {
        for (let i = 0; i < N3; i++) {
          const phase = (i % 4 < 2) ? 1 : -1;
          this.electron[i]    = phase * (0.3 + this._gauss() * 0.1);
          this.higgs[i]       = VEV + this._gauss() * 0.05;
          this.electronVel[i] = -phase * 0.05;
        }
        break;
      }
    }
  }

  // --- Laplacian (6-neighbor stencil, periodic) ---
  _laplacian(field, x, y, z) {
    const c  = field[this.idx(x,   y,   z  )];
    const xp = field[this.idx(x+1, y,   z  )];
    const xm = field[this.idx(x-1, y,   z  )];
    const yp = field[this.idx(x,   y+1, z  )];
    const ym = field[this.idx(x,   y-1, z  )];
    const zp = field[this.idx(x,   y,   z+1)];
    const zm = field[this.idx(x,   y,   z-1)];
    return xp + xm + yp + ym + zp + zm - 6 * c;
  }

  // --- Velocity Verlet update ---
  update(dt) {
    const acc_h = this._higgsAcc;
    const acc_e = this._electronAcc;
    const acc_p = this._photonAcc;

    // 1. Compute accelerations at current positions
    for (let x = 0; x < N; x++)
    for (let y = 0; y < N; y++)
    for (let z = 0; z < N; z++) {
      const i = this.idx(x, y, z);
      const h = this.higgs[i];
      const e = this.electron[i];
      const p = this.photon[i];

      const lap_h = this._laplacian(this.higgs,    x, y, z);
      const lap_e = this._laplacian(this.electron, x, y, z);
      const lap_p = this._laplacian(this.photon,   x, y, z);

      // Higgs: Mexican hat potential
      acc_h[i] = 0.3 * lap_h
               - (h - VEV) * (h * h - VEV * VEV) * 0.4
               - 0.1 * e * e;

      // Electron: Yukawa mass from Higgs
      acc_e[i] = 0.5 * lap_e
               - 0.2 * e
               - 0.3 * h * e;

      // Photon: massless, driven by electron current
      acc_p[i] = 1.0 * lap_p
               - 0.05 * this.photonVel[i]
               + 0.2 * this.electronVel[i];
    }

    // 2. Full Verlet step: x += v·dt + ½a·dt²; v += ½(a_old+a_new)·dt
    const dt2half = 0.5 * dt * dt;
    const dthalf  = 0.5 * dt;

    for (let i = 0; i < N3; i++) {
      // Update positions
      this.higgs[i]    += this.higgsVel[i]    * dt + acc_h[i] * dt2half;
      this.electron[i] += this.electronVel[i] * dt + acc_e[i] * dt2half;
      this.photon[i]   += this.photonVel[i]   * dt + acc_p[i] * dt2half;
    }

    // 3. Recompute accelerations at new positions
    for (let x = 0; x < N; x++)
    for (let y = 0; y < N; y++)
    for (let z = 0; z < N; z++) {
      const i = this.idx(x, y, z);
      const h = this.higgs[i];
      const e = this.electron[i];
      const p = this.photon[i];

      const lap_h = this._laplacian(this.higgs,    x, y, z);
      const lap_e = this._laplacian(this.electron, x, y, z);
      const lap_p = this._laplacian(this.photon,   x, y, z);

      const new_ah = 0.3 * lap_h
                   - (h - VEV) * (h * h - VEV * VEV) * 0.4
                   - 0.1 * e * e;
      const new_ae = 0.5 * lap_e
                   - 0.2 * e
                   - 0.3 * h * e;
      const new_ap = 1.0 * lap_p
                   - 0.05 * this.photonVel[i]
                   + 0.2 * this.electronVel[i];

      // Update velocities
      this.higgsVel[i]    += (acc_h[i] + new_ah) * dthalf;
      this.electronVel[i] += (acc_e[i] + new_ae) * dthalf;
      this.photonVel[i]   += (acc_p[i] + new_ap) * dthalf;
    }

    // Heart attractor: stochastic per-cell probability biasing field toward heart shape
    if (this.heartStrength > 0) {
      const hs = this.heartStrength;

      // Surface cells: each has heartStrength probability of being pulled this step
      for (let ci = 0; ci < this._heartSurfaceCells.length; ci++) {
        if (Math.random() > hs) continue;
        const i    = this._heartSurfaceCells[ci];
        const surf = this.heartSurface[i];
        // Deterministic drift toward heart-surface amplitude + stochastic kick
        this.electronVel[i] += (surf * 0.7 - this.electron[i]) * hs * 0.5 * dt;
        this.electronVel[i] += (Math.random() - 0.5) * surf * hs * 0.6;
        this.photonVel[i]   += (Math.random() - 0.5) * surf * hs * 0.2;
      }

      // Interior cells: mild positive amplitude bias (dimmer heart body)
      const innerProb = hs * 0.35;
      for (let ci = 0; ci < this._heartInteriorCells.length; ci++) {
        if (Math.random() > innerProb) continue;
        const i = this._heartInteriorCells[ci];
        this.electronVel[i] += (0.15 - this.electron[i]) * 0.25 * dt;
      }
    }

    // Clamp to avoid blow-up
    for (let i = 0; i < N3; i++) {
      this.higgs[i]    = Math.max(-5, Math.min(5, this.higgs[i]));
      this.electron[i] = Math.max(-5, Math.min(5, this.electron[i]));
      this.photon[i]   = Math.max(-5, Math.min(5, this.photon[i]));
    }
  }

  // Precompute 3D heart implicit surface proximity arrays.
  // Formula: f(x,y,z) = (x² + 9z²/4 + y² - 1)³ - x²y³ - 9z²y³/80 = 0
  // Heart lives in XY plane: lobes at +y, tip at -y, visible from +Z camera.
  // heartScale maps world coords → heart coords; tuned so heart spans ~70% of field.
  _buildHeartField() {
    const HEART_SCALE = 0.128; // world → heart  (lobe max ≈ ±9 world units)
    const surfaceCells  = [];
    const interiorCells = [];

    for (let i = 0; i < N3; i++) {
      const [wx, wy, wz] = this.worldPos(i);
      const hx = wx * HEART_SCALE;
      const hy = wy * HEART_SCALE;
      const hz = wz * HEART_SCALE;

      // Implicit function: negative inside heart, positive outside, zero on surface
      const r2 = hx*hx + (9.0/4.0)*hz*hz + hy*hy;
      const f  = (r2 - 1.0) ** 3 - hx*hx*hy*hy*hy - (9.0/80.0)*hz*hz*hy*hy*hy;

      // Surface proximity: Gaussian falloff from f=0; width tuned artistically
      const surface  = Math.exp(-Math.abs(f) * 15.0);
      const interior = f < 0 ? 1.0 : 0.0;

      this.heartSurface[i]  = surface;
      this.heartInterior[i] = interior;

      if (surface > 0.05)              surfaceCells.push(i);
      else if (interior > 0)           interiorCells.push(i);
    }

    this._heartSurfaceCells  = new Int32Array(surfaceCells);
    this._heartInteriorCells = new Int32Array(interiorCells);
  }

  // Check if field has mostly settled
  isQuiescent() {
    let totalKE = 0;
    for (let i = 0; i < N3; i++) {
      totalKE += this.higgsVel[i]    * this.higgsVel[i]
               + this.electronVel[i] * this.electronVel[i]
               + this.photonVel[i]   * this.photonVel[i];
    }
    return (totalKE / N3) < 1e-6;
  }
}
