import { useState } from "react"
import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { BusLanesPipelineSolver, BusLanesSolver } from "../lib"
import { loadAm3352SbcSample } from "../scripts/am3352-sbc-sample"
function Am3352SbcSample() {
  const [timing, setTiming] = useState<"benchmark" | "complete">("benchmark")
  const [placement, setPlacement] = useState<"published" | "byte-corridors">(
    "published",
  )
  const [scope, setScope] = useState<"all" | "byte0" | "byte1">("all")
  const input = loadAm3352SbcSample(timing, placement, scope)
  return (
    <main style={{ fontFamily: "system-ui", padding: 20 }}>
      <h1>AM3352 SBC / DDR on top and bottom</h1>
      <p>
        Full-board geometry: {input.connections.length} unresolved signals, 1111
        pad/hole obstacles, and 67 immutable ground escapes. Both chips are on
        top; bottom-side components can block through-via sites. No DDR route
        cache is supplied.
      </p>
      <label>
        Timing constraints:{" "}
        <select
          value={timing}
          onChange={(e) => setTiming(e.target.value as typeof timing)}
        >
          <option value="benchmark">
            Byte buses + three pairs (benchmark comparison)
          </option>
          <option value="complete">
            Byte buses + address/control/clock + three pairs
          </option>
        </select>
      </label>
      <label>
        Placement:{" "}
        <select
          value={placement}
          onChange={(e) => setPlacement(e.target.value as typeof placement)}
        >
          <option value="published">Published board</option>
          <option value="byte-corridors">
            Move seven decouplers to protect both byte corridors
          </option>
        </select>
      </label>
      <label>
        Signals:{" "}
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as typeof scope)}
        >
          <option value="all">All 47 DDR signals</option>
          <option value="byte0">
            BYTE0 only (11 signals, full-board obstacles)
          </option>
          <option value="byte1">
            BYTE1 only (11 signals, full-board obstacles)
          </option>
        </select>
      </label>
      <p>
        Before routing completes, the fallback view shows input pads and fixed
        copper. Step the pipeline to inspect layer allocation and routing.
      </p>
      <GenericSolverDebugger
        key={`${timing}/${placement}/${scope}`}
        createSolver={() => {
          const solver = new BusLanesPipelineSolver(input)
          const fallback = new BusLanesSolver(input).visualize()
          const visualize = solver.visualize.bind(solver)
          solver.visualize = () => {
            const graphics = visualize()
            return graphics.lines?.length || graphics.points?.length
              ? graphics
              : fallback
          }
          return solver
        }}
      />
    </main>
  )
}
export default <Am3352SbcSample />
