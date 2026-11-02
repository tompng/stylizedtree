fn shellRestPosition(basePos: vec3f, flareVec: vec3f, patchCenter: vec3f, patchData: vec4f, lodA: vec4f) -> vec3f {
  let flareFactor = lodA.x;
  let keepThreshold = lodA.y;
  let grow = lodA.z;
  let pruneFade = lodA.w;
  let rank = patchData.x;

  let shrink = 1.0 - smoothstep(keepThreshold - pruneFade, keepThreshold, rank);
  let p = basePos + flareVec * flareFactor;
  return patchCenter + (p - patchCenter) * (shrink * grow);
}
