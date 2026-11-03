import * as THREE from 'three/webgpu';
import { attribute, float, mix, screenCoordinate, texture, uniform, varying, vec3, vec4, wgsl, wgslFn } from 'three/tsl';
import commonSrc from '../shaders/common.wgsl?raw';
import corePositionSrc from '../shaders/core_position.wgsl?raw';
import crownPositionSrc from '../shaders/crown_position.wgsl?raw';
import decalPositionSrc from '../shaders/decal_position.wgsl?raw';
import decalShadeSrc from '../shaders/decal_shade.wgsl?raw';
import foliageShadeSrc from '../shaders/foliage_shade.wgsl?raw';
import innerFadeSrc from '../shaders/inner_fade.wgsl?raw';
import innerLeafSrc from '../shaders/inner_leaf.wgsl?raw';
import leafSampleSrc from '../shaders/leaf_sample.wgsl?raw';
import leafSampleCoreSrc from '../shaders/leaf_sample_core.wgsl?raw';
import leafUvSrc from '../shaders/leaf_uv.wgsl?raw';
import shellFadeSrc from '../shaders/shell_fade.wgsl?raw';
import proxyNormalSrc from '../shaders/proxy_normal.wgsl?raw';
import shellPositionSrc from '../shaders/shell_position.wgsl?raw';
import shellWindSrc from '../shaders/shell_wind.wgsl?raw';
import sunVisibilitySrc from '../shaders/sun_visibility.wgsl?raw';
import windOffsetSrc from '../shaders/wind_offset.wgsl?raw';
import woodPositionSrc from '../shaders/wood_position.wgsl?raw';
import woodShadeSrc from '../shaders/wood_shade.wgsl?raw';

export const common = wgsl(commonSrc);
const leafSampleCore = wgsl(leafSampleCoreSrc);
const fn = (src, includes = []) => wgslFn(src, [common, ...includes]);
const shellRestPosition = fn(shellPositionSrc);
const shellWind = fn(shellWindSrc);
const coreRestPosition = fn(corePositionSrc);
const crownRestPosition = fn(crownPositionSrc);
const woodRestPosition = fn(woodPositionSrc);
const windOffsetAt = fn(windOffsetSrc);
const decalPosition = fn(decalPositionSrc);
const sunVisibilityAt = fn(sunVisibilitySrc);
const proxyNormal = fn(proxyNormalSrc);
const leafSample = fn(leafSampleSrc, [leafSampleCore]);
const innerLeafSample = fn(innerLeafSrc, [leafSampleCore]);
const innerFadeThreshold = fn(innerFadeSrc);
const leafUv = fn(leafUvSrc);
const shellFadeThreshold = fn(shellFadeSrc);
const foliageShade = fn(foliageShadeSrc);
const woodShade = fn(woodShadeSrc);
const decalShade = fn(decalShadeSrc);

const color = (hex) => uniform(new THREE.Color(hex));

export const palette = {
  leafLit: color('#a9c95b'),
  leafMid: color('#5d9442'),
  leafShadow: color('#2e6050'),
  leafDeep: color('#173b3b'),
  leafTrans: color('#d9ea72'),
  sky: color('#8fbfe6'),
  zenith: color('#4a8cd8'),
  horizon: color('#cfe1ea'),
  sunHaze: color('#f3e7c8'),
  sunColor: color('#fff4da'),
  wood: color('#6d5a4b'),
  woodShadow: color('#38384a'),
  grass: color('#7da34a'),
  grass2: color('#9cbb5b'),
  grassShadow: color('#4e6d58'),
  groundShadow: color('#a3bccb'),
  groundAo: color('#c5cfc0'),
};

// Packed vec4 layouts must match the `let` unpacking at the top of each WGSL function.
export const stylePresets = {
  soft: { ramp: [0.42, 0.66, 0.16, 0.1], edge: [0.6, 0.25, 0, 0], tone: [0.75, 0.4, 0.7, 0.65] },
  crisp: { ramp: [0.42, 0.66, 0.05, 0.16], edge: [0, 0, 0, 0], tone: [1, 0.12, 1, 0.65] },
};

