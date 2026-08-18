/**
 * Branch-complete unit tests for the pure model-facing renderers. Every
 * conditional in render.ts runs with both operand shapes.
 */

import { describe, expect, it } from 'vitest'
import type {
  GithubContextDigest,
  GithubPrDetail,
  GithubPullRequestMergedValue,
  GithubPullRequestStateValue,
  GithubReviewSubmittedValue,
  GithubThreadResolutionValue,
  GithubThreadId,
  GithubCommentCreatedValue,
  GithubCommitSha,
  GithubPrSummary,
  GithubRepoRef,
} from '@deepseek-ai/dsh-github'
import {
  renderCommitList,
  renderCommentCreated,
  renderContextDigest,
  renderMerged,
  renderPrDetail,
  renderPrList,
  renderReviewSubmitted,
  renderStateChange,
  renderThreadFull,
  renderThreadList,
  renderThreadReply,
  renderThreadResolution,
} from '../src/render.ts'

const repo: GithubRepoRef = { owner: 'owner', name: 'repo' }
const threadId = (value: string): GithubThreadId => value as GithubThreadId
const sha = (value: string): GithubCommitSha => value as GithubCommitSha

function summary(overrides: Partial<GithubPrSummary> = {}): GithubPrSummary {
  return {
    repo,
    number: 7,
    title: 'fixture',
    state: 'OPEN',
    isDraft: false,
    author: 'author',
    headRef: 'feature',
    baseRef: 'master',
    updatedAt: '2026-01-01T00:00:00Z',
    mergeable: 'MERGEABLE',
    reviewDecision: 'APPROVED',
    checksState: 'SUCCESS',
    ...overrides,
  }
}

function detail(overrides: Partial<GithubPrDetail> = {}): GithubPrDetail {
  return {
    ...summary(),
    nodeId: 'PR_7',
    bodyText: 'the body',
    additions: 3,
    deletions: 1,
    changedFiles: 2,
    createdAt: '2026-01-01T00:00:00Z',
    labels: [],
    threadCounts: { total: 2, unresolved: 1 },
    checks: { state: 'SUCCESS', contexts: [] },
    ...overrides,
  }
}

describe('renderPrList', () => {
  it('reports an empty listing', () => {
    expect(renderPrList({ repo, pullRequests: [] })).toBe('No pull requests in owner/repo.')
  })

  it('marks null checks, null review decision, and drafts', () => {
    const text = renderPrList({
      repo,
      pullRequests: [summary({ checksState: null, reviewDecision: null }), summary({ number: 8, isDraft: true })],
    })
    expect(text).toContain('checks:?')
    expect(text).toContain('#7 OPEN fixture — by author, feature→master, checks:?, updated')
    expect(text).toContain('#8 OPEN [draft] fixture')
    expect(text).toContain('review:APPROVED')
  })
})

