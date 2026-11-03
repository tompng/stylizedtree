import * as THREE from 'three/webgpu';
import { Rng } from '../math.js';
import { clusterNormal, clusterSurfacePoint } from './clusterShape.js';
import { RHOMBUS_POINTS, RHOMBUS_TRIANGLES, interpolateOnTriangles, rhombusPoint, triacontahedronRhombi } from './clusterTiling.js';
import { CrownField } from './crownField.js';
import { buildIcosphere } from './icosphere.js';

export const defaultShellParams = {
  patchDivisions: 2,
  overlap: 4,
  flare: 0.6,
  // outward, inward (each patch curls toward the cluster center), or random (either, per patch)
  flareDirection: 'outward',
  depth: 0.2,
  // Scales each patch so its leaves come out the size of an average patch's (average surface
  // magnification at the average depth).
  leafSizeCompensation: true,
  gridSegments: 3,
  crownSmooth: 1.0,
};

const INNER_LEVEL = 1;
const CROWN_MAX_LEVEL = 2;

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

  // `interleave` packs every attribute but position into one vertex buffer; WebGPU allows only 8.
  toGeometry(indices, { interleave = false } = {}) {
    const geometry = new THREE.BufferGeometry();
    const packed = Object.entries(this.attributes).filter(([name]) => interleave && name !== 'position');
    for (const [name, { data, size }] of Object.entries(this.attributes)) {
      if (!packed.some(([packedName]) => packedName === name)) geometry.setAttribute(name, new THREE.BufferAttribute(data, size));
    }
    if (packed.length > 0) {
      const stride = packed.reduce((sum, [, { size }]) => sum + size, 0);
      const count = packed[0][1].data.length / packed[0][1].size;
      const array = new Float32Array(count * stride);
      const buffer = new THREE.InterleavedBuffer(array, stride);
      let offset = 0;
      for (const [name, { data, size }] of packed) {
        for (let i = 0; i < count; i++) array.set(data.subarray(i * size, (i + 1) * size), i * stride + offset);
        geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, size, offset));
        offset += size;
      }
    }
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

export function buildTreeAsset(tree, shellParams) {
  const field = new CrownField(tree, shellParams.crownSmooth);
  const tiling = clusterTilings(tree, shellParams, field);
  return {
    tree,
    crownRadius: Math.max(tree.crownRadii.x, tree.crownRadii.y),
    sphereTexture: buildSphereTexture(tree),
    counts: new THREE.Vector4(tree.clusters.length, tree.woodChains.length, shellParams.crownSmooth, tree.clusters[0].shape.lobes.length),
    crownInfo: new THREE.Vector4(tree.crownCenter.x, tree.crownCenter.y, tree.crownCenter.z, Math.max(tree.crownRadii.x, tree.crownRadii.z)),
    core: buildCore(tree, field, tiling),
    inner: buildInner(tree, shellParams),
    shell: buildShell(tree, field, shellParams, tiling),
    crown: buildCrown(field),
    wood: buildWood(tree, field),
  };
}

export function disposeTreeAsset(asset) {
  asset.sphereTexture.dispose();
  for (const part of [asset.core, asset.inner, asset.shell, asset.crown, asset.wood]) part.geometry.dispose();
}

