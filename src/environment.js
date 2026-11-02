import * as THREE from 'three/webgpu';
import { cameraPosition, positionWorld, wgslFn } from 'three/tsl';
import groundShadeSrc from './shaders/ground_shade.wgsl?raw';
import skyShadeSrc from './shaders/sky_shade.wgsl?raw';
import { common, palette, params } from './tree/treeMaterials.js';

const groundShade = wgslFn(groundShadeSrc, [common]);
const skyShade = wgslFn(skyShadeSrc, [common]);

export function createEnvironment(scene) {
  const groundMaterial = new THREE.MeshBasicNodeMaterial();
  groundMaterial.fog = false;
  groundMaterial.colorNode = groundShade({
    posWorld: positionWorld,
    camPos: cameraPosition,
    sun: params.sunWorld,
    cGrass: palette.grass,
    cGrass2: palette.grass2,
    cGrassShadow: palette.grassShadow,
    fog: params.fog,
    cHorizon: palette.horizon,
    cSunHaze: palette.sunHaze,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000).rotateX(-Math.PI / 2), groundMaterial);
  scene.add(ground);

  const skyMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  skyMaterial.fog = false;
  skyMaterial.colorNode = skyShade({
    viewVec: positionWorld.sub(cameraPosition),
    sun: params.sunWorld,
    cZenith: palette.zenith,
    cHorizon: palette.horizon,
    cSunHaze: palette.sunHaze,
    cSun: palette.sunColor,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), skyMaterial);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);

  return { ground, sky };
}
