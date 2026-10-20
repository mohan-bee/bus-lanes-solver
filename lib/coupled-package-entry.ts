import { distance, simplify } from "./geometry"
import { pointInBox } from "./package-approach-regions"
import type { Point, SimpleRouteJson } from "./types"

export interface CoupledPackageEntry {
  section: Point[]
  counterpart: Point[]
  /** Endpoint index of the containing segment in the supplied points. */
  stop: number
}

/** Find a joint package entry in board-world mm (+X right, +Y up). points[0]
 * anchors the last shared segment and points[1] ends that segment. Only the
 * following approach segments are searched. Positive offsets are left of
 * travel. Neither the supplied points nor the package box is modified. */
export function findCoupledPackageEntry(
  points: readonly Point[],
  signedOffset: number,
  box: SimpleRouteJson["bounds"],
  offsetPath: (points: Point[], offset: number) => Point[],
): CoupledPackageEntry | null {
  if (box.minX > box.maxX || box.minY > box.maxY) return null
  const epsilon = 1e-8
  for (let stop = 2; stop < points.length; stop++) {
    const a = points[stop - 1],
      b = points[stop],
      span = distance(a, b)
    if (span < epsilon) continue
    const dx = b.x - a.x,
      dy = b.y - a.y,
      ux = dx / span,
      uy = dy / span,
      offsetX = -uy * signedOffset,
      offsetY = ux * signedOffset
    // Both endpoints must be in the physical region. Only the normal offset
    // shrinks its usable extent; a horizontal approach needs no X inset.
    const entry = {
      minX: Math.max(box.minX, box.minX - offsetX),
      maxX: Math.min(box.maxX, box.maxX - offsetX),
      minY: Math.max(box.minY, box.minY - offsetY),
      maxY: Math.min(box.maxY, box.maxY - offsetY),
    }
    if (entry.minX > entry.maxX || entry.minY > entry.maxY) continue
    let lo = 0,
      hi = 1
    for (const [origin, delta, min, max] of [
      [a.x, dx, entry.minX, entry.maxX],
      [a.y, dy, entry.minY, entry.maxY],
    ]) {
      if (Math.abs(delta) < epsilon) {
        if (origin < min || origin > max) hi = -1
        continue
      }
      const first = (min - origin) / delta,
        last = (max - origin) / delta
      lo = Math.max(lo, Math.min(first, last))
      hi = Math.min(hi, Math.max(first, last))
    }
    if (lo > hi) continue
    const wholeSection = simplify(points.slice(0, stop + 1))
    if (wholeSection.length < 2) continue
    let wholeCounterpart: Point[]
    try {
      wholeCounterpart = offsetPath(wholeSection, signedOffset)
    } catch {
      continue
    }
    const miter = wholeCounterpart.at(-2)!
    const miterAdvance = (miter.x - a.x) * ux + (miter.y - a.y) * uy
    // A diagonal miter can project beyond the first geometric entry. Move the
    // cut past it so the mate's final segment continues forward, without a
    // zero-length final edge that would change the offset normal.
    const fraction = Math.max(
      lo,
      (miterAdvance + epsilon) / span,
      epsilon / span,
    )
    if (fraction > hi) continue
    const t = Math.min(hi, fraction + epsilon / span)
    const cut = { x: a.x + dx * t, y: a.y + dy * t }
    const section = simplify([...points.slice(0, stop), cut])
    let counterpart: Point[]
    try {
      counterpart = offsetPath(section, signedOffset)
    } catch {
      continue
    }
    if (
      !pointInBox(section.at(-1)!, box) ||
      !pointInBox(counterpart.at(-1)!, box)
    )
      continue
    const backtracks = section.slice(1).some((point, i) => {
      const previous = section[i],
        mate = counterpart[i + 1],
        previousMate = counterpart[i]
      return (
        (point.x - previous.x) * (mate.x - previousMate.x) +
          (point.y - previous.y) * (mate.y - previousMate.y) <
        -epsilon * distance(previous, point)
      )
    })
    if (backtracks) continue
    return { section, counterpart, stop }
  }
  return null
}
