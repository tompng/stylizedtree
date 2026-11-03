fn shellNormalAo(nPatchAo: vec4f, morphNormalAo: vec4f, patchData: vec4f, lodA: vec4f) -> vec4f {
  return mix(nPatchAo, morphNormalAo, st_shellMorph(patchData, lodA));
}
