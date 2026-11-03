// Wood vertices dropped at the drawn detail level (morphData.z == woodLod.x) geomorph by woodLod.y.
fn woodMorph(morphData: vec4f, woodLod: vec4f) -> f32 {
  return select(0.0, woodLod.y, abs(morphData.z - woodLod.x) < 0.5);
}
