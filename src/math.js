import { Vector3 } from 'three/webgpu';

export class Rng {
  constructor(seed) {
    this.state = Math.imul(seed | 0, 2654435761) >>> 0 || 1;
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }

  signed() {
    return this.next() * 2 - 1;
  }

  unitVector() {
    const y = this.signed();
    const a = this.next() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    return new Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  }

  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

export function fibonacciSphere(count) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const points = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const a = i * golden;
    points.push(new Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  return points;
}

export const clamp = (x, min, max) => Math.min(Math.max(x, min), max);
export const lerp = (a, b, t) => a + (b - a) * t;

export function smoothstep(edge0, edge1, x) {
  if (edge0 >= edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash1(i) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  return lerp(hash1(i), hash1(i + 1), f * f * (3 - 2 * f));
}
