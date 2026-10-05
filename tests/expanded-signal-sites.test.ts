import { expect, test } from "bun:test"
import { expandedSignalSiteChoices } from "../lib/expanded-signal-sites"
import { negotiateSignalSites } from "../lib/negotiate-signal-sites"
import { fixedCopper, VectorScene } from "../lib/vector-scene"
import { routeAnglesAreConventional } from "../lib/route-angle-validation"
import { tuningPathIsSelfClear } from "../lib/length-tuning"
import { length, distance } from "../lib/geometry"
import type { SimpleRouteJson, Trace, Wire } from "../lib/types"

const layers = ["top", "inner1", "inner2", "bottom"]
function blockedAdjacentCells(): SimpleRouteJson {
  const connection = {
    name: "signal",
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 4, y: 0, layer: "top" },
    ],
  }
  const traces: Trace[] = []
  for (const x of [0, 4])
    for (const dx of [-0.4, 0.4])
      for (const dy of [-0.4, 0.4])
        traces.push({
          type: "pcb_trace",
          pcb_trace_id: `fixed_${x}_${dx}_${dy}`,
          connection_name: "fixed_power",
          source_trace_id: "fixed_power",
          route: [
            {
              x: x + dx,
              y: dy,
              route_type: "via",
              from_layer: "top",
              to_layer: "bottom",
              layers,
              via_diameter: 0.3,
              via_hole_diameter: 0.15,
            },
          ],
        })
  return {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.1,
    minBoardEdgeClearance: 0.1,
    allowedLayers: ["top", "bottom"],
    bounds: { minX: -3, maxX: 7, minY: -3, maxY: 3 },
    connections: [connection],
    traces,
    obstacles: [0, 4].flatMap((x) =>
      [0, 0.8].flatMap((dx) =>
        [0, 0.8].map((y) => ({
          componentId: `package_${x}`,
          shape: "circle" as const,
          type: "rect",
          center: { x: x + dx, y },
          width: 0.25,
          height: 0.25,
          layers: ["top"],
          connectedTo:
            dx === 0 && y === 0 ? ["signal"] : [`other_${x}_${dx}_${y}`],
        })),
      ),
    ),
  }
}

test("expanded terminal cells escape a blocked adjacent-cell field with fixed full-stack barrels", () => {
  const native = blockedAdjacentCells()
  const connection = native.connections[0]
  const original = structuredClone(native)
  const search = expandedSignalSiteChoices(native, connection, "bottom", 4)
  let step = search.next(),
    steps = 0
  while (!step.done && steps++ < 100000) step = search.next()
  expect(step.done).toBe(true)
  const choices = step.done ? step.value : []
  expect(choices.length).toBeGreaterThan(0)
  expect(choices.length).toBeLessThanOrEqual(4)
  for (const choice of choices) {
    expect(choice.escapes.length).toBe(2)
    for (const [end, escape] of choice.escapes.entries()) {
      const vias = escape.route.filter((p) => p.route_type === "via")
      expect(vias).toHaveLength(1)
      expect(vias[0].layers).toEqual(layers)
      expect(
        distance(vias[0], connection.pointsToConnect[end]),
      ).toBeGreaterThan(0.6)
      const top = escape.route.filter(
        (p) => p.route_type === "wire" && p.layer === "top",
      ) as Wire[]
      expect(length(top)).toBeLessThanOrEqual(2 + 1e-8)
      expect(tuningPathIsSelfClear(top, 0.2)).toBe(true)
      expect(routeAnglesAreConventional([{ ...escape, route: top }])).toBe(true)
      for (const layer of layers) {
        const point = { ...vias[0], layer }
        const local = { ...connection, pointsToConnect: [point, point] }
        expect(
          new VectorScene(native, local, 0.3, fixedCopper(native)).visible(
            point,
            point,
          ),
        ).toBe(true)
      }
    }
    expect(
      routeAnglesAreConventional([
        {
          type: "pcb_trace",
          pcb_trace_id: "carrier",
          connection_name: "signal",
          route: choice.route,
        },
      ]),
    ).toBe(true)
    expect(tuningPathIsSelfClear(choice.route, 0.2)).toBe(true)
  }
  expect(native).toEqual(original)
})