export const params = {
  // band1, band2, bandSoftness, leafVariation
  ramp: uniform(new THREE.Vector4(0.42, 0.66, 0.16, 0.1)),
  // translucency, edgeBrightness, hueVariation, skyAmbient
  look: uniform(new THREE.Vector4(0.55, 0.08, 0.25, 0.6)),
  // patchNormalWeight, mipScale, dissolveFrequency, -
  look2: uniform(new THREE.Vector4(0.35, 0.25, 1.6, 0)),
  // edgeSoftness, alphaDither, -, -
  edge: uniform(new THREE.Vector4(0.6, 0.25, 0, 0)),
  // start (1 - bump where leaves start shrinking), strength, grazing (edge-on patches), -
  patchFade: uniform(new THREE.Vector4(0.15, 1, 1, 0)),
  // per-leaf variation of the shrink threshold, shrink softness
  leafShrink: uniform(new THREE.Vector4(0.5, 0.15, 0, 0)),
  // shade (AO of the inner shade-leaf ball), rimWidth, thin, -
  inner: uniform(new THREE.Vector4(0.1, 0.8, 0.05, 0)),
  // contrast, shadowFloor, aoStrength, depthShade (AO of the deepest shell patches)
  tone: uniform(new THREE.Vector4(0.75, 0.4, 0.7, 0.65)),
  // density, softness (cluster-to-cluster sun occlusion)
  shadow: uniform(new THREE.Vector4(0.8, 0.35, 0, 0)),
  // strength, breakup, density, softness (ground shadow)
  groundShadow: uniform(new THREE.Vector4(0.85, 0.6, 0.85, 0.3)),
  // density
  fog: uniform(new THREE.Vector4(0.0012, 0, 0, 0)),
  sunWorld: uniform(new THREE.Vector4(0, 1, 0, 1)),
};

const perInstance = (key, value) => uniform(value).onObjectUpdate(({ object }) => object.userData.state?.[key]);

export const instanceUniforms = {
  sun: perInstance('sun', new THREE.Vector4(0, 1, 0, 1)),
  cam: perInstance('cam', new THREE.Vector3()),
  wind: perInstance('wind', new THREE.Vector4()),
  tree: perInstance('tree', new THREE.Vector4(8, 0, 0, 0)),
  lodA: perInstance('lodA', new THREE.Vector4(1, 0, 0, 0)),
  lodB: perInstance('lodB', new THREE.Vector4(0.8, 2, 0, 0)),
  lodC: perInstance('lodC', new THREE.Vector4(2, 0, 0, 0)),
  lodD: perInstance('lodD', new THREE.Vector4(0.5, 0, 0, 0)),
  wood: perInstance('wood', new THREE.Vector4(1, 1, 1, 0)),
  decal: perInstance('decal', new THREE.Vector4(0, 0, 1, 1)),
};

const meshTint = uniform(new THREE.Vector4()).onObjectUpdate(({ object }) => object.userData.tint);

// Alpha-to-coverage also stores the fragment alpha in the color target, and the sRGB output pass
// treats that alpha as premultiplied, darkening every soft edge. The blend keeps the destination alpha.
function foliageMaterial(side) {
  const material = new THREE.MeshBasicNodeMaterial({ side });
  material.alphaToCoverage = true;
  material.fog = false;
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.ZeroFactor;
  material.blendSrcAlpha = THREE.ZeroFactor;
  material.blendDstAlpha = THREE.OneFactor;
  return material;
}

