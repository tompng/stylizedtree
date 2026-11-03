import { clamp, lerp, smoothstep } from '../math.js';

// LOD level L = log2(referencePixels / projected crown radius in px): +1 per doubling of distance.
export const defaultLodSettings = {
  mode: 'auto',
  manualLevel: 0,
  bias: 0,
  referencePixels: 400,

  collapseStart: 1.4,
  collapseEnd: 3.2,
  // Shell grid levels step down evenly from here to collapseEnd, the last step onto the core mesh.
  shellPolyStart: 1.4,
  corePolyStart: 3.6,
  corePolyEnd: 4.4,
  mergeStart: 3.8,
  mergeEnd: 5.0,
  crownPolyEnd: 7.0,

  cutoffNear: 0.5,
  cutoffFar: 0.22,
};

export function evaluateLod(level, s) {
  const collapse = smoothstep(s.collapseStart, s.collapseEnd, level);
  const shellPoly = clamp((level - s.shellPolyStart) / Math.max(s.collapseEnd - s.shellPolyStart, 1e-3), 0, 1);
  const coreT = clamp((level - s.corePolyStart) / Math.max(s.corePolyEnd - s.corePolyStart, 1e-3), 0, 1);
  const merge = smoothstep(s.mergeStart, s.mergeEnd, level);
  const crownT = 2 * clamp((level - s.mergeEnd) / Math.max(s.crownPolyEnd - s.mergeEnd, 1e-3), 0, 1);
  const crownStep = Math.min(Math.floor(crownT), 2);
  const limbScale = 1 - smoothstep(s.crownPolyEnd, s.crownPolyEnd + 1.5, level);
  return {
    level,
    near: 1 - collapse,
    shellPoly,
    shellActive: level < s.collapseEnd,
    cutoff: lerp(s.cutoffNear, s.cutoffFar, collapse),
    dissolve: smoothstep(s.collapseEnd, s.mergeStart, level) * limbScale,
    coreLevel: coreT >= 1 ? 0 : 1,
    coreMorph: coreT >= 1 ? 0 : coreT,
    merge,
    innerFade: clamp(merge * 2, 0, 1),
    crownActive: level >= s.mergeEnd,
    crownLevel: 2 - crownStep,
    crownMorph: crownT - crownStep,
    limbScale,
    twigScale: 1 - merge,
  };
}
