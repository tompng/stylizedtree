fn coreRestPosition(surfacePos: vec3f, morphPos: vec3f, coreData: vec4f, cCenter: vec3f, crownPos: vec3f, lodB: vec4f) -> vec3f {
  let coreScale = lodB.x;
  let drawLevel = lodB.y;
  let morph = lodB.z;
  let merge = lodB.w;
  let birthLevel = coreData.x;

  var surface = surfacePos;
  if (abs(birthLevel - drawLevel) < 0.5) {
    surface = mix(surfacePos, morphPos, morph);
  }
  return mix(cCenter + (surface - cCenter) * coreScale, crownPos, merge);
}
