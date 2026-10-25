import {
  getUnitVectorFromPointAToB,
  isPointInsidePolygon,
} from "@tscircuit/math-utils"
import { distance, segmentDistance } from "./geometry"
import type { Point, SimpleRouteJson, Trace } from "./types"

const BOARD_EDGE_EPSILON = 1e-9
const DEFAULT_VIA_PAD_DIAMETER = 0.3

function outlineVertices(outline: Point[]) {
  const vertices = outline.filter(
    (point, index) => index === 0 || distance(point, outline[index - 1]) > 0,
  )
  if (vertices.length > 1 && distance(vertices[0], vertices.at(-1)!) === 0)
    vertices.pop()
  return vertices
}

function signedArea(outline: Point[]) {
  return (
    outline.reduce((area, point, index) => {
      const next = outline[(index + 1) % outline.length]
      return area + point.x * next.y - next.x * point.y
    }, 0) / 2
  )
}

export function isValidBoardOutline(outline: Point[]) {
  if (
    !outline.every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    )
  )
    return false
  const vertices = outlineVertices(outline)
  if (
    vertices.length < 3 ||
    Math.abs(signedArea(vertices)) <= BOARD_EDGE_EPSILON
  )
    return false
  for (let index = 0; index < vertices.length; index++) {
    const next = (index + 1) % vertices.length
    for (let other = index + 1; other < vertices.length; other++) {
      const otherNext = (other + 1) % vertices.length
      if (next === other || otherNext === index) continue
      if (
        segmentDistance(
          [vertices[index], vertices[next]],
          [vertices[other], vertices[otherNext]],
        ) <= BOARD_EDGE_EPSILON
      )
        return false
    }
  }
  return true
}

/** Check the whole copper capsule, including across concave cut-ins. */
export function isSegmentInsideBoardOutline({
  segment,
  outline,
  clearance,
}: {
  segment: [Point, Point]
  outline: Point[]
  clearance: number
}) {
  if (!Number.isFinite(clearance) || clearance < 0) return false
  if (!segment.every((point) => isPointInsidePolygon(point, outline)))
    return false
  const minimumDistance = Math.max(
    clearance - BOARD_EDGE_EPSILON,
    Number.EPSILON,
  )
  for (let index = 0; index < outline.length; index++) {
    if (
      segmentDistance(segment, [
        outline[index],
        outline[(index + 1) % outline.length],
      ]) < minimumDistance
    )
      return false
  }
  return true
}

export function boardOutlineRoutingVertices({
  outline,
  clearance,
}: {
  outline: Point[]
  clearance: number
}) {
  const vertices = outlineVertices(outline)
  const winding = Math.sign(signedArea(vertices))
  const result: Point[] = []
  for (let index = 0; index < vertices.length; index++) {
    const point = vertices[index]
    const incoming = getUnitVectorFromPointAToB(
      vertices[(index + vertices.length - 1) % vertices.length],
      point,
    )
    const outgoing = getUnitVectorFromPointAToB(
      point,
      vertices[(index + 1) % vertices.length],
    )
    const denominator = 1 + incoming.x * outgoing.x + incoming.y * outgoing.y
    if (denominator <= BOARD_EDGE_EPSILON) continue
    result.push({
      x:
        point.x -
        (winding * (incoming.y + outgoing.y) * clearance) / denominator,
      y:
        point.y +
        (winding * (incoming.x + outgoing.x) * clearance) / denominator,
    })
  }
  return result
}

export function tracesInsideBoardOutline(
  input: SimpleRouteJson,
  traces: Trace[],
) {
  const outline = input.outline
  if (!outline?.length) return true
  const edgeClearance = input.minBoardEdgeClearance ?? 0
  for (const trace of traces) {
    for (let index = 0; index < trace.route.length; index++) {
      const point = trace.route[index]
      if (point.route_type === "via") {
        if (
          !isSegmentInsideBoardOutline({
            segment: [point, point],
            outline,
            clearance:
              (point.via_diameter ??
                input.minViaPadDiameter ??
                DEFAULT_VIA_PAD_DIAMETER) /
                2 +
              edgeClearance,
          })
        )
          return false
      }
      const next = trace.route[index + 1]
      if (!next) continue
      let width = 0
      if (point.route_type === "wire") width = point.width
      if (next.route_type === "wire") width = Math.max(width, next.width)
      if (
        width > 0 &&
        !isSegmentInsideBoardOutline({
          segment: [point, next],
          outline,
          clearance: width / 2 + edgeClearance,
        })
      )
        return false
    }
  }
  return true
}
