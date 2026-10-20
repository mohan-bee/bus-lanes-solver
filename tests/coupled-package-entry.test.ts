import { expect, test } from "bun:test"
import { findCoupledPackageEntry } from "../lib/coupled-package-entry"
import { offsetPath } from "../lib/coupled-pair-routing"
import { pointInBox } from "../lib/package-approach-regions"
import type { Point } from "../lib/types"

test("joint entry clips the actual signed offset and passes its last miter", () => {
  const horizontal = [
    { x: -4, y: -4 },
    { x: -2, y: -4 },
    { x: -1.5, y: -3.5 },
    { x: 1, y: -3.5 },
  ]
  const horizontalBox = { minX: -1.4, maxX: 2, minY: -4, maxY: -2 }
  const before = structuredClone({ horizontal, horizontalBox })
  const entry = findCoupledPackageEntry(
    horizontal,
    0.22,
    horizontalBox,
    offsetPath,
  )!
  expect(entry).not.toBeNull()
  expect(entry.stop).toBe(3)
  // The mate's displacement is vertical, so neither rail needs an X inset.
  expect(entry.section.at(-1)!.x).toBeCloseTo(-1.4, 6)
  expect(entry.counterpart.at(-1)!.x).toBeCloseTo(-1.4, 6)
  expect({ horizontal, horizontalBox }).toEqual(before)

  const diagonalBox = { minX: 0, maxX: 3, minY: 0, maxY: 3 }
  const diagonal = findCoupledPackageEntry(
    [
      { x: -3, y: -3 },
      { x: -2, y: -2 },
      { x: 2, y: 2 },
    ],
    0.3,
    diagonalBox,
    offsetPath,
  )!
  expect(diagonal).not.toBeNull()
  expect(diagonal.section.at(-1)!.x).toBeCloseTo(0.3 / Math.SQRT2, 6)
  expect(pointInBox(diagonal.section.at(-1)!, diagonalBox)).toBe(true)
  expect(pointInBox(diagonal.counterpart.at(-1)!, diagonalBox)).toBe(true)

  const miterBox = { minX: -0.3, maxX: 0.3, minY: 0.1, maxY: 2 }
  const miter = findCoupledPackageEntry(
    [
      { x: -2, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ],
    0.22,
    miterBox,
    offsetPath,
  )!
  expect(miter).not.toBeNull()
  // Entering at y=0.1 would make the offset return from its y=0.22 miter.
  expect(miter.section.at(-1)!.y).toBeGreaterThan(0.22)
  expect(miter.counterpart.at(-1)!.y).toBeGreaterThan(0.22)
  expect(pointInBox(miter.counterpart.at(-1)!, miterBox)).toBe(true)
  for (let i = 1; i < miter.section.length; i++) {
    const a = miter.section[i - 1],
      b = miter.section[i]
    const c = miter.counterpart[i - 1],
      d = miter.counterpart[i]
    expect(
      (b.x - a.x) * (d.x - c.x) + (b.y - a.y) * (d.y - c.y),
    ).toBeGreaterThanOrEqual(0)
  }

  const narrow: Point[] = [
    { x: 0, y: -2 },
    { x: 0, y: -1 },
    { x: 0, y: 2 },
  ]
  expect(
    findCoupledPackageEntry(
      narrow,
      0.22,
      { minX: -0.05, maxX: 0.05, minY: 0, maxY: 2 },
      offsetPath,
    ),
  ).toBeNull()
  expect(
    findCoupledPackageEntry(
      narrow,
      0.22,
      { minX: 1, maxX: -1, minY: 0, maxY: 2 },
      offsetPath,
    ),
  ).toBeNull()
})
