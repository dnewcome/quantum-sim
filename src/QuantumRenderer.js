// QuantumRenderer.js — All Three.js geometry, custom GLSL shaders, per-frame updates

import * as THREE from 'three';
import { N, N2, N3, WORLD_RANGE } from './QuantumField.js';
import { MAX, TYPE_PHOTON, TYPE_HIGGS, TYPE_ANTI_HIGGS } from './ParticleSystem.js';

// ─── Shader: Field Volume ────────────────────────────────────────────────────
const FIELD_VERT = /* glsl */`
  attribute float aHiggs;
  attribute float aElectron;
  attribute float aPhoton;
  attribute float aPhi;
  attribute float aOrch;

  uniform float uTime;
  uniform float uVEV;

  varying vec3  vColor;
  varying float vAlpha;
  varying float vOrch;

  void main() {
    float totalEnergy = aHiggs * aHiggs + aElectron * aElectron + aPhoton * aPhoton;
    float breath = 1.0 + 0.15 * sin(uTime * 1.2 + position.x * 0.4 + position.y * 0.3);

    gl_PointSize = (1.5 + totalEnergy * 4.0 + aPhi * 2.0) * breath;
    gl_PointSize = clamp(gl_PointSize, 1.0, 20.0);

    // Color: gold=Higgs, blue=electron, white=photon, cyan near Orch threshold
    vec3 goldColor = vec3(1.0, 0.8, 0.2);
    vec3 blueColor = vec3(0.2, 0.5, 1.0);
    vec3 whiteColor = vec3(0.9, 0.95, 1.0);
    vec3 cyanColor = vec3(0.0, 1.0, 0.9);

    float hNorm = clamp(abs(aHiggs - uVEV) * 1.5, 0.0, 1.0);
    float eNorm = clamp(abs(aElectron) * 2.0, 0.0, 1.0);
    float pNorm = clamp(abs(aPhoton)   * 3.0, 0.0, 1.0);

    vec3 col = mix(vec3(0.05, 0.05, 0.1), goldColor,  hNorm);
    col = mix(col, blueColor,  eNorm * 0.7);
    col = mix(col, whiteColor, pNorm * 0.4);
    col = mix(col, cyanColor,  aOrch * 0.8);

    // Phi gives a subtle purple tint
    col += vec3(0.3, 0.0, 0.4) * aPhi * 0.6;

    vColor = col;
    vAlpha = 0.3 + totalEnergy * 0.5 + aPhi * 0.3 + aOrch * 0.5;
    vAlpha = clamp(vAlpha, 0.05, 1.0);
    vOrch  = aOrch;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FIELD_FRAG = /* glsl */`
  varying vec3  vColor;
  varying float vAlpha;
  varying float vOrch;

  void main() {
    vec2  uv   = gl_PointCoord - 0.5;
    float dist = length(uv);
    if (dist > 0.5) discard;

    float core  = 1.0 - smoothstep(0.0, 0.25, dist);
    float halo  = 1.0 - smoothstep(0.1, 0.5,  dist);

    // Glowing ring at Orch-OR threshold crossing
    float ring = smoothstep(0.35, 0.42, dist) * (1.0 - smoothstep(0.42, 0.5, dist));
    ring *= vOrch * 3.0;

    float brightness = core * 0.8 + halo * 0.3 + ring * 0.9;
    gl_FragColor = vec4(vColor + vec3(ring * 0.4), brightness * vAlpha);
  }
