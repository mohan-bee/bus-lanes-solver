import { expect, test } from "bun:test"
import { tuningPathIsSelfClear } from "../lib/length-tuning"
import type { Point } from "../lib/types"

test("long sampled bends and returning arms keep exact self-clearance decisions", () => {
  const sample = (corners: Point[]) =>
    corners
      .slice(1)
      .flatMap((b, i) =>
        Array.from({ length: 80 }, (_, j) => ({
          x: corners[i].x + ((b.x - corners[i].x) * j) / 80,
          y: corners[i].y + ((b.y - corners[i].y) * j) / 80,
        })),
      )
      .concat(corners.at(-1)!)
  for (const rotate of [false, true])
    for (const shift of [0, 1000, -1000]) {
      const transform = (p: Point) =>
        rotate
          ? { x: shift - p.y, y: shift + p.x }
          : { x: shift + p.x, y: shift + p.y }
      const arc = Array.from({ length: 512 }, (_, i) => ({
        x: 4 * Math.cos((1.5 * Math.PI * i) / 511),
        y: 4 * Math.sin((1.5 * Math.PI * i) / 511),
      })).map(transform)
      expect(tuningPathIsSelfClear(arc, 0.25)).toBe(true)
      expect(tuningPathIsSelfClear([...arc, arc[1]], 0.25)).toBe(false)
      const returning = sample([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
        { x: 0, y: 0.2 },
        { x: 3, y: 0.2 },
      ]).map(transform)
      expect(tuningPathIsSelfClear(returning, 0.15)).toBe(true)
      expect(tuningPathIsSelfClear(returning, 0.25)).toBe(false)
    }
})
