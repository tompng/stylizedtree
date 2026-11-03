import { Vector3 } from 'three/webgpu';
import { fibonacciSphere, smoothstep } from '../math.js';
import { clusterRatio, clusterSdf } from './clusterShape.js';

function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function rayEllipsoid(o, d, { center: c, axes: a }) {
  const ox = (o.x - c.x) / a.x;
  const oy = (o.y - c.y) / a.y;
  const oz = (o.z - c.z) / a.z;
  const dx = d.x / a.x;
  const dy = d.y / a.y;
  const dz = d.z / a.z;
  const A = dx * dx + dy * dy + dz * dz;
  const B = ox * dx + oy * dy + oz * dz;
  const C = ox * ox + oy * oy + oz * oz - 1;
  if (C < 0) return Infinity;
  const disc = B * B - A * C;
  if (disc < 0) return Infinity;
  const t = (-B - Math.sqrt(disc)) / A;
  return t > 0 ? t : Infinity;
}

// Smooth union of all clusters. Its outermost surface seen from the crown center
// is the shape that every far LOD (merged cores, crown mesh) converges to.
export class CrownField {
  constructor(tree, smoothK) {
    this.items = tree.clusters;
    this.k = Math.max(smoothK, 1e-3);
    this.origin = tree.crownCenter.clone();
    let reach = 0;
    for (const { center, axes, shape } of this.items) {
      const maxScale = shape.lobes.reduce((s, l) => s + l.weight, shape.base);
      reach = Math.max(reach, center.distanceTo(this.origin) + Math.max(axes.x, axes.y, axes.z) * maxScale);
    }
    this.reach = reach + this.k + 0.5;
    this.aoDirections = fibonacciSphere(64);
    this.aoRange = Math.max(tree.crownRadii.x, tree.crownRadii.y) * 1.4;
  }

  sdf(x, y, z) {
    let d = Infinity;
    for (const cluster of this.items) {
      const e = clusterSdf(cluster, x, y, z);
      d = d === Infinity ? e : smin(d, e, this.k);
    }
    return d;
  }

  sdfAlong(dir, t) {
    const o = this.origin;
    return this.sdf(o.x + dir.x * t, o.y + dir.y * t, o.z + dir.z * t);
  }

  hullPoint(dir) {
    let t = this.reach;
    let prevT = t;
    for (let i = 0; i < 300; i++) {
      const d = this.sdfAlong(dir, t);
      if (d < 1e-3) {
        if (d < -1e-3) {
          let inside = t;
          let outside = prevT;
          for (let j = 0; j < 24; j++) {
            const mid = (inside + outside) / 2;
            if (this.sdfAlong(dir, mid) < 0) inside = mid;
            else outside = mid;
          }
          t = (inside + outside) / 2;
        }
        break;
      }
      prevT = t;
      t -= Math.max(d * 0.8, 0.005);
      if (t <= 0.05) {
        t = 0.05;
        break;
      }
    }
    return this.origin.clone().addScaledVector(dir, t);
  }

  normal(p) {
    const e = 0.01;
    return new Vector3(
      this.sdf(p.x + e, p.y, p.z) - this.sdf(p.x - e, p.y, p.z),
      this.sdf(p.x, p.y + e, p.z) - this.sdf(p.x, p.y - e, p.z),
      this.sdf(p.x, p.y, p.z + e) - this.sdf(p.x, p.y, p.z - e),
    ).normalize();
  }

  occlusion(p, n, exclude = -1) {
    let occluded = 0;
    let total = 0;
    for (const d of this.aoDirections) {
      const w = d.dot(n);
      if (w <= 0) continue;
      total += w;
      let nearest = Infinity;
      for (let i = 0; i < this.items.length; i++) {
        if (i === exclude || this.items[i].isFiller) continue;
        nearest = Math.min(nearest, rayEllipsoid(p, d, this.items[i]));
      }
      if (nearest < this.aoRange) occluded += w * (1 - nearest / this.aoRange);
    }
    let ao = 1 - occluded / total;
    for (let i = 0; i < this.items.length; i++) {
      if (i === exclude || this.items[i].isFiller) continue;
      const q = clusterRatio(this.items[i], p.x, p.y, p.z);
      if (q < 1) ao *= 0.3 + 0.7 * smoothstep(0.6, 1.0, q);
    }
    return ao;
  }
}
