import { getCopperLayerNames } from "@tscircuit/fanout-solver"
import {
  matchNativeCarrierSignals,
  type NativeCarrierMatchingOptions,
  type NativeCarrierProgress,
} from "./match-native-carrier-signals"
import {
  planNativePairedCarriers,
  type NativePairedCarrierOptions,
} from "./plan-native-paired-carriers"
import type { SimpleRouteJson, Trace } from "./types"

export interface NativeSingleCarrierOptions
  extends NativePairedCarrierOptions,
    NativeCarrierMatchingOptions {}

export function nativeSingleCarrierEligible(input: SimpleRouteJson) {
  return (
    !input.outline?.length &&
    input.allowedLayers?.length === 1 &&
    /^inner\d+$/.test(input.allowedLayers[0]) &&
    getCopperLayerNames(input.layerCount).includes(input.allowedLayers[0]) &&
    !!input.differentialPairs?.length &&
    input.connections.every(
      (c) =>
        c.pointsToConnect.length === 2 &&
        c.pointsToConnect.every((p) => p.layer === "top"),
    )
  )
}

export function* routeMatchedNativeSingleCarrier(
  input: SimpleRouteJson,
  options: NativeSingleCarrierOptions = {},
  progress?: (state: NativeCarrierProgress) => void,
): Generator<void, Trace[] | null> {
  if (!nativeSingleCarrierEligible(input)) return null
  if (
    input.connections.some(
      (c) =>
        (c.width ?? c.nominalTraceWidth ?? input.minTraceWidth) !==
        input.minTraceWidth,
    ) ||
    input.buses?.some(
      (b) => b.traceWidth !== undefined && b.traceWidth !== input.minTraceWidth,
    )
  )
    throw Error("Native single-carrier matching requires uniform signal widths")
  if (
    input.buses?.some(
      (b) =>
        b.allowedLayers && !b.allowedLayers.includes(input.allowedLayers![0]),
    )
  )
    throw Error("A bus excludes the selected native carrier layer")
  const owners = new Set(
    [...input.connections, ...(options.fixedConnections ?? [])].map(
      (c) => c.name,
    ),
  )
  if (
    input.traces?.some(
      (t) => !t.connection_name || !owners.has(t.connection_name),
    )
  )
    throw Error(
      "Supply fixedConnections for all immutable traces not owned by routing requests",
    )
  const paired = yield* planNativePairedCarriers(input, options, (stage) =>
    progress?.({ stage, pass: 0, collisions: 0, unfinished: [], traces: [] }),
  )
  if (!paired) return null
  return yield* matchNativeCarrierSignals(input, paired, options, progress)
}
