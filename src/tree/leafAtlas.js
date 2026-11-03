import * as THREE from 'three/webgpu';
import { Rng } from '../math.js';

// Disc radius inside each atlas cell. Must match the 0.96 in leaf_uv.wgsl.
const DISC = 0.96;

// 2x2 atlas. Each cell is one cluster hemisphere in Lambert azimuthal equal-area projection
// (leaf_uv.wgsl), so leaves placed uniformly in the disc are uniform on the sphere. Each leaf is
// drawn through the projection's Jacobian at its position so it keeps its shape on the sphere.
// Channels: R = coverage (blurred so its edge can be sharpened with fwidth or kept soft),
// G = per-leaf random (dilated past the leaf so the blurred fringe carries the leaf's value),
// B = per-leaf brush gradient, A = leaf core (1 at each leaf center, falling to 0 just past its
// outline; a rising threshold on it shrinks every leaf toward its own center).
// G/B are 0.5 outside leaves so mips stay neutral.
export function createLeafAtlas({
  seed = 11,
  cell = 1024,
  leavesPerHemisphere = 1300,
  leafLength = [0.07, 0.12],
  leafAspect = [0.5, 0.7],
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

  for (let cellIndex = 0; cellIndex < 4; cellIndex++) {
    const ox = (cellIndex % 2) * cell;
    const oy = Math.floor(cellIndex / 2) * cell;
    const R = (cell / 2) * DISC;
    const leaves = [];
    for (let i = 0; i < leavesPerHemisphere; i++) {
      const rho = Math.sqrt(rng.next());
      const phi = rng.next() * Math.PI * 2;
      const theta = 2 * Math.asin(rho / Math.SQRT2);
      const length = rng.range(leafLength[0], leafLength[1]);
      leaves.push({
        x: ox + cell / 2 + R * rho * Math.cos(phi),
        y: oy + cell / 2 + R * rho * Math.sin(phi),
        phi,
        radialScale: R * Math.SQRT1_2 * Math.cos(theta / 2),
        tangentialScale: R * (theta > 1e-4 ? rho / Math.sin(theta) : Math.SQRT1_2),
        heading: rng.next() * Math.PI * 2,
        length,
        width: length * rng.range(leafAspect[0], leafAspect[1]),
        rand: rng.next(),
      });
    }

    for (const ctx of layers) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, cell, cell);
      ctx.clip();
    }
    const dilate = 8 / (R * 0.6);
    for (const leaf of leaves) {
      withLeafFrame(randCtx, leaf, () => {
        leafPath(randCtx, leaf.length, leaf.width);
        randCtx.lineWidth = dilate;
        randCtx.strokeStyle = gray(leaf.rand);
        randCtx.stroke();
      });
    }
    for (const leaf of leaves) drawLeaf(layers, leaf);
    for (const ctx of layers) ctx.restore();
  }

  const [alpha, rand, stroke, core] = layers.map((ctx) => ctx.getImageData(0, 0, size, size).data);
  const coverage = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) coverage[i] = alpha[i * 4] / 255;
  const blurred = boxBlur(boxBlur(boxBlur(coverage, size, 3), size, 3), size, 3);
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
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
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

function leafPath(ctx, length, width, endAngle = Math.PI * 2) {
  ctx.beginPath();
  ctx.ellipse(0, 0, length / 2, width / 2, 0, 0, endAngle);
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
    leafPath(strokeCtx, length, width, Math.PI);
    strokeCtx.fillStyle = 'rgba(0,0,0,0.22)';
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

function boxBlur(src, size, radius) {
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  const span = radius * 2 + 1;
  const at = (i) => Math.min(size - 1, Math.max(0, i));
  for (let y = 0; y < size; y++) {
    const row = y * size;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[row + at(k)];
    for (let x = 0; x < size; x++) {
      tmp[row + x] = sum / span;
      sum += src[row + at(x + radius + 1)] - src[row + at(x - radius)];
    }
  }
  for (let x = 0; x < size; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[at(k) * size + x];
    for (let y = 0; y < size; y++) {
      dst[y * size + x] = sum / span;
      sum += tmp[at(y + radius + 1) * size + x] - tmp[at(y - radius) * size + x];
    }
  }
  return dst;
}
