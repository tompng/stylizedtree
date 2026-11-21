import * as THREE from 'three/webgpu';
import { Rng, clamp, lerp } from '../math.js';

// Disc radius inside each atlas cell. Must match the 0.96 in leaf_sphere_sample.wgsl.
const DISC = 0.96;

// 2x2 atlas holding two whole-sphere leaf patterns: pattern p has its upper hemisphere in cell 2p
// and its lower hemisphere in cell 2p + 1, each a disc in Lambert azimuthal equal-area projection
// (leaf_sphere_sample.wgsl), so leaves placed uniformly on the sphere are uniform in the discs.
// Each leaf is drawn through the projection's Jacobian at its position so it keeps its shape on the sphere.
// Channels: R = coverage (blurred so its edge can be sharpened with fwidth or kept soft),
// G = per-leaf random (dilated past the leaf so the blurred fringe carries the leaf's value),
// B = per-leaf brush gradient, A = leaf core (1 at each leaf center, falling to 0 just past its
// outline; a rising threshold on it shrinks every leaf toward its own center).
// G/B are 0.5 outside leaves so mips stay neutral.
// The gap, blur and dilation are in pixels of a `designCell` cell and scale with `cell`, so the same
// seed gives the same leaves at any resolution.
export function createLeafAtlas({
  seed = 11,
  cell = 1024,
  designCell = cell,
  sizeScale = 1,
  candidates = Math.round(40000 / sizeScale ** 2),
  leafLength = [0.07 * sizeScale, 0.12 * sizeScale],
  leafAspect = [0.5, 0.7],
  gapPixels = 3,
} = {}) {
  const size = cell * 2;
  const rng = new Rng(seed);
  const layers = ['alpha', 'rand', 'stroke', 'core'].map(() => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    return canvas.getContext('2d');
  });
  const [alphaCtx, randCtx, strokeCtx, coreCtx] = layers;
  for (const ctx of [alphaCtx, coreCtx]) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
  }
  coreCtx.globalCompositeOperation = 'lighten';
  for (const ctx of [randCtx, strokeCtx]) {
    ctx.fillStyle = 'rgb(128,128,128)';
    ctx.fillRect(0, 0, size, size);
  }

  const R = (cell / 2) * DISC;
  const texelScale = cell / designCell;
  // The projection never maps a radian to fewer than R / 2 pixels.
  const gap = (gapPixels * texelScale) / (R / 2);
  const leafCounts = [];
  let widthSum = 0;
  for (let pattern = 0; pattern < 2; pattern++) {
    const pool = Array.from({ length: candidates }, () => {
      const theta = Math.acos(1 - 2 * rng.next());
      const phi = rng.next() * Math.PI * 2;
      const length = rng.range(leafLength[0], leafLength[1]);
      return {
        theta,
        phi,
        length,
        heading: rng.next() * Math.PI * 2,
        width: length * rng.range(leafAspect[0], leafAspect[1]),
        rand: rng.next(),
      };
    });
    const leaves = placeApart(pool, { reach: leafLength[1], gap });
    leafCounts.push(leaves.length);
    for (const leaf of leaves) widthSum += leaf.width;

    for (const sign of [1, -1]) {
      const cellIndex = 2 * pattern + (sign > 0 ? 0 : 1);
      const ox = (cellIndex % 2) * cell;
      const oy = Math.floor(cellIndex / 2) * cell;
      // Leaves of the other hemisphere that reach across the equator are drawn as well, through the
      // projection continued past the equator, so the two cells agree along it. Seen from the lower
      // pole the radial direction points north, so headings mirror to keep each leaf's 3D direction.
      const placed = [];
      for (const leaf of leaves) {
        const theta = sign > 0 ? leaf.theta : Math.PI - leaf.theta;
        if (theta > Math.PI / 2 + leafLength[1]) continue;
        const rho = Math.SQRT2 * Math.sin(theta / 2);
        placed.push({
          ...leaf,
          x: ox + cell / 2 + R * rho * Math.cos(leaf.phi),
          y: oy + cell / 2 + R * rho * Math.sin(leaf.phi),
          radialScale: R * Math.SQRT1_2 * Math.cos(theta / 2),
          tangentialScale: R * (theta > 1e-4 ? rho / Math.sin(theta) : Math.SQRT1_2),
          heading: sign > 0 ? leaf.heading : Math.PI - leaf.heading,
        });
      }

      for (const ctx of layers) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(ox, oy, cell, cell);
        ctx.clip();
      }
      const dilate = (8 * texelScale) / (R * 0.6);
      for (const leaf of placed) {
        withLeafFrame(randCtx, leaf, () => {
          leafPath(randCtx, leaf.length, leaf.width);
          randCtx.lineWidth = dilate;
          randCtx.strokeStyle = gray(leaf.rand);
          randCtx.stroke();
        });
      }
      for (const leaf of placed) drawLeaf(layers, leaf);
      for (const ctx of layers) ctx.restore();
    }
  }

  const [alpha, rand, stroke, core] = layers.map((ctx) => ctx.getImageData(0, 0, size, size).data);
  const coverage = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) coverage[i] = alpha[i * 4] / 255;
  // A whole-radius box has variance r(r + 1) / 3, not proportional to r², so a radius scaled with
  // the atlas would blur small atlases more than large ones.
  const blurRadius = boxRadiusForVariance(4 * texelScale ** 2);
  const blurred = boxBlur(boxBlur(boxBlur(coverage, size, blurRadius), size, blurRadius), size, blurRadius);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round(blurred[i] * 255);
    data[i * 4 + 1] = rand[i * 4];
    data[i * 4 + 2] = stroke[i * 4];
    data[i * 4 + 3] = core[i * 4];
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  texture.userData = {
    leafCounts,
    // Typical radians-to-texels scale of the projection.
    leafWidthTexels: (widthSum / (leafCounts[0] + leafCounts[1])) * R * 0.6,
    ...coverageStats(blurred, size, cell, R),
    shrinkSamples: shrinkSamples(blurred, data, size, cell, R),
    keptTexture: createKeptTexture(),
  };
  texture.addEventListener('dispose', () => texture.userData.keptTexture.dispose());
  return texture;
}

