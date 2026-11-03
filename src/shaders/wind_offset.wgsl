fn windOffsetAt(anchor: vec3f, wind: vec4f, tree: vec4f) -> vec3f {
  return st_windOffset(anchor, wind, tree);
}
