import { expect, test } from "bun:test"
import { findViaAwareSignalPocket } from "../lib/find-signal-site-pocket"
import { negotiateSignalSites } from "../lib/negotiate-signal-sites"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import { fixedCopper, routeCopper, VectorScene } from "../lib/vector-scene"
import type { SimpleRouteJson, Trace, Wire } from "../lib/types"

const wire = (x: number, y: number): Wire => ({
  x,
  y,
  route_type: "wire",
  layer: "top",
  width: 0.1,
})
const trace = (name: string, points: number[][]): Trace => ({
  type: "pcb_trace",
  pcb_trace_id: `trace_${name}`,
  connection_name: name,
  route: points.map(([x, y]) => wire(x, y)),
})
const finish = <T>(gen: Generator<unknown, T>): T => {
  let step = gen.next(),
    work = 0
  while (!step.done && work++ < 10000) step = gen.next()
  expect(step.done).toBe(true)
  if (!step.done) throw Error("Unexpected test search budget")
  return step.value
}

function fixture() {
  const a = trace("A", [
    [0, 0],
    [3, 0],
    [3, 0.84],
    [5, 0.84],
    [5, 0],
    [8, 0],
  ])
  const b = trace("B", [
    [4, -0.8],
    [4, 0.45],
  ])
  const p = {
    ...trace("P", [
      [1, 0.72],
      [7, 0.72],
    ]),
    coupledSection: [0, 1] as [number, number],
  }
  const n = {
    ...trace("N", [
      [1, 0.94],
      [7, 0.94],
    ]),
    coupledSection: [0, 1] as [number, number],
  }
  const power = trace("POWER", [
    [-0.7, -0.85],
    [-0.3, -0.85],
  ])
  const all = [a, b, p, n]
  const native: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 9, minY: -1, maxY: 1 },
    layerCount: 2,
    allowedLayers: ["top"],
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    connections: all.map((t) => ({
      name: t.connection_name!,
      pointsToConnect: [t.route[0] as Wire, t.route.at(-1)! as Wire],
    })),
    obstacles: all.flatMap((t) =>
      [t.route[0], t.route.at(-1)!].map((point, end) => ({
        componentId: `${t.connection_name}_${end}`,
        center: point,
        width: ["A", "B"].includes(t.connection_name!) ? 0.2 : 0.1,
        height: ["A", "B"].includes(t.connection_name!) ? 0.2 : 0.1,
        shape: "circle",
        layers: ["top"],
        connectedTo: [t.connection_name!],
      })),
    ),
    differentialPairs: [
      { connectionNames: ["P", "N"], lengthTolerance: 0.05, traceGap: 0.12 },
    ],
    traces: [power],
  }
  const state = {
    native,
    pending: { ...native, traces: [power, p, n] },
    escapes: [],
    retained: [p, n],
    traces: [a, b],
  }
  return { native, state, a, b, p, n, power }
}

test("a routed insertion blocker can extend its ordinary closure while keeping the new pair hard", () => {
  const { native, state, a, b, p, n, power } = fixture()
  const before = structuredClone(state)
  const aConnection = native.connections.find((c) => c.name === "A")!
  const sceneBeforePair = new VectorScene(native, aConnection, 0.1, [
    ...fixedCopper(native),
    ...routeCopper(b),
  ])
  expect(sceneBeforePair.pathVisible(a.route)).toBe(true)
  const sceneWithPair = new VectorScene(native, aConnection, 0.1, [
    ...fixedCopper(native),
    ...routeCopper(b),
    ...routeCopper(p),
    ...routeCopper(n),
  ])
  expect(sceneWithPair.pathVisible(a.route)).toBe(false)
  expect(finish(negotiateSignalSites(state, new Set(["A"])))).toBeNull()
  expect(finish(findViaAwareSignalPocket(state))).toEqual(new Set())
  expect(finish(findViaAwareSignalPocket(state, new Set(["A"])))).toEqual(
    new Set(["A", "B"]),
  )
  expect(state).toEqual(before)
  expect(state.retained).toEqual([p, n])
  expect(native.traces![0]).toBe(power)

  // This is a feasible repair, not merely a request to expand a blocked domain.
  // B goes around A's receiver; both paired rails and supplied copper stay fixed.
  const repairedA = trace("A", [
    [0, 0],
    [8, 0],
  ])
  const repairedB = trace("B", [
    [4, -0.8],
    [8.4, -0.8],
    [8.4, 0.45],
    [4, 0.45],
  ])
  const validator = BusLanesSolver.forValidation(native, [
    p,
    n,
    repairedA,
    repairedB,
  ])
  validator.solve()
  expect(validator.solved).toBe(true)
  expect(validator.error).toBeNull()
})
