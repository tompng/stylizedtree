import { fibonacciSphere, smoothstep } from '../math.js';
import { clusterRatio } from './clusterShape.js';

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

// Ambient occlusion of a point by the leaf clusters, baked per vertex.
export class ClusterOcclusion {
  constructor(tree) {
    this.items = tree.clusters;
    this.aoDirections = fibonacciSphere(64);
    this.aoRange = Math.max(tree.crownRadii.x, tree.crownRadii.y) * 1.4;
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
        if (i === exclude) continue;
        nearest = Math.min(nearest, rayEllipsoid(p, d, this.items[i]));
      }
      if (nearest < this.aoRange) occluded += w * (1 - nearest / this.aoRange);
    }
    let ao = 1 - occluded / total;
    for (let i = 0; i < this.items.length; i++) {
      if (i === exclude) continue;
      const q = clusterRatio(this.items[i], p.x, p.y, p.z);
      if (q < 1) ao *= 0.3 + 0.7 * smoothstep(0.6, 1.0, q);
    }
    return ao;
  }
}
