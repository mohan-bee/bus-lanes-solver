import { expect, test } from "bun:test"
import { BusLanesPipelineSolver } from "../lib"
import { loadAm3352ByteStallInput } from "../scripts/load-am3352-byte-stall-input"

test("byte buses select the same initial routing stage with implicit or explicit surface layers", () => {
  const input = loadAm3352ByteStallInput()
  const before = structuredClone(input)
  expect(input.allowedLayers).toBeUndefined()
  expect(input.buses!.map((bus) => bus.allowedLayers)).toEqual([
    ["top"],
    ["bottom"],
  ])
  const explicit = structuredClone(input)
  // Every connection already belongs to a surface-only bus, so this is a
  // redundant global restriction. Geometry and per-bus intent stay identical.
  explicit.allowedLayers = ["top", "bottom"]
  const explicitBefore = structuredClone(explicit)
  const nativeSolver = new BusLanesPipelineSolver(input)
  const explicitSolver = new BusLanesPipelineSolver(explicit)
  try {
    // Real allocation, local escapes and first routing step; do not replay
    // copper or wait for the original half-hour routing timeout.
    nativeSolver.step()
    explicitSolver.step()
    expect(nativeSolver.failed).toBe(false)
    expect(explicitSolver.failed).toBe(false)
    expect(input).toEqual(before)
    expect(explicit).toEqual(explicitBefore)
    expect(nativeSolver.input.buses).toEqual(before.buses)
    expect(explicitSolver.input.buses).toEqual(before.buses)
    expect(nativeSolver.phase).toBe(explicitSolver.phase)
  } finally {
    nativeSolver.tryFinalAcceptance()
    explicitSolver.tryFinalAcceptance()
  }
}, 30_000)
