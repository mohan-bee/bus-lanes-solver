import { expect, test } from "bun:test"
import { initialSignalDogbones } from "../lib/initial-signal-dogbones"
import { routeAlternateSignalDogbones } from "../lib/alternate-signal-dogbones"
import { signalDogboneOptions } from "../lib/repair-bus-dogbones"
import { loadAm3352SbcSample } from "../scripts/am3352-sbc-sample"

test("full SBC keeps a pad on top when bottom components block every local via site", () => {
  const input = loadAm3352SbcSample("benchmark")
  const original = structuredClone(input)
  const targets = new Map(input.connections.map((c) => [c.name, "bottom"]))
  const options = signalDogboneOptions(input, targets)
  expect(() => routeAlternateSignalDogbones(input, options, 0)).toThrow(
    "No collision-free local dogbone assignment",
  )
  const result = initialSignalDogbones(input, options, 0)
  expect(result.connections).toHaveLength(47)
  const blocked = result.connections.find((c) => c.name === "source_trace_3")!
  expect(
    blocked.pointsToConnect.map((p) => ("layer" in p ? p.layer : undefined)),
  ).toEqual(["top", "top"])
  expect(
    result.traces.filter((t) => t.connection_name === blocked.name),
  ).toEqual([])
  expect(
    result.connections
      .filter((c) => c.name !== blocked.name)
      .every((c) =>
        c.pointsToConnect.every(
          (p) => ("layer" in p ? p.layer : undefined) === "bottom",
        ),
      ),
  ).toBe(true)
  expect(input).toEqual(original)
  expect(targets.get(blocked.name)).toBe("bottom")
}, 30_000)

test("blocked bottom escapes cannot fall back to a forbidden top layer", () => {
  const input = loadAm3352SbcSample("benchmark")
  input.allowedLayers = ["bottom"]
  const options = signalDogboneOptions(
    input,
    new Map(input.connections.map((c) => [c.name, "bottom"])),
  )
  expect(() => initialSignalDogbones(input, options, 0)).toThrow(
    "No collision-free local dogbone assignment",
  )
}, 30_000)

test("native-layer fallback keeps differential partners on the same layer", () => {
  const input = loadAm3352SbcSample("benchmark")
  input.differentialPairs = [
    {
      connectionNames: ["source_trace_3", "source_trace_4"],
      lengthTolerance: 0.127,
    },
  ]
  const result = initialSignalDogbones(
    input,
    signalDogboneOptions(
      input,
      new Map(input.connections.map((c) => [c.name, "bottom"])),
    ),
    0,
  )
  for (const name of input.differentialPairs[0].connectionNames) {
    expect(
      result.connections
        .find((c) => c.name === name)!
        .pointsToConnect.map((p) => ("layer" in p ? p.layer : undefined)),
    ).toEqual(["top", "top"])
    expect(result.traces.filter((t) => t.connection_name === name)).toEqual([])
  }
}, 30_000)
