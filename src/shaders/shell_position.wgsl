fn shellRestPosition(basePos: vec3f, nearOffset: vec3f, morphFar: vec3f, morphOffset: vec3f, patchData: vec4f, lodA: vec4f) -> vec3f {
  let near = lodA.x;
  let morph = st_shellMorph(patchData, lodA);
  return mix(basePos, morphFar, morph) + mix(nearOffset, morphOffset, morph) * near;
}
