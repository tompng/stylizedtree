fn woodShade(n: vec3f, posLocal: vec3f, camLocal: vec3f, sun: vec4f, sunVis: f32, woodData: vec4f, cWood: vec3f, cWoodShadow: vec3f, cSky: vec3f, ramp: vec4f, fog: vec4f, cHorizon: vec3f, cSunHaze: vec3f) -> vec4f {
  let ao = woodData.y;
  let band = ramp.x;
  let bandSoftness = ramp.z;
  let N = normalize(n);
  let L = sun.xyz;
  let x = (dot(N, L) * 0.5 + 0.5) * (0.12 + 0.88 * sunVis);
  let lit = smoothstep(band - bandSoftness, band + bandSoftness, x);
  var col = mix(cWoodShadow, cWood, lit);
  col = mix(col, cSky * 0.5, 0.12 * (N.y * 0.5 + 0.5) * (1.0 - lit));
  col = col * mix(0.45, 1.0, ao);
  col = st_applyFog(col, posLocal - camLocal, L, cHorizon, cSunHaze, fog.x);
  return vec4f(col, 1.0);
}
