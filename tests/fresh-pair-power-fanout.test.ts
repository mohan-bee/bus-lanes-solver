import { expect, test } from "bun:test"
import { routeCoupledPair } from "../lib/coupled-pair-routing"
import {
  isProvisionalPairPlan,
  planSharedPairCorridors,
} from "../lib/plan-shared-pair-corridors"
import { fixedCopper, routeCopper, VectorScene } from "../lib/vector-scene"
import {
  packageApproachRegions,
  pointInBox,
} from "../lib/package-approach-regions"
import { pairLengthReports } from "../lib/route-lengths"
import { exteriorPairSpacingReports } from "../lib/exterior-pair-spacing"
import { sharedPairSpacingReports } from "../lib/shared-pair-spacing"
import type { SimpleRouteJson, Trace, Wire } from "../lib/types"

const wire = (x: number, y: number, layer = "top"): Wire => ({
  x,
  y,
  layer,
  width: 0.1,
  route_type: "wire",
})
function fixture(): SimpleRouteJson {
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    allowedLayers: ["top", "bottom"],
    bounds: { minX: -4, maxX: 16, minY: -4, maxY: 5 },
    connections: [],
    obstacles: [],
    traces: [],
    differentialPairs: [
      { connectionNames: ["P", "N"], lengthTolerance: 0.01, traceGap: 0.1 },
    ],
  }
  for (const x of [0, 10])
    for (const dx of [0, 0.8, 1.6])
      for (const y of [0, 0.8, 1.6])
        input.obstacles.push({
          componentId: `U${x}`,
          shape: "circle",
          center: { x: x + dx, y },
          width: 0.3,
          height: 0.3,
          layers: ["top"],
          connectedTo:
            dx === 0 && y <= 0.8 ? [y ? "N" : "P"] : [`other_${x}_${dx}_${y}`],
        })
  for (const [i, name] of ["P", "N"].entries()) {
    const points = []
    for (const [end, x] of [0, 10].entries()) {
      const pad = wire(x, i * 0.8),
        via = wire(x + 0.4, i * 0.8 + (i ? 0 : 0.4), "bottom")
      input.traces!.push({
        type: "pcb_trace",
        pcb_trace_id: `local_dogbone_${name}_${end}`,
        connection_name: name,
        source_trace_id: name,
        route: [
          pad,
          wire(via.x, via.y),
          {
            route_type: "via",
            x: via.x,
            y: via.y,
            from_layer: "top",
            to_layer: "bottom",
            layers: ["top", "inner1", "inner2", "bottom"],
            via_diameter: 0.3,
            via_hole_diameter: 0.15,
          },
          via,
        ],
      })
      points.push(via)
    }
    input.connections.push({ name, pointsToConnect: points })
  }
  input.traces!.push({
    type: "pcb_trace",
    pcb_trace_id: "supplied_power_fanout",
    connection_name: "VCC",
    source_trace_id: "VCC",
    route: [
      wire(-3, -3),
      wire(-2.6, -2.6),
      {
        route_type: "via",
        x: -2.6,
        y: -2.6,
        from_layer: "top",
        to_layer: "inner1",
        layers: ["top", "inner1", "inner2", "bottom"],
        via_diameter: 0.3,
        via_hole_diameter: 0.15,
      },
      wire(-2.6, -2.6, "inner1"),
      wire(-2, -2.6, "inner1"),
    ],
  })
  return input
}

