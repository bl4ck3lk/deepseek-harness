/**
 * Live e2e against real GitHub through the installed `gh` CLI, gated on
 * `GH_TOKEN`: the suite self-skips everywhere the token is absent (local
 * keychain auth does not count — CI carries the token, so this exercises the
 * same environment class deployments run in). Read-only: writes stay disabled
 * in this config, so a green run cannot mutate any repository.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import GithubService from '../src/index.ts'
import type { GithubConfig } from '../src/index.ts'

const LIVE_REPO = 'deepseek-ai/deepseek-harness'

describe.skipIf(process.env.GH_TOKEN === undefined)('github service against live GitHub (GH_TOKEN)', () => {
  let ctx: Context

  async function mount(): Promise<void> {
    ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    const config = {
      ghPath: 'gh',
      favorites: [LIVE_REPO],
      cacheTtlMs: 0,
      allowWrites: false,
      allowEnrich: false,
      childEnv: { GH_TOKEN: process.env.GH_TOKEN as string },
    }
    await ctx.plugin(GithubService, config as unknown as GithubConfig)
  }

  it('lists open pull requests of the harness repository', async () => {
    await mount()
    const result = await ctx.github.listPullRequests({ state: 'OPEN', first: 5 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.repo).toEqual({ owner: 'deepseek-ai', name: 'deepseek-harness' })
    for (const pr of result.value.pullRequests) {
      expect(pr.state).toBe('OPEN')
      expect(pr.number).toBeGreaterThan(0)
      expect(pr.title.length).toBeGreaterThan(0)
    }
    await ctx.fiber.dispose()
  }, 120_000)

  it('classifies an absent repository as not-found', async () => {
    await mount()
    const result = await ctx.github.getPullRequest({ repo: 'deepseek-ai/this-repo-does-not-exist-000', number: 1 })
    expect(result).toMatchObject({ ok: false, error: { code: 'not-found' } })
    await ctx.fiber.dispose()
  }, 120_000)
})
