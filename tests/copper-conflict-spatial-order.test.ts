import { expect, test } from "bun:test"
import { CopperConflictIndex } from "../lib/copper-conflict-index"
import { clearanceToCopper, type Copper } from "../lib/vector-scene"

test("spatial conflicts preserve brute-force identity and order on large copper arrays", () => {
  let state = 173
  const random = () =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32
  const copper = (): Copper => {
    const x = random() * 100 - 50,
      y = random() * 100 - 50
    const kind = Math.floor(random() * 3)
    return {
      a: { x, y },
      b: kind ? { x, y } : { x: x + random(), y: y + random() },
      radius: kind === 2 ? 0 : random() * 0.4,
      owners: [],
      layer: random() < 0.5 ? "top" : "inner1",
      ...(kind === 2
        ? {
            rect: {
              minX: x - 0.4,
              maxX: x + 0.7,
              minY: y - 0.2,
              maxY: y + 0.3,
            },
          }
        : {}),
    }
  }
  const index = new CopperConflictIndex()
  const check = (a: Copper[], b: Copper[], clearance: number) => {
    let expected: [Copper, Copper] | undefined
    search: for (const c of a)
      for (const d of b)
        if (
          c.layer === d.layer &&
          clearanceToCopper(c.a, c.b, d) < c.radius + clearance
        ) {
          expected = [c, d]
          break search
        }
    const actual = index.firstConflict(a, b, clearance)
    expect(actual?.[0]).toBe(expected?.[0])
    expect(actual?.[1]).toBe(expected?.[1])
  }
  for (let trial = 0; trial < 100; trial++) {
    const a = Array.from({ length: 48 }, copper)
    const b = Array.from({ length: 128 }, copper)
    b.push(b[3], b[7])
    for (const clearance of [0, 0.1 - 1e-8, 0.3, 5]) {
      check(a, b, clearance)
      check(b, a, clearance)
    }
  }
  for (const x of [0, -1000, 1000])
    for (const offset of [-1e-12, 0, 1e-12]) {
      const a: Copper = {
        a: { x, y: 0 },
        b: { x: x + 2, y: 0 },
        radius: 0.05,
        layer: "top",
        owners: [],
      }
      const b: Copper = {
        ...a,
        a: { x, y: 0.2 + offset },
        b: { x: x + 2, y: 0.2 + offset },
      }
      check([a], [...Array.from({ length: 40 }, copper), b], 0.1)
    }
})
