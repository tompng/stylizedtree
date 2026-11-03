import { Vector3 } from 'three/webgpu';

// Cluster surface: |q / axes| = s(q̂), q = p - center, s(n) = base + Σ w·exp(κ(n·u - 1)).

export function lobeMean(sharpness) {
  return (1 - Math.exp(-2 * sharpness)) / (2 * sharpness);
}

function lobeScale({ base, sharpness, lobes }, nx, ny, nz) {
  let s = base;
  for (const { dir, weight } of lobes) s += weight * Math.exp(sharpness * (nx * dir.x + ny * dir.y + nz * dir.z - 1));
  return s;
}

// `dir` is a unit vector in the cluster's unit-sphere parameter space (dir ⊙ axes is on the base ellipsoid).
export function clusterSurfacePoint(cluster, dir, scale = 1) {
  const q = dir.clone().multiply(cluster.axes);
  const len = q.length();
  return q.multiplyScalar(lobeScale(cluster.shape, q.x / len, q.y / len, q.z / len) * scale).add(cluster.center);
}

export function clusterNormal(cluster, p) {
  const { center: c, axes: a, shape } = cluster;
  const qx = p.x - c.x;
  const qy = p.y - c.y;
  const qz = p.z - c.z;
  const len = Math.max(Math.hypot(qx, qy, qz), 1e-6);
  const nx = qx / len;
  const ny = qy / len;
  const nz = qz / len;
  let s = shape.base;
  const ds = new Vector3();
  for (const { dir, weight } of shape.lobes) {
    const d = nx * dir.x + ny * dir.y + nz * dir.z;
    const e = weight * Math.exp(shape.sharpness * (d - 1));
    s += e;
    const k = (e * shape.sharpness) / len;
    ds.x += k * (dir.x - d * nx);
    ds.y += k * (dir.y - d * ny);
    ds.z += k * (dir.z - d * nz);
  }
  const g = Math.max(Math.hypot(qx / a.x, qy / a.y, qz / a.z), 1e-6);
  const k = g / (s * s);
  return new Vector3(
    qx / (a.x * a.x * g * s) - ds.x * k,
    qy / (a.y * a.y * g * s) - ds.y * k,
    qz / (a.z * a.z * g * s) - ds.z * k,
  ).normalize();
}

// < 1 inside, 1 on the surface.
export function clusterRatio(cluster, x, y, z) {
  const { center: c, axes: a } = cluster;
  const qx = x - c.x;
  const qy = y - c.y;
  const qz = z - c.z;
  const len = Math.hypot(qx, qy, qz);
  if (len < 1e-9) return 0;
  return Math.hypot(qx / a.x, qy / a.y, qz / a.z) / lobeScale(cluster.shape, qx / len, qy / len, qz / len);
}
