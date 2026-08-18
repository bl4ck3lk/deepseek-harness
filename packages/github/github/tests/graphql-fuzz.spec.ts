/**
 * Data-driven corruption suite: every field the mappers trust is replaced
 * with a wrong type, and each misshape must throw GhResponseError naming the
 * field. This covers the defensive require* branches without one fixture per
 * branch.
 */

import { describe, expect, it } from 'vitest'
import {
  GhResponseError,
  mapCommitList,
  mapPullRequestDetail,
  mapPullRequestList,
  mapThreadFull,
  mapThreadReply,
  mapThreadResolution,
  mapThreadSummaries,
  unwrapGraphql,
} from '../src/graphql.ts'

const REPO = { owner: 'o', name: 'r' }

function setPath(root: Record<string, unknown>, path: readonly string[], value: unknown): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(root)) as Record<string, unknown>
  let cursor = clone
  for (let index = 0; index < path.length - 1; index += 1) {
    const step = path[index] as string
    const next = cursor[step]
    if (typeof next !== 'object' || next === null) throw new Error(`bad corruption path at ${step}`)
    cursor = next as Record<string, unknown>
  }
  cursor[path[path.length - 1] as string] = value
  return clone
}

const LIST_NODE = {
  number: 1, title: 't', state: 'OPEN', isDraft: false,
  author: { login: 'a' }, headRefName: 'h', baseRefName: 'b',
  updatedAt: '2026-01-01T00:00:00Z', reviewDecision: null, mergeable: 'MERGEABLE',
  statusCheckRollup: { state: 'SUCCESS' },
}
const LIST_ENVELOPE = { data: { repository: { pullRequests: { nodes: [LIST_NODE] } } } }

const CHECK_CONTEXTS = [
  { __typename: 'CheckRun', name: 'n', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: null },
  { __typename: 'StatusContext', context: 'c', state: 'SUCCESS', targetUrl: null },
]

const DETAIL_PR = {
  id: 'PR_1', number: 1, title: 't', state: 'OPEN', isDraft: false,
  author: { login: 'a' }, bodyText: 'body',
  headRefName: 'h', baseRefName: 'b',
  mergeable: 'MERGEABLE', reviewDecision: 'APPROVED',
  additions: 1, deletions: 2, changedFiles: 3,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  labels: { nodes: [{ name: 'l1' }] },
  reviewThreads: {
    totalCount: 1,
    nodes: [{
      id: 'PRRT_1', isResolved: false, isOutdated: false, path: 'f.ts', line: 9,
      resolvedBy: { login: 'a' },
      comments: { totalCount: 1, nodes: [{ id: 'C_1', databaseId: 1, author: { login: 'a' }, createdAt: '2026-01-01T00:00:00Z', bodyText: 'b' }] },
    }],
  },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS', contexts: { nodes: CHECK_CONTEXTS } } } }] },
}
const DETAIL_ENVELOPE = { data: { repository: { pullRequest: DETAIL_PR } } }

const THREAD = {
  __typename: 'PullRequestReviewThread',
  id: 'PRRT_1', isResolved: true, isOutdated: false, path: 'f.ts', line: null,
  comments: { totalCount: 1, nodes: [{ id: 'C_1', databaseId: 1, author: { login: 'a' }, createdAt: '2026-01-01T00:00:00Z', bodyText: 'b' }] },
}

const COMMITS = {
  totalCount: 1,
  nodes: [{ commit: { oid: 'abc', messageHeadline: 'm', authoredDate: '2026-01-01T00:00:00Z', author: { name: 'N', user: { login: 'a' } } } }],
}

interface CorruptionCase {
  label: string
  envelope: Record<string, unknown>
  path: readonly string[]
  value: unknown
}