// Shading, noise and shadows use the rest position (all LOD morphs, no wind) so that the
// pattern rides along with the swaying vertices instead of sliding across them.
export function createTreeMaterials(asset, atlases) {
  const I = instanceUniforms;
  const spheres = texture(asset.sphereTexture);
  const counts = uniform(asset.counts);
  const crownInfo = uniform(asset.crownInfo);
  const leafTex = texture(atlases.leaf);
  const innerTex = texture(atlases.inner);
  const shadeArgs = {
    camLocal: I.cam,
    sun: I.sun,
    cLit: palette.leafLit,
    cMid: palette.leafMid,
    cShadow: palette.leafShadow,
    cDeep: palette.leafDeep,
    cTrans: palette.leafTrans,
    cSky: palette.sky,
    ramp: params.ramp,
    look: params.look,
    look2: params.look2,
    edge: params.edge,
    tone: params.tone,
    fog: params.fog,
    pixel: screenCoordinate,
    cHorizon: palette.horizon,
    cSunHaze: palette.sunHaze,
    tint: meshTint,
  };
  const sunVisibility = (p) => varying(sunVisibilityAt({ p, sun: I.sun, spheres, counts, shadow: params.shadow }));
  const windAt = (anchor, wobbleSeed, wobbleAmount) => windOffsetAt({ anchor, wobbleSeed, wobbleAmount, wind: I.wind, tree: I.tree });
  const solidLeaf = vec4(1, 0.5, 0.5, 0.5);

  const shell = foliageMaterial(THREE.DoubleSide);
  {
    const patchData = attribute('patchData', 'vec4');
    const patchCenter = attribute('patchCenter', 'vec3');
    const nPatchAo = attribute('nPatchAo', 'vec4');
    const far = attribute('position', 'vec3');
    const clusterIndex = patchData.w;
    const near = I.lodA.x;
    const rest = shellRestPosition({ basePos: far, nearOffset: attribute('nearOffset', 'vec3'), lodA: I.lodA });
    shell.positionNode = rest.add(shellWind({ patchCenter, patchData, spheres, wind: I.wind, tree: I.tree }));
    const farV = varying(far);
    const restV = varying(rest);
    const ao = nPatchAo.w.mul(mix(float(1), params.tone.w, patchData.x.mul(near)));
    shell.colorNode = foliageShade({
      ...shadeArgs,
      nProxy: proxyNormal({ p: farV, clusterIndex, merge: float(0), spheres, counts }),
      nDetail: vec4(nPatchAo.xyz, params.look2.x.mul(near)),
      shadeIn: vec4(ao, ao, 1, 0),
      posLocal: restV,
      sunVis: sunVisibility(rest),
      leaf: leafSample({
        tex: leafTex,
        samp: leafTex,
        uv: leafUv({ p: farV, clusterIndex, spheres }),
        cutoff: I.lodD.x,
        mipScale: params.look2.y,
        patchRand: mix(float(0.5), patchData.y, near),
        softness: params.edge.x,
        threshold: shellFadeThreshold({
          patchUv: attribute('patchUv', 'vec2'),
          nPatch: nPatchAo.xyz,
          posLocal: restV,
          camLocal: I.cam,
          patchFade: params.patchFade,
          near,
        }),
        shrink: params.leafShrink,
      }),
      misc: vec4(clusterIndex, patchData.z.mul(near), 0, 0),
      noisePos: vec3(0),
      bulkCenter: vec3(0),
    });
  }

  const core = foliageMaterial(THREE.DoubleSide);
  {
    const coreData = attribute('coreData', 'vec4');
    const cCenter = attribute('cCenter', 'vec3');
    const crownPos = attribute('crownPos', 'vec3');
    const merge = I.lodB.w;
    const coreArgs = {
      surfacePos: attribute('position', 'vec3'),
      morphPos: attribute('morphPos', 'vec3'),
      coreData,
      cCenter,
      crownPos,
    };
    const rest = coreRestPosition({ ...coreArgs, lodB: I.lodB });
    const unmerged = varying(coreRestPosition({ ...coreArgs, lodB: vec4(I.lodB.xyz, 0) }));
    core.positionNode = rest.add(windAt(mix(cCenter, crownPos, merge), coreData.y, float(1).sub(merge)));
    const restV = varying(rest);
    const leaf = leafSample({
      tex: leafTex,
      samp: leafTex,
      uv: leafUv({ p: unmerged, clusterIndex: coreData.y, spheres }),
      cutoff: I.lodD.x,
      mipScale: params.look2.y,
      patchRand: float(0.5),
      softness: params.edge.x,
      threshold: float(0),
      shrink: params.leafShrink,
    });
    core.colorNode = foliageShade({
      ...shadeArgs,
      nProxy: proxyNormal({ p: restV, clusterIndex: coreData.y, merge, spheres, counts }),
      nDetail: vec4(0),
      shadeIn: vec4(attribute('ao', 'vec2'), 1, merge),
      posLocal: restV,
      sunVis: sunVisibility(rest),
      leaf: mix(leaf, solidLeaf, I.lodC.z),
      misc: vec4(coreData.y, 0, I.lodD.y, 1),
      noisePos: restV,
      bulkCenter: varying(mix(cCenter, crownInfo.xyz, merge)),
    });
  }

  const inner = foliageMaterial(THREE.DoubleSide);
  {
    const cCenter = attribute('cCenter', 'vec4');
    const center = cCenter.xyz;
    const clusterIndex = cCenter.w;
    const rest = attribute('position', 'vec3');
    inner.positionNode = rest.add(windAt(center, clusterIndex, float(1)));
    const restV = varying(rest);
    const nProxy = proxyNormal({ p: restV, clusterIndex, merge: float(0), spheres, counts });
    const shade = params.inner.x;
    inner.colorNode = foliageShade({
      ...shadeArgs,
      nProxy,
      nDetail: vec4(0),
      shadeIn: vec4(shade, shade, 1, 0),
      posLocal: restV,
      sunVis: sunVisibility(rest),
      leaf: innerLeafSample({
        tex: innerTex,
        samp: innerTex,
        p: restV,
        clusterIndex,
        spheres,
        cutoff: I.lodD.x,
        mipScale: params.look2.y,
        // Differs from the core's 0.5 so their alpha-to-coverage dither does not line up.
        patchRand: float(0.45),
        softness: params.edge.x,
        threshold: innerFadeThreshold({ nProxy, posLocal: restV, center: varying(center), camLocal: I.cam, inner: params.inner, lodD: I.lodD }),
        shrink: params.leafShrink,
      }),
      misc: vec4(clusterIndex, 0, 0, 0),
      noisePos: vec3(0),
      bulkCenter: vec3(0),
    });
  }

  const crown = foliageMaterial(THREE.FrontSide);
  {
    const pos = attribute('position', 'vec3');
    const rest = crownRestPosition({
      pos,
      morphPos: attribute('morphPos', 'vec3'),
      crownData: attribute('crownData', 'vec4'),
      lodC: I.lodC,
    });
    crown.positionNode = rest.add(windAt(pos, float(0), float(0)));
    const restV = varying(rest);
    const ao = attribute('ao', 'float');
    crown.colorNode = foliageShade({
      ...shadeArgs,
      nProxy: proxyNormal({ p: restV, clusterIndex: float(0), merge: float(1), spheres, counts }),
      nDetail: vec4(0),
      shadeIn: vec4(ao, ao, 1, 1),
      posLocal: restV,
      sunVis: sunVisibility(rest),
      leaf: solidLeaf,
      misc: vec4(0, 0, I.lodD.y, 1),
      noisePos: restV,
      bulkCenter: crownInfo.xyz,
    });
  }

  const wood = new THREE.MeshBasicNodeMaterial();
  wood.fog = false;
  {
    const woodData = attribute('woodData', 'vec4');
    const axisPos = attribute('axisPos', 'vec3');
    const rest = woodRestPosition({ pos: attribute('position', 'vec3'), axisPos, woodData, lodW: I.wood });
    wood.positionNode = rest.add(windAt(axisPos, float(0), float(0)));
    wood.colorNode = woodShade({
      n: attribute('normal', 'vec3'),
      posLocal: varying(rest),
      camLocal: I.cam,
      sun: I.sun,
      sunVis: sunVisibility(rest),
      woodData,
      cWood: palette.wood,
      cWoodShadow: palette.woodShadow,
      cSky: palette.sky,
      ramp: params.ramp,
      fog: params.fog,
      cHorizon: palette.horizon,
      cSunHaze: palette.sunHaze,
    });
  }

  const decal = new THREE.MeshBasicNodeMaterial();
  decal.fog = false;
  decal.transparent = true;
  decal.depthWrite = false;
  decal.polygonOffset = true;
  decal.polygonOffsetFactor = -2;
  decal.polygonOffsetUnits = -2;
  decal.blending = THREE.CustomBlending;
  decal.blendEquation = THREE.AddEquation;
  decal.blendSrc = THREE.ZeroFactor;
  decal.blendDst = THREE.SrcColorFactor;
  decal.blendSrcAlpha = THREE.ZeroFactor;
  decal.blendDstAlpha = THREE.OneFactor;
  {
    const pos = decalPosition({ pos: attribute('position', 'vec3'), decal: I.decal });
    decal.positionNode = pos;
    decal.colorNode = decalShade({
      local: varying(pos),
      spheres,
      counts,
      sun: I.sun,
      crown: crownInfo,
      camLocal: I.cam,
      shadowTint: palette.groundShadow,
      aoTint: palette.groundAo,
      ground: params.groundShadow,
      fog: params.fog,
    });
  }

  return { shell, core, inner, crown, wood, decal };
}

export function disposeTreeMaterials(materials) {
  for (const m of Object.values(materials)) m.dispose();
}
