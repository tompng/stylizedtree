fn crownRestPosition(pos: vec3f, morphPos: vec3f, crownData: vec4f, lodC: vec4f) -> vec3f {
  let drawLevel = lodC.x;
  let morph = lodC.y;
  let birthLevel = crownData.x;

  if (abs(birthLevel - drawLevel) < 0.5) {
    return mix(pos, morphPos, morph);
  }
  return pos;
}
