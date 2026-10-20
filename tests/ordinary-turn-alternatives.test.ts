import { expect, test } from "bun:test"
import { length } from "../lib/geometry"
import { reduceOrdinaryTurns } from "../lib/reduce-ordinary-turns"
import { VectorScene } from "../lib/vector-scene"
import type { SimpleRouteJson } from "../lib/types"

test("explicit approach alternatives keep shortest lengths and the stable default", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 5, minY: -1, maxY: 3 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 4, y: 2, layer: "top" },
        ],
      },
    ],
    obstacles: [],
  }
  const scene = new VectorScene(input, input.connections[0], 0.1, [])
  const path = [
    { x: 0, y: 0 },
    { x: 0, y: 2 },
    { x: 4, y: 2 },
  ]
  const first = reduceOrdinaryTurns(path, scene)
  const other = reduceOrdinaryTurns(path, scene, 1)
  expect(first).toEqual([
    { x: 0, y: 0 },
    { x: 2, y: 2 },
    { x: 4, y: 2 },
  ])
  expect(other).toEqual([
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 4, y: 2 },
  ])
  expect(length(first)).toBeCloseTo(length(other), 12)
  expect(scene.pathVisible(other)).toBe(true)
  expect(reduceOrdinaryTurns(path, scene, 0)).toEqual(first)
  expect(path).toEqual([
    { x: 0, y: 0 },
    { x: 0, y: 2 },
    { x: 4, y: 2 },
  ])
})
