import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { createEnvironment } from './environment.js';
import { Rng } from './math.js';
import { buildTreeAsset, defaultShellParams, disposeTreeAsset } from './tree/buildGeometry.js';
import { defaultTreeParams, generateTree } from './tree/generateTree.js';
import { createLeafAtlas, updateKeptTexture } from './tree/leafAtlas.js';
import { defaultLodSettings } from './tree/lod.js';
import { TreeInstance } from './tree/TreeInstance.js';
import { createTreeMaterials, disposeTreeMaterials, palette, params, stylePresets } from './tree/treeMaterials.js';

const hud = document.getElementById('hud');

const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
await renderer.init();
if (!renderer.backend.isWebGPUBackend) {
  hud.textContent = 'WebGPU is not available (WGSL shaders require the WebGPU backend).';
  throw new Error('WebGPU backend unavailable');
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 9000);
camera.position.set(13, 5.5, 13);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 5, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
createEnvironment(scene);

const treeParams = { ...defaultTreeParams };
const shellParams = { ...defaultShellParams };
const lodSettings = { ...defaultLodSettings };
const env = { sunAzimuth: 140, sunElevation: 38, windStrength: 0.35, windDirection: 20, gust: 0.6, flutter: 0.3, fogDensity: 0.0012 };
const view = {
  layout: 'single', tint: 0, dolly: false, dollyMin: 9, dollyMax: 1200, dollyPeriod: 24, timeScale: 1, style: 'soft', innerLayer: true, bakedAo: true,
};
// Leaves are packed close to the densest non-touching arrangement, so their count is set by their
// size: about 840 per sphere at sizeScale 1, scaling with 1 / size².
// ?leafTex=2048 sets the atlas size in texels (2x2 cells); the leaves stay the same.
const urlParams = new URLSearchParams(location.search);
const atlasCell = (fallback) => {
  const size = Number(urlParams.get('leafTex'));
  return Number.isFinite(size) && size > 0 ? Math.round(THREE.MathUtils.clamp(size, 64, 8192) / 2) : fallback / 2;
};
const atlasParams = { leafCount: 2000, cell: atlasCell(512) };
const createShellAtlas = () => createLeafAtlas({ cell: atlasParams.cell, designCell: 1024, sizeScale: Math.sqrt(840 / atlasParams.leafCount) });
const atlases = { leaf: createShellAtlas() };

let asset = null;
let materials = null;
let trees = [];
let buildMs = 0;

function layoutTransforms(layout) {
  if (layout === 'single') return [{ x: 0, z: 0, rotation: 0 }];
  const rng = new Rng(17);
  if (layout === 'row') {
    return Array.from({ length: 8 }, (_, i) => {
      const distance = 12 * 2 ** i;
      return { x: (i % 2 ? 1 : -1) * distance * 0.12, z: -distance, rotation: rng.next() * Math.PI * 2 };
    });
  }
  return Array.from({ length: 60 }, () => {
    const r = 15 + 600 * rng.next() ** 2;
    const a = rng.next() * Math.PI * 2;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r, rotation: rng.next() * Math.PI * 2 };
  });
}

function rebuild() {
  const start = performance.now();
  for (const tree of trees) {
    scene.remove(tree.group);
    tree.dispose();
  }
  if (asset) disposeTreeAsset(asset);
  if (materials) disposeTreeMaterials(materials);
  asset = buildTreeAsset(generateTree(treeParams), shellParams);
  materials = createTreeMaterials(asset, atlases);
  trees = layoutTransforms(view.layout).map(({ x, z, rotation }, i) => {
    const tree = new TreeInstance(asset, materials);
    tree.group.position.set(x, 0, z);
    tree.group.rotation.y = rotation;
    tree.phase = (i * 0.618) % 1;
    scene.add(tree.group);
    return tree;
  });
  buildMs = performance.now() - start;
}

function resetCamera() {
  if (view.layout === 'single') {
    camera.position.set(13, 5.5, 13);
    controls.target.set(0, 5, 0);
  } else {
    camera.position.set(0, 9, 14);
    controls.target.set(0, 5, -40);
  }
}

