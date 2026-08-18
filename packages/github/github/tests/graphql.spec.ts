/**
 * Pure mapper tests: every documented GraphQL response shape maps to frozen
 * domain values, and every misshape throws GhResponseError with the field
 * named. No subprocess is involved.
 */

import { describe, expect, it } from 'vitest'
import {
  GhResponseError,
  isNotFoundMessage,
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

const LIST_NODE = {
  number: 1, title: 't', state: 'OPEN', isDraft: false,
  author: { login: 'a' }, headRefName: 'h', baseRefName: 'b',
  updatedAt: '2026-01-01T00:00:00Z', reviewDecision: null, mergeable: 'MERGEABLE',
  statusCheckRollup: null,
}

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
      resolvedBy: null,
      comments: { totalCount: 1, nodes: [{ id: 'C_1', databaseId: 1, author: { login: 'a' }, createdAt: '2026-01-01T00:00:00Z', bodyText: 'b' }] },
    }],
  },
  commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
}

describe('unwrapGraphql', () => {
  it('returns data for a well-formed envelope', () => {
    expect(unwrapGraphql({ data: { repository: null } }, 'op')).toEqual({ repository: null })
  })

  it('surfaces GraphQL error messages', () => {
    expect(() => unwrapGraphql({ errors: [{ message: 'boom' }] }, 'op')).toThrow(GhResponseError)
    expect(() => unwrapGraphql({ errors: [{ message: 'boom' }] }, 'op')).toThrow('op: GraphQL error: boom')
  })

  it('rejects envelopes without data and non-object payloads', () => {
    expect(() => unwrapGraphql({}, 'op')).toThrow('op: response carries no data')
    expect(() => unwrapGraphql('nope', 'op')).toThrow('op: response is not an object')
  })
})

describe('isNotFoundMessage', () => {
  it('matches the documented absent-referent wordings', () => {
    expect(isNotFoundMessage('Could not resolve to a Repository with the name o/r.')).toBe(true)
    expect(isNotFoundMessage('HTTP 404')).toBe(true)
    expect(isNotFoundMessage('all good')).toBe(false)
  })
})

describe('mapPullRequestList', () => {
  it('maps summary rows including a null rollup', () => {
    const rows = mapPullRequestList({ data: { repository: { pullRequests: { nodes: [LIST_NODE] } } } }, REPO)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ number: 1, state: 'OPEN', checksState: null, author: 'a', repo: REPO })
  })

  it('rejects a null repository and misshapen nodes', () => {
    expect(() => mapPullRequestList({ data: { repository: null } }, REPO)).toThrow('repository is null')
    expect(() => mapPullRequestList({ data: { repository: { pullRequests: { nodes: 'x' } } } }, REPO))
      .toThrow('nodes is not an array')
    expect(() => mapPullRequestList({ data: { repository: { pullRequests: { nodes: [{ ...LIST_NODE, state: 'WEIRD' }] } } } }, REPO))
      .toThrow('unexpected state')
  })
})

describe('mapPullRequestDetail', () => {
  it('maps detail fields, thread counts, and empty checks', () => {
    const detail = mapPullRequestDetail({ data: { repository: { pullRequest: DETAIL_PR } } }, REPO)
    expect(detail.threadCounts).toEqual({ total: 1, unresolved: 1 })
    expect(detail.labels).toEqual(['l1'])
    expect(detail.checks).toEqual({ state: null, contexts: [] })
    expect(detail.reviewDecision).toBe('APPROVED')
  })

  it('rejects an absent pull request and unexpected check context types', () => {
    expect(() => mapPullRequestDetail({ data: { repository: { pullRequest: null } } }, REPO))
      .toThrow('pullRequest is null')
    const badContext = {
      ...DETAIL_PR,
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS', contexts: { nodes: [{ __typename: 'Mystery' }] } } } }] },
    }
    expect(() => mapPullRequestDetail({ data: { repository: { pullRequest: badContext } } }, REPO))
      .toThrow('unexpected check context type Mystery')
  })

  it('rejects unexpected mergeable and reviewDecision values', () => {
    expect(() => mapPullRequestDetail({ data: { repository: { pullRequest: { ...DETAIL_PR, mergeable: 'SOMETIMES' } } } }, REPO))
      .toThrow('unexpected mergeable')
    expect(() => mapPullRequestDetail({ data: { repository: { pullRequest: { ...DETAIL_PR, reviewDecision: 'MAYBE' } } } }, REPO))
      .toThrow('unexpected reviewDecision')
  })
})

