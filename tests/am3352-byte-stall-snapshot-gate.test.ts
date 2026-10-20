import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadAm3352ByteStallInput } from "../scripts/load-am3352-byte-stall-input"
import { exportAm3352ByteStallSnapshot } from "../scripts/snapshot-am3352-byte-stall"
import { validateAm3352ByteStallOutput } from "../scripts/validate-am3352-byte-stall-output"

test("an unrouted native byte capture cannot create snapshot artifacts", async () => {
  const input = loadAm3352ByteStallInput()
  expect(input.traces).toEqual([])
  expect(validateAm3352ByteStallOutput(input, input)).toMatchObject({
    valid: false,
    complete: false,
    signals: 0,
  })
  const temporary = await mkdtemp(join(tmpdir(), "am3352-byte-artifact-gate-"))
  const directory = join(temporary, "must-not-be-created")
  try {
    await expect(
      exportAm3352ByteStallSnapshot(input, directory),
    ).rejects.toThrow("Refusing byte snapshot without all 11 signals")
    expect(existsSync(directory)).toBe(false)
    expect(await readdir(temporary)).toEqual([])
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