function buildGui() {
  const gui = new GUI({ title: 'stylized tree' });

  const fView = gui.addFolder('View');
  fView.add(view, 'layout', ['single', 'row', 'grove']).onChange(() => {
    rebuild();
    resetCamera();
  });
  fView.add(view, 'dolly').name('auto dolly');
  fView.add(view, 'dollyMin', 3, 50, 1);
  fView.add(view, 'dollyMax', 50, 3000, 10);
  fView.add(view, 'dollyPeriod', 4, 60, 1);
  fView.add(view, 'tint', 0, 1, 0.01).name('LOD part tint');
  fView.add(view, 'timeScale', 0, 3, 0.01);

  const fLod = gui.addFolder('LOD');
  fLod.add(lodSettings, 'mode', ['auto', 'manual', 'off']);
  fLod.add(lodSettings, 'manualLevel', -3, 9, 0.01);
  fLod.add(lodSettings, 'bias', -3, 3, 0.01);
  fLod.add(lodSettings, 'referencePixels', 100, 1000, 10);
  const fStages = fLod.addFolder('stage ranges (L)').close();
  for (const key of [
    'mergeEnd', 'gridLevelSpacing', 'woodPolyStart', 'woodPolyEnd',
    'innerFadeStart', 'innerFadeEnd', 'twigFadeStart', 'twigFadeEnd', 'limbFadeStart', 'limbFadeEnd',
  ]) {
    fStages.add(lodSettings, key, -3, 10, 0.05);
  }
  const fStageParams = fLod.addFolder('stage params').close();
  fStageParams.add(lodSettings, 'cutoff', 0, 1, 0.01);
  fStageParams.add(lodSettings, 'innerMaxLevel', 0, 8, 1);

  const fTree = gui.addFolder('Tree (rebuild)').close();
  fTree.add(treeParams, 'seed', 1, 200, 1).onFinishChange(rebuild);
  fTree.add(treeParams, 'height', 4, 16, 0.1).onFinishChange(rebuild);
  fTree.add(treeParams, 'crownWidth', 3, 16, 0.1).onFinishChange(rebuild);
  fTree.add(treeParams, 'crownHeight', 2, 12, 0.1).onFinishChange(rebuild);
  fTree.add(treeParams, 'clusterCount', 3, 30, 1).onFinishChange(rebuild);
  fTree.add(treeParams, 'clusterSize', 0.4, 1.8, 0.01).onFinishChange(rebuild);
  fTree.add(treeParams, 'clusterFlatten', 0.4, 1.2, 0.01).onFinishChange(rebuild);
  fTree.add(treeParams, 'clusterLobes', 0, 10, 1).onFinishChange(rebuild);
  fTree.add(treeParams, 'clusterBumps', 0, 1, 0.01).onFinishChange(rebuild);
  fTree.add(treeParams, 'lobeSharpness', 0.5, 12, 0.1).onFinishChange(rebuild);
  fTree.add(treeParams, 'trunkRadius', 0.1, 0.8, 0.01).onFinishChange(rebuild);
  fTree.add(treeParams, 'limbCount', 1, 7, 1).onFinishChange(rebuild);
  fTree.add(shellParams, 'patchDivisions', 1, 3, 1).onFinishChange(rebuild);
  fTree.add(shellParams, 'overlap', 1, 5, 0.05).onFinishChange(rebuild);
  fTree.add(shellParams, 'flare', 0, 1, 0.01).onFinishChange(rebuild);
  fTree.add(shellParams, 'flareDirection', ['outward', 'inward', 'random']).onFinishChange(rebuild);
  fTree.add(shellParams, 'depth', 0, 0.8, 0.01).onFinishChange(rebuild);
  fTree.add(shellParams, 'leafSizeCompensation').onFinishChange(rebuild);
  fTree.add(shellParams, 'gridSegments', 1, 8, 1).onFinishChange(rebuild);
  fTree.add(atlasParams, 'leafCount', 200, 3000, 10).name('atlasLeafCount').onFinishChange(() => {
    atlases.leaf.dispose();
    atlases.leaf = createShellAtlas();
    rebuild();
  });

  const fLook = gui.addFolder('Look').close();
  fLook.add(view, 'style', Object.keys(stylePresets)).onChange((name) => {
    for (const [key, values] of Object.entries(stylePresets[name])) params[key].value.set(...values);
    for (const controller of fLook.controllersRecursive()) controller.updateDisplay();
  });
  const vec = (folder, uniformNode, index, name, min, max, step) => {
    const proxy = {
      get value() {
        return uniformNode.value.getComponent(index);
      },
      set value(v) {
        uniformNode.value.setComponent(index, v);
      },
    };
    return folder.add(proxy, 'value', min, max, step).name(name);
  };
  vec(fLook, params.ramp, 0, 'band1', 0, 1, 0.01);
  vec(fLook, params.ramp, 1, 'band2', 0, 1, 0.01);
  vec(fLook, params.ramp, 2, 'bandSoftness', 0.001, 0.3, 0.001);
  vec(fLook, params.ramp, 3, 'leafVariation', 0, 0.6, 0.01);
  vec(fLook, params.look, 0, 'translucency', 0, 2, 0.01);
  vec(fLook, params.look, 1, 'edgeBrightness', -0.3, 0.4, 0.01);
  vec(fLook, params.look, 2, 'hueVariation', 0, 1, 0.01);
  vec(fLook, params.look, 3, 'skyAmbient', 0, 1, 0.01);
  vec(fLook, params.look2, 0, 'patchNormalWeight', 0, 1, 0.01);
  vec(fLook, params.look2, 1, 'farDensity', 0, 4, 0.01);
  vec(fLook, params.edge, 0, 'edgeSoftness', 0, 1, 0.01);
  vec(fLook, params.edge, 1, 'alphaDither', 0, 1, 0.01);
  vec(fLook, params.edge, 2, 'edgeOutward', 0, 1, 0.01);
  vec(fLook, params.patchFade, 0, 'patchFadeStart', 0, 1, 0.01);
  vec(fLook, params.patchFade, 1, 'patchFade', 0, 1, 0.01);
  vec(fLook, params.patchFade, 2, 'grazingFade', 0, 1, 0.01);
  vec(fLook, params.leafShrink, 0, 'shrinkLeafVariation', 0, 1, 0.01);
  vec(fLook, params.leafShrink, 1, 'shrinkSoftness', 0.01, 0.5, 0.01);
  fLook.add(view, 'innerLayer');
  fLook.add(view, 'bakedAo').onChange((on) => params.look2.value.setW(on ? 1 : 0));
  vec(fLook, params.inner, 0, 'innerShade', 0, 1, 0.01);
  vec(fLook, params.inner, 1, 'innerRimWidth', 0.05, 1, 0.01);
  vec(fLook, params.inner, 2, 'innerThin', 0, 1, 0.01);
  vec(fLook, params.tone, 0, 'contrast', 0.2, 1.2, 0.01);
  vec(fLook, params.tone, 1, 'shadowFloor', 0, 1, 0.01);
  vec(fLook, params.tone, 2, 'aoStrength', 0, 1, 0.01);
  vec(fLook, params.tone, 3, 'depthShade', 0, 1, 0.01);
  vec(fLook, params.shadow, 0, 'selfShadowDensity', 0, 1, 0.01);
  vec(fLook, params.shadow, 1, 'selfShadowSoftness', 0.01, 1, 0.01);
  vec(fLook, params.groundShadow, 0, 'groundShadow', 0, 1, 0.01);
  vec(fLook, params.groundShadow, 1, 'groundShadowBreakup', 0, 1.5, 0.01);
  const fColors = fLook.addFolder('colors').close();
  const colorProxy = {};
  for (const [key, node] of Object.entries(palette)) {
    colorProxy[key] = `#${node.value.getHexString()}`;
    fColors.addColor(colorProxy, key).onChange((hex) => node.value.set(hex));
  }

  const fEnv = gui.addFolder('Light & wind').close();
  fEnv.add(env, 'sunAzimuth', 0, 360, 1);
  fEnv.add(env, 'sunElevation', 3, 89, 1);
  fEnv.add(env, 'windStrength', 0, 1.5, 0.01);
  fEnv.add(env, 'windDirection', 0, 360, 1);
  fEnv.add(env, 'gust', 0, 2, 0.01);
  fEnv.add(env, 'flutter', 0, 1, 0.005);
  vec(fEnv, params.windBend, 0, 'bend', 0, 1.5, 0.01);
  vec(fEnv, params.windBend, 1, 'lean', 0, 1, 0.01);
  vec(fEnv, params.windPatch, 0, 'patchTilt', 0, 1.5, 0.01);
  fEnv.add(env, 'fogDensity', 0, 0.006, 0.0001);
}

