import * as THREE from 'three/webgpu';
import { Rng } from '../math.js';
import { ClusterOcclusion } from './clusterOcclusion.js';
import { clusterNormal, clusterSurfacePoint } from './clusterShape.js';
import {
  RHOMBUS_HALVES, RHOMBUS_POINTS, RHOMBUS_QUARTERS, interpolateOnTriangles, rhombusPoint, triacontahedronRhombi,
} from './clusterTiling.js';
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
};

const INNER_LEVEL = 1;

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
  const occlusion = new ClusterOcclusion(tree);
  const tiling = clusterTilings(tree, shellParams, occlusion);
  return {
    tree,
    crownRadius: Math.max(tree.crownRadii.x, tree.crownRadii.y),
    sphereTexture: buildSphereTexture(tree),
    counts: new THREE.Vector4(tree.clusters.length, tree.woodChains.length, 0, 0),
    crownInfo: new THREE.Vector4(tree.crownCenter.x, tree.crownCenter.y, tree.crownCenter.z, Math.max(tree.crownRadii.x, tree.crownRadii.z)),
    core: buildCore(tree, tiling),
    inner: buildInner(tree, shellParams),
    shell: buildShell(tree, occlusion, shellParams, tiling),
    wood: buildWood(tree, occlusion),
  };
}

export function disposeTreeAsset(asset) {
  asset.sphereTexture.dispose();
  for (const part of [asset.core, asset.inner, asset.shell, asset.wood]) part.geometry.dispose();
}

