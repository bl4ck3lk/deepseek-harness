/**
 * The service booted through a real Loader composition over a test-only
 * cordis.yml: the actual mount path deployments use, with the fixture `gh`
 * standing in for the real CLI.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import GithubService from '../src/index.ts'
import { createFixtureGh } from './helpers.ts'
import type { FixtureGh } from './helpers.ts'

let root: string | undefined
let fixture: FixtureGh | undefined
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (fixture !== undefined) await fixture.dispose()
  fixture = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadComposition(configPath: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root as string).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
    ['@deepseek-ai/dsh-github', GithubService],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  const unloaded = [...ctx.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)
  expect(unloaded).toEqual([])
  return ctx
}

describe('github service through a real Loader composition', () => {
  it('mounts, exposes the complete Remote surface, and answers a listing', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-github-loader-'))
    fixture = await createFixtureGh()
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-subprocess-local'",
      "- name: '@deepseek-ai/dsh-github'",
      '  config:',
      `    ghPath: ${JSON.stringify(fixture.ghPath)}`,
      "    favorites: ['fixture-owner/fixture-repo']",
      '    cacheTtlMs: 0',
      `    reportRoot: ${JSON.stringify(join(root, 'reports'))}`,
      '',
    ].join('\n'))

    const ctx = await loadComposition(configPath)
    expect(ctx.github.typertRemote.namespace).toBe('github')
    expect(remoteMethods(ctx.github).map(marker => marker.method)).toEqual([
      'listPullRequests',
      'getPullRequest',
      'listThreads',
      'getThread',
      'listCommits',
      'getContext',
      'addComment',
      'replyToThread',
      'setThreadResolved',
      'submitReview',
      'mergePullRequest',
      'closePullRequest',
      'reopenPullRequest',
    ])

    const result = await ctx.github.listPullRequests({})
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.pullRequests.map(pr => pr.number)).toEqual([7])
  })
})