// Rows: 0 = center + shadow radius (0 casts no shadow), 1 = wood chain points, 2 = axes,
// 3 = lobe base, lobe sharpness, leaf atlas pattern, -, 4 = leaf atlas rotation quaternion,
// 5 = wind pivot (where the cluster's twig forks off its limb) + flexibility, 6.. = one lobe
// (direction, weight) per row.
function buildSphereTexture(tree) {
  const rng = new Rng(tree.seed * 13 + 5);
  const width = Math.max(tree.clusters.length, tree.woodChains.length, 1);
  const lobeCount = tree.clusters[0].shape.lobes.length;
  const height = 6 + lobeCount;
  const data = new Float32Array(width * height * 4);
  const put = (row, column, values) => data.set(values, (width * row + column) * 4);
  tree.clusters.forEach((c, i) => {
    const shadowRadius = c.isFiller ? 0 : Math.cbrt(c.axes.x * c.axes.y * c.axes.z) * 0.95;
    put(0, i, [c.center.x, c.center.y, c.center.z, shadowRadius]);
    put(2, i, [c.axes.x, c.axes.y, c.axes.z, 0]);
    put(3, i, [c.shape.base, c.shape.sharpness, rng.next() < 0.5 ? 0 : 1, 0]);
    put(4, i, randomQuaternion(rng));
    put(5, i, [c.pivot.x, c.pivot.y, c.pivot.z, c.isFiller ? 0 : 1]);
    c.shape.lobes.forEach(({ dir, weight }, k) => put(6 + k, i, [dir.x, dir.y, dir.z, weight]));
  });
  tree.woodChains.forEach((s, i) => put(1, i, [s.center.x, s.center.y, s.center.z, s.radius]));
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

// Uniformly distributed rotation (Shoemake, Graphics Gems III), as [x, y, z, w].
function randomQuaternion(rng) {
  const u1 = rng.next();
  const a = rng.next() * Math.PI * 2;
  const b = rng.next() * Math.PI * 2;
  const s = Math.sqrt(1 - u1);
  const t = Math.sqrt(u1);
  return [s * Math.sin(a), s * Math.cos(a), t * Math.sin(b), t * Math.cos(b)];
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

// Each cluster is tiled by the 30 rhombi of a rhombic triacontahedron, turned by a random
// rotation (identity for the filler). The shell's patches subdivide these rhombi and collapse onto
// the core mesh built over them (RHOMBUS_TRIANGLES): four triangles around each rhombus center when
// the patch grid has a vertex there (even patchDivisions), otherwise two.
function clusterTilings(tree, params, field) {
  const rng = new Rng(tree.seed * 7 + 11);
  const rhombi = triacontahedronRhombi();
  const topLevel = params.patchDivisions % 2 === 0 ? 1 : 0;
  return {
    topLevel,
    clusters: tree.clusters.map((cluster, ci) => {
      const rotation = new THREE.Quaternion();
      if (!cluster.isFiller) rotation.setFromAxisAngle(rng.unitVector(), rng.next() * Math.PI * 2);
      const corners = rhombi.map((r) => r.map((d) => d.clone().applyQuaternion(rotation)));
      const keys = new Map();
      const dirs = [];
      const vertexOf = (dir) => {
        const key = dir.toArray().map((x) => Math.round(x * 1e5)).join(',');
        if (!keys.has(key)) {
          keys.set(key, dirs.length);
          dirs.push(dir);
        }
        return keys.get(key);
      };
      const rhombusVertices = corners.map((rhombus) => {
        const ids = rhombus.map(vertexOf);
        if (topLevel === 1) ids.push(vertexOf(rhombusPoint(rhombus, 0.5, 0.5)));
        return ids;
      });
      const positions = dirs.map((dir) => clusterSurfacePoint(cluster, dir));
      const ao = positions.map((p) => {
        const n = clusterNormal(cluster, p);
        return field.occlusion(p.clone().addScaledVector(n, 0.03), n, ci);
      });
      return { corners, dirs, positions, ao, rhombusVertices };
    }),
  };
}

// Level 1 (four triangles per rhombus) geomorphs into level 0 (two): each rhombus center moves to
// the midpoint of the c00-c11 diagonal, where it lies on the level 0 triangles.
function buildCore(tree, field, tiling) {
  const { topLevel } = tiling;
  const groups = tree.clusters.map((cluster, ci) => {
    const { dirs, positions, ao, rhombusVertices } = tiling.clusters[ci];
    const birth = dirs.map(() => 0);
    const morphPos = positions.map((p) => p);
    if (topLevel === 1) {
      for (const ids of rhombusVertices) {
        birth[ids[4]] = 1;
        morphPos[ids[4]] = positions[ids[0]].clone().add(positions[ids[2]]).multiplyScalar(0.5);
      }
    }
    const levels = RHOMBUS_TRIANGLES.slice(0, topLevel + 1).map((triangles) =>
      rhombusVertices.flatMap((ids) => triangles.flatMap((triangle) => triangle.map((k) => ids[k]))));
    return { cluster, ci, dirs, positions, ao, birth, morphPos, levels };
  });

  const vertexCount = groups.reduce((sum, g) => sum + g.dirs.length, 0);
  const w = new AttributeWriter(vertexCount, {
    position: 3, morphPos: 3, coreData: 4, cCenter: 3, crownPos: 3, ao: 2,
  });
  const levelIndices = Array.from({ length: topLevel + 1 }, () => []);
  let base = 0;
  for (const { cluster, ci, positions, ao, birth, morphPos, levels } of groups) {
    positions.forEach((p, vi) => {
      const index = base + vi;
      const hull = field.hullPoint(p.clone().sub(field.origin).normalize());
      const nFar = field.normal(hull);
      const aoFar = field.occlusion(hull.clone().addScaledVector(nFar, 0.03), nFar);
      w.setVector('position', index, p);
      w.setVector('morphPos', index, morphPos[vi]);
      w.set('coreData', index, birth[vi], ci, cluster.isFiller ? 1 : 0, 0);
      w.setVector('cCenter', index, cluster.center);
      w.setVector('crownPos', index, hull);
      w.set('ao', index, ao[vi], aoFar);
    });
    levels.forEach((faces, level) => {
      for (const v of faces) levelIndices[level].push(base + v);
    });
    base += positions.length;
  }
  const { indices, ranges } = concatLevels(levelIndices);
  return { geometry: w.toGeometry(indices), ranges, maxLevel: topLevel };
}

// Index ranges per level, finest level first.
function concatLevels(levelIndices) {
  const indices = [];
  const ranges = [];
  for (let level = levelIndices.length - 1; level >= 0; level--) {
    ranges[level] = { start: indices.length, count: levelIndices[level].length };
    for (const i of levelIndices[level]) indices.push(i);
  }
  return { indices, ranges };
}

// Sits at the deepest shell layer, where the shell's depth offset pushes patches to.
function buildInner(tree, params) {
  const ico = buildIcosphere(INNER_LEVEL);
  const perCluster = ico.dirs.length;
  const clusters = tree.clusters.slice(0, tree.leafClusterCount);
  const w = new AttributeWriter(clusters.length * perCluster, { position: 3, cCenter: 4 });
  clusters.forEach((cluster, ci) => {
    ico.dirs.forEach((dir, vi) => {
      const index = ci * perCluster + vi;
      w.setVector('position', index, clusterSurfacePoint(cluster, dir, 1 - params.depth));
      w.setVector('cCenter', index, cluster.center, ci);
    });
  });
  const faces = ico.levels[INNER_LEVEL];
  const indices = clusters.flatMap((_, ci) => faces.map((v) => ci * perCluster + v));
  return { geometry: w.toGeometry(indices) };
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

// Linear scale from the leaf atlas (directions on the unit sphere) to the cluster surface over one
// patch: lobes and the ellipsoid axes enlarge or shrink the leaves drawn there.
function patchMagnification(cluster, rhombus, i, j, n) {
  const k = 4;
  const sample = (u, v) => rhombusPoint(rhombus, (i + u / k) / n, (j + v / k) / n);
  const quadArea = (p00, p10, p01, p11) => p11.clone().sub(p00).cross(p01.clone().sub(p10)).length() / 2;
  let sphereArea = 0;
  let surfaceArea = 0;
  for (let v = 0; v < k; v++) {
    for (let u = 0; u < k; u++) {
      const dirs = [sample(u, v), sample(u + 1, v), sample(u, v + 1), sample(u + 1, v + 1)];
      sphereArea += quadArea(...dirs);
      surfaceArea += quadArea(...dirs.map((d) => clusterSurfacePoint(cluster, d)));
    }
  }
  return Math.sqrt(surfaceArea / sphereArea);
}

// At rest (near offset 0) the patches tile each cluster surface exactly, edge to edge, and every
// fragment looks up the leaf atlas from its own surface direction, so the tiled shell and the
// core mesh show the same leaves. Up close each patch is scaled up around its center (overlap),
// pushed inward (depth) and curled (flare); its leaves stay attached to it, so their size follows
// the patch's scale times the surface magnification times the depth scale.
//
// Each patch is stored once per grid level, from gridSegments segments down to one (patchData.z),
// and a level's vertices geomorph (morph* attributes) onto the next coarser representation so that
// every switch happens between identical meshes. Vertices placed on a coarser surface at their own
// patch coordinates only match it when the finer triangles do not straddle its creases, which
// holds for nested grids (two segments into one, one segment onto the core) but not for k into
// k - 1 segments with k >= 3. There the middle column and row of cells collapse instead: the grid
// lines on either side move onto one line of the coarser grid, the strip between them degenerates,
// and every other cell becomes a coarser cell, patch coordinates included. All cells of a patch
// share one diagonal direction, chosen so that the one-segment cell lies flat on the core triangles.
function buildShell(tree, field, params, tiling) {
  const rng = new Rng(tree.seed * 7 + 3);
  const n = params.patchDivisions;
  const segments = Math.max(1, Math.round(params.gridSegments));
  const leafClusters = tree.clusters.slice(0, tree.leafClusterCount);
  const rhombusCount = tiling.clusters[0].corners.length;
  const patchCount = leafClusters.length * rhombusCount * n * n;
  let perPatch = 0;
  for (let k = 1; k <= segments; k++) perPatch += (k + 1) ** 2;
  const w = new AttributeWriter(patchCount * perPatch, {
    position: 3, nearOffset: 3, patchCenter: 4, patchUv: 2, patchData: 4, nPatchAo: 4,
    morphFar: 3, morphOffset: 3, morphNormalAo: 4, morphUv: 2,
  });
  const levelIndices = Array.from({ length: segments + 1 }, () => []);
  const topTriangles = RHOMBUS_TRIANGLES[tiling.topLevel];
  const scale = Math.sqrt(Math.max(params.overlap, 1));
  let maxOffset = 0;
  let vertex = 0;

  leafClusters.forEach((cluster, ci) => {
    const { corners, positions, ao: coreAo, rhombusVertices } = tiling.clusters[ci];
    const magnifications = corners.map((rhombus) =>
      Array.from({ length: n * n }, (_, k) => patchMagnification(cluster, rhombus, k % n, Math.floor(k / n), n)));
    const meanMagnification = magnifications.flat().reduce((sum, m) => sum + m, 0) / (corners.length * n * n);
    corners.forEach((rhombus, ri) => {
      const corePositions = rhombusVertices[ri].map((id) => positions[id]);
      const coreAoValues = rhombusVertices[ri].map((id) => coreAo[id]);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const depth = rng.next();
          const nearScale = 1 - params.depth * depth;
          let grow = scale * rng.range(0.9, 1.1);
          if (params.leafSizeCompensation) {
            const compensation = (meanMagnification / magnifications[ri][j * n + i]) * ((1 - params.depth / 2) / nearScale);
            // Below 1 the scaled patches would no longer cover the surface between them.
            grow = Math.min(Math.max(grow * compensation, 1), grow * 2);
          }
          const flare = params.flare * rng.range(0.7, 1.3);
          const rand = rng.next();
          const flip = rng.next() < 0.5;
          const flareSign = params.flareDirection === 'inward' || (params.flareDirection === 'random' && flip) ? -1 : 1;
          const center = clusterSurfacePoint(cluster, rhombusPoint(rhombus, (i + 0.5) / n, (j + 0.5) / n));
          const nearCenter = center.clone().sub(cluster.center).multiplyScalar(nearScale).add(cluster.center);
          const farAt = (su, sv) => clusterSurfacePoint(cluster, rhombusPoint(rhombus, (i + su) / n, (j + sv) / n));
          const nearAt = (su, sv, far = farAt(su, sv)) => {
            const s = 2 * su - 1;
            const t = 2 * sv - 1;
            return far.clone().sub(center).multiplyScalar(grow).add(center)
              .sub(cluster.center).multiplyScalar(nearScale).add(cluster.center)
              .addScaledVector(clusterNormal(cluster, far), flareSign * flare * cluster.radius * nearScale * (s * s + t * t) * 0.5);
          };
          const sampleAt = (su, sv) => {
            const far = farAt(su, sv);
            const nProxy = clusterNormal(cluster, far);
            const near = nearAt(su, sv, far);
            const e = 1e-3;
            const normal = nearAt(su + e, sv).sub(nearAt(su - e, sv)).cross(nearAt(su, sv + e).sub(nearAt(su, sv - e))).normalize();
            if (normal.dot(nProxy) < 0) normal.negate();
            const ao = field.occlusion(far.clone().addScaledVector(nProxy, 0.03), nProxy, ci);
            return { far, near, offset: near.clone().sub(far), normal, ao };
          };
          const cache = new Map();
          const grids = [];
          for (let k = 1; k <= segments; k++) {
            grids[k] = Array.from({ length: (k + 1) ** 2 }, (_, idx) => {
              const iu = idx % (k + 1);
              const iv = Math.floor(idx / (k + 1));
              const key = `${(iu * 720) / k},${(iv * 720) / k}`;
              if (!cache.has(key)) cache.set(key, sampleAt(iu / k, iv / k));
              return cache.get(key);
            });
          }
          const antiDiagonal = tiling.topLevel === 1 && i + j === n - 1;
          const onGrid = (k, su, sv, name) => {
            const cu = Math.min(Math.floor(su * k), k - 1);
            const cv = Math.min(Math.floor(sv * k), k - 1);
            const at = (du, dv) => grids[k][(cv + dv) * (k + 1) + cu + du][name];
            const cellPoints = [[0, 0], [1, 0], [1, 1], [0, 1]];
            const triangles = antiDiagonal ? [[0, 1, 3], [1, 2, 3]] : [[0, 1, 2], [0, 2, 3]];
            return interpolateOnTriangles(triangles, cellPoints, [at(0, 0), at(1, 0), at(1, 1), at(0, 1)], su * k - cu, sv * k - cv);
          };
          const patchRadius = Math.max(...grids[segments].map(({ near }) => near.distanceTo(nearCenter)));

          for (let k = segments; k >= 1; k--) {
            const base = vertex;
            grids[k].forEach((value, idx) => {
              const su = (idx % (k + 1)) / k;
              const sv = Math.floor(idx / (k + 1)) / k;
              let target;
              let targetUv = [su, sv];
              if (k > 2) {
                const collapsed = Math.floor((k - 1) / 2);
                const line = (x) => (x <= collapsed ? x : x - 1);
                const cu = line(idx % (k + 1));
                const cv = line(Math.floor(idx / (k + 1)));
                target = grids[k - 1][cv * k + cu];
                targetUv = [cu / (k - 1), cv / (k - 1)];
              } else if (k === 2) {
                target = ['far', 'offset', 'normal', 'ao'].reduce((t, f) => ({ ...t, [f]: onGrid(1, su, sv, f) }), {});
              } else {
                const U = (i + su) / n;
                const V = (j + sv) / n;
                target = {
                  far: interpolateOnTriangles(topTriangles, RHOMBUS_POINTS, corePositions, U, V),
                  offset: value.offset,
                  normal: value.normal,
                  ao: interpolateOnTriangles(topTriangles, RHOMBUS_POINTS, coreAoValues, U, V),
                };
              }
              maxOffset = Math.max(maxOffset, value.offset.length());
              w.setVector('position', vertex, value.far);
              w.setVector('nearOffset', vertex, value.offset);
              w.setVector('patchCenter', vertex, nearCenter, patchRadius);
              w.set('patchUv', vertex, su, sv);
              w.set('patchData', vertex, depth, rand, k, ci);
              w.setVector('nPatchAo', vertex, value.normal, value.ao);
              w.setVector('morphFar', vertex, target.far);
              w.setVector('morphOffset', vertex, target.offset);
              w.setVector('morphNormalAo', vertex, target.normal, target.ao);
              w.set('morphUv', vertex, ...targetUv);
              vertex++;
            });
            for (let iv = 0; iv < k; iv++) {
              for (let iu = 0; iu < k; iu++) {
                const a = base + iv * (k + 1) + iu;
                const b = a + 1;
                const c = a + k + 1;
                const d = c + 1;
                const faces = antiDiagonal ? [a, b, c, b, d, c] : [a, b, d, a, d, c];
                for (const f of faces) levelIndices[k].push(f);
              }
            }
          }
        }
      }
    });
  });
  const { indices, ranges } = concatLevels(levelIndices);
  const geometry = w.toGeometry(indices, { interleave: true });
  geometry.boundingSphere.radius += maxOffset;
  return { geometry, patchCount, ranges, segments };
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
        bucket.data.push(branch.level, ao, branch.clusterIndex ?? -1, t);
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
