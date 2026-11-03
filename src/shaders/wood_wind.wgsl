// Twigs (woodData: level 2, cluster index, position t along the twig) carry their cluster's bend,
// weighted by t² from the fork so that the tip, at the cluster center, moves with the cluster.
// The bend fades with the twigs (lodW.z) like the cluster's does with the merge.
fn woodWind(pos: vec3f, axisPos: vec3f, woodData: vec4f, spheres: texture_2d<f32>, wind: vec4f, tree: vec4f, windBend: vec4f, lodW: vec4f) -> vec3f {
  let level = woodData.x;
  let t = woodData.w;
  var offset = st_windOffset(axisPos, wind, tree);
  if (level > 1.5) {
    let ci = i32(woodData.z + 0.5);
    let pivot = textureLoad(spheres, vec2i(ci, 5), 0).xyz;
    let bend = st_clusterBend(ci, spheres, wind, tree, windBend) * (t * t * lodW.z);
    offset = offset + st_rotateVector(pos - pivot, bend) + pivot - pos;
  }
  return offset;
}
