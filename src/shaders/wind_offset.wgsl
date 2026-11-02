fn windOffsetAt(anchor: vec3f, wobbleSeed: f32, wobbleAmount: f32, wind: vec4f, tree: vec4f) -> vec3f {
  return st_windOffset(anchor, wind, tree) + st_clusterWobble(wobbleSeed, wind, tree) * wobbleAmount;
}
