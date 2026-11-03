import * as THREE from 'three/webgpu';
import { Rng } from '../math.js';
import { clusterNormal, clusterSurfacePoint } from './clusterShape.js';
import { CrownField } from './crownField.js';
import { buildIcosphere } from './icosphere.js';

export const defaultShellParams = {
  patchDivisions: 2,
  overlap: 4,
  flare: 0.4,
  depth: 0.35,
  gridSegments: 3,
  crownSmooth: 1.0,
};

export const CORE_MAX_LEVEL = 2;
export const CROWN_MAX_LEVEL = 2;

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
    counts: new THREE.Vector4(tree.clusters.length, tree.woodChains.length, shellParams.crownSmooth, tree.clusters[0].shape.lobes.length),
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

// Rows: 0 = center + shadow radius (0 casts no shadow), 1 = wood chain points, 2 = axes,
// 3 = lobe base, lobe sharpness, leaf atlas yaw, leaf atlas cell, 4.. = one lobe (direction, weight) per row.
function buildSphereTexture(tree) {
  const rng = new Rng(tree.seed * 13 + 5);
  const width = Math.max(tree.clusters.length, tree.woodChains.length, 1);
  const lobeCount = tree.clusters[0].shape.lobes.length;
  const height = 4 + lobeCount;
  const data = new Float32Array(width * height * 4);
  const put = (row, column, values) => data.set(values, (width * row + column) * 4);
  tree.clusters.forEach((c, i) => {
    const shadowRadius = c.isFiller ? 0 : Math.cbrt(c.axes.x * c.axes.y * c.axes.z) * 0.95;
    put(0, i, [c.center.x, c.center.y, c.center.z, shadowRadius]);
    put(2, i, [c.axes.x, c.axes.y, c.axes.z, 0]);
    put(3, i, [c.shape.base, c.shape.sharpness, rng.next() * Math.PI * 2, Math.floor(rng.next() * 4)]);
    c.shape.lobes.forEach(({ dir, weight }, k) => put(4 + k, i, [dir.x, dir.y, dir.z, weight]));
  });
  tree.woodChains.forEach((s, i) => put(1, i, [s.center.x, s.center.y, s.center.z, s.radius]));
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
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
    const surface = ico.dirs.map((dir) => clusterSurfacePoint(cluster, dir));
    ico.dirs.forEach((dir, vi) => {
      const index = ci * perCluster + vi;
      const parents = ico.parents[vi];
      const base = surface[vi];
      const morphPos = parents ? surface[parents[0]].clone().add(surface[parents[1]]).multiplyScalar(0.5) : base;
      const nNear = clusterNormal(cluster, base);
      const aoNear = field.occlusion(base.clone().addScaledVector(nNear, 0.03), nNear, ci);
      const hull = field.hullPoint(base.clone().sub(field.origin).normalize());
      const nFar = field.normal(hull);
      const aoFar = field.occlusion(hull.clone().addScaledVector(nFar, 0.03), nFar);
      w.setVector('position', index, base);
      w.setVector('morphPos', index, morphPos);
      w.set('coreData', index, ico.birth[vi], ci, cluster.isFiller ? 1 : 0, 0);
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

// Rhombic triacontahedron: one rhombus per icosahedron edge, spanning its two endpoints and the
// centers of the two faces sharing it. Corners are counter-clockwise seen from outside.
function triacontahedronRhombi() {
  const ico = buildIcosphere(0);
  const faces = ico.levels[0];
  const centers = [];
  const edgeFaces = new Map();
  for (let f = 0; f < faces.length / 3; f++) {
    const [a, b, c] = faces.slice(f * 3, f * 3 + 3);
    centers.push(ico.dirs[a].clone().add(ico.dirs[b]).add(ico.dirs[c]).normalize());
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = Math.min(p, q) * 100 + Math.max(p, q);
      if (!edgeFaces.has(key)) edgeFaces.set(key, { p, q, faces: [] });
      edgeFaces.get(key).faces.push(f);
    }
  }
  return [...edgeFaces.values()].map(({ p, q, faces: [f1, f2] }) => {
    const a = ico.dirs[p];
    const b = ico.dirs[q];
    let c1 = centers[f1];
    let c2 = centers[f2];
    const normal = c1.clone().sub(a).cross(c2.clone().sub(a));
    if (normal.dot(a.clone().add(b)) < 0) [c1, c2] = [c2, c1];
    return [a, c1, b, c2];
  });
}

function rhombusPoint([c00, c10, c11, c01], u, v) {
  return c00.clone().multiplyScalar((1 - u) * (1 - v))
    .addScaledVector(c10, u * (1 - v))
    .addScaledVector(c11, u * v)
    .addScaledVector(c01, (1 - u) * v)
    .normalize();
}

// At rest (near offset 0) the patches tile each cluster surface exactly, edge to edge, and every
// fragment looks up the leaf atlas from its own surface direction, so the tiled shell and the
// core mesh show the same leaves. Up close each patch is scaled up around its center (overlap),
// pushed inward (depth) and curled outward (flare); its leaves stay attached to it.
function buildShell(tree, field, params) {
  const rng = new Rng(tree.seed * 7 + 3);
  const rhombi = triacontahedronRhombi();
  const n = params.patchDivisions;
  const segments = params.gridSegments;
  const side = segments + 1;
  const perPatch = side * side;
  const leafClusters = tree.clusters.slice(0, tree.leafClusterCount);
  const patchCount = leafClusters.length * rhombi.length * n * n;
  const w = new AttributeWriter(patchCount * perPatch, {
    position: 3, nearOffset: 3, patchCenter: 3, patchUv: 2, patchData: 4, nPatchAo: 4,
  });
  const indices = [];
  let maxOffset = 0;
  let pi = 0;
  const scale = Math.sqrt(Math.max(params.overlap, 1));

  leafClusters.forEach((cluster, ci) => {
    const rotation = new THREE.Quaternion().setFromAxisAngle(rng.unitVector(), rng.next() * Math.PI * 2);
    const corners = rhombi.map((r) => r.map((d) => d.clone().applyQuaternion(rotation)));
    for (const rhombus of corners) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const depth = rng.next();
          const nearScale = 1 - params.depth * depth;
          const grow = scale * rng.range(0.9, 1.1);
          const flare = params.flare * rng.range(0.7, 1.3);
          const rand = rng.next();
          const center = clusterSurfacePoint(cluster, rhombusPoint(rhombus, (i + 0.5) / n, (j + 0.5) / n));
          const nearCenter = center.clone().sub(cluster.center).multiplyScalar(nearScale).add(cluster.center);
          const near = [];
          const normals = [];
          const v0 = pi * perPatch;

          for (let iv = 0; iv < side; iv++) {
            for (let iu = 0; iu < side; iu++) {
              const index = v0 + iv * side + iu;
              const su = iu / segments;
              const sv = iv / segments;
              const far = clusterSurfacePoint(cluster, rhombusPoint(rhombus, (i + su) / n, (j + sv) / n));
              const nProxy = clusterNormal(cluster, far);
              const s = 2 * su - 1;
              const t = 2 * sv - 1;
              const p = far.clone().sub(center).multiplyScalar(grow).add(center)
                .sub(cluster.center).multiplyScalar(nearScale).add(cluster.center)
                .addScaledVector(nProxy, flare * cluster.radius * nearScale * (s * s + t * t) * 0.5);
              const offset = p.clone().sub(far);
              maxOffset = Math.max(maxOffset, offset.length());
              near.push(p);
              normals.push(nProxy);
              const ao = field.occlusion(far.clone().addScaledVector(nProxy, 0.03), nProxy, ci);
              w.setVector('position', index, far);
              w.setVector('nearOffset', index, offset);
              w.setVector('patchCenter', index, nearCenter);
              w.set('patchUv', index, su, sv);
              w.set('patchData', index, depth, rand, 1 - 16 * su * (1 - su) * sv * (1 - sv), ci);
              w.set('nPatchAo', index, 0, 0, 0, ao);
            }
          }

          for (let iv = 0; iv < side; iv++) {
            for (let iu = 0; iu < side; iu++) {
              const at = (x, y) => near[Math.min(Math.max(y, 0), segments) * side + Math.min(Math.max(x, 0), segments)];
              const du = at(iu + 1, iv).clone().sub(at(iu - 1, iv));
              const dv = at(iu, iv + 1).clone().sub(at(iu, iv - 1));
              const normal = du.cross(dv).normalize();
              if (normal.dot(normals[iv * side + iu]) < 0) normal.negate();
              const index = v0 + iv * side + iu;
              w.attributes.nPatchAo.data.set([normal.x, normal.y, normal.z], index * 4);
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
          pi++;
        }
      }
    }
  });
  const geometry = w.toGeometry(indices);
  geometry.boundingSphere.radius += maxOffset;
  return { geometry, patchCount };
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