const LIST_CASES: CorruptionCase[] = [
  { label: 'repository not object', envelope: LIST_ENVELOPE, path: ['data', 'repository'], value: 'x' },
  { label: 'pullRequests not object', envelope: LIST_ENVELOPE, path: ['data', 'repository', 'pullRequests'], value: 5 },
  { label: 'number wrong type', envelope: LIST_ENVELOPE, path: ['data', 'repository', 'pullRequests', 'nodes', '0', 'number'], value: 'x' },
  { label: 'title wrong type', envelope: LIST_ENVELOPE, path: ['data', 'repository', 'pullRequests', 'nodes', '0', 'title'], value: 5 },
  { label: 'state wrong type', envelope: LIST_ENVELOPE, path: ['data', 'repository', 'pullRequests', 'nodes', '0', 'state'], value: 5 },
  { label: 'isDraft wrong type', envelope: LIST_ENVELOPE, path: ['data', 'repository', 'pullRequests', 'nodes', '0', 'isDraft'], value: 'yes' },
  { label: 'author not object', envelope: LIST_ENVELOPE, path: ['data', 'repository', 'pullRequests', 'nodes', '0', 'author'], value: 5 },
  { label: 'author.login wrong type', envelope: LIST_ENVELOPE, path: ['data', 'repository', 'pullRequests', 'nodes', '0', 'author', 'login'], value: 5 },
  { label: 'headRefName wrong type', envelope: LIST_ENVELOPE, path: ['data', 'repository', 'pullRequests', 'nodes', '0', 'headRefName'], value: 5 },
  { label: 'baseRefName wrong type', envelope: LIST_ENVELOPE, path: ['data', 'repository', 'pullRequests', 'nodes', '0', 'baseRefName'], value: 5 },
  { label: 'updatedAt wrong type', envelope: LIST_ENVELOPE, path: ['data', 'repository', 'pullRequests', 'nodes', '0', 'updatedAt'], value: 5 },
  { label: 'reviewDecision wrong type', envelope: LIST_ENVELOPE, path: ['data', 'repository', 'pullRequests', 'nodes', '0', 'reviewDecision'], value: 5 },
  { label: 'mergeable wrong type', envelope: LIST_ENVELOPE, path: ['data', 'repository', 'pullRequests', 'nodes', '0', 'mergeable'], value: 5 },
  { label: 'rollup not object', envelope: LIST_ENVELOPE, path: ['data', 'repository', 'pullRequests', 'nodes', '0', 'statusCheckRollup'], value: 5 },
  { label: 'rollup.state wrong type', envelope: LIST_ENVELOPE, path: ['data', 'repository', 'pullRequests', 'nodes', '0', 'statusCheckRollup', 'state'], value: 5 },
  { label: 'rollup.state unexpected value', envelope: LIST_ENVELOPE, path: ['data', 'repository', 'pullRequests', 'nodes', '0', 'statusCheckRollup', 'state'], value: 'WEIRD' },
]

