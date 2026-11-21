import * as THREE from 'three/webgpu';
import { noise1 } from '../math.js';
import { farCoverageScale } from './leafAtlas.js';
import { evaluateLod, shellGridLevel } from './lod.js';

const TINTS = {
  shell: [0.95, 0.35, 0.3],
  inner: [0.95, 0.8, 0.25],
  wood: [0, 0, 0],
};

const decalGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

// Each instance gets its own BufferGeometry (for its own draw range and groups) sharing the asset's attributes.
function shareGeometry(source) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.setIndex(source.index);
  geometry.boundingSphere = source.boundingSphere.clone();
  return geometry;
}

// Splits a 0..1 LOD progress evenly over `steps` geomorph steps, from the finest level `steps`
// down to level 0, which is reached with no morph left at progress 1.
function steppedLevel(progress, steps) {
  const x = progress * steps;
  const step = Math.min(Math.floor(x), steps);
  return { level: steps - step, morph: x - step };
}

// Rebuilds the mesh's draw groups from a level per cluster (-1 = not drawn). The index buffer is
// ordered by level, then cluster, so neighbouring clusters at the same level join one draw.
function setClusterGroups(mesh, ranges, levels) {
  const { groups } = mesh.geometry;
  let count = 0;
  let open = null;
  let openLevel = -1;
  levels.forEach((level, cluster) => {
    if (level < 0) {
      open = null;
      return;
    }
    const range = ranges[level].clusters[cluster];
    if (open && openLevel === level && open.start + open.count === range.start) {
      open.count += range.count;
      return;
    }
    open = groups[count] ?? (groups[count] = { start: 0, count: 0, materialIndex: 0 });
    open.start = range.start;
    open.count = range.count;
    openLevel = level;
    count++;
  });
  groups.length = count;
  mesh.visible = count > 0;
  return count;
}

const inverse = new THREE.Matrix4();
const crownWorld = new THREE.Vector3();
const clusterWorld = new THREE.Vector3();
const tmp = new THREE.Vector3();
const corner = new THREE.Vector3();

export class TreeInstance {
  constructor(asset, materials) {
    this.asset = asset;
    this.group = new THREE.Group();
    this.state = {
      sun: new THREE.Vector4(),
      cam: new THREE.Vector3(),
      wind: new THREE.Vector4(),
      tree: new THREE.Vector4(),
      wood: new THREE.Vector4(1, 1, 1, 0),
      woodLod: new THREE.Vector4(),
      decal: new THREE.Vector4(),
    };
    // Shell and inner layer pick their level per cluster: the materials read clusterLod by cluster
    // index, and each mesh draws its clusters' ranges as geometry groups (material arrays).
    const clusterCount = asset.tree.clusters.length;
    this.clusterLod = Array.from({ length: clusterCount * 2 }, () => new THREE.Vector4());
    this.clusterLevels = { shell: new Array(clusterCount), inner: new Array(clusterCount) };
    this.shell = this.addMesh(shareGeometry(asset.shell.geometry), [materials.shell], 'shell');
    this.inner = this.addMesh(shareGeometry(asset.shell.geometry), [materials.inner], 'inner');
    // Drawn after the shell in front of it, so the depth test drops what the shell already covers.
    this.inner.renderOrder = 1;
    for (const mesh of [this.shell, this.inner]) mesh.userData.clusterLod = this.clusterLod;
    this.wood = this.addMesh(shareGeometry(asset.wood.geometry), materials.wood, 'wood');
    this.decal = this.addMesh(decalGeometry, materials.decal, 'wood');
    this.decal.frustumCulled = false;
    this.decal.renderOrder = 1;
    this.phase = 0;
    this.lod = null;
    this.radiusPx = 0;
    this.distance = 0;
  }

