// ParticleSystem.js — Particle pool, virtual pairs, annihilation, entanglement

import { N, N2, N3, WORLD_RANGE, VEV } from './QuantumField.js';

export const MAX = 300;
const ANNIHILATION_RADIUS = 1.5;
const DRAG = 0.99;
const MAX_FLASHES = 20;

// Particle types
export const TYPE_INACTIVE  = 0;
export const TYPE_ELECTRON  = 1;
export const TYPE_POSITRON  = 2;
export const TYPE_PHOTON    = 3;
export const TYPE_HIGGS     = 4;
export const TYPE_ANTI_HIGGS = 5;

export class ParticleSystem {
  constructor() {
    // Position / velocity
    this.px = new Float32Array(MAX);
    this.py = new Float32Array(MAX);
    this.pz = new Float32Array(MAX);
    this.vx = new Float32Array(MAX);
    this.vy = new Float32Array(MAX);
    this.vz = new Float32Array(MAX);

    // Appearance
    this.colorR   = new Float32Array(MAX);
    this.colorG   = new Float32Array(MAX);
    this.colorB   = new Float32Array(MAX);
    this.size     = new Float32Array(MAX);
    this.alpha    = new Float32Array(MAX);

    // Lifecycle / relations
    this.type        = new Uint8Array(MAX);
    this.age         = new Float32Array(MAX);
    this.lifetime    = new Float32Array(MAX);
    this.entangledWith = new Int16Array(MAX).fill(-1);
    this.pairWith      = new Int16Array(MAX).fill(-1);

    // Free list for O(1) allocation
    this._freeList = [];
    this.active    = new Set();
    for (let i = MAX - 1; i >= 0; i--) this._freeList.push(i);

    // Annihilation flash pool
    this.annihilationFlashes = [];
    for (let i = 0; i < MAX_FLASHES; i++) {
      this.annihilationFlashes.push({ x: 0, y: 0, z: 0, age: 999, intensity: 0 });
    }
    this._flashHead = 0;

    // Injection accumulator
    this._spawnAccum = 0;

    // Reference to field (set by main.js)
    this.field = null;

    // Params (overridden by GUI)
    this.injectionRate = 4.0;
  }

  // --- Allocation ---
  _alloc() {
    if (this._freeList.length === 0) return -1;
    const idx = this._freeList.pop();
    this.active.add(idx);
    return idx;
  }

  _free(idx) {
    this.type[idx] = TYPE_INACTIVE;
    this.alpha[idx] = 0;
    this.entangledWith[idx] = -1;
    this.pairWith[idx] = -1;
    this.active.delete(idx);
    this._freeList.push(idx);
  }

  // --- Type helpers ---
  _setColor(i, type) {
    switch (type) {
      case TYPE_ELECTRON:
        this.colorR[i] = 0.2; this.colorG[i] = 0.4; this.colorB[i] = 1.0; break;
      case TYPE_POSITRON:
        this.colorR[i] = 1.0; this.colorG[i] = 0.2; this.colorB[i] = 0.2; break;
      case TYPE_PHOTON:
        this.colorR[i] = 1.0; this.colorG[i] = 0.85; this.colorB[i] = 0.2; break;
      case TYPE_HIGGS:
        this.colorR[i] = 0.7; this.colorG[i] = 0.2; this.colorB[i] = 1.0; break;
      case TYPE_ANTI_HIGGS:
        this.colorR[i] = 0.0; this.colorG[i] = 0.9; this.colorB[i] = 1.0; break;
    }
  }

  _typeSize(type) {
    switch (type) {
      case TYPE_PHOTON: return 6;
      case TYPE_HIGGS:
      case TYPE_ANTI_HIGGS: return 8;
      default: return 5;
    }
  }

  // --- Find field hotspot (best of 8 random candidates by energy) ---
  _sampleHotspot() {
    let bestEnergy = -1;
    let bx = 0, by = 0, bz = 0;
    const field = this.field;

    for (let k = 0; k < 8; k++) {
      const x = (Math.random() * N) | 0;
      const y = (Math.random() * N) | 0;
      const z = (Math.random() * N) | 0;
      const gi = x + y * N + z * N2;
      const h = field.higgs[gi], e = field.electron[gi], p = field.photon[gi];
      const energy = h*h + e*e + p*p;
      if (energy > bestEnergy) {
        bestEnergy = energy;
        bx = x; by = y; bz = z;
      }
    }

    const scale = (2 * WORLD_RANGE) / N;
    return [
      (bx - N / 2 + 0.5) * scale,
      (by - N / 2 + 0.5) * scale,
      (bz - N / 2 + 0.5) * scale,
    ];
  }

