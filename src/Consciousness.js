// Consciousness.js — Orch-OR threshold collapses + IIT Φ approximation
// Runs every 4th frame (caller compensates dt)

import { N, N2, N3, VEV } from './QuantumField.js';

export class Consciousness {
  constructor(field) {
    this.field = field;

    // Configurable params (overridden by GUI)
    this.orchThreshold  = 0.95;
    this.orchGrowthRate = 0.8;
    this.iitUpdateRate  = 0.15; // temporal smoothing weight for new Phi
    this.enabled        = true;
  }

  // --- Orch-OR model ---
  updateOrchOR(dt) {
    const field = this.field;
    const { higgs, electron, photon, electronVel, photonVel, orchCoherence, orchFlash } = field;

    // Clear flashes from last tick
    orchFlash.fill(0);

    const rate = this.orchGrowthRate * dt;

    for (let i = 0; i < N3; i++) {
      const h = higgs[i];
      const e = electron[i];
      const p = photon[i];
      const ev = electronVel[i];
      const pv = photonVel[i];

      // Activity measures
      const electronActivity    = e * e + ev * ev;
      const photonOscillation   = p * p + pv * pv;
      const higgsDeviation      = Math.abs(h - VEV);

      const delta = (electronActivity * 0.6 + photonOscillation * 0.4 - higgsDeviation * 0.5) * rate;
      orchCoherence[i] = Math.max(0, Math.min(1, orchCoherence[i] + delta));

      if (orchCoherence[i] >= this.orchThreshold) {
        orchFlash[i] = 1;
        orchCoherence[i] = 0;
      }
    }
  }

  // --- IIT Φ approximation ---
  updateIITPhi() {
    const field = this.field;
    const { higgs, electron, photon, phi } = field;
    const alpha = this.iitUpdateRate;
    const eps   = 1e-8;

    for (let x = 0; x < N; x++)
    for (let y = 0; y < N; y++)
    for (let z = 0; z < N; z++) {
      const ci = x + y * N + z * N2;
      const hi = higgs[ci], ei = electron[ci], pi = photon[ci];
      const mag_i = Math.sqrt(hi*hi + ei*ei + pi*pi) + eps;

      // 6 neighbors
      const neighbors = [
        [(x+1)%N, y, z],
        [(x-1+N)%N, y, z],
        [x, (y+1)%N, z],
        [x, (y-1+N)%N, z],
        [x, y, (z+1)%N],
        [x, y, (z-1+N)%N],
      ];

      let sumMI = 0;
      let minMI = Infinity;

      for (const [nx, ny, nz] of neighbors) {
        const ni = nx + ny * N + nz * N2;
        const hn = higgs[ni], en = electron[ni], pn = photon[ni];
        const mag_n = Math.sqrt(hn*hn + en*en + pn*pn) + eps;

        // Cosine similarity → mutual information proxy
        const dotProd = hi*hn + ei*en + pi*pn;
        const mi = Math.abs(dotProd) / (mag_i * mag_n);
        sumMI += mi;
        if (mi < minMI) minMI = mi;
      }

      // Φ = integrated info minus weakest partition
      const newPhi = (sumMI - minMI) / 6;

      // Temporal smoothing
      phi[ci] = phi[ci] * (1 - alpha) + newPhi * alpha;
    }
  }

  // Called every 4th frame; dtCompensated = 4 * SIM_DT
  update(dtCompensated) {
    if (!this.enabled) return;
    this.updateOrchOR(dtCompensated);
    this.updateIITPhi();
  }
}