// Rows: 0 = center + shadow radius, 1 = wood chain points, 2 = axes, 3 = leaf atlas pattern,
// 4 = leaf atlas rotation quaternion, 5 = wind pivot (where the cluster's twig forks off its limb)
// + flexibility.
function buildSphereTexture(tree) {
  const rng = new Rng(tree.seed * 13 + 5);
  const width = Math.max(tree.clusters.length, tree.woodChains.length, 1);
  const height = 6;
  const data = new Float32Array(width * height * 4);
  const put = (row, column, values) => data.set(values, (width * row + column) * 4);
  tree.clusters.forEach((c, i) => {
    put(0, i, [c.center.x, c.center.y, c.center.z, Math.cbrt(c.axes.x * c.axes.y * c.axes.z) * 0.95]);
    put(2, i, [c.axes.x, c.axes.y, c.axes.z, 0]);
    put(3, i, [rng.next() < 0.5 ? 0 : 1, 0, 0, 0]);
    put(4, i, randomQuaternion(rng));
    put(5, i, [c.pivot.x, c.pivot.y, c.pivot.z, 1]);
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

// Each cluster is tiled by the 30 rhombi of a rhombic triacontahedron turned by a random rotation.
// Corners 0 and 2 of every rhombus are icosahedron vertices, corners 1 and 3 centers of
// icosahedron faces. The shell's patches subdivide these rhombi and collapse onto the core mesh
// built over them: four triangles around each rhombus center when the patch grid has a vertex
// there (even patchDivisions), otherwise two. Normals of the cluster shape are baked per vertex.
function clusterTilings(tree, params, occlusion) {
  const rng = new Rng(tree.seed * 7 + 11);
  const rhombi = triacontahedronRhombi();
  const quartered = params.patchDivisions % 2 === 0;
  return {
    quartered,
    topTriangles: quartered ? RHOMBUS_QUARTERS : RHOMBUS_HALVES,
    clusters: tree.clusters.map((cluster, ci) => {
      const rotation = new THREE.Quaternion().setFromAxisAngle(rng.unitVector(), rng.next() * Math.PI * 2);
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
        if (quartered) ids.push(vertexOf(rhombusPoint(rhombus, 0.5, 0.5)));
        return ids;
      });
      const positions = dirs.map((dir) => clusterSurfacePoint(cluster, dir));
      const normals = positions.map((p) => clusterNormal(cluster, p));
      const ao = positions.map((p, i) => occlusion.occlusion(p.clone().addScaledVector(normals[i], 0.03), normals[i], ci));
      return { corners, dirs, positions, normals, ao, rhombusVertices };
    }),
  };
}

// Core levels, each geomorphing into the next coarser one: 2 = four triangles per rhombus (only
// when quartered), 1 = two, the rhombus centers moved to the midpoints of the c00-c11 diagonals,
// 0 = the icosahedron, each face-center corner moved to the centroid of its icosahedron face,
// which flattens the three triangles around it into that face. Morph targets are averages of the
// coarser vertices, unnormalized for normals as well, since that is what the coarser triangles
// interpolate there.
function buildCore(tree, tiling) {
  const topLevel = tiling.quartered ? 2 : 1;
  const groups = tree.clusters.map((cluster, ci) => {
    const { dirs, positions, normals, ao, rhombusVertices } = tiling.clusters[ci];
    const birth = dirs.map(() => 0);
    const target = positions.map((pos, i) => ({ pos, normal: normals[i] }));
    const average = (ids) => ({
      pos: ids.reduce((sum, id) => sum.add(positions[id]), new THREE.Vector3()).divideScalar(ids.length),
      normal: ids.reduce((sum, id) => sum.add(normals[id]), new THREE.Vector3()).divideScalar(ids.length),
    });
    const faceCorners = new Map();
    for (const ids of rhombusVertices) {
      for (const k of [1, 3]) {
        if (!faceCorners.has(ids[k])) faceCorners.set(ids[k], new Set());
        faceCorners.get(ids[k]).add(ids[0]).add(ids[2]);
      }
    }
    const icosahedronFaces = [];
    for (const [center, set] of faceCorners) {
      const [a, b, c] = [...set];
      birth[center] = 1;
      target[center] = average([a, b, c]);
      const normal = dirs[b].clone().sub(dirs[a]).cross(dirs[c].clone().sub(dirs[a]));
      icosahedronFaces.push(...(normal.dot(dirs[center]) > 0 ? [a, b, c] : [a, c, b]));
    }
    if (tiling.quartered) {
      for (const ids of rhombusVertices) {
        birth[ids[4]] = 2;
        target[ids[4]] = average([ids[0], ids[2]]);
      }
    }
    const rhombusFaces = (triangles) => rhombusVertices.flatMap((ids) => triangles.flatMap((t) => t.map((k) => ids[k])));
    const levels = [icosahedronFaces, rhombusFaces(RHOMBUS_HALVES)];
    if (tiling.quartered) levels.push(rhombusFaces(RHOMBUS_QUARTERS));
    return { cluster, ci, positions, normals, ao, birth, target, levels };
  });

  const vertexCount = groups.reduce((sum, g) => sum + g.positions.length, 0);
  const w = new AttributeWriter(vertexCount, {
    position: 3, morphPos: 3, normal: 3, morphNormal: 3, coreData: 4, cCenter: 3, ao: 1,
  });
  const levelIndices = Array.from({ length: topLevel + 1 }, () => []);
  let base = 0;
  for (const { cluster, ci, positions, normals, ao, birth, target, levels } of groups) {
    positions.forEach((p, vi) => {
      const index = base + vi;
      w.setVector('position', index, p);
      w.setVector('morphPos', index, target[vi].pos);
      w.setVector('normal', index, normals[vi]);
      w.setVector('morphNormal', index, target[vi].normal);
      w.set('coreData', index, birth[vi], ci, 0, 0);
      w.setVector('cCenter', index, cluster.center);
      w.set('ao', index, ao[vi]);
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
  const { clusters } = tree;
  const w = new AttributeWriter(clusters.length * perCluster, { position: 3, normal: 3, cCenter: 4 });
  clusters.forEach((cluster, ci) => {
    ico.dirs.forEach((dir, vi) => {
      const index = ci * perCluster + vi;
      const p = clusterSurfacePoint(cluster, dir, 1 - params.depth);
      w.setVector('position', index, p);
      w.setVector('normal', index, clusterNormal(cluster, p));
      w.setVector('cCenter', index, cluster.center, ci);
    });
  });
  const faces = ico.levels[INNER_LEVEL];
  const indices = clusters.flatMap((_, ci) => faces.map((v) => ci * perCluster + v));
  return { geometry: w.toGeometry(indices) };
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
function buildShell(tree, occlusion, params, tiling) {
  const rng = new Rng(tree.seed * 7 + 3);
  const n = params.patchDivisions;
  const segments = Math.max(1, Math.round(params.gridSegments));
  const leafClusters = tree.clusters;
  const rhombusCount = tiling.clusters[0].corners.length;
  const patchCount = leafClusters.length * rhombusCount * n * n;
  let perPatch = 0;
  for (let k = 1; k <= segments; k++) perPatch += (k + 1) ** 2;
  const w = new AttributeWriter(patchCount * perPatch, {
    position: 3, nearOffset: 3, patchCenter: 4, patchUv: 2, patchData: 4, nPatchAo: 4,
    morphFar: 3, morphOffset: 3, morphNormalAo: 4, morphUv: 2, proxyNormal: 3, morphProxy: 3,
  });
  const levelIndices = Array.from({ length: segments + 1 }, () => []);
  const { topTriangles } = tiling;
  const scale = Math.sqrt(Math.max(params.overlap, 1));
  let maxOffset = 0;
  let vertex = 0;

  leafClusters.forEach((cluster, ci) => {
    const { corners, positions, normals: coreNormals, ao: coreAo, rhombusVertices } = tiling.clusters[ci];
    const magnifications = corners.map((rhombus) =>
      Array.from({ length: n * n }, (_, k) => patchMagnification(cluster, rhombus, k % n, Math.floor(k / n), n)));
    const meanMagnification = magnifications.flat().reduce((sum, m) => sum + m, 0) / (corners.length * n * n);
    corners.forEach((rhombus, ri) => {
      const corePositions = rhombusVertices[ri].map((id) => positions[id]);
      const coreAoValues = rhombusVertices[ri].map((id) => coreAo[id]);
      const coreNormalValues = rhombusVertices[ri].map((id) => coreNormals[id]);
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
            const ao = occlusion.occlusion(far.clone().addScaledVector(nProxy, 0.03), nProxy, ci);
            return { far, near, offset: near.clone().sub(far), normal, ao, proxy: nProxy };
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
          const antiDiagonal = tiling.quartered && i + j === n - 1;
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
                target = ['far', 'offset', 'normal', 'ao', 'proxy'].reduce((t, f) => ({ ...t, [f]: onGrid(1, su, sv, f) }), {});
              } else {
                const U = (i + su) / n;
                const V = (j + sv) / n;
                target = {
                  far: interpolateOnTriangles(topTriangles, RHOMBUS_POINTS, corePositions, U, V),
                  offset: value.offset,
                  normal: value.normal,
                  ao: interpolateOnTriangles(topTriangles, RHOMBUS_POINTS, coreAoValues, U, V),
                  proxy: interpolateOnTriangles(topTriangles, RHOMBUS_POINTS, coreNormalValues, U, V),
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
              w.setVector('proxyNormal', vertex, value.proxy);
              w.setVector('morphProxy', vertex, target.proxy);
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

// Each branch is a grid of rings (along the curve) by radial vertices, drawn at three detail
// levels that halve the ring count and, while at least three remain, the radial count
// (trunk 12, 6, 3; limbs 8, 4, 4; twigs 6, 3, 3). Each level's grid is a subset of the next finer
// one and all quads split along the same diagonal, so a vertex dropped at a level geomorphs (morph*
// attributes) onto the coarser triangles at its own grid position and the switch is exact.
// Faces are grouped by detail level, then by branch level, so that a prefix of a detail level's
// range draws the trunk, trunk + limbs, or everything.
const WOOD_RADIAL = [12, 8, 6];
const WOOD_DETAIL_LEVELS = 3;

function buildWood(tree, occlusion) {
  const halve = (count) => (count % 2 === 0 && count / 2 >= 3 ? count / 2 : count);
  const branches = [0, 1, 2].flatMap((level) => tree.branches.filter((b) => b.level === level));
  const meshes = branches.map((branch) => {
    const length = branch.curve.getLength();
    const rings = Math.max(4, Math.round(length / 0.25 / 4) * 4);
    const radial = WOOD_RADIAL[branch.level];
    const radials = [halve(halve(radial)), halve(radial), radial];
    const steps = [0, 1, 2].map((d) => ({ ring: 2 ** (2 - d), radial: radial / radials[d] }));
    const frames = branch.curve.computeFrenetFrames(rings, false);
    const values = [];
    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      const axis = branch.curve.getPointAt(t);
      const r = branch.radius(t);
      const N = frames.normals[i];
      const B = frames.binormals[i];
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const sin = Math.sin(a);
        const cos = -Math.cos(a);
        const normal = new THREE.Vector3(cos * N.x + sin * B.x, cos * N.y + sin * B.y, cos * N.z + sin * B.z).normalize();
        const pos = axis.clone().addScaledVector(normal, r);
        const ao = occlusion.occlusion(pos.clone().addScaledVector(normal, 0.03), normal);
        values.push({ pos, normal, axis, ao, t });
      }
    }
    const at = (i, j) => values[i * (radial + 1) + j];
    const birth = (i, j) => steps.findIndex((step) => i % step.ring === 0 && j % step.radial === 0);
    const cellPoints = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const triangles = [[0, 1, 3], [1, 2, 3]];
    const vertices = values.map((value, k) => {
      const i = Math.floor(k / (radial + 1));
      const j = k % (radial + 1);
      const d = birth(i, j);
      if (d === 0) return { ...value, birth: 0, target: value };
      const { ring, radial: radialStep } = steps[d - 1];
      const i0 = Math.min(Math.floor(i / ring) * ring, rings - ring);
      const j0 = Math.min(Math.floor(j / radialStep) * radialStep, radial - radialStep);
      const corners = [at(i0, j0), at(i0, j0 + radialStep), at(i0 + ring, j0 + radialStep), at(i0 + ring, j0)];
      const fu = (j - j0) / radialStep;
      const fv = (i - i0) / ring;
      const target = Object.fromEntries(['pos', 'normal', 'axis', 'ao', 't'].map((name) =>
        [name, interpolateOnTriangles(triangles, cellPoints, corners.map((c) => c[name]), fu, fv)]));
      return { ...value, birth: d, target };
    });
    const faces = steps.map(({ ring, radial: radialStep }) => {
      const list = [];
      for (let i = ring; i <= rings; i += ring) {
        for (let j = radialStep; j <= radial; j += radialStep) {
          const a = (i - ring) * (radial + 1) + (j - radialStep);
          const b = i * (radial + 1) + (j - radialStep);
          const c = i * (radial + 1) + j;
          const d = (i - ring) * (radial + 1) + j;
          list.push(a, b, d, b, c, d);
        }
      }
      return list;
    });
    return { branch, vertices, faces };
  });

  const vertexCount = meshes.reduce((sum, m) => sum + m.vertices.length, 0);
  const w = new AttributeWriter(vertexCount, {
    position: 3, normal: 3, axisPos: 3, woodData: 4, morphPos: 3, morphNormal: 3, morphAxis: 3, morphData: 4,
  });
  const levelIndices = Array.from({ length: WOOD_DETAIL_LEVELS }, () => [[], [], []]);
  let base = 0;
  for (const { branch, vertices, faces } of meshes) {
    vertices.forEach(({ pos, normal, axis, ao, t, birth, target }, k) => {
      const index = base + k;
      w.setVector('position', index, pos);
      w.setVector('normal', index, normal);
      w.setVector('axisPos', index, axis);
      w.set('woodData', index, branch.level, ao, branch.clusterIndex ?? -1, t);
      w.setVector('morphPos', index, target.pos);
      w.setVector('morphNormal', index, target.normal);
      w.setVector('morphAxis', index, target.axis);
      w.set('morphData', index, target.ao, target.t, birth, 0);
    });
    faces.forEach((list, d) => {
      for (const v of list) levelIndices[d][branch.level].push(base + v);
    });
    base += vertices.length;
  }
  const indices = [];
  const ranges = levelIndices.map((byBranchLevel) => {
    const start = indices.length;
    const countUpTo = byBranchLevel.map((list) => {
      for (const v of list) indices.push(v);
      return indices.length - start;
    });
    return { start, countUpTo };
  });
  return { geometry: w.toGeometry(indices, { interleave: true }), ranges };
}
