import { chamferOrdinaryCorners } from "./chamfer-ordinary-corners"
import { reduceOrdinaryTurns } from "./reduce-ordinary-turns"
import { tuneSmoothLengths } from "./smooth-length-tuning"
import { length } from "./geometry"
import { VectorScene, fixedCopper } from "./vector-scene"
import type { Connection, SimpleRouteJson, Trace } from "./types"

/** Keep negotiated detours while removing raster corners. Other movable
 * signals constrain shortcuts; their existing collisions remain provisional. */
export function cleanNativeCarrierSignal(
  native: SimpleRouteJson,
  connection: Connection,
  trace: Trace,
  soft: Trace[],
  carrierToo: boolean,
): Trace | null {
  const [a, b] = trace.route.flatMap((p, i) =>
    p.route_type === "via" ? [i] : [],
  )
  if (a === undefined || b === undefined) return null
  const runs = [
    trace.route.slice(0, a),
    trace.route.slice(a + 1, b),
    trace.route.slice(b + 1),
  ]
  for (const side of carrierToo ? [0, 1, 2] : [0, 2]) {
    const route = runs[side]
    if (route.length < 2) return null
    const layer = side === 1 ? native.allowedLayers![0] : "top"
    const c = {
      ...connection,
      pointsToConnect: [
        { ...connection.pointsToConnect[0], ...route[0], layer },
        { ...connection.pointsToConnect[1], ...route.at(-1)!, layer },
      ],
    }
    const input = {
      ...native,
      connections: [c],
      buses: [],
      differentialPairs: [],
    }
    const hard = fixedCopper(input),
      softCopper = fixedCopper({ ...input, obstacles: [], traces: soft })
    const path = reduceOrdinaryTurns(
      route,
      new VectorScene(input, c, native.minTraceWidth, [...hard, ...softCopper]),
    )
    try {
      runs[side] = chamferOrdinaryCorners(
        input,
        [
          {
            ...trace,
            route: path.map((p) => ({
              ...p,
              route_type: "wire" as const,
              layer,
              width: native.minTraceWidth,
            })),
            curvedSegments: undefined,
          },
        ],
        hard,
        0.125,
      )[0].route
    } catch {
      return null
    }
  }
  return {
    ...trace,
    route: [...runs[0], trace.route[a], ...runs[1], trace.route[b], ...runs[2]],
    curvedSegments: undefined,
  }
}

/** Match actual whole-signal copper. TOP escapes stay owned and immutable
 * during this correction; every added timing bank is on the inner carrier. */
export function tuneNativeCarrierSignal(
  native: SimpleRouteJson,
  connection: Connection,
  raw: Trace,
  minimum: number,
  maximum: number,
  soft: Trace[],
  bankCost?: (trace: Trace) => number,
): Trace | null {
  const trace = cleanNativeCarrierSignal(native, connection, raw, soft, false)
  if (!trace) return null
  const [a, b] = trace.route.flatMap((p, i) =>
    p.route_type === "via" ? [i] : [],
  )
  const route = trace.route.slice(a + 1, b),
    prefix = trace.route.slice(0, a + 1),
    suffix = trace.route.slice(b)
  const escapes: Trace[] = [
    {
      ...trace,
      pcb_trace_id: `generated_escape_${connection.name}_0`,
      route: trace.route.slice(0, a + 2),
    },
    {
      ...trace,
      pcb_trace_id: `generated_escape_${connection.name}_1`,
      route: trace.route
        .slice(b - 1)
        .toReversed()
        .map((p) =>
          p.route_type === "via"
            ? { ...p, from_layer: p.to_layer, to_layer: p.from_layer }
            : p,
        ),
    },
  ]
  const carrier = native.allowedLayers![0]
  const c = {
    ...connection,
    pointsToConnect: connection.pointsToConnect.map((p, i) => ({
      ...p,
      ...route[i ? route.length - 1 : 0],
      layer: carrier,
    })),
  }
  const input: SimpleRouteJson = {
    ...native,
    connections: [c],
    traces: [...(native.traces ?? []), ...escapes],
    buses: [
      {
        busId: "native_target",
        connectionNames: [c.name],
        minLength: minimum,
        maxLength: maximum,
      },
    ],
    differentialPairs: [],
  }
  const hard = fixedCopper(input),
    softCopper = fixedCopper({ ...input, obstacles: [], traces: soft })
  const path = reduceOrdinaryTurns(
    route,
    new VectorScene(input, c, native.minTraceWidth, [...hard, ...softCopper]),
  )
  try {
    const clean = chamferOrdinaryCorners(
      input,
      [
        {
          ...trace,
          route: path.map((p) => ({
            ...p,
            route_type: "wire" as const,
            layer: carrier,
            width: native.minTraceWidth,
          })),
        },
      ],
      hard,
      0.125,
    )[0]
    const matched = tuneSmoothLengths(
      input,
      [clean],
      new Map([[c.name, minimum]]),
      {
        candidateScore: bankCost,
        alignPeriods: true,
        packMeanders: true,
        maxCandidates: 65536,
      },
    )[0]
    const full = {
      ...matched,
      route: [...prefix, ...matched.route, ...suffix],
      curvedSegments: matched.curvedSegments?.map((i) => i + prefix.length),
    }
    return length(full.route) <= maximum + 1e-8 &&
      length(full.route) >= minimum - 1e-8
      ? full
      : null
  } catch {
    return null
  }
}
