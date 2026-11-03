fn clusterDeform(p: vec3f, clusterIndex: f32, spheres: texture_2d<f32>, wind: vec4f, tree: vec4f, windBend: vec4f, bend: vec3f, amount: f32) -> vec3f {
  return st_clusterDeform(p, i32(clusterIndex + 0.5), spheres, wind, tree, windBend, bend, amount);
}
