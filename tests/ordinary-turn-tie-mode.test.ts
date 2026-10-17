import { expect, test } from "bun:test"
import { length } from "../lib/geometry"
import { reduceOrdinaryTurns } from "../lib/reduce-ordinary-turns"
import { connectors } from "../lib/vector-visibility"
import { VectorScene } from "../lib/vector-scene"
import type { SimpleRouteJson } from "../lib/types"

test("fixed handoffs keep strict ordering while native planning explicitly stabilizes ties", () => {
  const a = { x: -3.92, y: -0.399999999999 }
  const b = { x: 4.03, y: 10.42 }
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 6, minY: -2, maxY: 12 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { ...a, layer: "top" },
          { ...b, layer: "top" },
        ],
      },
    ],
  }
  const scene = new VectorScene(input, input.connections[0], 0.1, [])
  const path = [a, { x: a.x, y: b.y }, b]
  const before = structuredClone(path)
  const options = connectors(a, b)
  // The two analytic tangencies differ only by one floating-point ulp.
  expect(length(options[1])).toBeGreaterThan(length(options[2]))
  expect(length(options[1]) - length(options[2])).toBeLessThan(1e-8)
  const strict = reduceOrdinaryTurns(path, scene)
  const native = reduceOrdinaryTurns(path, scene, 0, true)
  const alternate = reduceOrdinaryTurns(path, scene, 1, true)
  expect(strict).toEqual(options[2])
  expect(reduceOrdinaryTurns(path, scene, 0, false)).toEqual(strict)
  expect(native).toEqual(options[1])
  expect(alternate).toEqual(options[2])
  expect(length(strict)).toBeCloseTo(length(native), 12)
  expect(scene.pathVisible(native)).toBe(true)
  expect(scene.pathVisible(alternate)).toBe(true)
  expect(path).toEqual(before)
})
