import { clamp, lerp, smoothstep } from '../math.js';

// LOD level L = log2(referencePixels / projected crown radius in px): +1 per doubling of distance.
export const defaultLodSettings = {
  mode: 'auto',
  manualLevel: 0,
  bias: 0,
  referencePixels: 400,

  closeStart: 1.4,
  closeEnd: 3.2,
  pruneStart: 2.2,
  pruneEnd: 3.8,
  flareStart: 2.4,
  flareEnd: 3.8,
  corePolyStart: 3.6,
  corePolyEnd: 4.4,
  mergeStart: 3.8,
  mergeEnd: 5.0,
  crownPolyEnd: 7.0,

  cutoffNear: 0.5,
  cutoffFar: 0.22,
  coreScaleNear: 0.8,
  coreScaleFar: 0.985,
  aoInner: 0.55,
  compensation: 0.5,
  pruneFade: 0.08,
};

export function evaluateLod(level, s) {
  const close = smoothstep(s.closeStart, s.closeEnd, level);
  const prune = smoothstep(s.pruneStart, s.pruneEnd, level);
  const keep = 1 - prune;
  const coreScale = lerp(s.coreScaleNear, s.coreScaleFar, close);
  const coreT = clamp((level - s.corePolyStart) / Math.max(s.corePolyEnd - s.corePolyStart, 1e-3), 0, 1);
  const merge = smoothstep(s.mergeStart, s.mergeEnd, level);
  const crownT = 2 * clamp((level - s.mergeEnd) / Math.max(s.crownPolyEnd - s.mergeEnd, 1e-3), 0, 1);
  const crownStep = Math.min(Math.floor(crownT), 2);
  return {
    level,
    flare: 1 - smoothstep(s.flareStart, s.flareEnd, level),
    close,
    keep,
    keepThreshold: keep * (1 + s.pruneFade),
    grow: 1 + (Math.min(1 / Math.sqrt(Math.max(keep, 0.25)), 2) - 1) * s.compensation,
    cutoff: lerp(s.cutoffNear, s.cutoffFar, close),
    coreScale,
    coreRadialAo: lerp(s.aoInner, 1, smoothstep(s.coreScaleNear, s.coreScaleFar - 0.01, coreScale)),
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
