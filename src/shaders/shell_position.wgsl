fn shellRestPosition(basePos: vec3f, nearOffset: vec3f, lodA: vec4f) -> vec3f {
  let near = lodA.x;
  return basePos + nearOffset * near;
}