test("expanded cells retain an endpoint already on the carrier surface", () => {
  const native = blockedAdjacentCells()
  native.connections[0].pointsToConnect[1].layer = "bottom"
  for (const obstacle of native.obstacles.filter(
    (o) => o.componentId === "package_4",
  ))
    obstacle.layers = ["bottom"]
  const search = expandedSignalSiteChoices(
    native,
    native.connections[0],
    "bottom",
    4,
  )
  let step = search.next(),
    steps = 0
  while (!step.done && steps++ < 100000) step = search.next()
  expect(step.done).toBe(true)
  const choices = step.done ? step.value : []
  expect(choices).toHaveLength(4)
  for (const choice of choices) {
    expect(choice.connection.pointsToConnect[1]).toEqual(
      native.connections[0].pointsToConnect[1],
    )
    expect(choice.escapes[1].route).toHaveLength(1)
    expect(
      choice.escapes.flatMap((t) =>
        t.route.filter((p) => p.route_type === "via"),
      ),
    ).toHaveLength(1)
  }
})

test("expanded escapes reject invalid manufacturing dimensions without generating copper", () => {
  for (const [diameter, hole] of [
    [0.3, 0],
    [0.3, -0.1],
    [0.3, 0.4],
    [0, 0.15],
    [-0.3, 0.15],
    [Number.NaN, 0.15],
    [0.3, Number.POSITIVE_INFINITY],
  ]) {
    const native = blockedAdjacentCells()
    native.minViaPadDiameter = diameter
    native.minViaHoleDiameter = hole
    const before = structuredClone(native)
    const search = expandedSignalSiteChoices(
      native,
      native.connections[0],
      "bottom",
    )
    expect(search.next()).toEqual({ done: true, value: [] })
    expect(native).toEqual(before)
  }
})

test("atomic surface routing falls back when all adjacent bottom sites are blocked", () => {
  const native = blockedAdjacentCells()
  native.buses = [
    {
      busId: "bottom_bus",
      connectionNames: ["signal"],
      allowedLayers: ["bottom"],
    },
  ]
  const original = structuredClone(native)
  const pending = {
    ...native,
    connections: native.connections.map((c) => ({
      ...c,
      pointsToConnect: c.pointsToConnect.map((p) => ({
        ...p,
        layer: "bottom",
      })),
    })),
  }
  const search = negotiateSignalSites(
    { native, pending, escapes: [], retained: [], traces: [] },
    new Set(["signal"]),
  )
  let step = search.next(),
    steps = 0
  while (!step.done && steps++ < 100000) step = search.next()
  expect(step.done).toBe(true)
  const result = step.done ? step.value : null
  expect(result).toBeTruthy()
  expect(result!.traces.map((t) => (t.route[0] as Wire).layer)).toEqual([
    "bottom",
  ])
  expect(
    result!.escapes.flatMap((t) =>
      t.route.filter((p) => p.route_type === "via"),
    ),
  ).toHaveLength(2)
  expect(native).toEqual(original)
})

test("a collective retry can widen reachable adjacent sites while the default stays local", () => {
  const native = blockedAdjacentCells()
  native.traces = []
  native.buses = [
    {
      busId: "bottom_bus",
      connectionNames: ["signal"],
      allowedLayers: ["bottom"],
    },
  ]
  native.obstacles.push({
    type: "rect",
    center: { x: 1, y: 0 },
    width: 0.4,
    height: 2.6,
    layers: ["bottom"],
    connectedTo: ["fixed_wall"],
  })
  const original = structuredClone(native)
  const pending = {
    ...native,
    connections: native.connections.map((c) => ({
      ...c,
      pointsToConnect: c.pointsToConnect.map((p) => ({
        ...p,
        layer: "bottom",
      })),
    })),
  }
  const solve = (expanded: boolean) => {
    const search = negotiateSignalSites(
      { native, pending, escapes: [], retained: [], traces: [] },
      new Set(["signal"]),
      false,
      expanded,
    )
    let step = search.next(),
      steps = 0
    while (!step.done && steps++ < 100000) step = search.next()
    expect(step.done).toBe(true)
    return step.done ? step.value : null
  }
  const adjacent = solve(false),
    expanded = solve(true)
  expect(adjacent).toBeTruthy()
  expect(expanded).toBeTruthy()
  const total = (state: NonNullable<typeof adjacent>) =>
    [...state.traces, ...state.escapes].reduce(
      (sum, t) => sum + length(t.route),
      0,
    )
  expect(total(expanded!)).toBeLessThan(total(adjacent!) - 0.5)
  expect(
    expanded!.escapes.flatMap((t) =>
      t.route.filter((p) => p.route_type === "via"),
    ),
  ).toHaveLength(2)
  expect(native).toEqual(original)
})
