import {
  getPngBufferFromGraphicsObject,
  getSvgFromGraphicsObject,
} from "graphics-debug"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import type { SimpleRouteJson } from "../lib"
import { loadAm3352SbcSample } from "./am3352-sbc-sample"
import { validateAm3352SbcSample } from "./validate-am3352-sbc-sample"
import { routedGraphics } from "./snapshot-routed-am3352"
import type { Am3352SampleMetadata } from "./am3352-samples"

/** Only full, independently accepted copper may become a review artifact. */
export async function exportSbcSnapshot(
  output: SimpleRouteJson,
  directory: string,
) {
  const input = loadAm3352SbcSample("benchmark")
  const report = validateAm3352SbcSample(input, output)
  if (!report.valid || report.signals !== 47)
    throw Error(
      "Refusing an SBC snapshot without 47/47, immutable ground, DRC, byte matching and pair coupling",
    )
  const traces = output.traces!.slice(input.traces!.length)
  const metadata = {
    name: "full-board",
    placement: { cpu: { x: 0, y: 0 }, ram: { x: 0, y: -27 } },
    fixedFanoutTraces: input.traces,
  } as unknown as Am3352SampleMetadata
  const { graphics, width, height } = routedGraphics(
    {
      metadata,
      solver: {
        solved: true,
        failed: false,
        error: null,
        input,
        traces,
        getOutput: () => output,
      },
    },
    {
      title: "AM3352 SBC · fresh 47/47 DDR · top/bottom",
      status: "1111 board obstacles · 67 fixed ground escapes · DRC passed",
      skew: "Planar byte skew ≤0.635 mm; pair skew ≤0.127 mm. CA timing remains unresolved.",
    },
  )
  const pixels = 3000,
    pngHeight = Math.round((pixels * height) / width)
  const options = { includeTextLabels: false, backgroundColor: "#10151b" }
  const svg = getSvgFromGraphicsObject(graphics, {
    ...options,
    svgWidth: pixels,
    svgHeight: pngHeight,
  }).replace(/[ \t]+$/gm, "")
  const png = await getPngBufferFromGraphicsObject(graphics, {
    ...options,
    pngWidth: pixels,
    pngHeight,
    yFlip: true,
  })
  await mkdir(directory, { recursive: true })
  await Bun.write(join(directory, "sbc-completed.svg"), svg)
  await Bun.write(join(directory, "sbc-completed.png"), png)
  await Bun.write(
    join(directory, "sbc-validation.json"),
    JSON.stringify(report, null, 2),
  )
  return report
}
if (import.meta.main) {
  if (!process.argv[2] || !process.argv[3])
    throw Error(
      "Usage: bun scripts/snapshot-am3352-sbc.ts completed.json output-directory",
    )
  await exportSbcSnapshot(
    await Bun.file(process.argv[2]).json(),
    process.argv[3],
  )
}
