import { expect, test } from "bun:test"
import {
  loadSequentialNativeDdr,
  nativeDqs0Control,
  auditSequentialNativePair,
} from "../scripts/native-sequential-pair"
import { negotiateSignalSites } from "../lib/negotiate-signal-sites"
import { repairSurfacePairEscape } from "../lib/repair-surface-pair-escape"
import { validateRoutedCopperDrc } from "@tscircuit/fanout-solver"
import type { FlexibleSignalState } from "../lib/flexible-signal-state"
function drive<T>(work: Generator<unknown, T>) {
  let next = work.next(),
    steps = 0
  while (!next.done) {
    steps++
    next = work.next()
  }
  return { value: next.value, steps }
}

test("native pair repair recovers validated progress around a computed ordinary candidate", () => {
  const sample = loadSequentialNativeDdr(),
    before = structuredClone(sample)
  const paired = drive(nativeDqs0Control(sample.secondInput, 60000)).value
  expect(paired).not.toBeNull()
  const pairNames = new Set(
    sample.secondInput.differentialPairs![0].connectionNames,
  )
  const ordinary = sample.secondInput.connections.filter(
      (c) => !pairNames.has(c.name),
    ),
    names = new Set(ordinary.map((c) => c.name))
  const state: FlexibleSignalState = {
    native: sample.secondInput,
    pending: {
      ...sample.secondInput,
      connections: ordinary,
      traces: [...sample.secondInput.traces!, ...paired!],
    },
    escapes: [],
    retained: paired!,
    traces: [],
  }
  const stateBefore = structuredClone(state),
    blocked: string[] = []
  const rejected = drive(
    negotiateSignalSites(state, names, false, false, {
      checkEscapeCompatibility: true,
      allowExpandedSites: true,
      expandEmptyDomainsOnly: true,
      maxCandidateSearchNodes: 12000,
      onBlockedConnection: (name) => blocked.push(name),
    }),
  )
  expect(rejected.value).toBeNull()
  expect(blocked).toHaveLength(1)
  const repair = drive(
    repairSurfacePairEscape(
      state,
      blocked[0],
      new Set([JSON.stringify(paired!.map((t) => t.route))]),
    ),
  )
  expect(repair.value).not.toBeNull()
  expect(repair.value!.retained).not.toEqual(state.retained)
  const recovered = repair.value!
  expect(recovered.retained).toHaveLength(2)
  expect(recovered.traces).toHaveLength(1)
  expect(auditSequentialNativePair(sample, recovered.retained).valid).toBe(true)
  const combined = {
    ...sample.secondInput,
    connections: [
      ...sample.firstInput.connections,
      ...sample.secondInput.connections,
    ],
  }
  const drc = validateRoutedCopperDrc({
    inputSrj: combined as never,
    routedSrj: {
      ...combined,
      traces: [
        ...sample.secondInput.traces!,
        ...recovered.escapes,
        ...recovered.retained,
        ...recovered.traces,
      ],
    } as never,
    clearance: sample.secondInput.minTraceToPadEdgeClearance!,
    allowBlindAndBuriedVias: false,
  })
  expect(drc.valid).toBe(true)
  expect(state).toEqual(stateBefore)
  expect(sample).toEqual(before)
}, 900000)
