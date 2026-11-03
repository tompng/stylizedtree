fn clusterBend(clusterIndex: f32, spheres: texture_2d<f32>, wind: vec4f, tree: vec4f, windBend: vec4f) -> vec3f {
  return st_clusterBend(i32(clusterIndex + 0.5), spheres, wind, tree, windBend);
}