const DETAIL_CASES: CorruptionCase[] = [
  { label: 'pullRequest not object', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest'], value: 'x' },
  { label: 'id wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'id'], value: 5 },
  { label: 'bodyText wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'bodyText'], value: 5 },
  { label: 'mergeable wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'mergeable'], value: 5 },
  { label: 'reviewDecision wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewDecision'], value: 5 },
  { label: 'additions wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'additions'], value: 'x' },
  { label: 'deletions wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'deletions'], value: 'x' },
  { label: 'changedFiles wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'changedFiles'], value: 'x' },
  { label: 'createdAt wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'createdAt'], value: 5 },
  { label: 'labels not object', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'labels'], value: 5 },
  { label: 'labels.nodes not array', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'labels', 'nodes'], value: 5 },
  { label: 'label.name wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'labels', 'nodes', '0', 'name'], value: 5 },
  { label: 'reviewThreads not object', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewThreads'], value: 5 },
  { label: 'threads.totalCount wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewThreads', 'totalCount'], value: 'x' },
  { label: 'threads.nodes not array', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewThreads', 'nodes'], value: 5 },
  { label: 'thread.id wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewThreads', 'nodes', '0', 'id'], value: 5 },
  { label: 'thread.isResolved wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewThreads', 'nodes', '0', 'isResolved'], value: 'x' },
  { label: 'thread.isOutdated wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewThreads', 'nodes', '0', 'isOutdated'], value: 5 },
  { label: 'thread.path wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewThreads', 'nodes', '0', 'path'], value: 5 },
  { label: 'thread.line wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewThreads', 'nodes', '0', 'line'], value: 'x' },
  { label: 'thread.resolvedBy not object', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewThreads', 'nodes', '0', 'resolvedBy'], value: 5 },
  { label: 'thread.comments not object', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewThreads', 'nodes', '0', 'comments'], value: 5 },
  { label: 'thread.comments.totalCount wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewThreads', 'nodes', '0', 'comments', 'totalCount'], value: 'x' },
  { label: 'comment.id wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewThreads', 'nodes', '0', 'comments', 'nodes', '0', 'id'], value: 5 },
  { label: 'comment.databaseId wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewThreads', 'nodes', '0', 'comments', 'nodes', '0', 'databaseId'], value: 'x' },
  { label: 'comment.author not object', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewThreads', 'nodes', '0', 'comments', 'nodes', '0', 'author'], value: 5 },
  { label: 'comment.createdAt wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewThreads', 'nodes', '0', 'comments', 'nodes', '0', 'createdAt'], value: 5 },
  { label: 'comment.bodyText wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewThreads', 'nodes', '0', 'comments', 'nodes', '0', 'bodyText'], value: 5 },
  { label: 'commits not object', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'commits'], value: 5 },
  { label: 'commits.nodes not array', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes'], value: 5 },
  { label: 'commit not object', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit'], value: 5 },
  { label: 'rollup not object', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'statusCheckRollup'], value: 5 },
  { label: 'rollup.state wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'statusCheckRollup', 'state'], value: 5 },
  { label: 'rollup.state unexpected value', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'statusCheckRollup', 'state'], value: 'WEIRD' },
  { label: 'contexts not object', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'statusCheckRollup', 'contexts'], value: 5 },
  { label: 'contexts.nodes not array', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'statusCheckRollup', 'contexts', 'nodes'], value: 5 },
  { label: 'check-run name wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'statusCheckRollup', 'contexts', 'nodes', '0', 'name'], value: 5 },
  { label: 'check-run status wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'statusCheckRollup', 'contexts', 'nodes', '0', 'status'], value: 5 },
  { label: 'check-run conclusion wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'statusCheckRollup', 'contexts', 'nodes', '0', 'conclusion'], value: 5 },
  { label: 'check-run detailsUrl wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'statusCheckRollup', 'contexts', 'nodes', '0', 'detailsUrl'], value: 5 },
  { label: 'status context wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'statusCheckRollup', 'contexts', 'nodes', '1', 'context'], value: 5 },
  { label: 'status state wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'statusCheckRollup', 'contexts', 'nodes', '1', 'state'], value: 5 },
  { label: 'status targetUrl wrong type', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'statusCheckRollup', 'contexts', 'nodes', '1', 'targetUrl'], value: 5 },
]

const THREAD_CASES: CorruptionCase[] = [
  { label: 'node not object', envelope: { data: { node: THREAD } }, path: ['data', 'node'], value: 5 },
  { label: 'id wrong type', envelope: { data: { node: THREAD } }, path: ['data', 'node', 'id'], value: 5 },
  { label: 'isResolved wrong type', envelope: { data: { node: THREAD } }, path: ['data', 'node', 'isResolved'], value: 'x' },
  { label: 'path wrong type', envelope: { data: { node: THREAD } }, path: ['data', 'node', 'path'], value: 5 },
  { label: 'line wrong type', envelope: { data: { node: THREAD } }, path: ['data', 'node', 'line'], value: 'x' },
  { label: 'comments not object', envelope: { data: { node: THREAD } }, path: ['data', 'node', 'comments'], value: 5 },
  { label: 'nodes not array', envelope: { data: { node: THREAD } }, path: ['data', 'node', 'comments', 'nodes'], value: 5 },
]

const COMMIT_CASES: CorruptionCase[] = [
  { label: 'pullRequest not object', envelope: { data: { repository: { pullRequest: { commits: COMMITS } } } }, path: ['data', 'repository', 'pullRequest'], value: 5 },
  { label: 'commits not object', envelope: { data: { repository: { pullRequest: { commits: COMMITS } } } }, path: ['data', 'repository', 'pullRequest', 'commits'], value: 5 },
  { label: 'commit not object', envelope: { data: { repository: { pullRequest: { commits: COMMITS } } } }, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit'], value: 5 },
  { label: 'oid wrong type', envelope: { data: { repository: { pullRequest: { commits: COMMITS } } } }, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'oid'], value: 5 },
  { label: 'messageHeadline wrong type', envelope: { data: { repository: { pullRequest: { commits: COMMITS } } } }, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'messageHeadline'], value: 5 },
  { label: 'authoredDate wrong type', envelope: { data: { repository: { pullRequest: { commits: COMMITS } } } }, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'authoredDate'], value: 5 },
  { label: 'author not object', envelope: { data: { repository: { pullRequest: { commits: COMMITS } } } }, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'author'], value: 5 },
  { label: 'author.name wrong type', envelope: { data: { repository: { pullRequest: { commits: COMMITS } } } }, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'author', 'name'], value: 5 },
  { label: 'author.user not object', envelope: { data: { repository: { pullRequest: { commits: COMMITS } } } }, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'author', 'user'], value: 5 },
  { label: 'author.user.login wrong type', envelope: { data: { repository: { pullRequest: { commits: COMMITS } } } }, path: ['data', 'repository', 'pullRequest', 'commits', 'nodes', '0', 'commit', 'author', 'user', 'login'], value: 5 },
]

