import * as THREE from 'three/webgpu';
import { Rng, clamp, fibonacciSphere } from '../math.js';
import { CrownField } from './crownField.js';
import { buildIcosphere } from './icosphere.js';

export const defaultShellParams = {
  patchesPerCluster: 30,
  overlap: 2.2,
  flare: 0.16,
  gridSegments: 4,
  crownSmooth: 1.0,
};

export const CORE_MAX_LEVEL = 2;
export const CROWN_MAX_LEVEL = 2;
const UV_EXTENT = 0.7;
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

class AttributeWriter {
  constructor(count, layout) {
    this.attributes = {};
    for (const [name, size] of Object.entries(layout)) {
      this.attributes[name] = { data: new Float32Array(count * size), size };
    }
  }

  set(name, index, ...values) {
    const attr = this.attributes[name];
    attr.data.set(values, index * attr.size);
  }

  setVector(name, index, v, w) {
    if (w === undefined) this.set(name, index, v.x, v.y, v.z);
    else this.set(name, index, v.x, v.y, v.z, w);
  }

  toGeometry(indices) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, { data, size }] of Object.entries(this.attributes)) {
      geometry.setAttribute(name, new THREE.BufferAttribute(data, size));
    }
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

export function buildTreeAsset(tree, shellParams) {
  const field = new CrownField(tree, shellParams.crownSmooth);
  return {
    tree,
    crownRadius: Math.max(tree.crownRadii.x, tree.crownRadii.y),
    sphereTexture: buildSphereTexture(tree),
    counts: new THREE.Vector4(tree.clusters.length, tree.woodChains.length, shellParams.crownSmooth, 0),
    crownInfo: new THREE.Vector4(tree.crownCenter.x, tree.crownCenter.y, tree.crownCenter.z, Math.max(tree.crownRadii.x, tree.crownRadii.z)),
    core: buildCore(tree, field),
    shell: buildShell(tree, field, shellParams),
    crown: buildCrown(field),
    wood: buildWood(tree, field),
  };
}

export function disposeTreeAsset(asset) {
  asset.sphereTexture.dispose();
  for (const part of [asset.core, asset.shell, asset.crown, asset.wood]) part.geometry.dispose();
}

