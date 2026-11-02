import { CatmullRomCurve3, Vector3 } from 'three/webgpu';
import { Rng, lerp, smoothstep } from '../math.js';

export const defaultTreeParams = {
  seed: 5,
  height: 8.5,
  crownWidth: 8.6,
  crownHeight: 5.4,
  clusterCount: 12,
  clusterSize: 1.0,
  clusterFlatten: 0.8,
  trunkRadius: 0.32,
  limbCount: 4,
};

export function generateTree(params) {
  const rng = new Rng(params.seed);
  const crownRadii = new Vector3(params.crownWidth / 2, params.crownHeight / 2, params.crownWidth / 2);
  const crownCenter = new Vector3(0, params.height - crownRadii.y, 0);
  const leafClusters = placeClusters(rng, params, crownCenter, crownRadii);
  const filler = {
    center: crownCenter.clone().add(new Vector3(0, -0.1 * crownRadii.y, 0)),
    axes: new Vector3(crownRadii.x * 0.62, crownRadii.y * 0.52, crownRadii.z * 0.62),
    isFiller: true,
  };
  filler.radius = Math.cbrt(filler.axes.x * filler.axes.y * filler.axes.z);
  const branches = growBranches(rng, params, crownCenter, leafClusters);
  return {
    seed: params.seed,
    height: params.height,
    crownCenter,
    crownRadii,
    clusters: [...leafClusters, filler],
    leafClusterCount: leafClusters.length,
    branches,
    woodChains: sampleWoodChains(branches),
  };
}

function placeClusters(rng, params, crownCenter, crownRadii) {
  const count = params.clusterCount;
  const baseRadius = crownRadii.x * 0.4 * params.clusterSize;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const rotation = rng.next() * Math.PI * 2;
  const clusters = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - ((i + 0.5) / count) * 1.45;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const a = rotation + i * golden + rng.signed() * 0.35;
    const dir = new Vector3(Math.cos(a) * ring, y, Math.sin(a) * ring);
    dir.add(new Vector3(rng.signed() * 0.12, rng.signed() * 0.08, rng.signed() * 0.12)).normalize();
    const radius = baseRadius * rng.range(0.88, 1.12) * lerp(0.86, 1.06, (dir.y + 1) / 2);
    const axes = new Vector3(radius, radius * params.clusterFlatten, radius);
    const reach = rng.range(0.9, 1.0);
    const center = new Vector3(
      dir.x * (crownRadii.x - axes.x),
      dir.y * (crownRadii.y - axes.y),
      dir.z * (crownRadii.z - axes.z),
    ).multiplyScalar(reach).add(crownCenter);
    clusters.push({ center, axes, radius, isFiller: false });
  }
  return clusters;
}

function growBranches(rng, params, crownCenter, clusters) {
  const r0 = params.trunkRadius;
  const branches = [];
  const trunkTop = new Vector3(rng.signed() * 0.35, params.height * 0.36, rng.signed() * 0.35);
  const trunkMid = new Vector3(0, 0, 0).lerp(trunkTop, 0.55).add(new Vector3(rng.signed() * 0.2, 0, rng.signed() * 0.2));
  branches.push({
    level: 0,
    curve: new CatmullRomCurve3([new Vector3(0, -0.4, 0), new Vector3(0, 0.6, 0), trunkMid, trunkTop]),
    radius: (t) => r0 * (1 + 0.9 * (1 - smoothstep(0, 0.2, t))) * (1 - 0.25 * t),
  });

  const limbCount = params.limbCount;
  const limbRotation = rng.next() * Math.PI * 2;
  const limbAngles = Array.from({ length: limbCount }, (_, j) => limbRotation + (j / limbCount) * Math.PI * 2 + rng.signed() * 0.3);
  const groups = limbAngles.map(() => []);
  for (const cluster of clusters) {
    const a = Math.atan2(cluster.center.z - crownCenter.z, cluster.center.x - crownCenter.x);
    let best = 0;
    let bestDiff = Infinity;
    limbAngles.forEach((la, j) => {
      const diff = Math.abs(Math.atan2(Math.sin(a - la), Math.cos(a - la)));
      if (diff < bestDiff) {
        bestDiff = diff;
        best = j;
      }
    });
    groups[best].push(cluster);
  }

  const limbRadius = r0 * 0.55;
  const twigRadius = r0 * 0.28;
  for (const group of groups) {
    if (group.length === 0) continue;
    const centroid = group.reduce((acc, c) => acc.add(c.center), new Vector3()).divideScalar(group.length);
    const end = trunkTop.clone().lerp(centroid, 0.55).add(new Vector3(0, 0.3, 0));
    const outward = new Vector3(end.x - trunkTop.x, 0, end.z - trunkTop.z).normalize();
    const mid = trunkTop.clone().lerp(end, 0.5).addScaledVector(outward, 0.3).add(new Vector3(0, 0.2, 0));
    const start = trunkTop.clone().add(new Vector3(0, -0.35, 0));
    branches.push({
      level: 1,
      curve: new CatmullRomCurve3([start, mid, end]),
      radius: (t) => limbRadius * (1 - 0.4 * t),
    });
    for (const cluster of group) {
      const twigMid = end.clone().lerp(cluster.center, 0.5).add(new Vector3(rng.signed() * 0.25, rng.signed() * 0.25, rng.signed() * 0.25));
      branches.push({
        level: 2,
        curve: new CatmullRomCurve3([end.clone().addScaledVector(outward, -0.1), twigMid, cluster.center.clone()]),
        radius: (t) => twigRadius * (1 - 0.5 * t),
      });
    }
  }
  return branches;
}

function sampleWoodChains(branches) {
  const points = [];
  for (const branch of branches) {
    if (branch.level > 1) continue;
    const steps = Math.max(2, Math.ceil(branch.curve.getLength() / 0.3));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      points.push({ center: branch.curve.getPointAt(t), radius: branch.radius(t) * (i === 0 ? -1 : 1) });
    }
  }
  return points;
}
