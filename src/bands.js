// Elevation bands for a location: where you start, where most of the skiing happens, where it tops out.
export function bands(loc) {
  const bottom = loc.kind === "resort" ? loc.base : loc.trailhead;
  const top = loc.top;
  const v = top - bottom;
  const [coreLo, coreHi] = loc.core ?? (loc.kind === "resort"
    ? [bottom + 0.25 * v, bottom + 0.85 * v]
    : [bottom + 0.30 * v, top]);
  return { bottom, top, coreLo: Math.round(coreLo), coreHi: Math.round(coreHi), core: Math.round((coreLo + coreHi) / 2) };
}