describe('renderPrDetail', () => {
  it('renders labels, check contexts with conclusions and urls, and the body', () => {
    const text = renderPrDetail(detail({
      labels: ['bug', 'p1'],
      checks: {
        state: 'FAILURE',
        contexts: [{ kind: 'check-run', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', url: 'https://example.test/lint' }],
      },
    }))
    expect(text).toContain('labels: bug, p1')
    expect(text).toContain('- lint: COMPLETED/FAILURE (https://example.test/lint)')
    expect(text).toContain('\nthe body')
  })

  it('handles absent labels, empty checks, null conclusion and url, null review decision, empty body, and drafts', () => {
    const text = renderPrDetail(detail({
      isDraft: true,
      reviewDecision: null,
      bodyText: '',
      checks: {
        state: null,
        contexts: [{ kind: 'status', name: 'ci', status: 'PENDING', conclusion: null, url: null }],
      },
    }))
    expect(text).not.toContain('labels:')
    expect(text).toContain('checks (unknown):')
    expect(text).toContain('- ci: PENDING')
    expect(text).not.toContain('(http')
    expect(text).not.toContain('the body')
    expect(text).toContain('reviewDecision: none')
  })

  it('reports a fully empty check context list', () => {
    const text = renderPrDetail(detail())
    expect(text).toContain('(no check contexts)')
  })
})

describe('renderThreadList', () => {
  it('reports an empty listing', () => {
    expect(renderThreadList({ repo, number: 7, filter: 'unresolved', threads: [] }))
      .toBe('No unresolved review threads on PR #7.')
  })

  it('renders locations, resolution variants, outdated markers, and absent first comments', () => {
    const text = renderThreadList({
      repo,
      number: 7,
      filter: 'all',
      threads: [
        {
          id: threadId('PRRT_a'),
          path: 'src/a.ts',
          line: 4,
          isResolved: true,
          isOutdated: true,
          commentCount: 2,
          resolvedBy: 'reviewer',
          firstComment: { id: 'C_1', databaseId: 1, author: 'author', createdAt: '2026-01-01T00:00:00Z', body: 'first' },
        },
        {
          id: threadId('PRRT_b'),
          path: 'src/b.ts',
          line: null,
          isResolved: true,
          isOutdated: false,
          commentCount: 1,
          resolvedBy: null,
          firstComment: null,
        },
        {
          id: threadId('PRRT_c'),
          path: 'src/c.ts',
          line: 9,
          isResolved: false,
          isOutdated: false,
          commentCount: 1,
          resolvedBy: null,
          firstComment: null,
        },
      ],
    })
    expect(text).toContain('PRRT_a src/a.ts:4 [resolved by reviewer, outdated, 2 comment(s)] — author: first')
    expect(text).toContain('PRRT_b src/b.ts [resolved, 1 comment(s)]')
    expect(text).toContain('PRRT_c src/c.ts:9 [unresolved, 1 comment(s)]')
  })
})

describe('renderThreadFull', () => {
  it('renders a file-level thread without a line', () => {
    const text = renderThreadFull({
      id: threadId('PRRT_x'),
      path: 'README.md',
      line: null,
      isResolved: false,
      comments: [{ id: 'C_1', databaseId: 1, author: 'author', createdAt: '2026-01-01T00:00:00Z', body: 'note' }],
    })
    expect(text).toContain('Thread PRRT_x at README.md [unresolved]')
    expect(text).toContain('author (2026-01-01T00:00:00Z): note')
  })

  it('renders a resolved thread header', () => {
    const text = renderThreadFull({
      id: threadId('PRRT_y'),
      path: 'src/y.ts',
      line: 2,
      isResolved: true,
      comments: [],
    })
    expect(text).toContain('Thread PRRT_y at src/y.ts:2 [resolved], 0 comment(s):')
  })
})

describe('renderCommitList', () => {
  it('reports an empty listing', () => {
    expect(renderCommitList({ repo, number: 7, totalCount: 0, commits: [] })).toBe('No commits returned for PR #7.')
  })

  it('falls back from login to name to unknown', () => {
    const text = renderCommitList({
      repo,
      number: 7,
      totalCount: 3,
      commits: [
        { sha: sha('aaa111aaa111'), headline: 'feat: a', authorLogin: 'login', authorName: 'Name', authoredDate: '2026-01-01T00:00:00Z' },
        { sha: sha('bbb222bbb222'), headline: 'fix: b', authorLogin: null, authorName: 'Only Name', authoredDate: '2026-01-01T00:00:00Z' },
        { sha: sha('ccc333ccc333'), headline: 'chore: c', authorLogin: null, authorName: null, authoredDate: '2026-01-01T00:00:00Z' },
      ],
    })
    expect(text).toContain('aaa111aaa1 feat: a — login')
    expect(text).toContain('bbb222bbb2 fix: b — Only Name')
    expect(text).toContain('ccc333ccc3 chore: c — unknown')
    expect(text).toContain('(3 total, 3 shown)')
  })
})

describe('renderContextDigest', () => {
  const digest = (enriched: boolean): GithubContextDigest => ({
    repo,
    number: 7,
    generatedAt: '2026-01-02T03:04:05Z',
    reportDir: '/tmp/report',
    commentCount: 3,
    threadCounts: { total: 2, unresolved: 1 },
    checks: { total: 2, passing: 1, failing: 1, pending: 0, overallState: 'FAILURE' },
    enriched,
    files: { combined: '/tmp/report/combined-data.json', report: '/tmp/report/comprehensive-report.md', threads: '/tmp/report/comment-threads.json' },
  })

  it('marks enriched digests', () => {
    expect(renderContextDigest(digest(true))).toContain('(enriched)')
  })

  it('omits the enrichment mark for plain digests', () => {
    expect(renderContextDigest(digest(false))).not.toContain('(enriched)')
  })
})

describe('write confirmations', () => {
  const created: GithubCommentCreatedValue = { url: 'https://example.test/c/1' }

  it('renders comment and reply confirmations', () => {
    expect(renderCommentCreated(created, 'owner/repo', 7)).toBe('Comment created on PR #7 of owner/repo: https://example.test/c/1')
    expect(renderThreadReply(created, 'PRRT_a')).toContain('Reply posted inside thread PRRT_a')
  })

  it('renders resolution outcomes', () => {
    const base: GithubThreadResolutionValue = { threadId: threadId('PRRT_a'), isResolved: true }
    expect(renderThreadResolution(base)).toBe('Thread PRRT_a is now resolved.')
    expect(renderThreadResolution({ ...base, isResolved: false })).toBe('Thread PRRT_a is now unresolved.')
  })

  it('renders review submissions', () => {
    const value: GithubReviewSubmittedValue = { repo, number: 7, event: 'approve' }
    expect(renderReviewSubmitted(value)).toBe('Review (approve) submitted on PR #7 of owner/repo.')
  })

  it('renders merge confirmations with and without branch deletion', () => {
    const value: GithubPullRequestMergedValue = { repo, number: 7, method: 'squash' }
    expect(renderMerged(value, true)).toContain('; head branch deleted')
    expect(renderMerged(value, false)).not.toContain('; head branch deleted')
  })

  it('renders close and reopen confirmations', () => {
    const closed: GithubPullRequestStateValue = { repo, number: 7, state: 'CLOSED' }
    expect(renderStateChange(closed)).toContain('closed')
    expect(renderStateChange({ ...closed, state: 'OPEN' })).toContain('reopened')
  })
})
