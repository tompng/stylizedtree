fn foliageShade(
  nProxy: vec3f, nDetail: vec4f, shadeIn: vec4f,
  posLocal: vec3f, camLocal: vec3f, sun: vec4f, sunVis: f32,
  leaf: vec4f, misc: vec4f, noisePos: vec3f, solidFill: f32, bulkCenter: vec3f, pixel: vec2f,
  cLit: vec3f, cMid: vec3f, cShadow: vec3f, cDeep: vec3f, cTrans: vec3f, cSky: vec3f,
  ramp: vec4f, look: vec4f, look2: vec4f, edge: vec4f, tone: vec4f, fog: vec4f, cHorizon: vec3f, cSunHaze: vec3f, tint: vec4f
) -> vec4f {
  let aoNear = shadeIn.x;
  let aoFar = shadeIn.y;
  let radialAo = shadeIn.z;
  let merge = shadeIn.w;
  let leafAlpha = leaf.x;
  let leafRand = leaf.y;
  let leafStroke = leaf.z;
  let patchRand = leaf.w;
  let clusterIndex = misc.x;
  let patchEdge = misc.y;
  let dissolve = misc.z;
  let isSolid = misc.w > 0.5;
  let band1 = ramp.x;
  let band2 = ramp.y;
  let bandSoftness = ramp.z;
  let leafVariation = ramp.w;
  let translucency = look.x;
  let edgeBrightness = look.y;
  let hueVariation = look.z;
  let skyAmbient = look.w;
  let dissolveFrequency = look2.z;
  let fillFrequency = look2.w;
  let edgeSoftness = edge.x;
  let alphaDither = edge.y;
  let contrast = tone.x;
  let shadowFloor = tone.y;
  let aoStrength = tone.z;

  let N = normalize(mix(normalize(nProxy), nDetail.xyz, nDetail.w));
  let L = sun.xyz;
  let toCam = camLocal - posLocal;
  let V = normalize(toCam);
  let ao = mix(aoNear, aoFar, merge) * radialAo;

  // fwidth must stay in uniform control flow, so the solid-mode alpha is computed for every fragment.
  // N alone would also read concave creases between lobes as silhouette; a point only counts as rim
  // when the direction from the bulk center is side-on too.
  let rim = 1.0 - abs(dot(N, V));
  let silhouetteRim = min(rim, 1.0 - abs(dot(normalize(posLocal - bulkCenter), V)));
  let edgeNoise = st_fbm3(noisePos * dissolveFrequency);
  let silhouette = 1.0 - dissolve * (0.12 + 0.55 * edgeNoise);
  let silhouetteWidth = max(max(fwidth(silhouetteRim), edgeSoftness * 0.2), 0.0001);
  let solidAlpha = clamp((silhouette - silhouetteRim) / silhouetteWidth + 0.5, 0.0, 1.0);
  let fillNoise = smoothstep(0.2, 0.8, st_fbm3(noisePos * fillFrequency + vec3f(clusterIndex * 7.31)));
  let fillWidth = max(max(fwidth(fillNoise), edgeSoftness * 0.3), 0.0001);
  let fillAlpha = clamp((mix(-0.05, 1.05, solidFill) - fillNoise) / fillWidth + 0.5, 0.0, 1.0);
  var alpha = select(leafAlpha, min(solidAlpha, fillAlpha), isSolid);
  // Alpha-to-coverage maps equal alpha to the same sample mask, so overlapping layers would not
  // accumulate; per-pixel jitter decorrelates them. Fully opaque/clear pixels are left untouched.
  let jitter = st_hash21(floor(pixel) + vec2f(patchRand * 251.0, clusterIndex * 37.0)) - 0.5;
  alpha = clamp(alpha + jitter * alphaDither * min(alpha, 1.0 - alpha) * 2.0, 0.0, 1.0);

  var x = dot(N, L) * 0.5 + 0.5;
  x = x + (leafRand - 0.5) * leafVariation + (leafStroke - 0.5) * leafVariation * 0.8 + patchEdge * edgeBrightness;
  x = x * (shadowFloor + (1.0 - shadowFloor) * sunVis);
  let pivot = (band1 + band2) * 0.5;
  x = pivot + (x - pivot) * contrast;

  let hue = (patchRand - 0.5) * hueVariation + (st_hash11(clusterIndex) - 0.5) * hueVariation * 0.6 * (1.0 - merge);
  let lit = cLit * (vec3f(1.0) + vec3f(0.6, 0.25, -0.8) * hue);
  let mid = cMid * (vec3f(1.0) + vec3f(0.3, 0.15, -0.4) * hue);
  let shadowColor = mix(cShadow, mix(cShadow, cSky, 0.45), (N.y * 0.5 + 0.5) * skyAmbient);
  var col = st_ramp3(x, band1, band2, bandSoftness, shadowColor, mid, lit);
  col = mix(cDeep, col, mix(1.0, smoothstep(0.0, 1.0, ao), aoStrength));

  let backLight = pow(max(dot(-V, L), 0.0), 3.0);
  let thinness = (0.3 + 0.7 * rim * rim) * (0.7 + 0.3 * patchEdge);
  col = col + cTrans * (backLight * thinness * translucency * (0.35 + 0.65 * sunVis) * ao);

  col = mix(col, tint.rgb, tint.a);
  col = st_applyFog(col, -toCam, L, cHorizon, cSunHaze, fog.x);
  return vec4f(col, alpha);
}
