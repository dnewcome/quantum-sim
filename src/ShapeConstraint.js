// ShapeConstraint.js — Field containment within an STL-defined volume.
//
// Workflow:
//   loadSTL(arrayBuffer)          parse → auto-scale → column scan → blur
//   setScale(v)                   re-scale → column scan → blur
//   setFuzziness(v)               blur only (no column scan)
//
// The public `fuzzMask` Float32Array [0..1] is what QuantumField reads.
// `_onGeometryChange(worldVerts, triCount)` fires when geometry is rebuilt
// so the renderer can update the optional wireframe.

import { N, N2, N3, WORLD_RANGE } from './QuantumField.js';

const CELL_SIZE = (2 * WORLD_RANGE) / N; // 1.0 world unit per cell (for N=28)

// ─── STL Parsing ─────────────────────────────────────────────────────────────

function parseBinarySTL(buf) {
  const view  = new DataView(buf);
  const count = view.getUint32(80, true);
  if (buf.byteLength < 84 + count * 50) throw new Error('Truncated binary STL');
  const verts = new Float32Array(count * 9);
  let off = 84;
  for (let t = 0; t < count; t++) {
    off += 12; // skip normal vector
    for (let v = 0; v < 3; v++) {
      verts[t*9 + v*3]     = view.getFloat32(off,     true);
      verts[t*9 + v*3 + 1] = view.getFloat32(off + 4, true);
      verts[t*9 + v*3 + 2] = view.getFloat32(off + 8, true);
      off += 12;
    }
    off += 2; // skip attribute byte count
  }
  return { verts, count };
}

function parseASCIISTL(buf) {
  const text = new TextDecoder().decode(new Uint8Array(buf));
  const re   = /vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/gi;
  const arr  = [];
  let m;
  while ((m = re.exec(text)) !== null) arr.push(+m[1], +m[2], +m[3]);
  if (arr.length < 9) throw new Error('No vertices in ASCII STL');
  const count = Math.floor(arr.length / 9);
  return { verts: new Float32Array(arr.slice(0, count * 9)), count };
}

