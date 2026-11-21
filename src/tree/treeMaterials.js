import * as THREE from 'three/webgpu';
import { attribute, float, int, max, mix, screenCoordinate, texture, uniform, uniformArray, varying, vec3, vec4, wgsl, wgslFn } from 'three/tsl';
import clusterBendSrc from '../shaders/cluster_bend.wgsl?raw';
import commonSrc from '../shaders/common.wgsl?raw';
import decalPositionSrc from '../shaders/decal_position.wgsl?raw';
import decalShadeSrc from '../shaders/decal_shade.wgsl?raw';
import foliageShadeSrc from '../shaders/foliage_shade.wgsl?raw';
import innerFadeSrc from '../shaders/inner_fade.wgsl?raw';
import innerPlaceSrc from '../shaders/inner_place.wgsl?raw';
import innerTurnSrc from '../shaders/inner_turn.wgsl?raw';
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
const woodRestPosition = fn(woodPositionSrc);
const clusterBend = fn(clusterBendSrc);
const patchTilt = fn(patchTiltSrc);
const woodWind = fn(woodWindSrc);
const woodMorph = fn(woodMorphSrc);
const rotateVector = fn(rotateVectorSrc);
const decalPosition = fn(decalPositionSrc);
const sunVisibilityAt = fn(sunVisibilitySrc);
const leafSphereSample = fn(leafSphereSampleSrc, [leafSampleCore]);
const innerFadeThreshold = fn(innerFadeSrc);
const innerPlace = fn(innerPlaceSrc);
const innerTurn = fn(innerTurnSrc);
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
  soft: { ramp: [0.42, 0.66, 0.16, 0.1], edge: [0.4, 0.25, 0, 0], tone: [0.75, 0.4, 0.7, 0.65] },
  crisp: { ramp: [0.42, 0.66, 0.05, 0.16], edge: [0, 0, 0, 0], tone: [1, 0.12, 1, 0.65] },
};

export const params = {
  // band1, band2, bandSoftness, leafVariation
  ramp: uniform(new THREE.Vector4(0.42, 0.66, 0.16, 0.1)),
  // translucency, edgeBrightness, hueVariation, skyAmbient
  look: uniform(new THREE.Vector4(0.55, 0.08, 0.25, 0.6)),
  // patchNormalWeight, farDensity (scales leaf opacity once pixels span several leaves; alpha to
  // coverage gives equal alphas the same samples, so overlapping minified layers barely add up), -,
  // bakedAo (0 ignores the occlusion baked from the other clusters)
  look2: uniform(new THREE.Vector4(0.35, 2.3, 0, 1)),
  // edgeSoftness, alphaDither, edgeOutward (moves the soft ramp below the cutoff), -
  edge: uniform(new THREE.Vector4(0.4, 0.25, 0, 0)),
  // start (1 - bump where leaves start shrinking), strength, grazing (edge-on patches), -
  patchFade: uniform(new THREE.Vector4(0.15, 1, 1, 0)),
  // per-leaf variation of the shrink threshold, shrink softness
  leafShrink: uniform(new THREE.Vector4(0.5, 0.15, 0, 0)),
  // shade (AO of the inner shade-leaf layer), rimWidth, thin, -
  inner: uniform(new THREE.Vector4(0.1, 0.8, 0.05, 0)),
  // contrast, shadowFloor, aoStrength, depthShade (AO of the deepest shell patches)
  tone: uniform(new THREE.Vector4(0.75, 0.4, 0.7, 0.65)),
  // density, softness (cluster-to-cluster sun occlusion)
  shadow: uniform(new THREE.Vector4(0.8, 0.35, 0, 0)),
  // strength, breakup, density, softness (ground shadow)
  groundShadow: uniform(new THREE.Vector4(0.85, 0.6, 0.85, 0.3)),
  // bend, lean, -, - (cluster response to wind, st_clusterDeform)
  windBend: uniform(new THREE.Vector4(0.35, 0.25, 0, 0)),
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
  wood: perInstance('wood', new THREE.Vector4(1, 1, 1, 0)),
  // drawn wood detail level, geomorph toward the next coarser level
  woodLod: perInstance('woodLod', new THREE.Vector4(2, 0, 0, 0)),
  decal: perInstance('decal', new THREE.Vector4(0, 0, 1, 1)),
};

