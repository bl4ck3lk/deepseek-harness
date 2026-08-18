/**
 * Integration tests: the REAL local subprocess service plus a deterministic
 * fixture `gh` executable, exercised through the complete service surface.
 * Covers every read mapping, every write gate and confirmation rule, the
 * enrichment gates, cache semantics, and the failure classification.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import GithubService from '../src/index.ts'
import type { GithubConfig, GithubPrDetail } from '../src/index.ts'
import { createFakeCheckout, createFixtureGh, createReportRoot, fixtureConfig } from './helpers.ts'
import type { FixtureGh } from './helpers.ts'

let ctx: Context
let fixture: FixtureGh
let reportRoot: { dir: string; dispose(): Promise<void> }

async function mount(config: Record<string, unknown>): Promise<void> {
  ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(GithubService, config as unknown as GithubConfig)
}

beforeEach(async () => {
  fixture = await createFixtureGh()
  reportRoot = await createReportRoot()
})

afterEach(async () => {
  await ctx.fiber.dispose()
  await fixture.dispose()
  await reportRoot.dispose()
})

describe('reads', () => {
  it('lists pull requests for an explicit repository', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.listPullRequests({ repo: 'fixture-owner/fixture-repo' })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.repo).toEqual({ owner: 'fixture-owner', name: 'fixture-repo' })
    expect(result.value.pullRequests).toHaveLength(1)
    const pr = result.value.pullRequests[0]!
    expect(pr.number).toBe(7)
    expect(pr.state).toBe('OPEN')
    expect(pr.reviewDecision).toBe('CHANGES_REQUESTED')
    expect(pr.checksState).toBe('FAILURE')
  })

  it('resolves the only configured favorite when no repo is given', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.listPullRequests({})
    expect(result.ok).toBe(true)
  })

  it('rejects a missing repo when multiple favorites are configured', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, {
      favorites: ['fixture-owner/fixture-repo', 'fixture-owner/other-repo'],
    }))
    const result = await ctx.github.listPullRequests({})
    expect(result).toMatchObject({ ok: false, error: { code: 'no-repo-configured' } })
  })

  it('rejects a malformed repository reference', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.listPullRequests({ repo: 'not a repo' })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-repo' } })
  })

  it('classifies transport failures as gh-failed with a stderr tail', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.listPullRequests({ repo: 'broken/repo' })
    expect(result).toMatchObject({ ok: false, error: { code: 'gh-failed' } })
    if (!result.ok) expect(result.error.detail).toContain('transport failure')
  })

  it('classifies absent repositories as not-found', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.getPullRequest({ repo: 'missing/anything', number: 1 })
    expect(result).toMatchObject({ ok: false, error: { code: 'not-found' } })
  })

  it('maps pull-request detail with labels, thread counts, and check contexts', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.getPullRequest({ repo: 'fixture-owner/fixture-repo', number: 7 })
    if (!result.ok) throw new Error(result.error.message)
    const detail: GithubPrDetail = result.value
    expect(detail.nodeId).toBe('PR_fixture')
    expect(detail.labels).toEqual(['kind/feat', 'area/github'])
    expect(detail.threadCounts).toEqual({ total: 2, unresolved: 1 })
    expect(detail.checks.state).toBe('FAILURE')
    expect(detail.checks.contexts).toEqual([
      { kind: 'check-run', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', url: 'https://example.test/lint' },
      { kind: 'status', name: 'ci/build', status: 'SUCCESS', conclusion: null, url: 'https://example.test/build' },
    ])
  })

  it('lists threads with the unresolved default filter', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.listThreads({ repo: 'fixture-owner/fixture-repo', number: 7 })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.filter).toBe('unresolved')
    expect(result.value.threads).toHaveLength(1)
    const thread = result.value.threads[0]!
    expect(thread.id).toBe('PRRT_unresolved')
    expect(thread.path).toBe('src/a.ts')
    expect(thread.line).toBe(4)
    expect(thread.commentCount).toBe(2)
    expect(thread.firstComment?.author).toBe('reviewer')
  })

  it('lists threads with resolved and all filters', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const resolved = await ctx.github.listThreads({ repo: 'fixture-owner/fixture-repo', number: 7, filter: 'resolved' })
    if (!resolved.ok) throw new Error(resolved.error.message)
    expect(resolved.value.threads.map(thread => thread.id)).toEqual(['PRRT_resolved'])
    expect(resolved.value.threads[0]!.resolvedBy).toBe('fixture-author')
    expect(resolved.value.threads[0]!.line).toBeNull()
    const all = await ctx.github.listThreads({ repo: 'fixture-owner/fixture-repo', number: 7, filter: 'all' })
    if (!all.ok) throw new Error(all.error.message)
    expect(all.value.threads).toHaveLength(2)
  })

  it('reads one complete thread by id', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.getThread({ threadId: 'PRRT_unresolved' as never })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.comments).toHaveLength(2)
    expect(result.value.comments[1]!.body).toBe('reply comment')
  })

  it('lists commits with total count', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.listCommits({ repo: 'fixture-owner/fixture-repo', number: 7 })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.totalCount).toBe(5)
    expect(result.value.commits[0]!.sha).toBe('aaa111')
    expect(result.value.commits[0]!.authorLogin).toBe('fixture-author')
    expect(result.value.commits[1]!.authorLogin).toBeNull()
    expect(result.value.commits[1]!.authorName).toBeNull()
  })
})

describe('bulk context through the fixture pr-enrich', () => {
  it('collects a context digest without enrichment', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const checkout = await createFakeCheckout()
    try {
      const result = await ctx.github.getContext({ repo: 'fixture-owner/fixture-repo', number: 7, repoPath: checkout.dir })
      if (!result.ok) throw new Error(result.error.message)
      expect(result.value.commentCount).toBe(3)
      expect(result.value.threadCounts).toEqual({ total: 2, unresolved: 1 })
      expect(result.value.checks.overallState).toBe('failure')
      expect(result.value.enriched).toBe(false)
      expect(existsSync(result.value.files.combined)).toBe(true)
      expect(result.value.reportDir.startsWith(reportRoot.dir)).toBe(true)
    } finally {
      await checkout.dispose()
    }
  })

  it('marks the digest enriched when analysis output exists', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { allowEnrich: true }))
    const checkout = await createFakeCheckout()
    try {
      const result = await ctx.github.getContext({
        repo: 'fixture-owner/fixture-repo',
        number: 7,
        repoPath: checkout.dir,
        enrich: true,
        confirmExport: true,
      })
      if (!result.ok) throw new Error(result.error.message)
      expect(result.value.enriched).toBe(true)
    } finally {
      await checkout.dispose()
    }
  })

  it('rejects enrichment disabled by configuration', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.getContext({ repo: 'fixture-owner/fixture-repo', number: 7, enrich: true, confirmExport: true })
    expect(result).toMatchObject({ ok: false, error: { code: 'enrich-disabled' } })
  })

  it('rejects enrichment without explicit export consent', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { allowEnrich: true }))
    const result = await ctx.github.getContext({ repo: 'fixture-owner/fixture-repo', number: 7, enrich: true })
    expect(result).toMatchObject({ ok: false, error: { code: 'confirmation-required' } })
  })

  it('classifies a failed collection as enrich-failed', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { childEnv: { GH_FIXTURE_ENRICH_FAIL: '1' } }))
    const result = await ctx.github.getContext({ repo: 'fixture-owner/fixture-repo', number: 7 })
    expect(result).toMatchObject({ ok: false, error: { code: 'enrich-failed' } })
  })
})

describe('writes', () => {
  it('creates an issue comment', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.addComment({ repo: 'fixture-owner/fixture-repo', number: 7, body: 'hello' })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.url).toBe('https://example.test/issuecomment-1')
  })

  it('replies inside a thread', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.replyToThread({ threadId: 'PRRT_unresolved' as never, body: 'reply' })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.url).toBe('https://example.test/reply')
  })

  it('resolves and unresolves threads', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const resolved = await ctx.github.setThreadResolved({ threadId: 'PRRT_unresolved' as never, resolved: true })
    expect(resolved).toMatchObject({ ok: true, value: { isResolved: true } })
    const unresolved = await ctx.github.setThreadResolved({ threadId: 'PRRT_unresolved' as never, resolved: false })
    expect(unresolved).toMatchObject({ ok: true, value: { isResolved: false } })
  })

  it('submits a comment review with confirmation', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.submitReview({
      repo: 'fixture-owner/fixture-repo', number: 7, event: 'comment', body: 'looks fine', confirm: true,
    })
    expect(result).toMatchObject({ ok: true, value: { event: 'comment' } })
  })

  it('requires confirmation for reviews', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.submitReview({ repo: 'fixture-owner/fixture-repo', number: 7, event: 'comment' })
    expect(result).toMatchObject({ ok: false, error: { code: 'confirmation-required' } })
  })

  it('surfaces the self-review prohibition as a domain outcome', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.submitReview({
      repo: 'selfowner/fixture-repo', number: 7, event: 'approve', confirm: true,
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'self-review-forbidden' } })
  })

  it('merges with confirmation and delete-branch', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.mergePullRequest({
      repo: 'fixture-owner/fixture-repo', number: 7, method: 'squash', deleteBranch: true, confirm: true,
    })
    expect(result).toMatchObject({ ok: true, value: { method: 'squash' } })
  })

  it('requires confirmation for merges and closes', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const merge = await ctx.github.mergePullRequest({ repo: 'fixture-owner/fixture-repo', number: 7, method: 'squash' })
    expect(merge).toMatchObject({ ok: false, error: { code: 'confirmation-required' } })
    const close = await ctx.github.closePullRequest({ repo: 'fixture-owner/fixture-repo', number: 7 })
    expect(close).toMatchObject({ ok: false, error: { code: 'confirmation-required' } })
  })

  it('closes and reopens', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const closed = await ctx.github.closePullRequest({ repo: 'fixture-owner/fixture-repo', number: 7, confirm: true })
    expect(closed).toMatchObject({ ok: true, value: { state: 'CLOSED' } })
    const reopened = await ctx.github.reopenPullRequest({ repo: 'fixture-owner/fixture-repo', number: 7 })
    expect(reopened).toMatchObject({ ok: true, value: { state: 'OPEN' } })
  })

  it('blocks every write when allowWrites is false', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { allowWrites: false }))
    const repo = 'fixture-owner/fixture-repo'
    const outcomes = await Promise.all([
      ctx.github.addComment({ repo, number: 7, body: 'x' }),
      ctx.github.replyToThread({ threadId: 'PRRT_unresolved' as never, body: 'x' }),
      ctx.github.setThreadResolved({ threadId: 'PRRT_unresolved' as never, resolved: true }),
      ctx.github.submitReview({ repo, number: 7, event: 'comment', confirm: true }),
      ctx.github.mergePullRequest({ repo, number: 7, method: 'squash', confirm: true }),
      ctx.github.closePullRequest({ repo, number: 7, confirm: true }),
      ctx.github.reopenPullRequest({ repo, number: 7 }),
    ])
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({ ok: false, error: { code: 'writes-disabled' } })
    }
  })
})

describe('cache and deadline semantics', () => {
  it('serves repeated reads from the cache and invalidates on writes', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { cacheTtlMs: 60_000 }))
    const first = await ctx.github.listPullRequests({ repo: 'fixture-owner/fixture-repo' })
    const second = await ctx.github.listPullRequests({ repo: 'fixture-owner/fixture-repo' })
    if (!first.ok || !second.ok) throw new Error('expected cacheable reads to succeed')
    expect(second.value).toBe(first.value)
    await ctx.github.addComment({ repo: 'fixture-owner/fixture-repo', number: 7, body: 'invalidate' })
    const third = await ctx.github.listPullRequests({ repo: 'fixture-owner/fixture-repo' })
    if (!third.ok) throw new Error('expected post-write read to succeed')
    expect(third.value).not.toBe(first.value)
  })

  it('classifies deadline expiry as aborted', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, {
      timeoutMs: 60,
      childEnv: { GH_FIXTURE_SLEEP_MS: '800' },
    }))
    const result = await ctx.github.listPullRequests({ repo: 'fixture-owner/fixture-repo' })
    expect(result).toMatchObject({ ok: false, error: { code: 'aborted' } })
  })

  it('classifies oversized output as output-overflow', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, {
      maxOutputBytes: 65_536,
      childEnv: { GH_FIXTURE_BIG: '1' },
    }))
    const result = await ctx.github.listPullRequests({ repo: 'fixture-owner/fixture-repo' })
    expect(result).toMatchObject({ ok: false, error: { code: 'output-overflow' } })
  })
})

describe('activation', () => {
  it('fails activation when the gh executable does not resolve', async () => {
    ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    await expect(ctx.plugin(GithubService, fixtureConfig(join(fixture.dir, 'no-such-gh'), reportRoot.dir) as unknown as GithubConfig))
      .rejects.toThrow(/could not be resolved/)
  })
})

describe('configuration surface', () => {
  it('exposes the configured favorites and a frozen config snapshot', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { favorites: ['a/b', 'c/d'] }))
    expect(ctx.github.favoriteRepos).toEqual([{ owner: 'a', name: 'b' }, { owner: 'c', name: 'd' }])
    const snapshot = ctx.github.githubConfig
    expect(snapshot.ghPath).toBe(fixture.ghPath)
    expect(snapshot.allowWrites).toBe(true)
    expect(snapshot.allowEnrich).toBe(false)
  })

  it('rejects a missing repo with a distinct message when no favorites exist', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { favorites: [] }))
    const result = await ctx.github.listPullRequests({})
    expect(result).toMatchObject({ ok: false, error: { code: 'no-repo-configured' } })
    if (!result.ok) expect(result.error.message).toContain('no favorites configured')
  })
})

describe('cache expiry', () => {
  it('drops entries whose TTL has elapsed', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { cacheTtlMs: 10 }))
    const first = await ctx.github.listPullRequests({ repo: 'fixture-owner/fixture-repo' })
    await new Promise(resolve => setTimeout(resolve, 30))
    const second = await ctx.github.listPullRequests({ repo: 'fixture-owner/fixture-repo' })
    if (!first.ok || !second.ok) throw new Error('expected reads to succeed')
    expect(second.value).not.toBe(first.value)
  })
})

describe('remaining read variants', () => {
  it('passes the state filter through to the listing', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.listPullRequests({ repo: 'fixture-owner/fixture-repo', state: 'MERGED' })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.pullRequests).toHaveLength(1)
  })

  it('falls back to the node count when totalCount is absent', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { childEnv: { GH_FIXTURE_NO_TOTAL: '1' } }))
    const result = await ctx.github.listCommits({ repo: 'fixture-owner/fixture-repo', number: 7 })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.totalCount).toBe(2)
    expect(result.value.commits).toHaveLength(2)
  })

  it('clips very long stderr tails in the failure detail', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.listPullRequests({ repo: 'longerr/repo' })
    expect(result).toMatchObject({ ok: false, error: { code: 'gh-failed' } })
    if (!result.ok) expect(result.error.detail?.length).toBeLessThanOrEqual(2000)
  })
})

describe('remaining write variants', () => {
  it('merges with merge and rebase methods', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const merged = await ctx.github.mergePullRequest({ repo: 'fixture-owner/fixture-repo', number: 7, method: 'merge', confirm: true })
    expect(merged).toMatchObject({ ok: true, value: { method: 'merge' } })
    const rebased = await ctx.github.mergePullRequest({ repo: 'fixture-owner/fixture-repo', number: 7, method: 'rebase', confirm: true })
    expect(rebased).toMatchObject({ ok: true, value: { method: 'rebase' } })
  })
})

describe('context digest robustness', () => {
  it('classifies a missing combined-data.json as enrich-failed', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { childEnv: { GH_FIXTURE_NO_COMBINED: '1' } }))
    const result = await ctx.github.getContext({ repo: 'fixture-owner/fixture-repo', number: 7 })
    expect(result).toMatchObject({ ok: false, error: { code: 'enrich-failed' } })
  })

  it('applies digest defaults when combined-data.json sections are absent', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { childEnv: { GH_FIXTURE_BAD_COMBINED: '1' } }))
    const result = await ctx.github.getContext({ repo: 'fixture-owner/fixture-repo', number: 7 })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.commentCount).toBe(0)
    expect(result.value.threadCounts).toEqual({ total: 0, unresolved: 0 })
    expect(result.value.checks.overallState).toBe('unknown')
    expect(result.value.generatedAt).toBe('')
  })
})

describe('resolve failures on every method', () => {
  it('classifies malformed repos on reads, threads, commits, and context', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const detail = await ctx.github.getPullRequest({ repo: 'not a repo', number: 1 })
    expect(detail).toMatchObject({ ok: false, error: { code: 'invalid-repo' } })
    const threads = await ctx.github.listThreads({ repo: 'not a repo', number: 1 })
    expect(threads).toMatchObject({ ok: false, error: { code: 'invalid-repo' } })
    const commits = await ctx.github.listCommits({ repo: 'not a repo', number: 1 })
    expect(commits).toMatchObject({ ok: false, error: { code: 'invalid-repo' } })
    const context = await ctx.github.getContext({ repo: 'not a repo', number: 1 })
    expect(context).toMatchObject({ ok: false, error: { code: 'invalid-repo' } })
  })
})

describe('response classification through the service', () => {
  it('classifies a mapper failure as invalid-response', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { childEnv: { GH_FIXTURE_BAD_DETAIL: '1' } }))
    const result = await ctx.github.getPullRequest({ repo: 'fixture-owner/fixture-repo', number: 7 })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-response' } })
  })

  it('classifies unparsable gh JSON as invalid-response', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { childEnv: { GH_FIXTURE_BAD_JSON: '1' } }))
    const result = await ctx.github.listPullRequests({ repo: 'fixture-owner/fixture-repo' })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-response' } })
  })

  it('classifies missing report files as enrich-failed', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { childEnv: { GH_FIXTURE_EMPTY_SUCCESS: '1' } }))
    const result = await ctx.github.getContext({ repo: 'fixture-owner/fixture-repo', number: 7 })
    expect(result).toMatchObject({ ok: false, error: { code: 'enrich-failed' } })
  })
})

describe('context digest partial thread shapes', () => {
  it.each(['2', '3', '4', '5'])('returns zero thread counts for shape %s', async (shape) => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { childEnv: { GH_FIXTURE_THREAD_SHAPE: shape } }))
    const result = await ctx.github.getContext({ repo: 'fixture-owner/fixture-repo', number: 7 })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.threadCounts).toEqual({ total: 0, unresolved: 0 })
  })
})

describe('request-changes review', () => {
  it('passes the request-changes flag', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await ctx.github.submitReview({
      repo: 'fixture-owner/fixture-repo', number: 7, event: 'request-changes', body: 'needs work', confirm: true,
    })
    expect(result).toMatchObject({ ok: true, value: { event: 'request-changes' } })
  })
})
