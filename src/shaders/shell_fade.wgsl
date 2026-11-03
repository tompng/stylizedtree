// Threshold on the leaf core field (st_leafSampleGrad): leaves shrink toward their own centers near the
// patch outline (bump 16x(1-x)y(1-y) in patch-local coordinates) and on patches seen edge-on,
// instead of being cut by the patch edge or turned into wide semi-transparent areas.
fn shellFadeThreshold(patchUv: vec2f, nPatch: vec3f, posLocal: vec3f, camLocal: vec3f, patchFade: vec4f, near: f32) -> f32 {
  let fadeStart = patchFade.x;
  let fadeStrength = patchFade.y;
  let grazing = patchFade.z;

  let bump = 16.0 * patchUv.x * (1.0 - patchUv.x) * patchUv.y * (1.0 - patchUv.y);
  let edge = smoothstep(fadeStart, 1.0, 1.0 - bump) * fadeStrength;
  let facing = abs(dot(normalize(nPatch), normalize(camLocal - posLocal)));
  let side = (1.0 - smoothstep(0.05, 0.4, facing)) * grazing;
  return max(edge, side) * near;
}