const meshTint = uniform(new THREE.Vector4()).onObjectUpdate(({ object }) => object.userData.tint);
const CARD_TINT = vec3(0.3, 0.85, 0.35);

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
  const keptTex = texture(atlases.leaf.userData.keptTexture);
  // Leaves stay sharp until the pixel footprint nears their width, then turn into averaged coverage.
  const farParams = (atlas, scale) => {
    const mip = Math.log2(atlas.userData.leafWidthTexels);
    return vec4(scale.mul(params.look2.y), mip - 1, mip + 1, 0);
  };
  // Per-cluster LOD of the drawn instance (TreeInstance.clusterLod), two vec4s per cluster:
  // (inner fade, shell level, shell morph, alpha cutoff), (farCoverageScale of the leaf atlas, -, -, -).
  const clusterLod = uniformArray(Array.from({ length: asset.tree.clusters.length * 2 }, () => new THREE.Vector4()), 'vec4')
    .onObjectUpdate(function ({ object }) {
      this.array = object.userData.clusterLod;
    });
  const lodOf = (clusterIndex, row) => clusterLod.element(int(clusterIndex.add(0.5)).mul(2).add(row));
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
  const windArgs = { spheres, wind: I.wind, tree: I.tree, windBend: params.windBend };
  const bakedAo = (ao) => mix(float(1), ao, params.look2.w);

  // The inner layer draws the shell's own patches again, turned about the cluster center and moved
  // in to the deepest layer (innerPlace), and shades them dark.
  const shellMaterial = (inner) => {
    const material = foliageMaterial(THREE.DoubleSide);
    const patchData = attribute('patchData', 'vec4');
    const morphPatch = attribute('morphPatch', 'vec4');
    const basePos = attribute('position', 'vec3');
    const morphFar = attribute('morphFar', 'vec3');
    const clusterIndex = patchData.w;
    const lodA = lodOf(clusterIndex, 0);
    const morph = shellMorphFactor({ patchData, lodA });
    const ownCenter = attribute('patchCenter', 'vec4');
    const targetCenter = attribute('morphCenter', 'vec4');
    const restPivot = mix(ownCenter.xyz, targetCenter.xyz, morph);
    const innerShift = attribute('innerShift', 'vec2');
    const place = (p) => (inner
      ? innerPlace({ p, patchCenter: restPivot, innerShift: mix(innerShift.x, innerShift.y, morph), clusterIndex, spheres })
      : p);
    const turn = (v) => (inner ? innerTurn({ v, clusterIndex, spheres }) : v);
    const pivot = place(restPivot);
    const far = shellFarPosition({ basePos, morphFar, patchData, lodA });
    const rest = place(shellRestPosition({
      basePos,
      nearOffset: attribute('nearOffset', 'vec3'),
      morphFar,
      morphOffset: attribute('morphOffset', 'vec3'),
      patchData,
      lodA,
    }));
    const normalAo = shellNormalAo({
      nPatchAo: attribute('nPatchAo', 'vec4'),
      morphNormalAo: attribute('morphNormalAo', 'vec4'),
      patchData,
      lodA,
    });
    const nPatchAo = varying(vec4(turn(normalAo.xyz), normalAo.w));
    const proxy = turn(mix(attribute('proxyNormal', 'vec3'), attribute('morphProxy', 'vec3'), morph));
    const patchUv = varying(shellPatchUv({ patchUv: attribute('patchUv', 'vec2'), morphUv: morphPatch.xy, patchData, lodA }));
    const patchEdge = float(1).sub(patchUv.x.mul(patchUv.x.oneMinus()).mul(patchUv.y).mul(patchUv.y.oneMinus()).mul(16));
    const depth = varying(mix(patchData.x, morphPatch.z, morph));
    const rand = varying(mix(patchData.y, morphPatch.w, morph));
    const bend = clusterBend({ clusterIndex, ...windArgs });
    const tiltArgs = { pivot, clusterIndex, spheres, wind: I.wind, tree: I.tree, windPatch: params.windPatch };
    const tilt = mix(
      patchTilt({ ...tiltArgs, radius: ownCenter.w, rand: patchData.y }),
      patchTilt({ ...tiltArgs, radius: targetCenter.w, rand: morphPatch.w }),
      morph,
    );
    material.positionNode = rest.add(shellWind({ rest, pivot, clusterIndex, ...windArgs, bend, tilt }));
    const bendV = varying(bend);
    const nProxy = rotateVector({ v: varying(proxy), w: bendV });
    const nPatch = rotateVector({ v: nPatchAo.xyz, w: bendV.add(varying(tilt)) });
    const farV = varying(far);
    const restV = varying(rest);
    const edgeFade = shellFadeThreshold({ patchUv, nPatch, posLocal: restV, camLocal: I.cam, patchFade: params.patchFade });
    const isCard = float(1).sub(patchData.z.min(1));
    material.colorNode = foliageShade({
      ...shadeArgs,
      tint: inner ? meshTint : vec4(mix(meshTint.xyz, CARD_TINT, isCard), meshTint.w),
      nProxy,
      nDetail: vec4(nPatch, params.look2.x),
      ao: inner ? params.inner.x : bakedAo(nPatchAo.w).mul(mix(float(1), params.tone.w, depth)),
      posLocal: restV,
      sunVis: sunVisibility(rest),
      leaf: leafSphereSample({
        tex: leafTex,
        samp: leafTex,
        kept: keptTex,
        keptSamp: keptTex,
        p: farV,
        clusterIndex,
        spheres,
        cutoff: lodA.w,
        far: farParams(atlases.leaf, lodOf(clusterIndex, 1).x),
        patchRand: rand,
        edge: params.edge,
        threshold: inner
          ? max(edgeFade, innerFadeThreshold({
            nProxy,
            posLocal: restV,
            clusterIndex,
            spheres,
            camLocal: I.cam,
            inner: params.inner,
            lodFade: lodA.x,
          }))
          : edgeFade,
        shrink: params.leafShrink,
      }),
      misc: vec4(clusterIndex, inner ? 0 : patchEdge, 0, 0),
    });
    return material;
  };
  const shell = shellMaterial(false);
  const inner = shellMaterial(true);

  const wood = new THREE.MeshBasicNodeMaterial();
  wood.fog = false;
  {
    const morphData = attribute('morphData', 'vec4');
    const morph = woodMorph({ morphData, woodLod: I.woodLod });
    const baseData = attribute('woodData', 'vec4');
    const woodData = vec4(baseData.x, bakedAo(mix(baseData.y, morphData.x, morph)), baseData.z, mix(baseData.w, morphData.y, morph));
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

  return { shell, inner, wood, decal };
}

export function disposeTreeMaterials(materials) {
  for (const m of Object.values(materials)) m.dispose();
}
