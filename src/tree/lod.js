import { clamp, lerp, smoothstep } from '../math.js';

// LOD level L = log2(referencePixels / projected crown radius in px): +1 per doubling of distance.
export const defaultLodSettings = {
  mode: 'auto',
  manualLevel: 0,
  bias: 0,
  referencePixels: 400,

  fillStart: 1.2,
  fillEnd: 3.0,
  pruneStart: 2.6,
  pruneEnd: 3.8,
  flareStart: 1.8,
  flareEnd: 3.4,
  corePolyStart: 3.6,
  corePolyEnd: 4.4,
  mergeStart: 3.8,
  mergeEnd: 5.0,
  crownPolyEnd: 7.0,

  cutoffNear: 0.5,
  cutoffFar: 0.22,
  coreScale: 0.985,
  aoInner: 0.7,
  compensation: 0.5,
  pruneFade: 0.08,
};

export function evaluateLod(level, s) {
  const fill = smoothstep(s.fillStart, s.fillEnd, level);
  const prune = smoothstep(s.pruneStart, s.pruneEnd, level);
  const keep = 1 - prune;
  const coreT = clamp((level - s.corePolyStart) / Math.max(s.corePolyEnd - s.corePolyStart, 1e-3), 0, 1);
  const merge = smoothstep(s.mergeStart, s.mergeEnd, level);
  const crownT = 2 * clamp((level - s.mergeEnd) / Math.max(s.crownPolyEnd - s.mergeEnd, 1e-3), 0, 1);
  const crownStep = Math.min(Math.floor(crownT), 2);
  return {
    level,
    flare: 1 - smoothstep(s.flareStart, s.flareEnd, level),
    fill,
    keep,
    keepThreshold: keep * (1 + s.pruneFade),
    grow: 1 + (Math.min(1 / Math.sqrt(Math.max(keep, 0.25)), 2) - 1) * s.compensation,
    cutoff: lerp(s.cutoffNear, s.cutoffFar, fill),
    coreScale: s.coreScale,
    coreRadialAo: lerp(s.aoInner, 1, fill),
    dissolve: prune * (1 - smoothstep(s.crownPolyEnd, s.crownPolyEnd + 1.5, level)),
    coreLevel: coreT >= 1 ? 1 : 2,
    coreMorph: coreT >= 1 ? 0 : coreT,
    merge,
    crownActive: level >= s.mergeEnd,
    crownLevel: 2 - crownStep,
    crownMorph: crownT - crownStep,
    limbScale: 1 - smoothstep(s.crownPolyEnd, s.crownPolyEnd + 1.5, level),
    twigScale: keep,
  };
}
