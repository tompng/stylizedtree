fn shellWind(rest: vec3f, pivot: vec3f, clusterIndex: f32, spheres: texture_2d<f32>, wind: vec4f, tree: vec4f, windBend: vec4f, bend: vec3f, tilt: vec3f) -> vec3f {
  let ci = i32(clusterIndex + 0.5);
  let center = textureLoad(spheres, vec2i(ci, 0), 0).xyz;
  let patchOffset = st_rotateVector(rest - pivot, tilt) + pivot - rest;
  return st_windOffset(center, wind, tree) + st_clusterDeform(rest, ci, spheres, wind, tree, windBend, bend, 1.0) + patchOffset;
}