function route(input: SimpleRouteJson): Trace[] {
  const original = structuredClone(input)
  const fixed = fixedCopper(input)
  const pair = input.differentialPairs![0]
  const search = routeCoupledPair(input, pair, fixed, {
    copper: [],
    penalty: 0,
    variant: 0,
    preferPackageOnlyTuning: true,
  })
  let step = search.next(),
    steps = 0
  while (!step.done && steps++ < 8000) step = search.next()
  expect(step.done).toBe(true)
  const traces = step.done ? step.value : null
  expect(traces).not.toBeNull()
  expect(traces).toHaveLength(2)
  expect(pairLengthReports(input, traces!)[0].matched).toBe(true)
  expect(sharedPairSpacingReports(input, traces!)[0].matched).toBe(true)
  const exterior = exteriorPairSpacingReports(input, traces!)[0]
  expect(exterior.applicable).toBe(true)
  expect(exterior.matched).toBe(true)
  expect(exterior.separatedExteriorLengthMm).toBe(0)
  const curves = traces!.flatMap((trace) =>
    (trace.curvedSegments ?? []).map((i) => [
      trace.route[i - 1],
      trace.route[i],
    ]),
  )
  // The deliberately unequal native dogbones require a real length correction.
  expect(curves.length).toBeGreaterThan(0)
  const regions = packageApproachRegions(
    input,
    input.minTraceWidth +
      pair.traceGap! / 2 +
      input.minTraceToPadEdgeClearance!,
  )
  expect(regions).toHaveLength(2)
  for (const [a, b] of curves)
    expect(
      regions.some(
        (region) =>
          pointInBox(a, region.copper) && pointInBox(b, region.copper),
      ),
    ).toBe(true)
  const copper = [...fixed, ...traces!.flatMap(routeCopper)]
  for (const trace of traces!) {
    const connection = input.connections.find(
      (c) => c.name === trace.connection_name,
    )!
    expect(trace.route[0]).toMatchObject(connection.pointsToConnect[0])
    expect(trace.route.at(-1)).toMatchObject(connection.pointsToConnect[1])
    expect(
      new VectorScene(
        input,
        connection,
        input.minTraceWidth,
        copper,
      ).pathVisible(trace.route),
    ).toBe(true)
  }
  expect(input).toEqual(original)
  return traces!
}

test("an unrelated supplied power fanout keeps fresh pair corrections in their package approaches", () => {
  const withPower = fixture()
  const power = structuredClone(
    withPower.traces!.find(
      (trace) => trace.pcb_trace_id === "supplied_power_fanout",
    )!,
  )
  const withPowerResult = route(withPower)
  expect(
    withPower.traces!.find(
      (trace) => trace.pcb_trace_id === power.pcb_trace_id,
    ),
  ).toEqual(power)
  const withoutPower = fixture()
  withoutPower.traces = withoutPower.traces!.filter(
    (trace) => trace.pcb_trace_id !== power.pcb_trace_id,
  )
  expect(route(withoutPower)).toEqual(withPowerResult)
})

test("fresh shared-pair planning offers a physical provisional topology after the package correction", () => {
  const input = fixture()
  const original = structuredClone(input)
  const search = planSharedPairCorridors(
    input,
    new Map(
      input.connections.map((connection) => [connection.name, ["bottom"]]),
    ),
    true,
    { preferPackageOnlyTuning: true },
  )
  const choices: Trace[][] = []
  let step = search.next(),
    iterations = 0
  while (!step.done && choices.length < 2 && iterations++ < 50000) {
    if (step.value) choices.push(step.value)
    step = search.next()
  }
  search.return(undefined)
  expect(choices).toHaveLength(2)
  expect(isProvisionalPairPlan(choices[0])).toBe(false)
  expect(isProvisionalPairPlan(choices[1])).toBe(true)
  expect(choices[1]).not.toEqual(choices[0])
  const fixed = fixedCopper(input)
  for (const traces of choices) {
    expect(pairLengthReports(input, traces)[0].matched).toBe(true)
    expect(sharedPairSpacingReports(input, traces)[0].matched).toBe(true)
    const copper = [...fixed, ...traces.flatMap(routeCopper)]
    for (const trace of traces) {
      const connection = input.connections.find(
        (candidate) => candidate.name === trace.connection_name,
      )!
      expect(
        new VectorScene(
          input,
          connection,
          input.minTraceWidth,
          copper,
        ).pathVisible(trace.route),
      ).toBe(true)
    }
  }
  expect(input).toEqual(original)
})
