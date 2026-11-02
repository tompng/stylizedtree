fn sunVisibilityAt(p: vec3f, sun: vec4f, spheres: texture_2d<f32>, counts: vec4f, shadow: vec4f) -> f32 {
  let density = shadow.x;
  let softness = shadow.y;
  return st_sunVisibility(p, sun.xyz, spheres, 0, i32(counts.x + 0.5), density, softness);
}