  // --- Nearest grid cell index for world position ---
  _nearestCell(wx, wy, wz) {
    const scale = N / (2 * WORLD_RANGE);
    const x = Math.max(0, Math.min(N-1, ((wx + WORLD_RANGE) * scale) | 0));
    const y = Math.max(0, Math.min(N-1, ((wy + WORLD_RANGE) * scale) | 0));
    const z = Math.max(0, Math.min(N-1, ((wz + WORLD_RANGE) * scale) | 0));
    return x + y * N + z * N2;
  }

  // --- Spawn a virtual pair ---
  spawnPair(typeA, typeB) {
    const [cx, cy, cz] = this._sampleHotspot();
    const a = this._alloc();
    const b = this._alloc();
    if (a === -1 || b === -1) {
      if (a !== -1) this._free(a);
      if (b !== -1) this._free(b);
      return;
    }

    const speed = 1.5 + Math.random() * 2.0;
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const vox   = speed * Math.sin(phi) * Math.cos(theta);
    const voy   = speed * Math.sin(phi) * Math.sin(theta);
    const voz   = speed * Math.cos(phi);

    const lifetime = 1.0 + Math.random() * 3.0;
    const jitter = 0.3;

    for (const [idx, t, sv] of [[a, typeA, 1], [b, typeB, -1]]) {
      this.px[idx] = cx + (Math.random() - 0.5) * jitter;
      this.py[idx] = cy + (Math.random() - 0.5) * jitter;
      this.pz[idx] = cz + (Math.random() - 0.5) * jitter;
      this.vx[idx] = sv * vox;
      this.vy[idx] = sv * voy;
      this.vz[idx] = sv * voz;
      this.type[idx]     = t;
      this.age[idx]      = 0;
      this.lifetime[idx] = lifetime;
      this.alpha[idx]    = 1.0;
      this.size[idx]     = this._typeSize(t);
      this._setColor(idx, t);
    }

    this.pairWith[a] = b;
    this.pairWith[b] = a;
    this.entangledWith[a] = b;
    this.entangledWith[b] = a;
  }

  // --- Spawn photons from annihilation ---
  _spawnAnnihilationPhotons(x, y, z) {
    for (let k = 0; k < 3; k++) {
      const idx = this._alloc();
      if (idx === -1) return;
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const speed = 3.0 + Math.random() * 2.0;
      this.px[idx] = x; this.py[idx] = y; this.pz[idx] = z;
      this.vx[idx] = speed * Math.sin(phi) * Math.cos(theta);
      this.vy[idx] = speed * Math.sin(phi) * Math.sin(theta);
      this.vz[idx] = speed * Math.cos(phi);
      this.type[idx]     = TYPE_PHOTON;
      this.age[idx]      = 0;
      this.lifetime[idx] = 0.4 + Math.random() * 0.4;
      this.alpha[idx]    = 1.0;
      this.size[idx]     = 6;
      this._setColor(idx, TYPE_PHOTON);
      this.entangledWith[idx] = -1;
      this.pairWith[idx] = -1;
    }
  }

  // --- Emit annihilation flash ---
  _emitFlash(x, y, z) {
    const f = this.annihilationFlashes[this._flashHead % MAX_FLASHES];
    f.x = x; f.y = y; f.z = z; f.age = 0; f.intensity = 1.0;
    this._flashHead++;
  }

  // --- Higgs gradient force ---
  _higgsGrad(wx, wy, wz) {
    if (!this.field) return [0, 0, 0];
    const scale = N / (2 * WORLD_RANGE);
    const gx = Math.max(1, Math.min(N-2, ((wx + WORLD_RANGE) * scale) | 0));
    const gy = Math.max(1, Math.min(N-2, ((wy + WORLD_RANGE) * scale) | 0));
    const gz = Math.max(1, Math.min(N-2, ((wz + WORLD_RANGE) * scale) | 0));
    const f = this.field.higgs;
    return [
      (f[(gx+1) + gy*N + gz*N2] - f[(gx-1) + gy*N + gz*N2]) * 0.5,
      (f[gx + (gy+1)*N + gz*N2] - f[gx + (gy-1)*N + gz*N2]) * 0.5,
      (f[gx + gy*N + (gz+1)*N2] - f[gx + gy*N + (gz-1)*N2]) * 0.5,
    ];
  }