`;

// ─── Shader: Particles ───────────────────────────────────────────────────────
const PARTICLE_VERT = /* glsl */`
  attribute vec3  aColor;
  attribute float aSize;
  attribute float aAlpha;
  attribute float aType;

  uniform float uTime;

  varying vec3  vColor;
  varying float vAlpha;
  varying float vType;

  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vType  = aType;

    float pulse = 1.0 + 0.2 * sin(uTime * 4.0 + position.x);
    gl_PointSize = aSize * pulse;
    gl_PointSize = clamp(gl_PointSize, 2.0, 30.0);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PARTICLE_FRAG = /* glsl */`
  varying vec3  vColor;
  varying float vAlpha;
  varying float vType;

  uniform float uTime;

  void main() {
    vec2  uv   = gl_PointCoord - 0.5;
    float dist = length(uv);
    if (dist > 0.5) discard;

    float core = 1.0 - smoothstep(0.0, 0.15, dist);
    float halo = (1.0 - smoothstep(0.1, 0.5, dist)) * 0.5;

    vec3 col = vColor;
    float brightness = core + halo;

    // Photon: spinning cross pattern
    if (vType > 2.5 && vType < 3.5) {
      float angle = atan(uv.y, uv.x) + uTime * 3.0;
      float cross = abs(sin(angle * 2.0));
      cross = pow(cross, 4.0);
      brightness += cross * 0.6 * (1.0 - dist * 2.0);
      col = mix(col, vec3(1.0, 1.0, 0.6), cross * 0.5);
    }

    // Higgs/Anti-Higgs: concentric pulsing rings
    if (vType > 3.5) {
      float ripple = sin((dist - uTime * 0.5) * 25.0) * 0.5 + 0.5;
      ripple *= (1.0 - dist * 2.0);
      brightness += ripple * 0.4;
    }

    gl_FragColor = vec4(col, brightness * vAlpha);
  }
`;

// ─── Shader: Entanglement Lines ──────────────────────────────────────────────
const ENTANGLE_VERT = /* glsl */`
  attribute float aLineT; // 0 at start, 1 at end

  varying float vLineT;
  varying vec3  vWorldPos;

  void main() {
    vLineT = aLineT;
    vWorldPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ENTANGLE_FRAG = /* glsl */`
  varying float vLineT;
  varying vec3  vWorldPos;
  uniform float uTime;

  void main() {
    // Traveling wave along line
    float wave = sin(vLineT * 20.0 - uTime * 5.0) * 0.5 + 0.5;

    // Endpoint glow
    float endGlow = smoothstep(0.3, 0.0, min(vLineT, 1.0 - vLineT));

    // Color shift blue→pink along line
    vec3 col = mix(vec3(0.2, 0.4, 1.0), vec3(1.0, 0.3, 0.6), vLineT);
    float alpha = (wave * 0.4 + endGlow * 0.6 + 0.1) * 0.7;

    gl_FragColor = vec4(col, alpha);
  }
`;

// ─── Shader: Annihilation Flash ──────────────────────────────────────────────
const FLASH_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FLASH_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform float uAge;
  uniform float uIntensity;

  void main() {
    vec2  uv   = vUv - 0.5;
    float dist = length(uv);

    // Expanding ring wavefront
    float ringR = uAge * 0.8 + 0.05;
    float ring  = smoothstep(ringR - 0.08, ringR, dist) *
                  (1.0 - smoothstep(ringR, ringR + 0.08, dist));

    // White core (fades quickly)
    float core  = (1.0 - smoothstep(0.0, 0.15, dist)) * (1.0 - uAge * 2.0);
    core = max(0.0, core);

    float fade  = 1.0 - uAge * 2.0;
    fade = max(0.0, fade);

    vec3 col = mix(vec3(1.0, 0.8, 0.4), vec3(1.0, 1.0, 1.0), core);
    float alpha = (ring * 0.8 + core) * fade * uIntensity;
    gl_FragColor = vec4(col, alpha);
  }
`;