// (coverage, core, rand) of every other texel inside the discs that a cutoff could keep.
function shrinkSamples(coverage, data, size, cell, R) {
  const samples = [];
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      if (Math.hypot((x % cell) + 0.5 - cell / 2, (y % cell) + 0.5 - cell / 2) > R) continue;
      const i = y * size + x;
      if (coverage[i] > 0.02) samples.push(coverage[i], data[i * 4 + 3] / 255, data[i * 4 + 1] / 255);
    }
  }
  return new Float32Array(samples);
}

const KEPT_BINS = 64;

function createKeptTexture() {
  const texture = new THREE.DataTexture(new Uint8Array(KEPT_BINS), KEPT_BINS, 1, THREE.RedFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.userData.key = '';
  return texture;
}

// Fills the atlas's keptTexture: at u = threshold, the fraction of the leaf texels above `cutoff`
// that the shrink threshold keeps (st_leafSampleGrad, same core and ramp), for minified layers
// whose averaged core no longer marks where the leaf centers are.
export function updateKeptTexture(atlas, cutoff, leafVariation, shrinkSoftness) {
  const { shrinkSamples: samples, keptTexture } = atlas.userData;
  const key = `${cutoff},${leafVariation},${shrinkSoftness}`;
  if (keptTexture.userData.key === key) return;
  keptTexture.userData.key = key;
  const softness = Math.max(shrinkSoftness, 0.0001);
  const kept = new Float64Array(KEPT_BINS);
  let count = 0;
  for (let i = 0; i < samples.length; i += 3) {
    if (samples[i] < cutoff) continue;
    const core = samples[i + 1] * lerp(1, samples[i + 2], leafVariation);
    for (let b = 0; b < KEPT_BINS; b++) {
      const threshold = b / (KEPT_BINS - 1);
      kept[b] += clamp((core - threshold * (1 + softness)) / softness + 1, 0, 1);
    }
    count++;
  }
  for (let b = 0; b < KEPT_BINS; b++) keptTexture.image.data[b] = Math.round((count > 0 ? kept[b] / count : 0) * 255);
  keptTexture.needsUpdate = true;
}

// Coverage inside the discs: its mean, and the fraction of texels above each threshold
// i / (coverageAbove.length - 1).
function coverageStats(coverage, size, cell, R) {
  const bins = 64;
  const above = new Float64Array(bins + 1);
  let sum = 0;
  let count = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (Math.hypot((x % cell) + 0.5 - cell / 2, (y % cell) + 0.5 - cell / 2) > R) continue;
      const c = coverage[y * size + x];
      sum += c;
      count++;
      above[Math.min(Math.floor(c * bins), bins)]++;
    }
  }
  for (let i = bins - 1; i >= 0; i--) above[i] += above[i + 1];
  return { meanCoverage: sum / count, coverageAbove: Array.from(above, (n) => n / count) };
}

