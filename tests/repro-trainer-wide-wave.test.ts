import { expect, test } from "bun:test"
import { pcb_trace, type AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import {
  BusLanesPipelineSolver,
  busLengthReports,
  type SimpleRouteJson,
} from "../lib"
import { tuningPathIsSelfClear } from "../lib/length-tuning"
import { fixedCopper, routeCopper, VectorScene } from "../lib/vector-scene"

test("the eight-bit trainer uses compact rounded tuning before wide waves", async () => {
  // Captured from the core trainer: SOIC16 U1 at (-25,-3), 1x8 J1 at
  // (23,0), top-layer DATA bus, 50 +/-0.5 mm target and 0.1 mm skew.
  const { input, pcb }: { input: SimpleRouteJson; pcb: AnyCircuitElement[] } =
    await Bun.file(
      new URL("./fixtures/length-trainer.json", import.meta.url),
    ).json()
  const original = structuredClone(input)
  const solver = new BusLanesPipelineSolver(input)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.traces).toHaveLength(8)
  expect(input).toEqual(original)
  const [bus] = busLengthReports(input, solver.traces)
  expect(bus.aboveMinimumLength).toBe(true)
  expect(bus.withinLengthLimit).toBe(true)
  expect(bus.skewMm!).toBeLessThanOrEqual(0.1 + 1e-7)

  for (const connection of input.connections) {
    const traces = solver.traces.filter(
      (t) => t.connection_name === connection.name,
    )
    expect(traces).toHaveLength(1)
    const [trace] = traces
    for (const port of connection.pointsToConnect) {
      expect(
        [trace.route[0], trace.route.at(-1)!].some(
          (p) =>
            p.route_type === "wire" &&
            p.layer === port.layer &&
            Math.hypot(p.x - port.x, p.y - port.y) < 1e-6,
        ),
      ).toBe(true)
    }
    expect(
      trace.route.every((p) => p.route_type === "wire" && p.layer === "top"),
    ).toBe(true)
    expect(tuningPathIsSelfClear(trace.route, 0.275)).toBe(true)
    const scene = new VectorScene(input, connection, 0.2, [
      ...fixedCopper(input),
      ...solver.traces.filter((t) => t !== trace).flatMap(routeCopper),
    ])
    expect(scene.pathVisible(trace.route)).toBe(true)
  }

  const first = solver.traces.find(
    (t) => t.connection_name === input.connections[0].name,
  )!
  const curvedPoints = first.curvedSegments!.flatMap((i) =>
    first.route.slice(i - 1, i + 1),
  )
  const tuningSpan =
    Math.max(...curvedPoints.map((p) => p.x)) -
    Math.min(...curvedPoints.map((p) => p.x))
  // The rounded tuning fits a small interior bank while retaining the target.
  expect(tuningSpan).toBeLessThanOrEqual(5)
  expect(
    first.route.some(
      (point, i) =>
        i > 0 &&
        Math.abs(point.x - first.route[i - 1].x) < 1e-9 &&
        Math.abs(point.y - first.route[i - 1].y) > 1e-6,
    ),
  ).toBe(true)

  const traces: AnyCircuitElement[] = solver.traces.map((trace) =>
    pcb_trace.parse({
      type: "pcb_trace",
      pcb_trace_id: trace.pcb_trace_id,
      source_trace_id: trace.connection_name,
      route: trace.route,
    }),
  )
  const svg = convertCircuitJsonToPcbSvg([...pcb, ...traces], {
    width: 1400,
    height: 800,
  })
  const snapshot = new URL(
    "./__snapshots__/repro-trainer-wide-wave.snap.svg",
    import.meta.url,
  )
  if (process.env.UPDATE_SNAPSHOTS === "1") await Bun.write(snapshot, svg)
  expect(svg).toBe(await Bun.file(snapshot).text())
})
