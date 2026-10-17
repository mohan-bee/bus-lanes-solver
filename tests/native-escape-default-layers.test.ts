import { expect, test } from "bun:test"
import { initialSignalDogbones } from "../lib/initial-signal-dogbones"
import { signalDogboneOptions } from "../lib/repair-bus-dogbones"
import { loadAm3352SbcSample } from "../scripts/am3352-sbc-sample"

test("omitted global layers preserve native escape choices and explicit bus restrictions", () => {
  const implicit = loadAm3352SbcSample("benchmark")
  delete implicit.allowedLayers
  const before = structuredClone(implicit)
  const explicit = structuredClone(implicit)
  explicit.allowedLayers = ["top", "inner1", "inner2", "bottom"]
  const targets = new Map(implicit.connections.map((c) => [c.name, "bottom"]))
  const implicitResult = initialSignalDogbones(
    implicit,
    signalDogboneOptions(implicit, targets),
    0,
  )
  const explicitResult = initialSignalDogbones(
    explicit,
    signalDogboneOptions(explicit, targets),
    0,
  )
  expect(implicitResult).toEqual(explicitResult)
  expect(implicit).toEqual(before)
  expect([...targets.values()].every((layer) => layer === "bottom")).toBe(true)
  implicit.buses = [
    {
      busId: "bottom_only",
      connectionNames: implicit.connections.map((c) => c.name),
      allowedLayers: ["bottom"],
    },
  ]
  expect(() =>
    initialSignalDogbones(implicit, signalDogboneOptions(implicit, targets), 0),
  ).toThrow("No collision-free local dogbone assignment")
}, 30_000)
