fn decalPosition(pos: vec3f, decal: vec4f) -> vec3f {
  let center = decal.xy;
  let size = decal.zw;
  return vec3f(center.x + pos.x * size.x, 0.0, center.y + pos.z * size.y);
}
