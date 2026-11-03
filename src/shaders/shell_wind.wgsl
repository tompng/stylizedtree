fn shellWind(rest: vec3f, patchCenter: vec4f, patchData: vec4f, spheres: texture_2d<f32>, wind: vec4f, tree: vec4f, windBend: vec4f, bend: vec3f, tilt: vec3f) -> vec3f {
  let ci = i32(patchData.w + 0.5);
  let center = textureLoad(spheres, vec2i(ci, 0), 0).xyz;
  let pc = patchCenter.xyz;
  let patchOffset = st_rotateVector(rest - pc, tilt) + pc - rest;
  return st_windOffset(center, wind, tree) + st_clusterDeform(rest, ci, spheres, wind, tree, windBend, bend, 1.0) + patchOffset;
}
