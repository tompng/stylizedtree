import * as THREE from 'three/webgpu';
import { attribute, float, mix, screenCoordinate, texture, uniform, varying, vec3, vec4, wgsl, wgslFn } from 'three/tsl';
import clusterBendSrc from '../shaders/cluster_bend.wgsl?raw';
import clusterDeformSrc from '../shaders/cluster_deform.wgsl?raw';
import commonSrc from '../shaders/common.wgsl?raw';
import coreMorphSrc from '../shaders/core_morph.wgsl?raw';
import decalPositionSrc from '../shaders/decal_position.wgsl?raw';
import decalShadeSrc from '../shaders/decal_shade.wgsl?raw';
import foliageShadeSrc from '../shaders/foliage_shade.wgsl?raw';
import innerFadeSrc from '../shaders/inner_fade.wgsl?raw';
import leafSampleCoreSrc from '../shaders/leaf_sample_core.wgsl?raw';
import leafSphereSampleSrc from '../shaders/leaf_sphere_sample.wgsl?raw';
import patchTiltSrc from '../shaders/patch_tilt.wgsl?raw';
import rotateVectorSrc from '../shaders/rotate_vector.wgsl?raw';
import shellFadeSrc from '../shaders/shell_fade.wgsl?raw';
import shellFarSrc from '../shaders/shell_far.wgsl?raw';
import shellMorphSrc from '../shaders/shell_morph.wgsl?raw';
import shellNormalSrc from '../shaders/shell_normal.wgsl?raw';
import shellPositionSrc from '../shaders/shell_position.wgsl?raw';
import shellUvSrc from '../shaders/shell_uv.wgsl?raw';
import shellWindSrc from '../shaders/shell_wind.wgsl?raw';
import sunVisibilitySrc from '../shaders/sun_visibility.wgsl?raw';
import windOffsetSrc from '../shaders/wind_offset.wgsl?raw';
import woodPositionSrc from '../shaders/wood_position.wgsl?raw';
import woodMorphSrc from '../shaders/wood_morph.wgsl?raw';
import woodShadeSrc from '../shaders/wood_shade.wgsl?raw';
import woodWindSrc from '../shaders/wood_wind.wgsl?raw';