const sunWorld = new THREE.Vector3();
let elapsed = 0;
let lastTime = performance.now();
let hudTimer = 0;
const frustum = new THREE.Frustum();
const viewProjection = new THREE.Matrix4();

function nearestTree() {
  let best = trees[0];
  for (const tree of trees) if (tree.distance < best.distance) best = tree;
  return best;
}

function updateHud(focus) {
  const e = focus.lod;
  const info = renderer.info.render;
  const fmt = (x, d = 2) => x.toFixed(d);
  frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem);
  let leaves = 0;
  let wood = 0;
  for (const tree of trees) {
    const counts = tree.triangleCounts(frustum);
    leaves += counts.leaves;
    wood += counts.wood;
  }
  const rows = [
    `L ${fmt(e.level)}   crown radius ${fmt(focus.radiusPx, 0)}px   dist ${fmt(focus.distance, 0)}m`,
    `shell  ${e.shellLevel > 0 ? `grid ${e.shellLevel}` : 'cards'}  morph ${fmt(e.shellMorph)}  patches ${asset.shell.patchCount}`,
    `draws  shell/inner ${e.clusterDraws.join(' / ')}`,
    `wood   detail ${e.woodDetail}  morph ${fmt(e.woodMorph)}`,
    `frame  ${fmt(info.triangles, 0)} tris (leaves ${leaves}, wood ${wood})  ${info.drawCalls ?? info.calls} draws   build ${fmt(buildMs, 0)}ms`,
    `atlas  ${atlasParams.cell * 2}px  ${atlases.leaf.userData.leafCounts.join(' / ')} leaves per sphere`,
  ];
  hud.textContent = rows.join('\n');
}