// Scale on the mip-averaged coverage that makes a minified leaf layer, where each pixel spans
// several leaves, as opaque on average as the full-resolution layer thresholded at `cutoff`.
export function farCoverageScale(atlas, cutoff) {
  const { coverageAbove, meanCoverage } = atlas.userData;
  const x = clamp(cutoff, 0, 1) * (coverageAbove.length - 1);
  const i = Math.min(Math.floor(x), coverageAbove.length - 2);
  return lerp(coverageAbove[i], coverageAbove[i + 1], x - i) / meanCoverage;
}

// Touching leaves would merge into one smooth blob once the coverage is blurred and thresholded,
// reading as one large leaf. Candidates are placed largest first and dropped when they come within
// `gap` of a placed leaf, testing each ellipse as the capsule that contains it, on the unit sphere.
function placeApart(pool, { reach, gap }) {
  const cellSize = reach + gap;
  const grid = new Map();
  const keyOf = ([x, y, z]) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`;
  const near = (center) => {
    const [cx, cy, cz] = center.map((v) => Math.floor(v / cellSize));
    const found = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) found.push(...(grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []));
      }
    }
    return found;
  };
  const clear = (a, b) => segmentDistance(a.p0, a.p1, b.p0, b.p1) >= a.radius + b.radius + gap;

  const placed = [];
  for (const leaf of [...pool].sort((a, b) => b.length - a.length)) {
    const capsule = leafCapsule(leaf);
    if (!near(capsule.center).every((other) => clear(capsule, other))) continue;
    const key = keyOf(capsule.center);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(capsule);
    placed.push(leaf);
  }
  return placed;
}

// Matches the drawing frame: the leaf's long axis is cos(heading) along +theta (away from the
// pole) plus sin(heading) along +phi.
function leafCapsule({ theta, phi, heading, length, width }) {
  const st = Math.sin(theta);
  const ct = Math.cos(theta);
  const sp = Math.sin(phi);
  const cp = Math.cos(phi);
  const center = [st * cp, ct, st * sp];
  const ch = Math.cos(heading);
  const sh = Math.sin(heading);
  const axis = [ch * ct * cp - sh * sp, -ch * st, ch * ct * sp + sh * cp];
  const radius = width / 2;
  const half = Math.max(length / 2 - radius, 0);
  return {
    center,
    radius,
    p0: center.map((c, i) => c - axis[i] * half),
    p1: center.map((c, i) => c + axis[i] * half),
  };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp01 = (x) => Math.min(Math.max(x, 0), 1);

// Closest distance between segments p0-p1 and q0-q1 (Ericson, Real-Time Collision Detection 5.1.9).
function segmentDistance(p0, p1, q0, q1) {
  const d1 = sub(p1, p0);
  const d2 = sub(q1, q0);
  const r = sub(p0, q0);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s = 0;
  let t = 0;
  if (a < 1e-12 && e < 1e-12) {
    s = 0;
    t = 0;
  } else if (a < 1e-12) {
    t = clamp01(f / e);
  } else {
    const c = dot(d1, r);
    if (e < 1e-12) {
      s = clamp01(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-12 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const diff = [0, 1, 2].map((i) => p0[i] + d1[i] * s - (q0[i] + d2[i] * t));
  return Math.sqrt(dot(diff, diff));
}

const gray = (t) => {
  const g = Math.round(t * 255);
  return `rgb(${g},${g},${g})`;
};

function withLeafFrame(ctx, { x, y, phi, radialScale, tangentialScale, heading }, draw) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(phi);
  ctx.scale(radialScale, tangentialScale);
  ctx.rotate(heading);
  draw();
  ctx.restore();
}

function leafPath(ctx, length, width) {
  ctx.beginPath();
  ctx.ellipse(0, 0, length / 2, width / 2, 0, 0, Math.PI * 2);
  ctx.closePath();
}

function drawLeaf([alphaCtx, randCtx, strokeCtx, coreCtx], leaf) {
  const { length, width } = leaf;
  withLeafFrame(alphaCtx, leaf, () => {
    leafPath(alphaCtx, length, width);
    alphaCtx.fillStyle = '#fff';
    alphaCtx.fill();
  });
  withLeafFrame(randCtx, leaf, () => {
    leafPath(randCtx, length, width);
    randCtx.fillStyle = gray(leaf.rand);
    randCtx.fill();
  });
  withLeafFrame(strokeCtx, leaf, () => {
    const gradient = strokeCtx.createLinearGradient(-length / 2, 0, length / 2, 0);
    gradient.addColorStop(0, 'rgb(70,70,70)');
    gradient.addColorStop(1, 'rgb(210,210,210)');
    leafPath(strokeCtx, length, width);
    strokeCtx.fillStyle = gradient;
    strokeCtx.fill();
  });
  withLeafFrame(coreCtx, leaf, () => {
    coreCtx.scale(length / 2, width / 2);
    const reach = 1.15;
    const gradient = coreCtx.createRadialGradient(0, 0, 0, 0, 0, reach);
    gradient.addColorStop(0, '#fff');
    gradient.addColorStop(1 / reach, 'rgb(20,20,20)');
    gradient.addColorStop(1, '#000');
    coreCtx.beginPath();
    coreCtx.arc(0, 0, reach, 0, Math.PI * 2);
    coreCtx.fillStyle = gradient;
    coreCtx.fill();
  });
}

// Radius whose box (boxBlur, fractional radii included) has the given variance in pixels².
function boxRadiusForVariance(variance) {
  let whole = 0;
  while (((whole + 1) * (whole + 2)) / 3 <= variance) whole++;
  const weightedSquares = (whole * (whole + 1) * (2 * whole + 1)) / 3;
  const weights = 2 * whole + 1;
  return whole + (variance * weights - weightedSquares) / (2 * ((whole + 1) ** 2 - variance));
}

// A fractional radius weights the two samples just outside the whole-pixel window by its fraction.
function boxBlur(src, size, radius) {
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  const whole = Math.floor(radius);
  const frac = radius - whole;
  const span = radius * 2 + 1;
  const at = (i) => Math.min(size - 1, Math.max(0, i));
  const blurLine = (input, output, base, step) => {
    let sum = 0;
    for (let k = -whole; k <= whole; k++) sum += input[base + at(k) * step];
    for (let i = 0; i < size; i++) {
      const outside = input[base + at(i - whole - 1) * step] + input[base + at(i + whole + 1) * step];
      output[base + i * step] = (sum + frac * outside) / span;
      sum += input[base + at(i + whole + 1) * step] - input[base + at(i - whole) * step];
    }
  };
  for (let y = 0; y < size; y++) blurLine(src, tmp, y * size, 1);
  for (let x = 0; x < size; x++) blurLine(tmp, dst, x, size);
  return dst;
}