function parseSTL(buf) {
  // Binary: the calculated file size matches exactly. This is more reliable than
  // checking for the "solid" header prefix (many binary exporters write it too).
  try {
    const view  = new DataView(buf);
    const count = view.getUint32(80, true);
    if (count > 0 && buf.byteLength === 84 + count * 50) return parseBinarySTL(buf);
  } catch (_) {}
  return parseASCIISTL(buf);
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

// Vertical ray at (rx, rz) through triangle. Returns world-Y of intersection or null.
// Uses barycentric coordinates in the XZ plane, then interpolates Y.
function triRayY(rx, rz, verts, base) {
  const ax = verts[base],   ay = verts[base+1], az = verts[base+2];
  const bx = verts[base+3], by = verts[base+4], bz = verts[base+5];
  const cx = verts[base+6], cy = verts[base+7], cz = verts[base+8];

  const denom = (bz-cz)*(ax-cx) + (cx-bx)*(az-cz);
  if (Math.abs(denom) < 1e-10) return null; // degenerate (horizontal triangle)

  const u = ((bz-cz)*(rx-cx) + (cx-bx)*(rz-cz)) / denom;
  const v = ((cz-az)*(rx-cx) + (ax-cx)*(rz-cz)) / denom;
  const w = 1 - u - v;
  if (u < -1e-6 || v < -1e-6 || w < -1e-6) return null; // outside XZ projection

  return u*ay + v*by + w*cy; // interpolated Y
}

// ─── ShapeConstraint ─────────────────────────────────────────────────────────

export class ShapeConstraint {
  constructor() {
    this.enabled   = false;
    this.fuzziness = 1.0;  // world units: half-width of soft boundary transition
    this.scale     = 1.0;  // user multiplier on top of auto-fit

    // Public — QuantumField reads this reference
    this.fuzzMask = new Float32Array(N3).fill(1.0);

    // Raw (pre-transform) geometry — preserved so rescales don't re-parse
    this._rawVerts  = null;   // Float32Array: flat [ax,ay,az, bx,by,bz, cx,cy,cz, ...]
    this._rawCenter = null;   // { cx, cy, cz, maxSpan }
    this._rawAutoS  = 1.0;   // auto-scale factor from raw bbox

    this._worldVerts = null;  // Float32Array: current scaled world-space triangles
    this._triCount   = 0;

    this._binMask = new Float32Array(N3); // binary inside(1)/outside(0) before blur
    this._blurTmp = [new Float32Array(N3), new Float32Array(N3)]; // reused to avoid GC

    // Assigned by main.js — called with (worldVerts, triCount) after geometry rebuild
    this._onGeometryChange = null;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  loadSTL(arrayBuffer) {
    let parsed;
    try {
      parsed = parseSTL(arrayBuffer);
    } catch (err) {
      console.error('[ShapeConstraint] Parse error:', err.message);
      return;
    }
    this._triCount = parsed.count;
    console.log(`[ShapeConstraint] ${this._triCount.toLocaleString()} triangles — building mask…`);
    console.time('[ShapeConstraint] mask build');

    this._rawVerts  = parsed.verts.slice(); // keep unmodified copy
    this._rawCenter = this._bboxCenter(this._rawVerts);
    this._rawAutoS  = this._autoScaleFactor(this._rawCenter);

    this._applyTransform();
    this._rebuildFull();

    console.timeEnd('[ShapeConstraint] mask build');
    this.enabled = true;
  }

  setScale(v) {
    this.scale = v;
    if (!this._rawVerts) return;
    this._applyTransform();
    this._rebuildFull();
  }

  setFuzziness(v) {
    this.fuzziness = v;
    if (!this._rawVerts) return;
    this._blurBinary(); // fast path: re-blur cached binary mask only
  }

  // ─── Internal: transform ───────────────────────────────────────────────────

  _bboxCenter(verts) {
    let minX=1e9,maxX=-1e9, minY=1e9,maxY=-1e9, minZ=1e9,maxZ=-1e9;
    for (let i = 0; i < verts.length; i += 3) {
      const x=verts[i], y=verts[i+1], z=verts[i+2];
      if (x<minX)minX=x; if (x>maxX)maxX=x;
      if (y<minY)minY=y; if (y>maxY)maxY=y;
      if (z<minZ)minZ=z; if (z>maxZ)maxZ=z;
    }
    return { cx:(minX+maxX)/2, cy:(minY+maxY)/2, cz:(minZ+maxZ)/2,
             maxSpan: Math.max(maxX-minX, maxY-minY, maxZ-minZ) };
  }

  _autoScaleFactor(center) {
    // Scale longest axis to 70% of field diameter
    const target = WORLD_RANGE * 2 * 0.70;
    return center.maxSpan > 0 ? target / center.maxSpan : 1.0;
  }

  _applyTransform() {
    const { cx, cy, cz } = this._rawCenter;
    const s = this._rawAutoS * this.scale;
    const n = this._rawVerts.length;
    if (!this._worldVerts || this._worldVerts.length !== n) {
      this._worldVerts = new Float32Array(n);
    }
    for (let i = 0; i < n; i += 3) {
      this._worldVerts[i]   = (this._rawVerts[i]   - cx) * s;
      this._worldVerts[i+1] = (this._rawVerts[i+1] - cy) * s;
      this._worldVerts[i+2] = (this._rawVerts[i+2] - cz) * s;
    }
  }

  _rebuildFull() {
    this._columnScan();
    this._blurBinary();
    this._onGeometryChange?.(this._worldVerts, this._triCount);
  }

  // ─── Internal: column-scan inside/outside test ─────────────────────────────
  // For each (gx, gz) column: collect Y intersections with the mesh using a
  // vertical ray, sort them, and parity-fill cells between paired crossings.
  // XZ bounding-box culling per triangle keeps this O(N² × localTris) ≈ fast.

  _columnScan() {
    const mask  = this._binMask;
    const verts = this._worldVerts;
    const nTri  = this._triCount;
    mask.fill(0);

    // Build per-column (gx,gz) triangle list via XZ bbox culling
    const colTris = new Array(N * N);
    for (let k = 0; k < N*N; k++) colTris[k] = [];

    for (let t = 0; t < nTri; t++) {
      const b  = t * 9;
      const x0=verts[b],   x1=verts[b+3], x2=verts[b+6];
      const z0=verts[b+2], z1=verts[b+5], z2=verts[b+8];
      const xMin=Math.min(x0,x1,x2), xMax=Math.max(x0,x1,x2);
      const zMin=Math.min(z0,z1,z2), zMax=Math.max(z0,z1,z2);

      const gxLo = Math.max(0,   Math.floor((xMin + WORLD_RANGE) / CELL_SIZE));
      const gxHi = Math.min(N-1, Math.ceil( (xMax + WORLD_RANGE) / CELL_SIZE));
      const gzLo = Math.max(0,   Math.floor((zMin + WORLD_RANGE) / CELL_SIZE));
      const gzHi = Math.min(N-1, Math.ceil( (zMax + WORLD_RANGE) / CELL_SIZE));

      for (let gx = gxLo; gx <= gxHi; gx++)
      for (let gz = gzLo; gz <= gzHi; gz++)
        colTris[gx + gz*N].push(t);
    }

    // For world-Y ↔ gy: wy(gy) = (gy - N/2 + 0.5) * CELL_SIZE
    // → gy = wy/CELL_SIZE + N/2 - 0.5
    const half = N/2 - 0.5;
    const yHits = []; // reused per column

    for (let gx = 0; gx < N; gx++)
    for (let gz = 0; gz < N; gz++) {
      const col = colTris[gx + gz*N];
      if (!col.length) continue;

      const rx = (gx - N/2 + 0.5) * CELL_SIZE;
      const rz = (gz - N/2 + 0.5) * CELL_SIZE;
      yHits.length = 0;

      for (const t of col) {
        const yh = triRayY(rx, rz, verts, t * 9);
        if (yh !== null) yHits.push(yh);
      }
      if (yHits.length < 2) continue;
      yHits.sort((a, b) => a - b);

      // Parity fill: odd-numbered crossing windows are "inside"
      for (let hi = 0; hi + 1 < yHits.length; hi += 2) {
        const yLo = yHits[hi], yHi = yHits[hi+1];
        const gyLo = Math.max(0,   Math.ceil( yLo / CELL_SIZE + half));
        const gyHi = Math.min(N-1, Math.floor(yHi / CELL_SIZE + half));
        for (let gy = gyLo; gy <= gyHi; gy++)
          mask[gx + gy*N + gz*N2] = 1.0;
      }
    }
  }

  // ─── Internal: separable box blur ─────────────────────────────────────────
  // Each round = one X + one Y + one Z pass of radius-1 box blur.
  // numPasses rounds gives ~numPasses cells of soft transition.
  // Uses clamp-to-edge boundaries (not periodic) so the mask doesn't wrap.

  _blurBinary() {
    const numPasses = Math.max(0, Math.round(this.fuzziness / CELL_SIZE));
    if (numPasses === 0) {
      this.fuzzMask.set(this._binMask);
      return;
    }
    const [t0, t1] = this._blurTmp;
    t0.set(this._binMask); // always start from binary; never accumulate

    for (let p = 0; p < numPasses; p++) {
      this._boxPass(t0, t1, 'x'); // t0 → t1
      this._boxPass(t1, t0, 'y'); // t1 → t0
      this._boxPass(t0, t1, 'z'); // t0 → t1
      t0.set(t1);                 // copy result back for next round
    }
    this.fuzzMask.set(t0);
  }

  // One 1D box-blur pass (radius = 1 cell) along the given axis.
  // Sliding-window O(N³) — no repeated summing.
  _boxPass(src, dst, axis) {
    for (let a = 0; a < N; a++)
    for (let b = 0; b < N; b++) {
      // Initial window: positions [-1, 0, 1] with clamp-to-edge → [0, 0, 1]
      let sum = src[this._fi(a, b, 0, axis)] * 2  // clamp(-1)=0 and 0 both read cell 0
              + src[this._fi(a, b, 1, axis)];
      dst[this._fi(a, b, 0, axis)] = sum / 3;

      // Slide the window one cell at a time
      for (let c = 1; c < N; c++) {
        sum += src[this._fi(a, b, Math.min(c + 1, N-1), axis)]; // enter
        sum -= src[this._fi(a, b, Math.max(c - 2, 0),   axis)]; // leave
        dst[this._fi(a, b, c, axis)] = sum / 3;
      }
    }
  }

  // Flat index for (a, b, c) where c is the axis being blurred.
  // Axis convention keeps x + y*N + z*N2 consistent with QuantumField.
  _fi(a, b, c, axis) {
    if (axis === 'x') return c + a*N + b*N2; // a=y, b=z, c=x
    if (axis === 'y') return a + c*N + b*N2; // a=x, b=z, c=y
                      return a + b*N + c*N2; // a=x, b=y, c=z
  }
}
