fn st_hash11(x: f32) -> f32 {
  return fract(sin(x * 12.9898 + 4.1414) * 43758.5453);
}

fn st_hash21(p: vec2f) -> f32 {
  var q = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  q = q + dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

fn st_hash31(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q = q + dot(q, q.zyx + 31.32);
  return fract((q.x + q.y) * q.z);
}

fn st_noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = st_hash21(i);
  let b = st_hash21(i + vec2f(1.0, 0.0));
  let c = st_hash21(i + vec2f(0.0, 1.0));
  let d = st_hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn st_noise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let x00 = mix(st_hash31(i), st_hash31(i + vec3f(1.0, 0.0, 0.0)), u.x);
  let x10 = mix(st_hash31(i + vec3f(0.0, 1.0, 0.0)), st_hash31(i + vec3f(1.0, 1.0, 0.0)), u.x);
  let x01 = mix(st_hash31(i + vec3f(0.0, 0.0, 1.0)), st_hash31(i + vec3f(1.0, 0.0, 1.0)), u.x);
  let x11 = mix(st_hash31(i + vec3f(0.0, 1.0, 1.0)), st_hash31(i + vec3f(1.0, 1.0, 1.0)), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

fn st_fbm2(p: vec2f) -> f32 {
  return st_noise2(p) * 0.55
    + st_noise2(p * 2.07 + vec2f(17.3, 9.1)) * 0.3
    + st_noise2(p * 4.13 + vec2f(3.7, 41.9)) * 0.15;
}

fn st_fbm3(p: vec3f) -> f32 {
  return st_noise3(p) * 0.55
    + st_noise3(p * 2.07 + vec3f(17.3, 9.1, 5.7)) * 0.3
    + st_noise3(p * 4.13 + vec3f(3.7, 41.9, 23.3)) * 0.15;
}

fn st_windOffset(anchor: vec3f, wind: vec4f, tree: vec4f) -> vec3f {
  let treeHeight = tree.x;
  let phase = tree.y + dot(anchor.xz, vec2f(0.23, 0.19));
  let gust = tree.z;
  let time = wind.w;
  let strength = length(wind.xyz);
  let dir = wind.xyz / max(strength, 0.0001);
  let side = vec3f(-dir.z, 0.0, dir.x);
  let h = clamp(anchor.y / max(treeHeight, 0.1), 0.0, 1.5);
  let sway = gust + 0.3 * sin(time * 1.35 + phase) + 0.12 * sin(time * 2.6 + phase * 1.9);
  let lateral = 0.16 * sin(time * 0.87 + phase * 2.3);
  var offset = (dir * sway + side * lateral) * (strength * h * h);
  offset.y = offset.y - dot(offset.xz, offset.xz) * 0.5 / max(anchor.y, 1.0);
  return offset;
}

// Shell vertices of the drawn grid level (patchData.z == lodA.y) geomorph by lodA.z toward the
// next coarser representation stored in their morph* attributes.
fn st_shellMorph(patchData: vec4f, lodA: vec4f) -> f32 {
  return select(0.0, lodA.z, abs(patchData.z - lodA.y) < 0.5);
}

// Rotation by rotation vector w (axis * angle), Rodrigues' formula.
fn st_rotateVector(v: vec3f, w: vec3f) -> vec3f {
  let angle = length(w);
  if (angle < 0.000001) {
    return v;
  }
  let k = w / angle;
  let c = cos(angle);
  return v * c + cross(k, v) * sin(angle) + k * dot(k, v) * (1.0 - c);
}

// Local gust strength: a steady part plus the instance's gust level (tree.z) carried by a noise
// pattern that travels downwind, so gusts sweep through the crown instead of moving it as one.
fn st_windGust(p: vec3f, wind: vec4f, tree: vec4f) -> f32 {
  let strength = length(wind.xyz);
  let dir = wind.xyz / max(strength, 0.0001);
  let side = vec3f(-dir.z, 0.0, dir.x);
  let n = st_noise2(vec2f(dot(p, dir) * 0.35 - wind.w * 1.2 + tree.y, dot(p, side) * 0.25));
  return 0.4 + tree.z * (0.4 + 1.2 * n);
}

// Rotation vector of cluster ci bending on its twig, about the pivot in sphere texture row 5 (where
// the twig forks off its limb; w = flexibility). The twig turns toward the wind in proportion to
// how far it is from pointing along it.
fn st_clusterBend(ci: i32, spheres: texture_2d<f32>, wind: vec4f, tree: vec4f, windBend: vec4f) -> vec3f {
  let bendAmount = windBend.x;
  let center = textureLoad(spheres, vec2i(ci, 0), 0).xyz;
  let pivot = textureLoad(spheres, vec2i(ci, 5), 0);
  let strength = length(wind.xyz);
  let dir = wind.xyz / max(strength, 0.0001);
  let twig = normalize(center - pivot.xyz + vec3f(0.0, 0.0001, 0.0));
  let sway = 0.15 * sin(wind.w * 1.9 + f32(ci) * 37.0);
  return cross(twig, dir) * (bendAmount * strength * pivot.w * (st_windGust(center, wind, tree) + sway));
}

// Offset of rest point p of cluster ci: the bend (rotation about the pivot), a lean that carries
// the cluster's far end (along the twig) further downwind, a press that flattens its windward side,
// and a ripple of the local gust through it. `amount` scales it all.
fn st_clusterDeform(p: vec3f, ci: i32, spheres: texture_2d<f32>, wind: vec4f, tree: vec4f, windBend: vec4f, bend: vec3f, amount: f32) -> vec3f {
  let lean = windBend.y;
  let press = windBend.z;
  let ripple = windBend.w;
  let centerRow = textureLoad(spheres, vec2i(ci, 0), 0);
  let center = centerRow.xyz;
  let radius = centerRow.w;
  let pivot = textureLoad(spheres, vec2i(ci, 5), 0);
  let strength = length(wind.xyz);
  let dir = wind.xyz / max(strength, 0.0001);
  let twig = normalize(center - pivot.xyz + vec3f(0.0, 0.0001, 0.0));
  let gustCenter = st_windGust(center, wind, tree);
  let gustHere = st_windGust(p, wind, tree);
  let q = p - center;
  let push = dir * (strength * pivot.w * (
    lean * gustCenter * dot(q, twig)
    + press * gustHere * max(-dot(q, dir), 0.0)
    + ripple * (gustHere - gustCenter) * radius));
  return (st_rotateVector(p - pivot.xyz, bend * amount) + pivot.xyz - p) + push * amount;
}

fn st_sunVisibility(p: vec3f, sunDir: vec3f, spheres: texture_2d<f32>, row: i32, count: i32, density: f32, softness: f32) -> f32 {
  var vis = 1.0;
  for (var i = 0; i < count; i = i + 1) {
    let s = textureLoad(spheres, vec2i(i, row), 0);
    let oc = s.xyz - p;
    let t = dot(oc, sunDir);
    let d = sqrt(max(dot(oc, oc) - t * t, 0.0));
    let r = s.w;
    if (r > 0.0) {
      var o = 1.0 - smoothstep(r * (1.0 - softness), r * (1.0 + 0.25 * softness), d);
      o = o * smoothstep(0.0, r * 0.8, t);
      vis = vis * (1.0 - o * density);
    }
  }
  return vis;
}

fn st_ramp3(x: f32, e1: f32, e2: f32, soft: f32, c0: vec3f, c1: vec3f, c2: vec3f) -> vec3f {
  let t1 = smoothstep(e1 - soft, e1 + soft, x);
  let t2 = smoothstep(e2 - soft, e2 + soft, x);
  return mix(mix(c0, c1, t1), c2, t2);
}

fn st_fogColor(viewDir: vec3f, sunDir: vec3f, horizon: vec3f, sunHaze: vec3f) -> vec3f {
  let haze = pow(max(dot(viewDir, sunDir), 0.0), 8.0);
  return mix(horizon, sunHaze, haze * 0.6);
}

fn st_applyFog(color: vec3f, camToPoint: vec3f, sunDir: vec3f, horizon: vec3f, sunHaze: vec3f, density: f32) -> vec3f {
  let dist = length(camToPoint);
  let f = 1.0 - exp(-dist * density);
  let fogColor = st_fogColor(camToPoint / max(dist, 0.0001), sunDir, horizon, sunHaze);
  return mix(color, fogColor, f);
}

// Branch chains in row 1: each texel is (point, radius); a negative radius starts a new chain.
// Closest points between the sun ray and each segment: Ericson, Real-Time Collision Detection 5.1.9.
fn st_woodVisibility(p: vec3f, sunDir: vec3f, spheres: texture_2d<f32>, count: i32) -> f32 {
  var vis = 1.0;
  var prev = textureLoad(spheres, vec2i(0, 1), 0);
  for (var i = 1; i < count; i = i + 1) {
    let cur = textureLoad(spheres, vec2i(i, 1), 0);
    if (cur.w > 0.0) {
      let a = prev.xyz;
      let ab = cur.xyz - a;
      let r = p - a;
      let e = dot(ab, ab);
      let f = dot(ab, r);
      let c = dot(sunDir, r);
      let b = dot(sunDir, ab);
      let denom = e - b * b;
      var s = 0.0;
      if (denom > 0.000001) {
        s = max((b * f - c * e) / denom, 0.0);
      }
      var t = (b * s + f) / max(e, 0.000001);
      if (t < 0.0) {
        t = 0.0;
        s = max(-c, 0.0);
      } else if (t > 1.0) {
        t = 1.0;
        s = max(b - c, 0.0);
      }
      let dist = length(p + sunDir * s - (a + ab * t));
      let radius = mix(abs(prev.w), cur.w, t);
      let o = (1.0 - smoothstep(radius * 0.75, radius * 1.15, dist)) * smoothstep(0.0, radius, s);
      vis = vis * (1.0 - o);
    }
    prev = cur;
  }
  return vis;
}
