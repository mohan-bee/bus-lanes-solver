import { expect, test } from "bun:test"
import { pruneCandidateDomains } from "../lib/prune-candidate-domains"
import { solveSignalCandidatePool } from "../lib/solve-signal-candidate-pool"

type Candidate = { connection: number; channel: number; metadata: string }
const option = (connection: number, channel: number): Candidate => ({
  connection,
  channel,
  metadata: `connection_${connection}_channel_${channel}`,
})
const neighboringChannelsAgree = (a: Candidate, b: Candidate) =>
  Math.abs(a.connection - b.connection) !== 1 || a.channel === b.channel

test("unsupported route channels propagate through neighboring domains without changing input", () => {
  const domains = [
    [option(0, 0), option(0, 1)],
    [option(1, 0), option(1, 1)],
    [option(2, 0), option(2, 1)],
    [option(3, 1)],
  ]
  const original = domains.map((domain) => [...domain])
  const pruned = pruneCandidateDomains(domains, neighboringChannelsAgree)
  expect(pruned).toEqual(domains.map((domain) => [domain.at(-1)!]))
  for (const [index, domain] of pruned!.entries())
    expect(domain[0]).toBe(domains[index].at(-1)!)
  expect(domains).toEqual(original)
})

test("contradictory channel requirements empty a domain before backtracking", () => {
  const domains = [[option(0, 0)], [option(1, 0), option(1, 1)], [option(2, 1)]]
  expect(pruneCandidateDomains(domains, neighboringChannelsAgree)).toBeNull()
  expect(solveSignalCandidatePool(domains, neighboringChannelsAgree)).toBeNull()
})

test("arc-consistent odd-cycle domains still receive the full constraint search", () => {
  const domains = [0, 1, 2].map((connection) => [
    option(connection, 0),
    option(connection, 1),
  ])
  const differentChannels = (a: Candidate, b: Candidate) =>
    a.channel !== b.channel
  expect(pruneCandidateDomains(domains, differentChannels)).toEqual(domains)
  expect(solveSignalCandidatePool(domains, differentChannels)).toBeNull()
})

test("selection preserves candidate references, connection order and metadata after MRV pivoting", () => {
  const a = option(0, 1),
    b = option(1, 1),
    c = option(2, 1)
  const domains = [[option(0, 0), a], [b], [option(2, 0), c]]
  const result = solveSignalCandidatePool(domains, neighboringChannelsAgree)
  expect(result).toEqual([a, b, c])
  expect(result![0]).toBe(a)
  expect(result![1]).toBe(b)
  expect(result![2]).toBe(c)
  expect(result!.map((candidate) => candidate.metadata)).toEqual([
    a.metadata,
    b.metadata,
    c.metadata,
  ])
})

test("support-check exhaustion retains unproven options and permits bounded selection", () => {
  const a = option(0, 0),
    b = option(1, 1)
  const domains = [[a, option(0, 1)], [b]]
  let checks = 0
  const compatible = (first: Candidate, second: Candidate) => {
    checks++
    return neighboringChannelsAgree(first, second)
  }
  expect(pruneCandidateDomains(domains, compatible, 1)).toEqual(domains)
  expect(checks).toBe(1)
  expect(
    solveSignalCandidatePool(domains, neighboringChannelsAgree, 4, 0),
  ).toEqual([domains[0][1], b])
  expect(
    solveSignalCandidatePool(domains, neighboringChannelsAgree, 0, 0),
  ).toBeNull()
})
