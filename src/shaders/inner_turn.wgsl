fn innerTurn(v: vec3f, clusterIndex: f32, spheres: texture_2d<f32>) -> vec3f {
  return st_rotateQuat(v, textureLoad(spheres, vec2i(i32(clusterIndex + 0.5), 6), 0));
}
