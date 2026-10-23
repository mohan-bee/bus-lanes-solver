import * as nativePlans from "../lib/plan-native-pair-seed"
import { BusLanesPipelineSolver } from "../lib/bus-lanes-pipeline-solver"
import { planNativePairSeed } from "../lib/plan-native-pair-seed"
import { expect, test, spyOn } from "bun:test"
import {
  loadSequentialNativeDdr,
  nativeDqs0Control,
  auditSequentialNativePair,
} from "../scripts/native-sequential-pair"

function drive(work: ReturnType<typeof nativeDqs0Control>) {
  let next = work.next(),
    steps = 0
  while (!next.done) {
    steps++
    next = work.next()
  }
  return { traces: next.value, steps }
}

test("native pair planning retains a valid seed beyond the former child budget", () => {
  const sample = loadSequentialNativeDdr(),
    before = structuredClone(sample)
  const limited = drive(nativeDqs0Control(sample.secondInput, 6000))
  expect(
    limited.traces === null ||
      auditSequentialNativePair(sample, limited.traces).valid,
  ).toBe(true)
  expect(sample).toEqual(before)
  const completed = drive(planNativePairSeed(sample.secondInput))
  expect(completed.traces).not.toBeNull()
  const audit = auditSequentialNativePair(sample, completed.traces!)
  expect(audit.valid).toBe(true)
  expect(audit.connected).toBe(true)
  expect(
    completed.traces!.every((trace) =>
      trace.route.every((point) => point.route_type === "wire"),
    ),
  ).toBe(true)
  for (const change of [
    (input: typeof sample.secondInput) => {
      input.traces = []
    },
    (input: typeof sample.secondInput) => {
      input.buses![0].allowedLayers = ["bottom"]
    },
    (input: typeof sample.secondInput) => {
      input.allowedLayers = ["bottom"]
    },
    (input: typeof sample.secondInput) => {
      delete input.buses![0].maxLength
    },
    (input: typeof sample.secondInput) => {
      const name = input.differentialPairs![0].connectionNames[0]
      const point = input.connections.find((c) => c.name === name)!
        .pointsToConnect[0]
      input.traces!.push({
        type: "pcb_trace",
        pcb_trace_id: "supplied_pair_stub",
        connection_name: name,
        route: [
          { ...point, route_type: "wire", width: 0.1 },
          { ...point, x: point.x + 0.1, route_type: "wire", width: 0.1 },
        ],
      })
    },
  ]) {
    const input = structuredClone(sample.secondInput)
    change(input)
    const fixed = structuredClone(input)
    expect(drive(planNativePairSeed(input)).traces).toBeNull()
    expect(input).toEqual(fixed)
  }
  const invoked: (typeof sample.secondInput)[] = []
  const mocked = spyOn(nativePlans, "planNativePairSeed").mockImplementation(
    function* (input) {
      invoked.push(structuredClone(input))
      return null
    },
  )
  try {
    const pipeline = new BusLanesPipelineSolver(sample.secondInput)
    for (let step = 0; step < 10 && !invoked.length; step++) pipeline.step()
    expect(invoked).toHaveLength(1)
    expect(invoked[0].traces).toEqual(sample.secondInput.traces)
    expect(invoked[0].connections).toEqual(sample.secondInput.connections)
  } finally {
    mocked.mockRestore()
  }
  expect(sample).toEqual(before)
}, 180000)