function frame() {
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  elapsed += dt * view.timeScale;

  if (view.dolly) {
    const t = (now / 1000 / view.dollyPeriod) * Math.PI * 2;
    const k = 0.5 - 0.5 * Math.cos(t);
    const distance = Math.exp(Math.log(view.dollyMin) + (Math.log(view.dollyMax) - Math.log(view.dollyMin)) * k);
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, distance);
  }
  controls.update();

  const az = THREE.MathUtils.degToRad(env.sunAzimuth);
  const el = THREE.MathUtils.degToRad(env.sunElevation);
  sunWorld.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
  params.sunWorld.value.set(sunWorld.x, sunWorld.y, sunWorld.z, 1);
  params.fog.value.x = env.fogDensity;

  const ctx = {
    camera,
    viewportHeight: renderer.domElement.height,
    lodSettings,
    sunWorld,
    wind: { strength: env.windStrength, direction: THREE.MathUtils.degToRad(env.windDirection), gust: env.gust, flutter: env.flutter },
    time: elapsed,
    tintAmount: view.tint,
    showInner: view.innerLayer,
    atlases,
  };
  updateKeptTexture(atlases.leaf, lodSettings.cutoff, params.leafShrink.value.x, params.leafShrink.value.y);
  for (const tree of trees) tree.update(ctx);

  renderer.render(scene, camera);

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.15;
    updateHud(nearestTree());
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

rebuild();
buildGui();
renderer.setAnimationLoop(frame);
window.stylizedTree = { camera, controls, lodSettings, treeParams, shellParams, env, view, params, palette, rebuild, resetCamera };
