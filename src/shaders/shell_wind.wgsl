fn shellWind(patchCenter: vec3f, patchData: vec4f, spheres: texture_2d<f32>, wind: vec4f, tree: vec4f) -> vec3f {
  let patchRand = patchData.y;
  let edge = patchData.z;
  let clusterIndex = patchData.w;
  let flutterAmount = tree.w;

  let center = textureLoad(spheres, vec2i(i32(clusterIndex + 0.5), 0), 0).xyz;
  let outward = normalize(patchCenter - center);
  let flutter = sin(wind.w * 5.3 + patchRand * 61.0 + edge * 2.0) * flutterAmount * edge * length(wind.xyz);
  return outward * flutter + st_windOffset(center, wind, tree) + st_clusterWobble(clusterIndex, wind, tree);
}
