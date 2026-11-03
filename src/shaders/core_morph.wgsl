// Core vertices dropped at the drawn level (coreData.x == lodB.y) geomorph by lodB.z.
fn coreMorph(coreData: vec4f, lodB: vec4f) -> f32 {
  return select(0.0, lodB.z, abs(coreData.x - lodB.y) < 0.5);
}
