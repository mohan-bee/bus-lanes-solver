import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { loadAm3352Sample } from "../scripts/am3352-samples"
import { validateAm3352Sample } from "../scripts/validate-am3352-sample"
import type { Trace } from "../lib"

for (const layer of ["top", "bottom"]) {
  test(`pipeline benchmark rejects ${layer} copper touching itself before writing output`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "self-touching-benchmark-"))
    try {
      const route = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0.5, 1],
        [0.5, 0.1],
        [-1, 0.1],
      ].map(([x, y]) => ({
        route_type: "wire",
        layer,
        width: 0.1,
        x,
        y,
      }))
      const input = {
        layerCount: 2,
        minTraceWidth: 0.1,
        obstacles: [],
        bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
        connections: [
          { name: "CONTROL", pointsToConnect: [route[0], route.at(-1)] },
        ],
      }
      const trace = {
        type: "pcb_trace",
        pcb_trace_id: "control",
        connection_name: "CONTROL",
        route,
      }
      const modulePath = join(directory, "solver.ts")
      const inputPath = join(directory, "input.json")
      const outputPath = join(directory, "completed.json")
      // An external solver claiming success must still pass the independent
      // production CLI guard; no bus is required to trigger the audit.
      await Bun.write(
        modulePath,
        `export class BusLanesPipelineSolver {
        solved = true; failed = false; iterations = 1;
        traces = ${JSON.stringify([trace])};
        constructor(public input: any) {}
        getOutput() { return { ...this.input, traces: this.traces } }
      }`,
      )
      await Bun.write(inputPath, JSON.stringify(input))
      const process = Bun.spawn(
        [
          globalThis.process.execPath,
          resolve(import.meta.dir, "../scripts/benchmark-pipeline.ts"),
          inputPath,
          "--solver",
          modulePath,
          "--output",
          outputPath,
        ],
        { stdout: "pipe", stderr: "pipe" },
      )
      const [exitCode, stderr] = await Promise.all([
        process.exited,
        new Response(process.stderr).text(),
      ])
      expect(exitCode).not.toBe(0)
      expect(stderr).toContain("shorts to itself")
      expect(existsSync(outputPath)).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test("AM3352 acceptance reports self-touching complete copper independently of carrier clearance", async () => {
  const { input, metadata } = await loadAm3352Sample("outer-layers")
  const connection = input.connections[0]
  const wire = (x: number, y: number) => ({
    route_type: "wire" as const,
    layer: "top",
    width: 0.1,
    x,
    y,
  })
  const signal: Trace = {
    type: "pcb_trace",
    pcb_trace_id: "touching",
    connection_name: connection.name,
    route: [
      wire(0, 0),
      wire(1, 0),
      wire(1, 1),
      wire(0.5, 1),
      wire(0.5, 0.1),
      wire(-1, 0.1),
    ],
  }
  const before = structuredClone({ input, signal })
  const report = await validateAm3352Sample(input, metadata, [signal])
  expect(report.valid).toBe(false)
  expect(report.selfShorts).toHaveLength(1)
  expect(
    report.issues.some((issue) => issue.includes("shorts to itself")),
  ).toBe(true)
  expect({ input, signal }).toEqual(before)
  const inputReport = await validateAm3352Sample(input, metadata)
  expect(inputReport.selfShorts).toBeNull()
})