  // --- Main update ---
  update(dt) {
    // Inject pairs (loop mode)
    this._spawnAccum += this.injectionRate * dt;
    while (this._spawnAccum >= 1.0) {
      this._spawnAccum -= 1.0;
      // Randomly choose pair type
      const r = Math.random();
      if (r < 0.5)      this.spawnPair(TYPE_ELECTRON, TYPE_POSITRON);
      else if (r < 0.8) this.spawnPair(TYPE_HIGGS, TYPE_ANTI_HIGGS);
      else              this.spawnPair(TYPE_ELECTRON, TYPE_POSITRON); // extra e/e+
    }

    const toAnnihilate = [];

    for (const i of this.active) {
      if (this.type[i] === TYPE_INACTIVE) continue;

      this.age[i] += dt;

      // Higgs gradient force
      const [gx, gy, gz] = this._higgsGrad(this.px[i], this.py[i], this.pz[i]);
      const force = 0.3;
      this.vx[i] -= gx * force * dt;
      this.vy[i] -= gy * force * dt;
      this.vz[i] -= gz * force * dt;

      // Drag
      this.vx[i] *= DRAG;
      this.vy[i] *= DRAG;
      this.vz[i] *= DRAG;

      // Move
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;

      // Periodic boundary wrap
      const W = WORLD_RANGE;
      if (this.px[i] >  W) this.px[i] -= 2*W;
      if (this.px[i] < -W) this.px[i] += 2*W;
      if (this.py[i] >  W) this.py[i] -= 2*W;
      if (this.py[i] < -W) this.py[i] += 2*W;
      if (this.pz[i] >  W) this.pz[i] -= 2*W;
      if (this.pz[i] < -W) this.pz[i] += 2*W;

      // Fade near end of life
      const remaining = this.lifetime[i] - this.age[i];
      if (remaining < 0.5) {
        this.alpha[i] = Math.max(0, remaining / 0.5);
      }

      // Natural death
      if (this.age[i] >= this.lifetime[i]) {
        const partner = this.entangledWith[i];
        if (partner !== -1 && this.active.has(partner)) {
          toAnnihilate.push([i, partner, false]); // no flash for natural death
        } else {
          toAnnihilate.push([i, -1, false]);
        }
        continue;
      }

      // Annihilation check with pair partner
      const pair = this.pairWith[i];
      if (pair !== -1 && pair > i && this.active.has(pair)) {
        const dx = this.px[i] - this.px[pair];
        const dy = this.py[i] - this.py[pair];
        const dz = this.pz[i] - this.pz[pair];
        const dist2 = dx*dx + dy*dy + dz*dz;
        if (dist2 < ANNIHILATION_RADIUS * ANNIHILATION_RADIUS) {
          toAnnihilate.push([i, pair, true]);
        }
      }
    }

    // Process annihilations / deaths (reverse order avoids double-free)
    for (const [a, b, doFlash] of toAnnihilate) {
      if (!this.active.has(a)) continue;
      const ax = (this.px[a] + (b !== -1 ? this.px[b] : this.px[a])) * 0.5;
      const ay = (this.py[a] + (b !== -1 ? this.py[b] : this.py[a])) * 0.5;
      const az = (this.pz[a] + (b !== -1 ? this.pz[b] : this.pz[a])) * 0.5;

      if (doFlash) {
        this._spawnAnnihilationPhotons(ax, ay, az);
        this._emitFlash(ax, ay, az);
        // Boost Orch-OR coherence at nearest cell
        if (this.field) {
          const ci = this._nearestCell(ax, ay, az);
          this.field.orchCoherence[ci] = Math.min(1, this.field.orchCoherence[ci] + 0.4);
        }
      }

      this._free(a);
      if (b !== -1 && this.active.has(b)) this._free(b);
    }

    // Age flashes
    for (const f of this.annihilationFlashes) {
      if (f.age < 2) f.age += dt;
    }
  }

  // Are all particles dead?
  allDead() {
    return this.active.size === 0;
  }
}