export const common = wgsl(commonSrc);
const leafSampleCore = wgsl(leafSampleCoreSrc);
const fn = (src, includes = []) => wgslFn(src, [common, ...includes]);
const shellRestPosition = fn(shellPositionSrc);
const shellFarPosition = fn(shellFarSrc);
const shellNormalAo = fn(shellNormalSrc);
const shellPatchUv = fn(shellUvSrc);
const shellMorphFactor = fn(shellMorphSrc);
const shellWind = fn(shellWindSrc);
const coreMorph = fn(coreMorphSrc);
const woodRestPosition = fn(woodPositionSrc);
const windOffsetAt = fn(windOffsetSrc);
const clusterBend = fn(clusterBendSrc);
const clusterDeform = fn(clusterDeformSrc);
const patchTilt = fn(patchTiltSrc);
const woodWind = fn(woodWindSrc);
const woodMorph = fn(woodMorphSrc);
const rotateVector = fn(rotateVectorSrc);
const decalPosition = fn(decalPositionSrc);
const sunVisibilityAt = fn(sunVisibilitySrc);
const leafSphereSample = fn(leafSphereSampleSrc, [leafSampleCore]);
const innerFadeThreshold = fn(innerFadeSrc);
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
  // patchNormalWeight, farDensity (scales leaf opacity once pixels span several leaves), dissolveFrequency, -
  look2: uniform(new THREE.Vector4(0.35, 1.25, 1.6, 0)),
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
  // bend, lean, press, ripple (cluster response to wind, st_clusterDeform)
  windBend: uniform(new THREE.Vector4(0.35, 0.25, 0.3, 0.25)),
  // tilt (shell patches leaning downwind), -, -, -
  windPatch: uniform(new THREE.Vector4(0.5, 0, 0, 0)),
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
  lodD: perInstance('lodD', new THREE.Vector4(0.5, 0, 0, 0)),
  // farCoverageScale of the shell and inner atlases at the instance's cutoff
  farLeaf: perInstance('farLeaf', new THREE.Vector4(1, 1, 0, 0)),
  wood: perInstance('wood', new THREE.Vector4(1, 1, 1, 0)),
  // drawn wood detail level, geomorph toward the next coarser level
  woodLod: perInstance('woodLod', new THREE.Vector4(2, 0, 0, 0)),
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
// pattern rides along with the swaying vertices instead of sliding across them. Normals of the
// cluster shape are baked per vertex and geomorph along with the positions.
export function createTreeMaterials(asset, atlases) {
  const I = instanceUniforms;
  const spheres = texture(asset.sphereTexture);
  const counts = uniform(asset.counts);
  const crownInfo = uniform(asset.crownInfo);
  const leafTex = texture(atlases.leaf);
  const innerTex = texture(atlases.inner);
  // Leaves stay sharp until the pixel footprint nears their width, then turn into averaged coverage.
  const farParams = (atlas, scale) => {
    const mip = Math.log2(atlas.userData.leafWidthTexels);
    return vec4(scale.mul(params.look2.y), mip - 1, mip + 1, 0);
  };
  const leafFar = farParams(atlases.leaf, I.farLeaf.x);
  const innerFar = farParams(atlases.inner, I.farLeaf.y);
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
  const windAt = (anchor) => windOffsetAt({ anchor, wind: I.wind, tree: I.tree });
  const windArgs = { spheres, wind: I.wind, tree: I.tree, windBend: params.windBend };

  const shell = foliageMaterial(THREE.DoubleSide);
  {
    const patchData = attribute('patchData', 'vec4');
    const patchCenter = attribute('patchCenter', 'vec4');
    const basePos = attribute('position', 'vec3');
    const morphFar = attribute('morphFar', 'vec3');
    const clusterIndex = patchData.w;
    const near = I.lodA.x;
    const far = shellFarPosition({ basePos, morphFar, patchData, lodA: I.lodA });
    const rest = shellRestPosition({
      basePos,
      nearOffset: attribute('nearOffset', 'vec3'),
      morphFar,
      morphOffset: attribute('morphOffset', 'vec3'),
      patchData,
      lodA: I.lodA,
    });
    const nPatchAo = varying(shellNormalAo({
      nPatchAo: attribute('nPatchAo', 'vec4'),
      morphNormalAo: attribute('morphNormalAo', 'vec4'),
      patchData,
      lodA: I.lodA,
    }));
    const proxy = mix(attribute('proxyNormal', 'vec3'), attribute('morphProxy', 'vec3'), shellMorphFactor({ patchData, lodA: I.lodA }));
    const patchUv = varying(shellPatchUv({ patchUv: attribute('patchUv', 'vec2'), morphUv: attribute('morphUv', 'vec2'), patchData, lodA: I.lodA }));
    const patchEdge = float(1).sub(patchUv.x.mul(patchUv.x.oneMinus()).mul(patchUv.y).mul(patchUv.y.oneMinus()).mul(16));
    const bend = clusterBend({ clusterIndex, ...windArgs });
    const tilt = patchTilt({ patchCenter, patchData, spheres, wind: I.wind, tree: I.tree, windPatch: params.windPatch, lodA: I.lodA });
    shell.positionNode = rest.add(shellWind({ rest, patchCenter, patchData, ...windArgs, bend, tilt }));
    const bendV = varying(bend);
    const nPatch = rotateVector({ v: nPatchAo.xyz, w: bendV.add(varying(tilt)) });
    const farV = varying(far);
    const restV = varying(rest);
    const ao = nPatchAo.w.mul(mix(float(1), params.tone.w, patchData.x.mul(near)));
    shell.colorNode = foliageShade({
      ...shadeArgs,
      nProxy: rotateVector({ v: varying(proxy), w: bendV }),
      nDetail: vec4(nPatch, params.look2.x.mul(near)),
      ao,
      posLocal: restV,
      sunVis: sunVisibility(rest),
      leaf: leafSphereSample({
        tex: leafTex,
        samp: leafTex,
        p: farV,
        clusterIndex,
        spheres,
        cutoff: I.lodD.x,
        far: leafFar,
        patchRand: mix(float(0.5), patchData.y, near),
        softness: params.edge.x,
        threshold: shellFadeThreshold({
          patchUv,
          nPatch,
          posLocal: restV,
          camLocal: I.cam,
          patchFade: params.patchFade,
          near,
        }),
        shrink: params.leafShrink,
      }),
      misc: vec4(clusterIndex, patchEdge.mul(near), 0, 0),
      noisePos: vec3(0),
      bulkCenter: vec3(0),
    });
  }

  const core = foliageMaterial(THREE.DoubleSide);
  {
    const coreData = attribute('coreData', 'vec4');
    const clusterIndex = coreData.y;
    const cCenter = attribute('cCenter', 'vec3');
    const morph = coreMorph({ coreData, lodB: I.lodB });
    const rest = mix(attribute('position', 'vec3'), attribute('morphPos', 'vec3'), morph);
    const bend = clusterBend({ clusterIndex, ...windArgs });
    core.positionNode = rest.add(windAt(cCenter)).add(clusterDeform({ p: rest, clusterIndex, ...windArgs, bend, amount: float(1) }));
    const restV = varying(rest);
    const proxy = mix(attribute('normal', 'vec3'), attribute('morphNormal', 'vec3'), morph);
    core.colorNode = foliageShade({
      ...shadeArgs,
      nProxy: rotateVector({ v: varying(proxy), w: varying(bend) }),
      nDetail: vec4(0),
      ao: attribute('ao', 'float'),
      posLocal: restV,
      sunVis: sunVisibility(rest),
      leaf: leafSphereSample({
        tex: leafTex,
        samp: leafTex,
        p: restV,
        clusterIndex,
        spheres,
        cutoff: I.lodD.x,
        far: leafFar,
        patchRand: float(0.5),
        softness: params.edge.x,
        threshold: float(0),
        shrink: params.leafShrink,
      }),
      misc: vec4(clusterIndex, 0, I.lodD.y, 1),
      noisePos: restV,
      bulkCenter: varying(cCenter),
    });
  }

  const inner = foliageMaterial(THREE.DoubleSide);
  {
    const cCenter = attribute('cCenter', 'vec4');
    const center = cCenter.xyz;
    const clusterIndex = cCenter.w;
    const rest = attribute('position', 'vec3');
    const bend = clusterBend({ clusterIndex, ...windArgs });
    inner.positionNode = rest.add(windAt(center)).add(clusterDeform({ p: rest, clusterIndex, ...windArgs, bend, amount: float(1) }));
    const restV = varying(rest);
    const nProxy = rotateVector({ v: varying(attribute('normal', 'vec3')), w: varying(bend) });
    inner.colorNode = foliageShade({
      ...shadeArgs,
      nProxy,
      nDetail: vec4(0),
      ao: params.inner.x,
      posLocal: restV,
      sunVis: sunVisibility(rest),
      leaf: leafSphereSample({
        tex: innerTex,
        samp: innerTex,
        p: restV,
        clusterIndex,
        spheres,
        cutoff: I.lodD.x,
        far: innerFar,
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

  const wood = new THREE.MeshBasicNodeMaterial();
  wood.fog = false;
  {
    const morphData = attribute('morphData', 'vec4');
    const morph = woodMorph({ morphData, woodLod: I.woodLod });
    const baseData = attribute('woodData', 'vec4');
    const woodData = vec4(baseData.x, mix(baseData.y, morphData.x, morph), baseData.z, mix(baseData.w, morphData.y, morph));
    const axisPos = mix(attribute('axisPos', 'vec3'), attribute('morphAxis', 'vec3'), morph);
    const pos = mix(attribute('position', 'vec3'), attribute('morphPos', 'vec3'), morph);
    const rest = woodRestPosition({ pos, axisPos, woodData, lodW: I.wood });
    wood.positionNode = rest.add(woodWind({ pos: rest, axisPos, woodData, ...windArgs }));
    wood.colorNode = woodShade({
      n: varying(mix(attribute('normal', 'vec3'), attribute('morphNormal', 'vec3'), morph)),
      posLocal: varying(rest),
      camLocal: I.cam,
      sun: I.sun,
      sunVis: sunVisibility(rest),
      woodData: varying(woodData),
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

  return { shell, core, inner, wood, decal };
}

export function disposeTreeMaterials(materials) {
  for (const m of Object.values(materials)) m.dispose();
}
