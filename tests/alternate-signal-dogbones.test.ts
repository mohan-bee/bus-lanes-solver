import { expect, test } from "bun:test"
import {
  routeLocalSignalDogbones,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { routeAlternateSignalDogbones } from "../lib/alternate-signal-dogbones"
import type { SimpleRouteJson } from "../lib/types"

function fixture(paired = false) {
  const input: SimpleRouteJson = {
    layerCount: 4,
    allowedLayers: ["top", "bottom"],
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -8, maxX: 8, minY: -3, maxY: 8 },
    connections: [],
    obstacles: [],
    buses: [],
    traces: [],
  }
  for (const [name, y] of [
    ["blocked", 0],
    ["available", 4],
  ] as const) {
    input.connections.push({
      name,
      pointsToConnect: [
        { x: -3, y, layer: "top" },
        { x: 3, y, layer: "top" },
      ],
    })
    for (const x of [-3, 3])
      for (let i = 0; i < 4; i++)
        input.obstacles.push({
          componentId: `${name}_${x}`,
          shape: "circle",
          center: { x: x + (i % 2) * 0.8, y: y + Math.floor(i / 2) * 0.8 },
          width: 0.4,
          height: 0.4,
          layers: ["top"],
          connectedTo: i === 0 ? [name] : [],
        })
  }
  input.obstacles.push({
    type: "rect",
    center: { x: -3, y: 0 },
    width: 3,
    height: 3,
    layers: ["bottom"],
    connectedTo: [],
  })
  if (paired)
    input.differentialPairs = [
      {
        connectionNames: ["blocked", "available"],
        traceGap: 0.12,
        lengthTolerance: 0.127,
      },
    ]
  const options = {
    targetLayers: new Map(input.connections.map((c) => [c.name, "bottom"])),
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    clearance: 0.1,
    allowBlindAndBuriedVias: false,
  }
  return { input, options }
}

test("native surface fallback keeps a connection without any local manufactured site while preserving legal other escapes", () => {
  const { input, options } = fixture(),
    original = structuredClone(input)
  expect(() =>
    routeLocalSignalDogbones(
      input as Parameters<typeof routeLocalSignalDogbones>[0],
      options,
    ),
  ).toThrow("No collision-free local dogbone assignment")
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = routeAlternateSignalDogbones(input, options, attempt)
    expect(
      result.connections.find((c) => c.name === "blocked")!.pointsToConnect,
    ).toEqual(input.connections[0].pointsToConnect)
    expect(
      result.connections
        .find((c) => c.name === "available")!
        .pointsToConnect.every(
          (point) => "layer" in point && point.layer === "bottom",
        ),
    ).toBe(true)
    expect(result.traces).toHaveLength(2)
    expect(
      result.traces.every((trace) => trace.connection_name === "available"),
    ).toBe(true)
    expect(
      result.traces
        .flatMap((trace) =>
          trace.route.filter((point) => point.route_type === "via"),
        )
        .every(
          (via) =>
            via.layers?.join(",") === "top,inner1,inner2,bottom" &&
            via.via_diameter === 0.3 &&
            via.via_hole_diameter === 0.15,
        ),
    ).toBe(true)
    const drc = validateRoutedCopperDrc({
      inputSrj: input as Parameters<
        typeof validateRoutedCopperDrc
      >[0]["inputSrj"],
      routedSrj: { ...input, traces: result.traces } as Parameters<
        typeof validateRoutedCopperDrc
      >[0]["routedSrj"],
      clearance: 0.1,
    })
    expect(drc.issues).toEqual([])
  }
  expect(input).toEqual(original)
  expect(options.targetLayers.get("blocked")).toBe("bottom")
})

test("fallback keeps both differential partners on the same native plane without relaxing skew or coupling", () => {
  const { input, options } = fixture(true),
    before = structuredClone(input)
  const result = routeAlternateSignalDogbones(input, options, 0)
  expect(result.connections.map((c) => c.pointsToConnect)).toEqual(
    input.connections.map((c) => c.pointsToConnect),
  )
  expect(result.traces).toEqual([])
  expect(input).toEqual(before)
  expect(input.differentialPairs![0]).toEqual({
    connectionNames: ["blocked", "available"],
    traceGap: 0.12,
    lengthTolerance: 0.127,
  })
})

test("an explicitly forbidden native plane still fails instead of weakening the signal-layer constraint", () => {
  const { input, options } = fixture()
  input.buses = [
    {
      busId: "required_bottom",
      connectionNames: ["blocked"],
      allowedLayers: ["bottom"],
      maxLengthSkew: 0.2,
    },
  ]
  expect(() => routeAlternateSignalDogbones(input, options, 0)).toThrow(
    "No collision-free local dogbone assignment",
  )
})