describe('mapThreadSummaries', () => {
  it('maps thread rows from a detail response', () => {
    const threads = mapThreadSummaries({ data: { repository: { pullRequest: DETAIL_PR } } })
    expect(threads).toHaveLength(1)
    expect(threads[0]).toMatchObject({ id: 'PRRT_1', path: 'f.ts', line: 9, commentCount: 1 })
  })

  it('rejects misshapen thread connections', () => {
    const bad = { ...DETAIL_PR, reviewThreads: { totalCount: 1, nodes: [{ ...DETAIL_PR.reviewThreads.nodes[0], comments: 'x' }] } }
    expect(() => mapThreadSummaries({ data: { repository: { pullRequest: bad } } }))
      .toThrow('comments is not an object')
  })
})

describe('mapThreadFull', () => {
  const THREAD = {
    __typename: 'PullRequestReviewThread',
    id: 'PRRT_1', isResolved: true, isOutdated: false, path: 'f.ts', line: null,
    comments: { totalCount: 1, nodes: [{ id: 'C_1', databaseId: 1, author: { login: 'a' }, createdAt: '2026-01-01T00:00:00Z', bodyText: 'b' }] },
  }

  it('maps a complete thread with null line', () => {
    const full = mapThreadFull({ data: { node: THREAD } })
    expect(full.isResolved).toBe(true)
    expect(full.line).toBeNull()
    expect(full.comments[0]!.body).toBe('b')
  })

  it('rejects absent nodes and foreign types', () => {
    expect(() => mapThreadFull({ data: { node: null } })).toThrow('node is null')
    expect(() => mapThreadFull({ data: { node: { __typename: 'Issue' } } })).toThrow('not a PullRequestReviewThread')
  })
})

describe('mapCommitList', () => {
  const COMMITS = {
    totalCount: 1,
    nodes: [{ commit: { oid: 'abc', messageHeadline: 'm', authoredDate: '2026-01-01T00:00:00Z', author: { name: 'N', user: { login: 'a' } } } }],
  }

  it('maps commit rows', () => {
    const rows = mapCommitList({ data: { repository: { pullRequest: { commits: COMMITS } } } })
    expect(rows[0]).toMatchObject({ sha: 'abc', headline: 'm', authorLogin: 'a', authorName: 'N' })
  })

  it('rejects misshapen commit connections', () => {
    expect(() => mapCommitList({ data: { repository: { pullRequest: { commits: { nodes: 'x' } } } } }))
      .toThrow('nodes is not an array')
  })
})

describe('mutation mappers', () => {
  it('maps resolve and unresolve outcomes', () => {
    expect(mapThreadResolution({ data: { resolveReviewThread: { thread: { id: 't', isResolved: true } } } }, 'resolveReviewThread')).toBe(true)
    expect(mapThreadResolution({ data: { unresolveReviewThread: { thread: { id: 't', isResolved: false } } } }, 'unresolveReviewThread')).toBe(false)
  })

  it('maps the reply URL', () => {
    expect(mapThreadReply({ data: { addPullRequestReviewThreadReply: { comment: { id: 'c', url: 'u' } } } })).toBe('u')
  })

  it('rejects misshapen mutation payloads', () => {
    expect(() => mapThreadResolution({ data: {} }, 'resolveReviewThread')).toThrow('payload is not an object')
    expect(() => mapThreadReply({ data: { addPullRequestReviewThreadReply: { comment: { id: 'c' } } } }))
      .toThrow('url is not a string')
  })
})

describe('ghost authors', () => {
  it('substitutes ghost for a null author', () => {
    const rows = mapPullRequestList({ data: { repository: { pullRequests: { nodes: [{ ...LIST_NODE, author: null }] } } } }, REPO)
    expect(rows[0]!.author).toBe('ghost')
  })
})