// ─── Shader: Consciousness Overlay ──────────────────────────────────────────
const CONSCIOUSNESS_VERT = /* glsl */`
  attribute float aPhi;
  attribute float aOrchFlash;
  attribute float aCoherence;

  uniform float uTime;

  varying vec3  vColor;
  varying float vAlpha;

  void main() {
    float osc = 0.5 + 0.5 * sin(uTime * 0.7 + position.x * 0.15 + position.y * 0.12);

    float sz = 4.0 + aPhi * 12.0 + aOrchFlash * 20.0 + aCoherence * 6.0;
    sz *= osc * 0.4 + 0.8;
    gl_PointSize = clamp(sz, 2.0, 50.0);

    // Color: purple for high phi, gold/white for flash events
    vec3 purpleColor = vec3(0.6, 0.1, 0.9);
    vec3 goldColor   = vec3(1.0, 0.9, 0.3);
    vec3 whiteColor  = vec3(1.0, 1.0, 0.95);

    vec3 col = mix(vec3(0.1, 0.0, 0.15), purpleColor, aPhi);
    col = mix(col, goldColor,  aOrchFlash);
    col = mix(col, whiteColor, aOrchFlash * aOrchFlash);

    vColor = col;
    vAlpha = (aPhi * 0.6 + aOrchFlash * 0.9 + aCoherence * 0.3) * 0.7;
    vAlpha = clamp(vAlpha, 0.0, 0.85);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CONSCIOUSNESS_FRAG = /* glsl */`
  varying vec3  vColor;
  varying float vAlpha;

  void main() {
    vec2  uv   = gl_PointCoord - 0.5;
    float dist = length(uv);
    if (dist > 0.5) discard;

    float core = 1.0 - smoothstep(0.0, 0.3, dist);
    float halo = (1.0 - smoothstep(0.2, 0.5, dist)) * 0.4;

    gl_FragColor = vec4(vColor, (core + halo) * vAlpha);
  }
