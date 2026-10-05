import { expect, test } from "bun:test"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import { retargetGeneratedEscape } from "../lib/retarget-generated-escape"
import type { SimpleRouteJson, Trace, Via } from "../lib/types"

const escape: Trace = {
  type: "pcb_trace",
  pcb_trace_id: "local_dogbone_signal_0",
  connection_name: "signal",
  source_trace_id: "signal",
  route: [
    { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
    { route_type: "wire", x: 0.4, y: -0.4, layer: "top", width: 0.1 },
    {
      route_type: "via",
      x: 0.4,
      y: -0.4,
      from_layer: "top",
      to_layer: "bottom",
      layers: ["top", "inner1", "inner2", "bottom"],
      via_diameter: 0.3,
      via_hole_diameter: 0.15,
    },
    { route_type: "wire", x: 0.4, y: -0.4, layer: "bottom", width: 0.1 },
  ],
}

test("generated escape returns to its source surface without a via", () => {
  const before = structuredClone(escape)
  const top = retargetGeneratedEscape(escape, "top")
  expect(top.route).toEqual(escape.route.slice(0, 2))
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 1, y: -0.4, layer: "top" },
        ],
      },
    ],
  }
  const completed: Trace = {
    ...top,
    route: [
      ...top.route,
      { route_type: "wire", x: 1, y: -0.4, layer: "top", width: 0.1 },
    ],
  }
  const drc = validateRoutedCopperDrc({
    clearance: 0.075,
    inputSrj: input as Parameters<
      typeof validateRoutedCopperDrc
    >[0]["inputSrj"],
    routedSrj: { ...input, traces: [completed] } as Parameters<
      typeof validateRoutedCopperDrc
    >[0]["routedSrj"],
  })
  expect(drc.valid).toBe(true)
  expect(escape).toEqual(before)
})

test("a new carrier keeps a generated through-via's full physical span", () => {
  const retargeted = retargetGeneratedEscape(escape, "inner2")
  const via = retargeted.route.find(
    (point) => point.route_type === "via",
  ) as Via
  expect(via.from_layer).toBe("top")
  expect(via.to_layer).toBe("inner2")
  expect(via.layers).toEqual(["top", "inner1", "inner2", "bottom"])
  expect(retargeted.route.at(-1)).toMatchObject({
    route_type: "wire",
    layer: "inner2",
  })
  expect(escape.route.at(-1)).toMatchObject({
    route_type: "wire",
    layer: "bottom",
  })
})

test("a blind generated escape cannot retarget beyond its physical span", () => {
  const blind: Trace = {
    ...escape,
    route: escape.route.map((point) =>
      point.route_type === "via"
        ? { ...point, to_layer: "inner1", layers: ["top", "inner1"] }
        : point,
    ),
  }
  expect(() => retargetGeneratedEscape(blind, "bottom")).toThrow(
    "does not span",
  )
})

test("an implicit barrel span cannot be silently shortened by changing its destination", () => {
  const implicit: Trace = {
    ...escape,
    route: escape.route.map((point) =>
      point.route_type === "via" ? { ...point, layers: undefined } : point,
    ),
  }
  const before = structuredClone(implicit)
  expect(() => retargetGeneratedEscape(implicit, "inner2")).toThrow(
    "explicit span",
  )
  expect(implicit).toEqual(before)
})

test("surface collapse rejects an implicit wire-to-via segment rather than losing its copper", () => {
  const direct: Trace = {
    ...escape,
    route: [escape.route[0], ...escape.route.slice(2)],
  }
  const before = structuredClone(direct)
  expect(() => retargetGeneratedEscape(direct, "top")).toThrow(
    "explicit native-layer via handoff",
  )
  expect(direct).toEqual(before)
})
