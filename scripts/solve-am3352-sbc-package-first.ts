import { BusLanesPipelineSolver, type SimpleRouteJson } from "../lib"
import { am3352Hash, loadAm3352Sample } from "./am3352-samples"
import { loadAm3352SbcSample } from "./am3352-sbc-sample"
import { validateAm3352SbcSample } from "./validate-am3352-sbc-sample"

/** A fresh package routing search, followed by acceptance against every board
 * obstacle. The saved fixture contains power fanouts, never DDR interconnect.
 * This sample requires the benchmark's physical pad placement and byte rules.
 * A failure in the full-board check must not emit or replay a candidate. */
export async function prepareSbcPackageSearch(native: SimpleRouteJson) {
  const { input, metadata } = await loadAm3352Sample("outer-layers")
  if (
    native.buses?.some(
      (bus) =>
        bus.allowedLayers &&
        JSON.stringify(bus.allowedLayers) !==
          JSON.stringify(native.allowedLayers),
    )
  )
    throw Error(
      "SBC bus layer restrictions differ from the package routing sample",
    )
  if (am3352Hash(native.connections) !== am3352Hash(input.connections))
    throw Error("SBC terminals differ from the package routing sample")
  const rules = (value: SimpleRouteJson) =>
    value.buses?.map(({ allowedLayers, ...bus }) => bus)
  if (am3352Hash(rules(native)) !== am3352Hash(rules(input)))
    throw Error("SBC timing rules differ from the package routing sample")
  if (
    am3352Hash(native.differentialPairs) !== am3352Hash(input.differentialPairs)
  )
    throw Error(
      "SBC differential pair rules differ from the package routing sample",
    )
  if (native.outline?.length)
    throw Error("Package-first sample requires a rectangular board")
  if (
    JSON.stringify(native.allowedLayers) !== JSON.stringify(input.allowedLayers)
  )
    throw Error("SBC allowed layers differ from the package routing sample")
  for (const pad of input.obstacles) {
    const candidates = native.obstacles.filter(
      (o) =>
        o.componentId === pad.componentId &&
        Math.hypot(o.center.x - pad.center.x, o.center.y - pad.center.y) < 1e-8,
    )
    if (
      candidates.length !== 1 ||
      candidates[0].width !== pad.width ||
      candidates[0].height !== pad.height ||
      candidates[0].shape !== pad.shape ||
      JSON.stringify(candidates[0].layers) !== JSON.stringify(pad.layers)
    )
      throw Error(
        "SBC BGA pad geometry differs from the package routing sample",
      )
  }
  const nativeConfig = native as SimpleRouteJson & Record<string, unknown>
  const packageConfig = input as SimpleRouteJson & Record<string, unknown>
  for (const key of [
    "minTraceWidth",
    "minViaPadDiameter",
    "minViaHoleDiameter",
    "minTraceToPadEdgeClearance",
    "minTraceToHoleEdgeClearance",
    "minViaHoleEdgeToViaHoleEdgeClearance",
    "minPlatedHoleDrillEdgeToDrillEdgeClearance",
    "minBoardEdgeClearance",
    "layerCount",
    "allowBlindAndBuriedVias",
  ] as const)
    if (nativeConfig[key] !== packageConfig[key])
      throw Error(`SBC ${key} differs from package search`)
  if (
    input.bounds.minX < native.bounds.minX ||
    input.bounds.maxX > native.bounds.maxX ||
    input.bounds.minY < native.bounds.minY ||
    input.bounds.maxY > native.bounds.maxY
  )
    throw Error("Package search envelope exceeds the SBC board")
  return { input, metadata }
}

export async function solveSbcPackageFirst(native: SimpleRouteJson) {
  const before = am3352Hash(native)
  const { input, metadata } = await prepareSbcPackageSearch(native)
  const solver = new BusLanesPipelineSolver(input)
  const started = performance.now()
  while (!solver.solved && !solver.failed) {
    solver.step()
    if (performance.now() - started > 1800000)
      throw Error("Package search exceeded 1800 seconds")
  }
  if (!solver.solved)
    throw Error(solver.error ?? "Package routing did not complete")
  const output = {
    ...native,
    traces: [...(native.traces ?? []), ...solver.traces],
  }
  const validation = validateAm3352SbcSample(native, output)
  if (am3352Hash(native) !== before)
    throw Error("Package routing changed the full-board input")
  if (!validation.valid)
    throw Error(
      "Fresh package routing failed full-board acceptance; no result emitted",
    )
  return {
    output,
    report: {
      seconds: (performance.now() - started) / 1000,
      iterations: solver.iterations,
      fullBoardInputSha256: before,
      packageInputSha256: am3352Hash(input),
      outputSha256: am3352Hash(output),
      powerFanoutProvenance: metadata.provenance,
      validation,
    },
  }
}

if (import.meta.main) {
  const result = await solveSbcPackageFirst(loadAm3352SbcSample("benchmark"))
  console.log(JSON.stringify(result.report, null, 2))
  if (process.argv[2])
    await Bun.write(process.argv[2], JSON.stringify(result.output))
}
