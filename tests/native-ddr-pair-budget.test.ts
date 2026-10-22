import { expect, test } from "bun:test"
import {
  loadSequentialNativeDdr,
  nativeDqs0Control,
  auditSequentialNativePair,
} from "../scripts/native-sequential-pair"

function drive(work: ReturnType<typeof nativeDqs0Control>) {
  let next = work.next(),
    steps = 0
  while (!next.done) {
    steps++
    next = work.next()
  }
  return { traces: next.value, steps }
}

test("the 6000-yield pair budget misses a valid native DQS0 route around fresh BYTE1", () => {
  const sample = loadSequentialNativeDdr(),
    before = structuredClone(sample)
  const limited = drive(nativeDqs0Control(sample.secondInput, 6000))
  expect(limited.traces).toBeNull()
  const completed = drive(nativeDqs0Control(sample.secondInput, 60000))
  expect(completed.traces).not.toBeNull()
  expect(completed.steps).toBeGreaterThan(6000)
  const audit = auditSequentialNativePair(sample, completed.traces!)
  expect(audit.valid).toBe(true)
  expect(audit.connected).toBe(true)
  expect(sample).toEqual(before)
}, 180000)