function assertCorrupted(mapper: (envelope: unknown) => unknown, cases: CorruptionCase[]): void {
  for (const corruption of cases) {
    const envelope = setPath(corruption.envelope, corruption.path, corruption.value)
    expect(() => mapper(envelope), corruption.label).toThrow(GhResponseError)
  }
}

describe('mapper corruption coverage', () => {
  it('rejects every corrupted listing field', () => {
    assertCorrupted(envelope => mapPullRequestList(envelope, REPO), LIST_CASES)
  })

  it('rejects every corrupted detail field', () => {
    assertCorrupted(envelope => mapPullRequestDetail(envelope, REPO), DETAIL_CASES)
  })

  it('rejects every corrupted thread field', () => {
    const summaryPrefix = ['data', 'repository', 'pullRequest', 'reviewThreads', 'nodes', '0'] as const
    const summaryCases: CorruptionCase[] = [
      { label: 'reviewThreads not object', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewThreads'], value: 5 },
      { label: 'reviewThreads.nodes not array', envelope: DETAIL_ENVELOPE, path: ['data', 'repository', 'pullRequest', 'reviewThreads', 'nodes'], value: 5 },
      { label: 'thread.id wrong type', envelope: DETAIL_ENVELOPE, path: [...summaryPrefix, 'id'], value: 5 },
      { label: 'thread.isResolved wrong type', envelope: DETAIL_ENVELOPE, path: [...summaryPrefix, 'isResolved'], value: 'x' },
      { label: 'thread.isOutdated wrong type', envelope: DETAIL_ENVELOPE, path: [...summaryPrefix, 'isOutdated'], value: 5 },
      { label: 'thread.path wrong type', envelope: DETAIL_ENVELOPE, path: [...summaryPrefix, 'path'], value: 5 },
      { label: 'thread.line wrong type', envelope: DETAIL_ENVELOPE, path: [...summaryPrefix, 'line'], value: 'x' },
      { label: 'thread.resolvedBy not object', envelope: DETAIL_ENVELOPE, path: [...summaryPrefix, 'resolvedBy'], value: 5 },
      { label: 'thread.comments not object', envelope: DETAIL_ENVELOPE, path: [...summaryPrefix, 'comments'], value: 5 },
      { label: 'thread.comments.nodes not array', envelope: DETAIL_ENVELOPE, path: [...summaryPrefix, 'comments', 'nodes'], value: 5 },
      { label: 'comment.author not object', envelope: DETAIL_ENVELOPE, path: [...summaryPrefix, 'comments', 'nodes', '0', 'author'], value: 5 },
      { label: 'comment.createdAt wrong type', envelope: DETAIL_ENVELOPE, path: [...summaryPrefix, 'comments', 'nodes', '0', 'createdAt'], value: 5 },
      { label: 'comment.bodyText wrong type', envelope: DETAIL_ENVELOPE, path: [...summaryPrefix, 'comments', 'nodes', '0', 'bodyText'], value: 5 },
    ]
    assertCorrupted(envelope => mapThreadSummaries(envelope), summaryCases)
    assertCorrupted(envelope => mapThreadFull(envelope), THREAD_CASES)
  })

  it('rejects every corrupted commit field', () => {
    assertCorrupted(envelope => mapCommitList(envelope), COMMIT_CASES)
  })

  it('maps an empty commit list to default checks', () => {
    const detail = mapPullRequestDetail({ data: { repository: { pullRequest: { ...DETAIL_PR, commits: { nodes: [] } } } } }, REPO)
    expect(detail.checks).toEqual({ state: null, contexts: [] })
  })

  it('maps a thread with no comments to a null first comment', () => {
    const emptyThread = { ...DETAIL_PR.reviewThreads.nodes[0], comments: { totalCount: 0, nodes: [] } }
    const pr = { ...DETAIL_PR, reviewThreads: { totalCount: 1, nodes: [emptyThread] } }
    const threads = mapThreadSummaries({ data: { repository: { pullRequest: pr } } })
    expect(threads[0]!.firstComment).toBeNull()
  })

  it('rejects a null pull request container in thread summaries', () => {
    expect(() => mapThreadSummaries({ data: { repository: { pullRequest: null } } })).toThrow(GhResponseError)
  })

  it('maps a null rollup state to a null checks state', () => {
    const envelope = setPath(LIST_ENVELOPE, ['data', 'repository', 'pullRequests', 'nodes', '0', 'statusCheckRollup', 'state'], null)
    const rows = mapPullRequestList(envelope, REPO)
    expect(rows[0]!.checksState).toBeNull()
  })

  it('rejects corrupted mutation payloads', () => {
    expect(() => mapThreadResolution({ data: { resolveReviewThread: 5 } }, 'resolveReviewThread')).toThrow(GhResponseError)
    expect(() => mapThreadResolution({ data: { resolveReviewThread: { thread: { isResolved: 'x' } } } }, 'resolveReviewThread')).toThrow(GhResponseError)
    expect(() => mapThreadReply({ data: { addPullRequestReviewThreadReply: 5 } })).toThrow(GhResponseError)
    expect(() => mapThreadReply({ data: { addPullRequestReviewThreadReply: { comment: 5 } } })).toThrow(GhResponseError)
  })
})

describe('unwrapGraphql error entries', () => {
  it('rejects entries without a readable message', () => {
    expect(() => unwrapGraphql({ errors: [5] }, 'op')).toThrow('unknown GraphQL error')
    expect(() => unwrapGraphql({ errors: [{ message: 5 }] }, 'op')).toThrow('unknown GraphQL error')
  })

  it('rejects a non-object repository container in listings', () => {
    expect(() => mapPullRequestList({ data: { repository: { pullRequests: 5 } } }, REPO)).toThrow(GhResponseError)
  })

  it('rejects a non-object pullRequest container in thread summaries', () => {
    expect(() => mapThreadSummaries({ data: { repository: { pullRequest: 5 } } })).toThrow(GhResponseError)
  })
})