`;

// ─── Shader: Heart Attractor Glow ────────────────────────────────────────────
const HEART_VERT = /* glsl */`
  attribute float aGlow;
  uniform float uTime;
  uniform float uStrength;
  varying float vGlow;

  void main() {
    vGlow = aGlow;
    float breath = 1.0 + 0.25 * sin(uTime * 1.5 + position.x * 0.2 + position.y * 0.15);
    float sz = (2.0 + aGlow * 14.0) * breath * (0.1 + uStrength * 0.9);
    gl_PointSize = clamp(sz, 0.5, 28.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HEART_FRAG = /* glsl */`
  varying float vGlow;
  uniform float uStrength;

  void main() {
    vec2  uv   = gl_PointCoord - 0.5;
    float dist = length(uv);
    if (dist > 0.5) discard;

    float core = 1.0 - smoothstep(0.0, 0.2,  dist);
    float halo = (1.0 - smoothstep(0.15, 0.5, dist)) * 0.5;

    // Rose → magenta → hot white as field activity increases
    vec3 rose  = vec3(1.0, 0.15, 0.45);
    vec3 magen = vec3(0.9, 0.1,  0.7);
    vec3 hotW  = vec3(1.0, 0.8,  0.9);

    vec3 col = mix(rose, magen, smoothstep(0.3, 0.7, vGlow));
    col = mix(col, hotW,  smoothstep(0.7, 1.0, vGlow));

    float alpha = (core * 0.9 + halo * 0.4) * vGlow * uStrength;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// ─── QuantumRenderer ────────────────────────────────────────────────────────
export class QuantumRenderer {
  constructor(scene, field, particles) {
    this.scene     = scene;
    this.field     = field;
    this.particles = particles;

    this.showField           = true;
    this.showParticles       = true;
    this.showEntanglement    = true;
    this.showFlashes         = true;
    this.showConsciousness   = true;
    this.showHeart           = true;
    this.fieldLayout         = 'cubic'; // 'cubic' | 'octahedral'

    this._buildFieldVolume();
    this._buildParticleLayer();
    this._buildEntanglementLayer();
    this._buildFlashPool();
    this._buildConsciousnessOverlay();
    this._buildHeartLayer();
  }

  // ─── Layer 1: Field Volume ────────────────────────────────────────────────
  _buildFieldVolume() {
    const geo = new THREE.BufferGeometry();

    // Precompute both cubic and octahedral position arrays; working buffer starts cubic.
    // Octahedral: odd y-layers shift +½ cell in x and z so each point sits above the
    // midpoint of four lower-layer neighbours — the vertex of a virtual upward triangle.
    const scale = (2 * WORLD_RANGE) / N;
    this._cubicPositions = new Float32Array(N3 * 3);
    this._octaPositions  = new Float32Array(N3 * 3);

    for (let x = 0; x < N; x++)
    for (let y = 0; y < N; y++)
    for (let z = 0; z < N; z++) {
      const i  = x + y * N + z * N2;
      const cx = (x - N/2 + 0.5) * scale;
      const cy = (y - N/2 + 0.5) * scale;
      const cz = (z - N/2 + 0.5) * scale;

      this._cubicPositions[i*3]     = cx;
      this._cubicPositions[i*3 + 1] = cy;
      this._cubicPositions[i*3 + 2] = cz;

      // Odd y-layers offset by half a cell in x and z → triangular / FCC close-packing
      const off = (y % 2 === 1) ? 0.5 * scale : 0.0;
      this._octaPositions[i*3]     = cx + off;
      this._octaPositions[i*3 + 1] = cy;
      this._octaPositions[i*3 + 2] = cz + off;
    }

    // Mutable working buffer (lerped between the two layouts on the GPU each frame)
    const positions = new Float32Array(this._cubicPositions);
    this._fieldLerpT = 0.0;
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Dynamic field attribute buffers
    this._fvHiggs    = new Float32Array(N3);
    this._fvElectron = new Float32Array(N3);
    this._fvPhoton   = new Float32Array(N3);
    this._fvPhi      = new Float32Array(N3);
    this._fvOrch     = new Float32Array(N3);

    const mkAttr = (arr, n) => new THREE.BufferAttribute(arr, n);
    geo.setAttribute('aHiggs',    mkAttr(this._fvHiggs,    1));
    geo.setAttribute('aElectron', mkAttr(this._fvElectron, 1));
    geo.setAttribute('aPhoton',   mkAttr(this._fvPhoton,   1));
    geo.setAttribute('aPhi',      mkAttr(this._fvPhi,      1));
    geo.setAttribute('aOrch',     mkAttr(this._fvOrch,     1));

    const mat = new THREE.ShaderMaterial({
      vertexShader:   FIELD_VERT,
      fragmentShader: FIELD_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uVEV:  { value: 0.8 },
      },
      transparent:  true,
      depthWrite:   false,
      blending:     THREE.AdditiveBlending,
    });

    this._fieldPoints = new THREE.Points(geo, mat);
    this.scene.add(this._fieldPoints);
  }

  // ─── Layer 2: Particles ───────────────────────────────────────────────────
  _buildParticleLayer() {
    const geo = new THREE.BufferGeometry();

    this._partPos   = new Float32Array(MAX * 3);
    this._partColor = new Float32Array(MAX * 3);
    this._partSize  = new Float32Array(MAX);
    this._partAlpha = new Float32Array(MAX);
    this._partType  = new Float32Array(MAX);

    geo.setAttribute('position', new THREE.BufferAttribute(this._partPos,   3));
    geo.setAttribute('aColor',   new THREE.BufferAttribute(this._partColor, 3));
    geo.setAttribute('aSize',    new THREE.BufferAttribute(this._partSize,  1));
    geo.setAttribute('aAlpha',   new THREE.BufferAttribute(this._partAlpha, 1));
    geo.setAttribute('aType',    new THREE.BufferAttribute(this._partType,  1));

    const mat = new THREE.ShaderMaterial({
      vertexShader:   PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent:  true,
      depthWrite:   false,
      blending:     THREE.AdditiveBlending,
    });

    this._particlePoints = new THREE.Points(geo, mat);
    this.scene.add(this._particlePoints);
  }

  // ─── Layer 3: Entanglement Lines ──────────────────────────────────────────
  _buildEntanglementLayer() {
    // Pre-allocate for MAX/2 = 150 pairs, 2 verts each
    const MAX_LINES = MAX;
    const geo = new THREE.BufferGeometry();

    this._entanglePos  = new Float32Array(MAX_LINES * 3);
    this._entangleT    = new Float32Array(MAX_LINES); // 0 or 1 per vertex

    geo.setAttribute('position', new THREE.BufferAttribute(this._entanglePos, 3));
    geo.setAttribute('aLineT',   new THREE.BufferAttribute(this._entangleT,   1));
    geo.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      vertexShader:   ENTANGLE_VERT,
      fragmentShader: ENTANGLE_FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent:  true,
      depthWrite:   false,
      blending:     THREE.AdditiveBlending,
    });

    this._entangleLines = new THREE.LineSegments(geo, mat);
    this.scene.add(this._entangleLines);
  }

  // ─── Layer 4: Annihilation Flashes (pool of 20 billboards) ───────────────
  _buildFlashPool() {
    this._flashMeshes = [];
    const geo = new THREE.PlaneGeometry(4, 4);

    for (let i = 0; i < 20; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader:   FLASH_VERT,
        fragmentShader: FLASH_FRAG,
        uniforms: {
          uAge:       { value: 1.0 },
          uIntensity: { value: 0.0 },
        },
        transparent:  true,
        depthWrite:   false,
        blending:     THREE.AdditiveBlending,
        side:         THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this._flashMeshes.push(mesh);
    }
  }

  // ─── Layer 5: Consciousness Overlay (7³ = 343 sampled cells) ─────────────
  _buildConsciousnessOverlay() {
    const CSUB = 7; // subsample grid
    const CTOTAL = CSUB * CSUB * CSUB;
    const geo = new THREE.BufferGeometry();

    this._csPositions  = new Float32Array(CTOTAL * 3);
    this._csPhi        = new Float32Array(CTOTAL);
    this._csOrchFlash  = new Float32Array(CTOTAL);
    this._csCoherence  = new Float32Array(CTOTAL);

    // Map subsample indices to field indices
    this._csIndices = new Int32Array(CTOTAL);
    const step = N / CSUB;
    let ci = 0;
    const scale = (2 * WORLD_RANGE) / N;
    for (let sx = 0; sx < CSUB; sx++)
    for (let sy = 0; sy < CSUB; sy++)
    for (let sz = 0; sz < CSUB; sz++) {
      const gx = Math.round(sx * step + step / 2);
      const gy = Math.round(sy * step + step / 2);
      const gz = Math.round(sz * step + step / 2);
      const gi = gx + gy * N + gz * N2;
      this._csIndices[ci] = gi;
      this._csPositions[ci*3 + 0] = (gx - N/2 + 0.5) * scale;
      this._csPositions[ci*3 + 1] = (gy - N/2 + 0.5) * scale;
      this._csPositions[ci*3 + 2] = (gz - N/2 + 0.5) * scale;
      ci++;
    }

    geo.setAttribute('position',  new THREE.BufferAttribute(this._csPositions, 3));
    geo.setAttribute('aPhi',      new THREE.BufferAttribute(this._csPhi,        1));
    geo.setAttribute('aOrchFlash', new THREE.BufferAttribute(this._csOrchFlash, 1));
    geo.setAttribute('aCoherence', new THREE.BufferAttribute(this._csCoherence, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader:   CONSCIOUSNESS_VERT,
      fragmentShader: CONSCIOUSNESS_FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent:  true,
      depthWrite:   false,
      blending:     THREE.AdditiveBlending,
    });

    this._consciousnessPoints = new THREE.Points(geo, mat);
    this.scene.add(this._consciousnessPoints);
    this._CSUB = CSUB;
    this._CTOTAL = CTOTAL;
  }

  // ─── Layer 6: Heart Attractor Glow ───────────────────────────────────────
  _buildHeartLayer() {
    const field = this.field;
    const cells = field._heartSurfaceCells;
    const count = cells.length;

    const geo       = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    this._heartGlow      = new Float32Array(count);
    this._heartCellCount = count;

    // Static positions — heart geometry never changes
    for (let ci = 0; ci < count; ci++) {
      const [wx, wy, wz] = field.worldPos(cells[ci]);
      positions[ci*3 + 0] = wx;
      positions[ci*3 + 1] = wy;
      positions[ci*3 + 2] = wz;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aGlow',    new THREE.BufferAttribute(this._heartGlow, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader:   HEART_VERT,
      fragmentShader: HEART_FRAG,
      uniforms: {
        uTime:     { value: 0 },
        uStrength: { value: 0 },
      },
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
    });

    this._heartPoints = new THREE.Points(geo, mat);
    this.scene.add(this._heartPoints);
  }

  // ─── Per-frame update ─────────────────────────────────────────────────────
  update(frameCount) {
    const t = performance.now() * 0.001;
    const field = this.field;
    const parts = this.particles;

    // --- Layer 1: Field Volume ---
    this._fieldPoints.visible = this.showField;
    if (this.showField) {
      const geo   = this._fieldPoints.geometry;
      this._fvHiggs.set(field.higgs);
      this._fvElectron.set(field.electron);
      this._fvPhoton.set(field.photon);
      this._fvPhi.set(field.phi);
      this._fvOrch.set(field.orchCoherence);
      geo.getAttribute('aHiggs').needsUpdate    = true;
      geo.getAttribute('aElectron').needsUpdate = true;
      geo.getAttribute('aPhoton').needsUpdate   = true;
      geo.getAttribute('aPhi').needsUpdate      = true;
      geo.getAttribute('aOrch').needsUpdate     = true;
      this._fieldPoints.material.uniforms.uTime.value = t;
    }

    // Animate lattice layout transition (cubic ↔ octahedral)
    {
      const targetT = (this.fieldLayout === 'octahedral') ? 1.0 : 0.0;
      if (this._fieldLerpT !== targetT) {
        const delta = 0.045; // ~22 frames at 60fps ≈ 0.37 s transition
        this._fieldLerpT = targetT > this._fieldLerpT
          ? Math.min(targetT, this._fieldLerpT + delta)
          : Math.max(targetT, this._fieldLerpT - delta);

        const posAttr = this._fieldPoints.geometry.getAttribute('position');
        const arr = posAttr.array;
        const c = this._cubicPositions, o = this._octaPositions;
        const lt = this._fieldLerpT;
        for (let k = 0; k < N3 * 3; k++) arr[k] = c[k] + (o[k] - c[k]) * lt;
        posAttr.needsUpdate = true;
      }
    }

    // --- Layer 2: Particles ---
    this._particlePoints.visible = this.showParticles;
    if (this.showParticles) {
      for (let i = 0; i < MAX; i++) {
        this._partPos[i*3 + 0]   = parts.px[i];
        this._partPos[i*3 + 1]   = parts.py[i];
        this._partPos[i*3 + 2]   = parts.pz[i];
        this._partColor[i*3 + 0] = parts.colorR[i];
        this._partColor[i*3 + 1] = parts.colorG[i];
        this._partColor[i*3 + 2] = parts.colorB[i];
        this._partSize[i]  = parts.size[i];
        this._partAlpha[i] = parts.alpha[i];
        this._partType[i]  = parts.type[i];
      }
      const geo = this._particlePoints.geometry;
      geo.getAttribute('position').needsUpdate = true;
      geo.getAttribute('aColor').needsUpdate   = true;
      geo.getAttribute('aSize').needsUpdate    = true;
      geo.getAttribute('aAlpha').needsUpdate   = true;
      geo.getAttribute('aType').needsUpdate    = true;
      this._particlePoints.material.uniforms.uTime.value = t;
    }

    // --- Layer 3: Entanglement Lines ---
    this._entangleLines.visible = this.showEntanglement;
    if (this.showEntanglement) {
      let lineCount = 0;
      const visited = new Set();
      for (const i of parts.active) {
        const j = parts.entangledWith[i];
        if (j === -1 || visited.has(j) || !parts.active.has(j)) continue;
        visited.add(i);
        const base = lineCount * 6;
        this._entanglePos[base + 0] = parts.px[i];
        this._entanglePos[base + 1] = parts.py[i];
        this._entanglePos[base + 2] = parts.pz[i];
        this._entanglePos[base + 3] = parts.px[j];
        this._entanglePos[base + 4] = parts.py[j];
        this._entanglePos[base + 5] = parts.pz[j];
        this._entangleT[lineCount * 2 + 0] = 0.0;
        this._entangleT[lineCount * 2 + 1] = 1.0;
        lineCount++;
      }
      const geo = this._entangleLines.geometry;
      geo.getAttribute('position').needsUpdate = true;
      geo.getAttribute('aLineT').needsUpdate   = true;
      geo.setDrawRange(0, lineCount * 2);
      this._entangleLines.material.uniforms.uTime.value = t;
    }

    // --- Layer 4: Annihilation Flashes ---
    if (this.showFlashes) {
      for (let fi = 0; fi < 20; fi++) {
        const flash = parts.annihilationFlashes[fi];
        const mesh  = this._flashMeshes[fi];
        if (flash.age < 0.5) {
          mesh.visible = true;
          mesh.position.set(flash.x, flash.y, flash.z);
          // Billboard: face camera using quaternion is expensive; use lookAt
          mesh.material.uniforms.uAge.value       = flash.age;
          mesh.material.uniforms.uIntensity.value = flash.intensity;
        } else {
          mesh.visible = false;
        }
      }
    } else {
      for (const m of this._flashMeshes) m.visible = false;
    }

    // --- Layer 5: Consciousness Overlay ---
    this._consciousnessPoints.visible = this.showConsciousness;
    if (this.showConsciousness) {
      for (let ci = 0; ci < this._CTOTAL; ci++) {
        const gi = this._csIndices[ci];
        this._csPhi[ci]       = field.phi[gi];
        this._csOrchFlash[ci] = field.orchFlash[gi];
        this._csCoherence[ci] = field.orchCoherence[gi];
      }
      const geo = this._consciousnessPoints.geometry;
      geo.getAttribute('aPhi').needsUpdate        = true;
      geo.getAttribute('aOrchFlash').needsUpdate  = true;
      geo.getAttribute('aCoherence').needsUpdate  = true;
      this._consciousnessPoints.material.uniforms.uTime.value = t;
    }

    // --- Layer 6: Heart Attractor Glow ---
    this._heartPoints.visible = this.showHeart;
    if (this.showHeart) {
      const hs    = field.heartStrength;
      const cells = field._heartSurfaceCells;
      for (let ci = 0; ci < this._heartCellCount; ci++) {
        const i  = cells[ci];
        const e  = field.electron[i];
        const ev = field.electronVel[i];
        // Glow = field activity × surface proximity, clamped [0,1]
        this._heartGlow[ci] = Math.min(1, Math.sqrt(e*e + ev*ev) * field.heartSurface[i] * 3.0);
      }
      const geo = this._heartPoints.geometry;
      geo.getAttribute('aGlow').needsUpdate               = true;
      this._heartPoints.material.uniforms.uTime.value     = t;
      this._heartPoints.material.uniforms.uStrength.value = hs;
    }
  }

  // Billboard flash meshes toward camera
  billboardFlashes(camera) {
    for (const mesh of this._flashMeshes) {
      if (mesh.visible) mesh.lookAt(camera.position);
    }
  }
}