function buildSphereTexture(tree) {
  const width = Math.max(tree.clusters.length, tree.woodChains.length, 1);
  const data = new Float32Array(width * 3 * 4);
  tree.clusters.forEach((c, i) => {
    data.set([c.center.x, c.center.y, c.center.z, Math.cbrt(c.axes.x * c.axes.y * c.axes.z) * 0.95], i * 4);
    data.set([c.axes.x, c.axes.y, c.axes.z, 0], (width * 2 + i) * 4);
  });
  tree.woodChains.forEach((s, i) => {
    data.set([s.center.x, s.center.y, s.center.z, s.radius], (width + i) * 4);
  });
  const texture = new THREE.DataTexture(data, width, 3, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function levelRanges(maxLevel, groupCount, verticesPerGroup, levels) {
  const indices = [];
  const ranges = [];
  for (let level = maxLevel; level >= 0; level--) {
    const start = indices.length;
    for (let g = 0; g < groupCount; g++) {
      for (const v of levels[level]) indices.push(g * verticesPerGroup + v);
    }
    ranges[level] = { start, count: indices.length - start };
  }
  return { indices, ranges };
}

function buildCore(tree, field) {
  const ico = buildIcosphere(CORE_MAX_LEVEL);
  const perCluster = ico.dirs.length;
  const clusters = tree.clusters;
  const w = new AttributeWriter(clusters.length * perCluster, {
    position: 3, morphPos: 3, coreData: 4, cCenter: 3, crownPos: 3, ao: 2,
  });
  clusters.forEach((cluster, ci) => {
    ico.dirs.forEach((dir, vi) => {
      const index = ci * perCluster + vi;
      const parents = ico.parents[vi];
      const morphDir = parents ? ico.dirs[parents[0]].clone().add(ico.dirs[parents[1]]).multiplyScalar(0.5) : dir;
      const morphPos = morphDir.clone().multiply(cluster.axes).add(cluster.center);
      const base = dir.clone().multiply(cluster.axes).add(cluster.center);
      const nNear = dir.clone().divide(cluster.axes).normalize();
      const aoNear = field.occlusion(base.clone().addScaledVector(nNear, 0.03), nNear, ci);
      const hull = field.hullPoint(base.clone().sub(field.origin).normalize());
      const nFar = field.normal(hull);
      const aoFar = field.occlusion(hull.clone().addScaledVector(nFar, 0.03), nFar);
      w.setVector('position', index, base);
      w.setVector('morphPos', index, morphPos);
      w.set('coreData', index, ico.birth[vi], ci, 0, 0);
      w.setVector('cCenter', index, cluster.center);
      w.setVector('crownPos', index, hull);
      w.set('ao', index, aoNear, aoFar);
    });
  });
  const { indices, ranges } = levelRanges(CORE_MAX_LEVEL, clusters.length, perCluster, ico.levels);
  return { geometry: w.toGeometry(indices), ranges };
}

function buildCrown(field) {
  const ico = buildIcosphere(CROWN_MAX_LEVEL);
  const hull = ico.dirs.map((d) => field.hullPoint(d));
  const w = new AttributeWriter(hull.length, { position: 3, morphPos: 3, crownData: 4, ao: 1 });
  hull.forEach((p, vi) => {
    const parents = ico.parents[vi];
    const morphPos = parents ? hull[parents[0]].clone().add(hull[parents[1]]).multiplyScalar(0.5) : p;
    const n = field.normal(p);
    const ao = field.occlusion(p.clone().addScaledVector(n, 0.03), n);
    w.setVector('position', vi, p);
    w.setVector('morphPos', vi, morphPos);
    w.set('crownData', vi, ico.birth[vi], 0, 0, 0);
    w.set('ao', vi, ao);
  });
  const { indices, ranges } = levelRanges(CROWN_MAX_LEVEL, 1, hull.length, ico.levels);
  return { geometry: w.toGeometry(indices), ranges };
}

function buildShell(tree, field, params) {
  const rng = new Rng(tree.seed * 7 + 3);
  const leafClusters = tree.clusters.slice(0, tree.leafClusterCount);
  const meanRadius = leafClusters.reduce((s, c) => s + c.radius, 0) / leafClusters.length;
  const patches = [];
  leafClusters.forEach((cluster, ci) => {
    const count = clamp(Math.round(params.patchesPerCluster * (cluster.radius / meanRadius) ** 2), 8, 96);
    const angle = Math.min(Math.acos(clamp(1 - (2 * params.overlap) / count, -1, 1)), 1.2);
    const rotation = new THREE.Quaternion().setFromAxisAngle(rng.unitVector(), rng.next() * Math.PI * 2);
    for (const d of fibonacciSphere(count)) {
      d.applyQuaternion(rotation).addScaledVector(rng.unitVector(), angle * 0.25).normalize();
      patches.push({
        ci,
        cluster,
        dir: d,
        angle: angle * rng.range(0.85, 1.15),
        lift: rng.range(0, 0.06),
        flare: params.flare * rng.range(0.7, 1.3),
        uvRotation: rng.next() * Math.PI * 2,
        cell: Math.floor(rng.next() * 4),
        mirror: rng.next() < 0.5,
        rand: rng.next(),
      });
    }
  });
  // Index order == rank order, so pruning N patches is just a shorter draw range.
  rng.shuffle(patches);

  const segments = params.gridSegments;
  const side = segments + 1;
  const perPatch = side * side;
  const w = new AttributeWriter(patches.length * perPatch, {
    position: 3, flareVec: 3, patchCenter: 3, uv: 2, patchData: 4, shadeNear: 4, nPatch: 3,
  });
  const indices = [];
  let maxFlare = 0;
  patches.forEach((patch, pi) => {
    const { cluster, dir } = patch;
    const rank = (pi + 0.5) / patches.length;
    const t1 = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 ? UP : RIGHT).normalize();
    const t2 = new THREE.Vector3().crossVectors(dir, t1);
    const tanA = Math.tan(patch.angle);
    const shellRadius = 1 + patch.lift;
    const center = dir.clone().multiplyScalar(shellRadius).multiply(cluster.axes).add(cluster.center);
    const cos = Math.cos(patch.uvRotation);
    const sin = Math.sin(patch.uvRotation);
    const cellU = patch.cell % 2;
    const cellV = Math.floor(patch.cell / 2);
    const flared = [];
    const proxies = [];
    const v0 = pi * perPatch;

    for (let iv = 0; iv < side; iv++) {
      for (let iu = 0; iu < side; iu++) {
        const index = v0 + iv * side + iu;
        const u = -1 + (2 * iu) / segments;
        const v = -1 + (2 * iv) / segments;
        const d = dir.clone().addScaledVector(t1, u * tanA).addScaledVector(t2, v * tanA).normalize();
        const base = d.clone().multiplyScalar(shellRadius).multiply(cluster.axes).add(cluster.center);
        const nProxy = d.clone().divide(cluster.axes).normalize();
        const s = Math.hypot(u, v);
        const flareVec = nProxy.clone().multiplyScalar(patch.flare * cluster.radius * s * s);
        maxFlare = Math.max(maxFlare, flareVec.length());
        flared.push(base.clone().add(flareVec));
        proxies.push(nProxy);

        let ru = u * cos - v * sin;
        const rv = u * sin + v * cos;
        if (patch.mirror) ru = -ru;
        const ao = field.occlusion(base.clone().addScaledVector(nProxy, 0.03), nProxy, patch.ci);
        w.setVector('position', index, base);
        w.setVector('flareVec', index, flareVec);
        w.setVector('patchCenter', index, center);
        w.set('uv', index, (cellU + 0.5 + 0.5 * UV_EXTENT * ru) / 2, (cellV + 0.5 + 0.5 * UV_EXTENT * rv) / 2);
        w.set('patchData', index, rank, patch.rand, Math.min(s, 1), patch.ci);
        w.setVector('shadeNear', index, nProxy, ao);
      }
    }

    for (let iv = 0; iv < side; iv++) {
      for (let iu = 0; iu < side; iu++) {
        const at = (x, y) => flared[clamp(y, 0, segments) * side + clamp(x, 0, segments)];
        const du = at(iu + 1, iv).clone().sub(at(iu - 1, iv));
        const dv = at(iu, iv + 1).clone().sub(at(iu, iv - 1));
        const n = du.cross(dv).normalize();
        if (n.dot(proxies[iv * side + iu]) < 0) n.negate();
        w.setVector('nPatch', v0 + iv * side + iu, n);
      }
    }

    for (let iv = 0; iv < segments; iv++) {
      for (let iu = 0; iu < segments; iu++) {
        const a = v0 + iv * side + iu;
        const b = a + 1;
        const c = a + side;
        const d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
    }
  });
  const geometry = w.toGeometry(indices);
  geometry.boundingSphere.radius += maxFlare * 2;
  return { geometry, patchCount: patches.length, indicesPerPatch: segments * segments * 6 };
}

function buildWood(tree, field) {
  const buckets = [0, 1, 2].map(() => ({ positions: [], normals: [], axes: [], data: [], indices: [] }));
  for (const branch of tree.branches) {
    const bucket = buckets[branch.level];
    const length = branch.curve.getLength();
    const lengthSegments = Math.max(4, Math.round(length / 0.25));
    const radialSegments = [12, 8, 6][branch.level];
    const frames = branch.curve.computeFrenetFrames(lengthSegments, false);
    const v0 = bucket.positions.length / 3;
    for (let i = 0; i <= lengthSegments; i++) {
      const t = i / lengthSegments;
      const p = branch.curve.getPointAt(t);
      const r = branch.radius(t);
      const N = frames.normals[i];
      const B = frames.binormals[i];
      for (let j = 0; j <= radialSegments; j++) {
        const a = (j / radialSegments) * Math.PI * 2;
        const sin = Math.sin(a);
        const cos = -Math.cos(a);
        const n = new THREE.Vector3(cos * N.x + sin * B.x, cos * N.y + sin * B.y, cos * N.z + sin * B.z).normalize();
        const pos = p.clone().addScaledVector(n, r);
        const ao = field.occlusion(pos.clone().addScaledVector(n, 0.03), n);
        bucket.positions.push(pos.x, pos.y, pos.z);
        bucket.normals.push(n.x, n.y, n.z);
        bucket.axes.push(p.x, p.y, p.z);
        bucket.data.push(branch.level, ao, 0, 0);
      }
    }
    for (let i = 1; i <= lengthSegments; i++) {
      for (let j = 1; j <= radialSegments; j++) {
        const a = v0 + (radialSegments + 1) * (i - 1) + (j - 1);
        const b = v0 + (radialSegments + 1) * i + (j - 1);
        const c = v0 + (radialSegments + 1) * i + j;
        const d = v0 + (radialSegments + 1) * (i - 1) + j;
        bucket.indices.push(a, b, d, b, c, d);
      }
    }
  }

  const vertexCount = buckets.reduce((s, b) => s + b.positions.length / 3, 0);
  const w = new AttributeWriter(vertexCount, { position: 3, normal: 3, axisPos: 3, woodData: 4 });
  const indices = [];
  const countUpToLevel = [];
  let offset = 0;
  buckets.forEach((bucket, level) => {
    w.attributes.position.data.set(bucket.positions, offset * 3);
    w.attributes.normal.data.set(bucket.normals, offset * 3);
    w.attributes.axisPos.data.set(bucket.axes, offset * 3);
    w.attributes.woodData.data.set(bucket.data, offset * 4);
    for (const i of bucket.indices) indices.push(i + offset);
    offset += bucket.positions.length / 3;
    countUpToLevel[level] = indices.length;
  });
  return { geometry: w.toGeometry(indices), countUpToLevel };
}
