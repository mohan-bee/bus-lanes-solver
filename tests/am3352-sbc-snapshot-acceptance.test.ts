import { expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadAm3352SbcSample } from "../scripts/am3352-sbc-sample"
import { exportSbcSnapshot } from "../scripts/snapshot-am3352-sbc"

test("incomplete full-board copper cannot create an SBC snapshot artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sbc-snapshot-"))
  try {
    const input = loadAm3352SbcSample("benchmark")
    await expect(exportSbcSnapshot(input, directory)).rejects.toThrow(
      "Refusing an SBC snapshot",
    )
    expect(await readdir(directory)).toEqual([])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
