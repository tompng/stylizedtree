fn shellPatchUv(patchUv: vec2f, morphUv: vec2f, patchData: vec4f, lodA: vec4f) -> vec2f {
  return mix(patchUv, morphUv, st_shellMorph(patchData, lodA));
}
