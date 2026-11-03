fn shellFarPosition(basePos: vec3f, morphFar: vec3f, patchData: vec4f, lodA: vec4f) -> vec3f {
  return mix(basePos, morphFar, st_shellMorph(patchData, lodA));
}
