/**
 * Integration tests: the REAL local subprocess service, the REAL
 * `@deepseek-ai/dsh-github` gateway over a deterministic fixture `gh`
 * executable, and the complete `gh_pr_*` tool surface, exercised through
 * `ctx.tools.execute()`. Covers registration, every read and write tool's
 * happy path, the typed error bridge (service rejection codes surface as
 * `GithubToolError` outcomes), the confirmation gates, and the
 * `presentationMeta` card contract.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import GithubService from '@deepseek-ai/dsh-github'
import type { GithubConfig } from '@deepseek-ai/dsh-github'
import * as ToolGithub from '../src/index.ts'
import { createFixtureGh, createReportRoot, fixtureConfig } from './helpers.ts'
import type { FixtureGh } from './helpers.ts'

const testToolSignal = new AbortController().signal

let ctx: Context
let fixture: FixtureGh
let reportRoot: { dir: string; dispose(): Promise<void> }

let callCounter = 0
function call(name: string, args: unknown) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`it-${++callCounter}`),
    name,
    arguments: args,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
}

async function mount(config: Record<string, unknown>, childEnv: Record<string, string> = {}): Promise<void> {
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(GithubService, { ...config, childEnv } as unknown as GithubConfig)
  await ctx.plugin(ToolGithub)
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

describe('registration', () => {
  it('registers all twelve gh_pr_* tools', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toEqual([
      'gh_pr_list',
      'gh_pr_view',
      'gh_pr_threads',
      'gh_pr_thread',
      'gh_pr_commits',
      'gh_pr_context',
      'gh_pr_comment',
      'gh_pr_reply',
      'gh_pr_thread_resolve',
      'gh_pr_review',
      'gh_pr_merge',
      'gh_pr_close',
    ])
  })

  it('publishes the tool:github system prompt section', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const assembled = renderPrompt(await ctx.systemPrompt.assemble())
    expect(assembled).toContain('Use the gh_pr_* tools')
  })
})

describe('read tools', () => {
  it('lists pull requests through the favorite repository default', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_list', {})
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('#7')
    expect(result.meta).toMatchObject({ kind: 'github.pr-list' })
  })

  it('surfaces a missing favorite default as a typed no-repo-configured error', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { favorites: [] }))
    const result = await call('gh_pr_list', {})
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { name: 'GithubToolError', code: 'no-repo-configured' } })
  })

  it('views one pull request with an explicit repository', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_view', { repo: 'fixture-owner/fixture-repo', number: 7 })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('PR #7 OPEN')
    expect(text(result)).toContain('threads: 1 unresolved of 2 total')
    expect(result.meta).toMatchObject({ kind: 'github.pr-detail' })
  })

  it('lists unresolved review threads by default', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_threads', { repo: 'fixture-owner/fixture-repo', number: 7 })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('PRRT_unresolved')
    expect(text(result)).not.toContain('PRRT_resolved')
    expect(result.meta).toMatchObject({ kind: 'github.thread-list' })
  })

  it('reads one complete review thread', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_thread', { threadId: 'PRRT_unresolved' })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('Thread PRRT_unresolved')
    expect(text(result)).toContain('fixture-author')
    expect(result.meta).toMatchObject({ kind: 'github.thread-full' })
  })

  it('lists commits with the real total count', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_commits', { repo: 'fixture-owner/fixture-repo', number: 7 })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('(5 total, 2 shown)')
    expect(result.meta).toMatchObject({ kind: 'github.commit-list' })
  })

  it('collects a plain context digest without enrichment', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_context', { repo: 'fixture-owner/fixture-repo', number: 7, repoPath: reportRoot.dir })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('context digest')
    expect(text(result)).toContain('combined-data.json')
    expect(result.meta).toMatchObject({ kind: 'github.context-digest' })
  })

  it('surfaces the enrichment gate as a typed enrich-disabled error', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { allowEnrich: false }))
    const result = await call('gh_pr_context', { repo: 'fixture-owner/fixture-repo', number: 7, enrich: true, confirmExport: true })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'enrich-disabled' } })
  })

  it('surfaces the export consent gate as a typed confirmation-required error', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { allowEnrich: true }))
    const result = await call('gh_pr_context', { repo: 'fixture-owner/fixture-repo', number: 7, enrich: true })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'confirmation-required' } })
  })
})

describe('write tools', () => {
  it('creates an issue comment', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_comment', { repo: 'fixture-owner/fixture-repo', number: 7, body: 'looks good' })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('Comment created on PR #7')
    expect(result.meta).toMatchObject({ kind: 'github.comment-created' })
  })

  it('replies inside a review thread', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_reply', { threadId: 'PRRT_unresolved', body: 'fixed in the next push' })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('Reply posted inside thread PRRT_unresolved')
    expect(result.meta).toMatchObject({ kind: 'github.thread-reply' })
  })

  it('resolves and unresolves a review thread', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const resolved = await call('gh_pr_thread_resolve', { threadId: 'PRRT_unresolved', resolved: true })
    expect(resolved.isError).toBe(false)
    expect(text(resolved)).toContain('now resolved')
    const unresolved = await call('gh_pr_thread_resolve', { threadId: 'PRRT_unresolved', resolved: false })
    expect(text(unresolved)).toContain('now unresolved')
    expect(resolved.meta).toMatchObject({ kind: 'github.thread-resolution' })
  })

  it('rejects a review without confirmation as a typed error', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_review', { repo: 'fixture-owner/fixture-repo', number: 7, event: 'approve', confirm: false })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'confirmation-required' } })
  })

  it('submits a confirmed review', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_review', { repo: 'fixture-owner/fixture-repo', number: 7, event: 'comment', body: 'nice', confirm: true })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('Review (comment) submitted')
    expect(result.meta).toMatchObject({ kind: 'github.review-submitted' })
  })

  it('classifies a self-review rejection as a typed error', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_review', { repo: 'selfowner/repo', number: 7, event: 'approve', confirm: true })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'self-review-forbidden' } })
  })

  it('rejects a merge without confirmation as a typed error', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_merge', { repo: 'fixture-owner/fixture-repo', number: 7, method: 'squash', confirm: false })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'confirmation-required' } })
  })

  it('merges a confirmed pull request', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_merge', {
      repo: 'fixture-owner/fixture-repo',
      number: 7,
      method: 'squash',
      deleteBranch: true,
      confirm: true,
    })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('merged via squash; head branch deleted')
    expect(result.meta).toMatchObject({ kind: 'github.merged' })
  })

  it('closes a confirmed pull request', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_close', { repo: 'fixture-owner/fixture-repo', number: 7, confirm: true })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('closed')
    expect(result.meta).toMatchObject({ kind: 'github.state-change' })
  })

  it('surfaces a write-disabled deployment as a typed error', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir, { allowWrites: false }))
    const result = await call('gh_pr_comment', { repo: 'fixture-owner/fixture-repo', number: 7, body: 'blocked' })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'writes-disabled' } })
  })
})

describe('optional-parameter spreads', () => {
  it('passes listing filters when provided', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_list', { repo: 'fixture-owner/fixture-repo', state: 'OPEN', first: 5 })
    expect(result.isError).toBe(false)
  })

  it('omits the repository for a detail view', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_view', { number: 7 })
    expect(result.isError).toBe(false)
  })

  it('omits the repository and passes an explicit thread filter', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_threads', { number: 7, filter: 'all' })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('PRRT_resolved')
  })

  it('omits the repository and passes a commit cap', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_commits', { number: 7, first: 1 })
    expect(result.isError).toBe(false)
  })

  it('omits the repository for a context digest', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_context', { number: 7, repoPath: reportRoot.dir })
    expect(result.isError).toBe(false)
  })

  it('omits the repository for a comment', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_comment', { number: 7, body: 'favorite-targeted comment' })
    expect(result.isError).toBe(false)
  })

  it('omits the repository and the optional body for a review', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_review', { number: 7, event: 'comment', confirm: true })
    expect(result.isError).toBe(false)
  })

  it('omits the repository and the branch deletion for a merge', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_merge', { number: 7, method: 'merge', confirm: true })
    expect(result.isError).toBe(false)
    expect(text(result)).not.toContain('head branch deleted')
  })

  it('omits the repository for a close', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_close', { number: 7, confirm: true })
    expect(result.isError).toBe(false)
  })
})

describe('typed failure bridge', () => {
  it('keeps the service code and detail on transport failures', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_view', { repo: 'broken/repo', number: 7 })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { name: 'GithubToolError', code: 'gh-failed' } })
    expect(text(result)).toContain('transport failure')
  })

  it('classifies an absent repository as not-found', async () => {
    await mount(fixtureConfig(fixture.ghPath, reportRoot.dir))
    const result = await call('gh_pr_view', { repo: 'missing/repo', number: 7 })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'not-found' } })
  })
})
