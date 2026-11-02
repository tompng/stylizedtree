fn woodRestPosition(pos: vec3f, axisPos: vec3f, woodData: vec4f, lodW: vec4f) -> vec3f {
  let level = woodData.x;
  var radiusScale = lodW.x;
  if (level > 0.5) {
    radiusScale = lodW.y;
  }
  if (level > 1.5) {
    radiusScale = lodW.z;
  }
  return axisPos + (pos - axisPos) * radiusScale;
}
