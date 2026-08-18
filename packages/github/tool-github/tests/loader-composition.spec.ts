/**
 * The tool suite booted through a real Loader composition over a test-only
 * cordis.yml: the actual mount path deployments use, with the fixture `gh`
 * standing in for the real CLI behind the `ctx.github` service.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { CallId } from '@deepseek-ai/dsh-llm'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import GithubService from '@deepseek-ai/dsh-github'
import * as ToolGithub from '../src/index.ts'
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
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-github', GithubService],
    ['@deepseek-ai/dsh-tool-github', ToolGithub],
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

describe('github tool suite through a real Loader composition', () => {
  it('mounts, registers all twelve tools, and answers a listing call', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-tool-github-loader-'))
    fixture = await createFixtureGh()
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-subprocess-local'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-github'",
      '  config:',
      `    ghPath: ${JSON.stringify(fixture.ghPath)}`,
      "    favorites: ['fixture-owner/fixture-repo']",
      '    cacheTtlMs: 0',
      `    reportRoot: ${JSON.stringify(join(root, 'reports'))}`,
      "- name: '@deepseek-ai/dsh-tool-github'",
      '',
    ].join('\n'))

    const ctx = await loadComposition(configPath)
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
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

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('loader-it-1'),
      name: 'gh_pr_list',
      arguments: {},
    })
    expect(result.isError).toBe(false)
    expect(result.content.map(block => ('text' in block ? block.text : '')).join('')).toContain('#7')
  })
})
