import * as THREE from 'three/webgpu';
import { Rng } from '../math.js';

// 2x2 atlas of leaf clumps. Channels: R = coverage (blurred so its edge can be sharpened with fwidth or kept soft),
// G = per-leaf random, B = per-leaf brush gradient. G/B are 0.5 outside leaves so mips stay neutral.
export function createLeafAtlas({ seed = 11, cell = 512, leavesPerClump = 52 } = {}) {
  const size = cell * 2;
  const rng = new Rng(seed);
  const layers = ['alpha', 'rand', 'stroke'].map(() => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    return canvas.getContext('2d');
  });
  const [alphaCtx, randCtx, strokeCtx] = layers;
  alphaCtx.fillStyle = '#000';
  alphaCtx.fillRect(0, 0, size, size);
  for (const ctx of [randCtx, strokeCtx]) {
    ctx.fillStyle = 'rgb(128,128,128)';
    ctx.fillRect(0, 0, size, size);
  }

  for (let cellIndex = 0; cellIndex < 4; cellIndex++) {
    const ox = (cellIndex % 2) * cell;
    const oy = Math.floor(cellIndex / 2) * cell;
    const cx = ox + cell / 2;
    const cy = oy + cell / 2;
    const R = cell * 0.5 * 0.68;
    for (const ctx of layers) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, cell, cell);
      ctx.clip();
    }

    const leaves = [];
    for (let i = 0; i < leavesPerClump; i++) {
      const dist = R * 0.85 * rng.next();
      const a = rng.next() * Math.PI * 2;
      const heading = dist < R * 0.2 ? rng.next() * Math.PI * 2 : a + rng.signed() * 0.7;
      const length = Math.min(R * rng.range(0.2, 0.32), 2 * (R * 0.98 - dist));
      if (length < R * 0.06) continue;
      const x = cx + Math.cos(a) * dist;
      const y = cy + Math.sin(a) * dist;
      leaves.push({ x, y, heading, length, width: length * rng.range(0.5, 0.7), rand: rng.next(), dist });
    }
    leaves.sort((p, q) => q.dist - p.dist);
    for (const leaf of leaves) drawLeaf(layers, leaf);

    for (const ctx of layers) ctx.restore();
  }

  const [alpha, rand, stroke] = layers.map((ctx) => ctx.getImageData(0, 0, size, size).data);
  const coverage = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) coverage[i] = alpha[i * 4] / 255;
  const blurred = boxBlur(boxBlur(boxBlur(coverage, size, 4), size, 4), size, 4);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round(blurred[i] * 255);
    data[i * 4 + 1] = rand[i * 4];
    data[i * 4 + 2] = stroke[i * 4];
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function leafPath(ctx, length, width, endAngle = Math.PI * 2) {
  ctx.beginPath();
  ctx.ellipse(0, 0, length / 2, width / 2, 0, 0, endAngle);
  ctx.closePath();
}

function drawLeaf([alphaCtx, randCtx, strokeCtx], { x, y, heading, length, width, rand }) {
  for (const ctx of [alphaCtx, randCtx, strokeCtx]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
  }
  leafPath(alphaCtx, length, width);
  alphaCtx.fillStyle = '#fff';
  alphaCtx.fill();

  const g = Math.round(rand * 255);
  leafPath(randCtx, length, width);
  randCtx.fillStyle = `rgb(${g},${g},${g})`;
  randCtx.fill();

  const gradient = strokeCtx.createLinearGradient(-length / 2, 0, length / 2, 0);
  gradient.addColorStop(0, 'rgb(70,70,70)');
  gradient.addColorStop(1, 'rgb(210,210,210)');
  leafPath(strokeCtx, length, width);
  strokeCtx.fillStyle = gradient;
  strokeCtx.fill();
  leafPath(strokeCtx, length, width, Math.PI);
  strokeCtx.fillStyle = 'rgba(0,0,0,0.22)';
  strokeCtx.fill();

  for (const ctx of [alphaCtx, randCtx, strokeCtx]) ctx.restore();
}

function boxBlur(src, size, radius) {
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += src[y * size + Math.min(size - 1, Math.max(0, x + k))];
      tmp[y * size + x] = sum / span;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += tmp[Math.min(size - 1, Math.max(0, y + k)) * size + x];
      dst[y * size + x] = sum / span;
    }
  }
  return dst;
}
