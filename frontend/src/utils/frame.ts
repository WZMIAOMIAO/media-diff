// The shared frame index used across video comparison is expressed in the
// reference (main) video's frame rate. Videos being compared can have different
// fps (e.g. a 24 fps original vs a 60 fps re-encode of the same clip), so the
// same frame N maps to a different wall-clock time in each. Convert the shared
// index to a given video's own frame index (clamped to its frame count) so
// every window extracts the same moment.
export function sharedToOwnFrame(
  shared: number,
  refFps: number,
  fps: number,
  frameCount: number,
): number {
  if (refFps > 0 && fps > 0) {
    const n = Math.round((shared - 1) * (fps / refFps)) + 1;
    return frameCount > 0 ? Math.max(1, Math.min(n, frameCount)) : Math.max(1, n);
  }
  return frameCount > 0 ? Math.min(shared, frameCount) : shared;
}
