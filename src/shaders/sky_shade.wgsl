fn skyShade(viewVec: vec3f, sun: vec4f, cZenith: vec3f, cHorizon: vec3f, cSunHaze: vec3f, cSun: vec3f) -> vec4f {
  let d = normalize(viewVec);
  let h = max(d.y, 0.0);
  var col = mix(st_fogColor(d, sun.xyz, cHorizon, cSunHaze), cZenith, pow(h, 0.5));
  col = col + cSun * smoothstep(0.9994, 0.9998, dot(d, sun.xyz));
  return vec4f(col, 1.0);
}
