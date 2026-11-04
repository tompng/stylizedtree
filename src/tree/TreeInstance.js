import * as THREE from 'three/webgpu';
import { noise1 } from '../math.js';
import { farCoverageScale } from './leafAtlas.js';
import { evaluateLod, shellGridLevel } from './lod.js';

const TINTS = {
  shell: [0.95, 0.35, 0.3],
  core: [0.3, 0.85, 0.35],
  inner: [0.95, 0.8, 0.25],
  wood: [0, 0, 0],
};

const decalGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

// Each instance gets its own BufferGeometry (for its own draw range) sharing the asset's attributes.
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

const inverse = new THREE.Matrix4();
const crownWorld = new THREE.Vector3();
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
      lodA: new THREE.Vector4(),
      lodB: new THREE.Vector4(),
      lodD: new THREE.Vector4(),
      farLeaf: new THREE.Vector4(),
      wood: new THREE.Vector4(1, 1, 1, 0),
      woodLod: new THREE.Vector4(),
      decal: new THREE.Vector4(),
    };
    this.shell = this.addMesh(shareGeometry(asset.shell.geometry), materials.shell, 'shell');
    this.core = this.addMesh(shareGeometry(asset.core.geometry), materials.core, 'core');
    this.inner = this.addMesh(shareGeometry(asset.inner.geometry), materials.inner, 'inner');
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
    for (const mesh of [this.shell, this.core, this.inner, this.wood]) mesh.geometry.dispose();
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

    crownWorld.copy(asset.tree.crownCenter).applyMatrix4(this.group.matrixWorld);
    this.distance = Math.max(camera.position.distanceTo(crownWorld), 0.01);
    this.radiusPx = (asset.crownRadius / (this.distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))) * (viewportHeight / 2);
    // 'off' shows the finest representation, which may sit below L = 0.
    let level = -10;
    if (lodSettings.mode === 'auto') level = Math.log2(lodSettings.referencePixels / this.radiusPx) + lodSettings.bias;
    else if (lodSettings.mode === 'manual') level = lodSettings.manualLevel;
    const e = evaluateLod(level, lodSettings);
    ({ level: e.shellLevel, morph: e.shellMorph } = shellGridLevel(level, lodSettings, asset.shell.segments));
    ({ level: e.coreLevel, morph: e.coreMorph } = steppedLevel(e.corePoly, asset.core.maxLevel));
    ({ level: e.woodDetail, morph: e.woodMorph } = steppedLevel(e.woodPoly, asset.wood.ranges.length - 1));
    this.lod = e;

    state.lodA.set(e.near, e.shellLevel, e.shellMorph, 0);
    state.lodB.set(1, e.coreLevel, e.coreMorph, 0);
    state.lodD.set(e.cutoff, e.dissolve, e.innerFade, 0);
    state.farLeaf.set(farCoverageScale(atlases.leaf, e.cutoff), farCoverageScale(atlases.inner, e.cutoff), 0, 0);
    state.wood.set(1, e.limbScale, e.twigScale, 0);
    state.woodLod.set(e.woodDetail, e.woodMorph, 0, 0);

    this.shell.visible = e.shellActive;
    const shellRange = asset.shell.ranges[e.shellLevel];
    this.shell.geometry.setDrawRange(shellRange.start, shellRange.count);

    const coreRange = asset.core.ranges[e.coreLevel];
    this.core.visible = !e.shellActive;
    this.core.geometry.setDrawRange(coreRange.start, coreRange.count);

    this.inner.visible = showInner && e.innerFade < 1;

    const woodLevel = e.twigScale > 0 ? 2 : e.limbScale > 0 ? 1 : 0;
    const woodRange = asset.wood.ranges[e.woodDetail];
    this.wood.geometry.setDrawRange(woodRange.start, woodRange.countUpTo[woodLevel]);

    for (const mesh of [this.shell, this.core, this.inner]) mesh.userData.tint.w = tintAmount;
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
