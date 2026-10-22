import { expect, test } from "bun:test"
import { routeAlternateSignalDogbones } from "../lib/alternate-signal-dogbones"
import { initialSignalDogbones } from "../lib/initial-signal-dogbones"
import { signalDogboneOptions } from "../lib/repair-bus-dogbones"
import type { SimpleRouteJson } from "../lib/types"

function sharedSiteInput(): SimpleRouteJson {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.075,
    minViaPadDiameter: 0.5,
    minViaHoleDiameter: 0.3,
    allowedLayers: ["top", "bottom"],
    bounds: { minX: -2, maxX: 3, minY: -2, maxY: 7 },
    obstacles: [],
    connections: [],
  }
  for (const [id, y] of [
    ["U1", 0],
    ["U2", 4],
  ] as const) {
    for (let i = 0; i < 4; i++)
      input.obstacles.push({
        type: "rect",
        shape: "circle",
        componentId: id,
        layers: ["top"],
        center: { x: (i % 2) * 0.8, y: y + Math.floor(i / 2) * 0.8 },
        width: 0.4,
        height: 0.4,
        connectedTo: [`port_${id}_${i}`, `signal_${i}`],
      })
  }
  for (let i = 0; i < 2; i++)
    input.connections.push({
      name: `signal_${i}`,
      pointsToConnect: input.obstacles
        .filter((o) => o.connectedTo.includes(`signal_${i}`))
        .map((o) => ({
          ...o.center,
          layer: "top",
          pcb_port_id: o.connectedTo[0],
        })),
    })
  // Only the central interstitial site in each package remains available.
  for (const [x, y, width, height] of [
    [-1, 2.4, 1.6, 10],
    [1.8, 2.4, 1.6, 10],
    [0.4, -1, 0.8, 1.6],
    [0.4, 2.4, 0.8, 2.8],
    [0.4, 5.8, 0.8, 1.6],
  ])
    input.obstacles.push({
      type: "rect",
      layers: ["bottom"],
      center: { x, y },
      width,
      height,
      connectedTo: ["blocker"],
    })
  return input
}

test("individual legal sites can conflict collectively and fall back one native cohort", () => {
  const input = sharedSiteInput(),
    before = structuredClone(input)
  const targets = new Map(input.connections.map((c) => [c.name, "bottom"]))
  const options = signalDogboneOptions(input, targets)
  for (const connection of input.connections) {
    const local = { ...input, connections: [connection] }
    expect(routeAlternateSignalDogbones(local, options, 0).traces).toHaveLength(
      2,
    )
  }
  expect(() => routeAlternateSignalDogbones(input, options, 0)).toThrow(
    "No collision-free local dogbone assignment",
  )
  const result = initialSignalDogbones(input, options, 0)
  expect(
    result.connections.map((c) =>
      c.pointsToConnect.map((p) => ("layer" in p ? p.layer : undefined)),
    ),
  ).toEqual([
    ["top", "top"],
    ["bottom", "bottom"],
  ])
  expect(result.traces).toHaveLength(2)
  expect(input).toEqual(before)
  expect([...targets.values()]).toEqual(["bottom", "bottom"])
})

test("a coupled pair falls back together when its individual via sites conflict", () => {
  const input = sharedSiteInput()
  input.differentialPairs = [
    { connectionNames: ["signal_0", "signal_1"], lengthTolerance: 0.127 },
  ]
  const result = initialSignalDogbones(
    input,
    signalDogboneOptions(
      input,
      new Map(input.connections.map((c) => [c.name, "bottom"])),
    ),
    0,
  )
  expect(result.traces).toHaveLength(0)
  expect(
    result.connections.every((c) =>
      c.pointsToConnect.every((p) => "layer" in p && p.layer === "top"),
    ),
  ).toBe(true)
})

test("collective fallback respects bus layer restrictions", () => {
  const input = sharedSiteInput()
  input.buses = [
    {
      busId: "bottom-only",
      connectionNames: input.connections.map((c) => c.name),
      allowedLayers: ["bottom"],
    },
  ]
  expect(() =>
    initialSignalDogbones(
      input,
      signalDogboneOptions(
        input,
        new Map(input.connections.map((c) => [c.name, "bottom"])),
      ),
      0,
    ),
  ).toThrow("No collision-free local dogbone assignment")
})