  addMesh(geometry, material, kind) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.state = this.state;
    mesh.userData.tint = new THREE.Vector4(...TINTS[kind], 0);
    this.group.add(mesh);
    return mesh;
  }

  dispose() {
    for (const mesh of [this.shell, this.inner, this.wood]) mesh.geometry.dispose();
  }

  // Triangles the leaf meshes (shell and inner layer) and the wood draw within `frustum`.
  triangleCounts(frustum) {
    const drawn = (mesh, indices) => (mesh.visible && frustum.intersectsObject(mesh) ? indices / 3 : 0);
    const grouped = (mesh) => drawn(mesh, mesh.geometry.groups.reduce((sum, group) => sum + group.count, 0));
    return { leaves: grouped(this.shell) + grouped(this.inner), wood: drawn(this.wood, this.wood.geometry.drawRange.count) };
  }

  update({ camera, viewportHeight, lodSettings, sunWorld, wind, time, tintAmount, showInner, atlases }) {
    const { asset, state } = this;
    this.group.updateMatrixWorld();
    inverse.copy(this.group.matrixWorld).invert();

    state.cam.copy(camera.position).applyMatrix4(inverse);
    tmp.copy(sunWorld).transformDirection(inverse);
    state.sun.set(tmp.x, tmp.y, tmp.z, 1);
    tmp.set(Math.cos(wind.direction), 0, Math.sin(wind.direction));
    const along = this.group.position.x * tmp.x + this.group.position.z * tmp.z;
    const gust = wind.gust * noise1(along * 0.03 - time * 0.45 + this.phase * 13.1);
    tmp.transformDirection(inverse).multiplyScalar(wind.strength);
    state.wind.set(tmp.x, tmp.y, tmp.z, time);
    state.tree.set(asset.tree.height, this.phase * 6.283, gust, wind.flutter);

    // L uses the crown radius as seen from a given distance; per cluster, the distance is the
    // cluster's, so a tree far away has every cluster at about the tree's level.
    const pixelsPerUnit = viewportHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const levelAt = (distance) => {
      // 'off' shows the finest representation, which may sit below L = 0.
      if (lodSettings.mode === 'auto') return Math.log2((lodSettings.referencePixels * distance) / (asset.crownRadius * pixelsPerUnit)) + lodSettings.bias;
      if (lodSettings.mode === 'manual') return lodSettings.manualLevel;
      return -10;
    };
    crownWorld.copy(asset.tree.crownCenter).applyMatrix4(this.group.matrixWorld);
    this.distance = Math.max(camera.position.distanceTo(crownWorld), 0.01);
    this.radiusPx = (asset.crownRadius / this.distance) * pixelsPerUnit;
    const level = levelAt(this.distance);
    const e = evaluateLod(level, lodSettings);
    ({ level: e.shellLevel, morph: e.shellMorph } = shellGridLevel(level, lodSettings, asset.shell.segments));
    ({ level: e.woodDetail, morph: e.woodMorph } = steppedLevel(e.woodPoly, asset.wood.ranges.length - 1));
    this.lod = e;

    state.wood.set(1, e.limbScale, e.twigScale, 0);
    state.woodLod.set(e.woodDetail, e.woodMorph, 0, 0);

    const { shell: shellLevels, inner: innerLevels } = this.clusterLevels;
    const farScale = farCoverageScale(atlases.leaf, lodSettings.cutoff);
    asset.tree.clusters.forEach((cluster, ci) => {
      clusterWorld.copy(cluster.center).applyMatrix4(this.group.matrixWorld);
      const clusterLevel = levelAt(Math.max(camera.position.distanceTo(clusterWorld), 0.01));
      const { innerFade } = evaluateLod(clusterLevel, lodSettings);
      const shell = shellGridLevel(clusterLevel, lodSettings, asset.shell.segments);
      this.clusterLod[ci * 2].set(innerFade, shell.level, shell.morph, lodSettings.cutoff);
      this.clusterLod[ci * 2 + 1].set(farScale, 0, 0, 0);
      shellLevels[ci] = shell.level;
      innerLevels[ci] = showInner && innerFade < 1 ? shell.level : -1;
    });
    e.clusterDraws = [
      setClusterGroups(this.shell, asset.shell.ranges, shellLevels),
      setClusterGroups(this.inner, asset.shell.ranges, innerLevels),
    ];

    const woodLevel = e.twigScale > 0 ? 2 : e.limbScale > 0 ? 1 : 0;
    const woodRange = asset.wood.ranges[e.woodDetail];
    this.wood.geometry.setDrawRange(woodRange.start, woodRange.countUpTo[woodLevel]);

    for (const mesh of [this.shell, this.inner]) mesh.userData.tint.w = tintAmount;
    this.updateDecal();
  }

  updateDecal() {
    const { tree } = this.asset;
    const sun = this.state.sun;
    const sy = Math.max(sun.y, 0.05);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const c = tree.crownCenter;
    const r = tree.crownRadii;
    const aoRadius = Math.max(r.x, r.z) * 1.1;
    for (let i = 0; i < 12; i++) {
      if (i < 8) corner.set(c.x + (i & 1 ? r.x : -r.x), c.y + (i & 2 ? r.y : -r.y), c.z + (i & 4 ? r.z : -r.z));
      else corner.set(c.x + (i & 1 ? aoRadius : -aoRadius), 0, c.z + (i & 2 ? aoRadius : -aoRadius));
      const x = corner.x - (sun.x * corner.y) / sy;
      const z = corner.z - (sun.z * corner.y) / sy;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const margin = 1.5;
    this.state.decal.set((minX + maxX) / 2, (minZ + maxZ) / 2, maxX - minX + margin * 2, maxZ - minZ + margin * 2);
  }
}
