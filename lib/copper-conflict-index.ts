import { clearanceToCopper, type Copper } from "./vector-scene"
import { CopperIndex } from "./copper-index"

interface Geometry {
  copper: Copper[]
  bounds: Float64Array
  minX: number
  maxX: number
  minY: number
  maxY: number
  index?: CopperIndex
  positions?: Map<Copper, number>
}

/** Request-local broad phase for immutable site/carrier candidates. Preserve
 * nested-loop order: the first conflicting chord determines routing history. */
export class CopperConflictIndex {
  private geometry = new WeakMap<Copper[], Geometry>()
  private conflicts = new WeakMap<
    Copper[],
    WeakMap<
      Copper[],
      { clearance: number; result: [Copper, Copper] | undefined }
    >
  >()
  private prepare(copper: Copper[]): Geometry {
    const cached = this.geometry.get(copper)
    if (cached) return cached
    const bounds = new Float64Array(copper.length * 4)
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity
    for (let i = 0; i < copper.length; i++) {
      const c = copper[i],
        k = i * 4
      bounds[k] = Math.min(c.a.x, c.b.x) - c.radius
      bounds[k + 1] = Math.max(c.a.x, c.b.x) + c.radius
      bounds[k + 2] = Math.min(c.a.y, c.b.y) - c.radius
      bounds[k + 3] = Math.max(c.a.y, c.b.y) + c.radius
      // Rectangles participate as targets in clearanceToCopper. Include their
      // full bounds even when their stored centerline is a point.
      if (c.rect) {
        bounds[k] = Math.min(bounds[k], c.rect.minX)
        bounds[k + 1] = Math.max(bounds[k + 1], c.rect.maxX)
        bounds[k + 2] = Math.min(bounds[k + 2], c.rect.minY)
        bounds[k + 3] = Math.max(bounds[k + 3], c.rect.maxY)
      }
      minX = Math.min(minX, bounds[k])
      maxX = Math.max(maxX, bounds[k + 1])
      minY = Math.min(minY, bounds[k + 2])
      maxY = Math.max(maxY, bounds[k + 3])
    }
    const geometry = { copper, bounds, minX, maxX, minY, maxY }
    this.geometry.set(copper, geometry)
    return geometry
  }
  firstConflict(
    first: Copper[],
    second: Copper[],
    clearance: number,
  ): [Copper, Copper] | undefined {
    let row = this.conflicts.get(first)
    const cached = row?.get(second)
    if (cached?.clearance === clearance) return cached.result
    if (!row) this.conflicts.set(first, (row = new WeakMap()))
    const result = this.findConflict(first, second, clearance)
    row.set(second, { clearance, result })
    return result
  }
  private findConflict(
    first: Copper[],
    second: Copper[],
    clearance: number,
  ): [Copper, Copper] | undefined {
    const a = this.prepare(first),
      b = this.prepare(second)
    if (
      a.maxX + clearance < b.minX ||
      b.maxX + clearance < a.minX ||
      a.maxY + clearance < b.minY ||
      b.maxY + clearance < a.minY
    )
      return
    for (let i = 0; i < first.length; i++) {
      const c = first[i],
        ai = i * 4
      let candidates: number[] | undefined
      if (second.length > 32) {
        if (!b.index) {
          b.index = new CopperIndex(second)
          b.positions = new Map()
          for (let j = 0; j < second.length; j++)
            if (!b.positions.has(second[j])) b.positions.set(second[j], j)
        }
        candidates = []
        // Query subtraction and the reference's addition can round in opposite
        // directions near tangency. Pad only the broad phase; the exact tests
        // below retain the original bounds and clearance arithmetic.
        const padding =
          clearance +
          4 *
            Number.EPSILON *
            Math.max(
              1,
              Math.abs(a.bounds[ai]),
              Math.abs(a.bounds[ai + 1]),
              Math.abs(a.bounds[ai + 2]),
              Math.abs(a.bounds[ai + 3]),
              Math.abs(b.minX),
              Math.abs(b.maxX),
              Math.abs(b.minY),
              Math.abs(b.maxY),
            )
        b.index.some(
          {
            minX: a.bounds[ai] - padding,
            maxX: a.bounds[ai + 1] + padding,
            minY: a.bounds[ai + 2] - padding,
            maxY: a.bounds[ai + 3] + padding,
          },
          (other) => {
            if (other.layer === c.layer)
              candidates!.push(b.positions!.get(other)!)
            return false
          },
        )
        // BVH traversal order is spatial. Restore the original inner-loop
        // order before exact tests, preserving the conflict used by history.
        candidates.sort((a, b) => a - b)
      }
      for (let k = 0; k < (candidates?.length ?? second.length); k++) {
        const j = candidates ? candidates[k] : k
        const d = second[j],
          bj = j * 4
        if (
          c.layer !== d.layer ||
          a.bounds[ai + 1] + clearance < b.bounds[bj] ||
          b.bounds[bj + 1] + clearance < a.bounds[ai] ||
          a.bounds[ai + 3] + clearance < b.bounds[bj + 2] ||
          b.bounds[bj + 3] + clearance < a.bounds[ai + 2]
        )
          continue
        if (clearanceToCopper(c.a, c.b, d) < c.radius + clearance) return [c, d]
      }
    }
  }
}
