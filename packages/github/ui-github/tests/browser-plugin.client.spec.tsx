// @vitest-environment jsdom
/**
 * ui-github browser half on a real cordis Context with fake slots/locale/
 * remote faces: the plugin registers the dashboard tab and one keyed card
 * per gh_pr_* tool, disposal removes the whole surface (HMR safety), the
 * card renders every stamped presentation kind plus error and running forms,
 * and the dashboard drives the Remote namespace through its list/detail/
 * thread/commit flows, discarding stale responses on fast switches. The node
 * half runs over the same Context.
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, GITHUB_TOOL_NAMES, inject } from '../src/client/index.ts'
import { GithubToolRow, type GithubToolRowProps } from '../src/client/GithubToolRow.tsx'
import { GithubView, type GithubViewProps } from '../src/client/GithubView.tsx'
import { zh } from '../src/client/locales.ts'
import { apply as nodeApply } from '../src/index.ts'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as InvariantCompanions from '../src/invariant.ts'

afterEach(cleanup)

/* ------------------------------------------------------------------ */
/* Fake gh_pr_* blocks                                                 */
/* ------------------------------------------------------------------ */

function running(over: Partial<RunningToolCall> = {}): RunningToolCall {
  return {
    callId: 'call-1', name: 'gh_pr_list', argsRaw: '{"first":5}', turn: 1, step: 1, time: 1_000,
    callView: null, subCalls: [], ...over,
  }
}

function settled(kind: string | null, value: unknown, over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 2, time: 2_000, callId: 'call-1',
    call: { name: 'gh_pr_list', argsRaw: '{"first":5}' }, callTime: 1_000,
    content: [{ type: 'text', text: 'ok' }], isError: false,
    meta: kind === null ? undefined : { kind, value },
    callView: null, resultView: null, subCalls: [], ...over,
  }
}

/* ------------------------------------------------------------------ */
/* Fake Remote namespace                                               */
/* ------------------------------------------------------------------ */

type Business<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }
type Envelope<T> =
  | { ok: true; value: Business<T> }
  | { ok: false; error: { code: string; message: string } }

interface GithubScript {
  list?: Envelope<unknown>
  detail?: Envelope<unknown>
  threads?: Envelope<unknown>
  commits?: Envelope<unknown>
}

function makeGithub(script: GithubScript = {}) {
  const calls: Array<{ method: string; request: unknown }> = []
  const success = (value: unknown): Envelope<unknown> => ({ ok: true, value: { ok: true, value } })
  return {
    calls,
    remote: {
      listPullRequests: (request: unknown) => {
        calls.push({ method: 'listPullRequests', request })
        return Promise.resolve(script.list ?? success(PR_ROWS))
      },
      getPullRequest: (request: unknown) => {
        calls.push({ method: 'getPullRequest', request })
        return Promise.resolve(script.detail ?? success(null))
      },
      listThreads: (request: unknown) => {
        calls.push({ method: 'listThreads', request })
        return Promise.resolve(script.threads ?? success({ repo: { owner: 'o', name: 'r' }, number: 7, filter: 'unresolved', threads: [] }))
      },
      listCommits: (request: unknown) => {
        calls.push({ method: 'listCommits', request })
        return Promise.resolve(script.commits ?? success({ repo: { owner: 'o', name: 'r' }, number: 7, totalCount: 0, commits: [] }))
      },
    },
  }
}

/* ------------------------------------------------------------------ */
/* Plugin bench                                                        */
/* ------------------------------------------------------------------ */

async function bench(github: unknown) {
  const ctx = new Context()
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.github', github)
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root', children: {
      'conversation.view': { kind: 'list', scope: 'session' },
      'tool.call.toolview': { kind: 'keyed', scope: 'session' },
    },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

describe('ui-github browser plugin', () => {
  it('registers the dashboard tab and one keyed card per tool', async () => {
    const { remote } = makeGithub()
    const b = await bench(remote)
    const view = b.ctx.slots.entries('conversation.view')[0]
    expect(view?.options).toMatchObject({ id: 'github', order: 20 })
    expect(view?.locale).toBe('github')
    const label = (view?.options as { label: () => string }).label()
    expect(label).toBe('GitHub')
    const injectFace = (view?.inject as (() => { github: unknown }) | undefined)?.()
    expect(injectFace?.github).toBe(remote)
    const keys = b.ctx.slots.entries('tool.call.toolview').map(entry => (entry.options as { key: string }).key)
    expect(keys.sort()).toEqual([...GITHUB_TOOL_NAMES].sort())
    await b.fiber.dispose()
    expect(b.ctx.slots.entries('conversation.view')).toEqual([])
    expect(b.ctx.slots.entries('tool.call.toolview')).toEqual([])
  })

  it('provides no host-side behavior', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('removes its invariant registration with the fiber (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = ctx.plugin(InvariantCompanions)
    await fiber.await()
    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-client-ui-github', () => {})
    }).toThrow(/already registered/u)
    await fiber.dispose()
    await expect(ctx.plugin(InvariantCompanions).await()).resolves.toBeDefined()
  })
})

/* ------------------------------------------------------------------ */
/* Tool card rendering                                                 */
/* ------------------------------------------------------------------ */

const t = makeTranslate(zh)

function cardProps(block: RunningToolCall | ToolResultNode): GithubToolRowProps {
  return {
    callId: 'call-1', toolName: 'gh_pr_list', block, openFile: () => {},
    t,
  } as unknown as GithubToolRowProps
}

describe('GithubToolRow', () => {
  it('shows the running state with its arguments hidden until settled', () => {
    const { container } = render(<GithubToolRow {...cardProps(running())} />)
    expect(container.textContent).toContain(zh['card.running'])
  })

  it('summarizes every stamped presentation kind', () => {
    const cases: Array<[kind: string, value: unknown, expected: string]> = [
      ['github.pr-list', { repo: { owner: 'o', name: 'r' }, pullRequests: [1, 2] }, 'o/r · 2'],
      ['github.pr-list', { pullRequests: [1] }, '1'],
      ['github.pr-list', { owner: 'd', name: 'repo', pullRequests: [] }, 'd/repo · 0'],
      ['github.pr-detail', { repo: { owner: 'o', name: 'r' }, number: 7, title: 'Fix', state: 'OPEN', additions: 1, deletions: 2, changedFiles: 3 }, '#7 Fix OPEN'],
      ['github.pr-detail', { title: 'Untitled' }, 'Untitled'],
      ['github.thread-list', { number: 7, filter: 'unresolved', threads: [1] }, '#7 · 1 (unresolved)'],
      ['github.thread-list', { threads: [1] }, '#? · 1 (all)'],
      ['github.thread-full', { path: 'a.ts', line: 3, isResolved: true, comments: [1, 2] }, 'a.ts:3 · 2 · resolved'],
      ['github.thread-full', { path: 'a.ts', line: null, isResolved: false, comments: [] }, 'a.ts · 0 · unresolved'],
      ['github.thread-full', { isResolved: false, comments: [] }, ' · 0 · unresolved'],
      ['github.commit-list', { number: 7, totalCount: 4, commits: [1] }, '#7 · 4'],
      ['github.commit-list', { commits: [1, 2] }, '#? · 2'],
      ['github.context-digest', { number: 7, checks: { passing: 3, total: 4 }, threadCounts: { unresolved: 1, total: 2 } }, '#7 · 3/4 checks'],
      ['github.context-digest', { number: 7 }, '#7'],
      ['github.context-digest', {}, '#?'],
      ['github.comment-created', { url: 'https://github.com/c/1' }, 'https://github.com/c/1'],
      ['github.thread-reply', { url: 'https://github.com/c/2' }, 'https://github.com/c/2'],
      ['github.thread-resolution', { threadId: 'PRRT_1', isResolved: true }, 'PRRT_1 → resolved'],
      ['github.thread-resolution', { threadId: 'PRRT_1', isResolved: false }, 'PRRT_1 → unresolved'],
      ['github.thread-resolution', { isResolved: false }, ' → unresolved'],
      ['github.review-submitted', { repo: { owner: 'o', name: 'r' }, number: 7, event: 'approve' }, '#7 · approve'],
      ['github.review-submitted', {}, '#? · '],
      ['github.merged', {}, '#? · '],
      ['github.state-change', {}, '#? → '],
      ['github.merged', { repo: { owner: 'o', name: 'r' }, number: 7, method: 'squash' }, '#7 · squash'],
      ['github.state-change', { repo: { owner: 'o', name: 'r' }, number: 7, state: 'CLOSED' }, '#7 → CLOSED'],
    ]
    for (const [kind, value, expected] of cases) {
      const { container, unmount } = render(<GithubToolRow {...cardProps(settled(kind, value))} />)
      expect(container.textContent, kind).toContain(expected)
      unmount()
    }
  })

  it('expands a settled card into facts, value JSON, arguments, and a comment link', () => {
    const block = settled('github.comment-created', { url: 'https://github.com/c/1' })
    const { container } = render(<GithubToolRow {...cardProps(block)} />)
    fireEvent.click(container.querySelector('button') as HTMLButtonElement)
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://github.com/c/1')
    expect(container.textContent).toContain('"url": "https://github.com/c/1"')
    expect(container.textContent).toContain('arguments')
  })

  it('renders fact rows for detail, digest, and resolution kinds', () => {
    const detail = settled('github.pr-detail', {
      repo: { owner: 'o', name: 'r' }, number: 7, title: 'Fix', state: 'OPEN',
      additions: 1, deletions: 2, changedFiles: 3,
    })
    const first = render(<GithubToolRow {...cardProps(detail)} />)
    fireEvent.click(first.container.querySelector('button') as HTMLButtonElement)
    expect(first.container.textContent).toContain('o/r')
    expect(first.container.textContent).toContain('+1 −2 / 3 files')
    first.unmount()

    const digest = settled('github.context-digest', { number: 7, threadCounts: { unresolved: 1, total: 2 } })
    const second = render(<GithubToolRow {...cardProps(digest)} />)
    fireEvent.click(second.container.querySelector('button') as HTMLButtonElement)
    expect(second.container.textContent).toContain('1 unresolved / 2')
    second.unmount()

    const resolution = settled('github.thread-resolution', { threadId: 'PRRT_1', isResolved: true })
    const third = render(<GithubToolRow {...cardProps(resolution)} />)
    fireEvent.click(third.container.querySelector('button') as HTMLButtonElement)
    expect(third.container.textContent).toContain('resolved')
    third.unmount()

    const stillOpen = settled('github.thread-resolution', { threadId: 'PRRT_1', isResolved: false })
    const fourth = render(<GithubToolRow {...cardProps(stillOpen)} />)
    fireEvent.click(fourth.container.querySelector('button') as HTMLButtonElement)
    expect(fourth.container.textContent).toContain('unresolved')
    fourth.unmount()

    const noState = settled('github.thread-resolution', { threadId: 'PRRT_1' })
    const fifth = render(<GithubToolRow {...cardProps(noState)} />)
    fireEvent.click(fifth.container.querySelector('button') as HTMLButtonElement)
    expect(fifth.container.textContent).not.toContain('resolved /')
    fifth.unmount()
  })

  it('shows the failure message and code of an errored call', () => {
    const block = settled(null, null, { isError: true, error: { name: 'GithubToolError', code: 'not-found' } })
    const { container } = render(<GithubToolRow {...cardProps(block)} />)
    expect(container.textContent).toContain(zh['card.failed'].replace('{message}', 'GithubToolError'))
    fireEvent.click(container.querySelector('button') as HTMLButtonElement)
    expect(container.textContent).toContain(zh['card.errorCode'].replace('{code}', 'not-found'))
  })

  it('keeps an errored call without error info expandable without a code row', () => {
    const block = settled('github.pr-list', { repo: { owner: 'o', name: 'r' }, pullRequests: [] }, { isError: true })
    const { container } = render(<GithubToolRow {...cardProps(block)} />)
    expect(container.textContent).toContain('error')
  })

  it('renders an unstampable settled result under the generic title', () => {
    const { container } = render(<GithubToolRow {...cardProps(settled(null, null))} />)
    expect(container.textContent).toContain(zh['card.unknown'])
  })

  it('omits the comment link when a created comment carries no url', () => {
    const block = settled('github.comment-created', {})
    const { container } = render(<GithubToolRow {...cardProps(block)} />)
    fireEvent.click(container.querySelector('button') as HTMLButtonElement)
    expect(container.querySelector('a')).toBeNull()
  })

  it('omits arguments when the settled call fell outside the window', () => {
    const block = settled('github.pr-list', { pullRequests: [] }, { call: null })
    const { container } = render(<GithubToolRow {...cardProps(block)} />)
    fireEvent.click(container.querySelector('button') as HTMLButtonElement)
    expect(container.textContent).not.toContain('arguments')
  })
})

/* ------------------------------------------------------------------ */
/* Dashboard view                                                      */
/* ------------------------------------------------------------------ */

const PR_ROWS = {
  repo: { owner: 'o', name: 'r' },
  pullRequests: [
    {
      repo: { owner: 'o', name: 'r' }, number: 7, title: 'Open PR', state: 'OPEN', isDraft: false,
      author: 'alice', headRef: 'h', baseRef: 'master', updatedAt: '2026-01-01T00:00:00Z',
      mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', checksState: 'SUCCESS',
    },
    {
      repo: { owner: 'o', name: 'r' }, number: 8, title: 'Failing draft', state: 'MERGED', isDraft: true,
      author: 'bob', headRef: 'h2', baseRef: 'master', updatedAt: '2026-01-02T00:00:00Z',
      mergeable: 'UNKNOWN', reviewDecision: null, checksState: 'FAILURE',
    },
    {
      repo: { owner: 'o', name: 'r' }, number: 9, title: 'No checks', state: 'CLOSED', isDraft: false,
      author: 'carol', headRef: 'h3', baseRef: 'master', updatedAt: '2026-01-03T00:00:00Z',
      mergeable: 'CONFLICTING', reviewDecision: null, checksState: null,
    },
  ],
}

const DETAIL = {
  ...PR_ROWS.pullRequests[0],
  nodeId: 'PR_7', bodyText: 'The description.', additions: 10, deletions: 4, changedFiles: 2,
  createdAt: '2026-01-01T00:00:00Z', labels: ['kind/feature'],
  threadCounts: { total: 3, unresolved: 1 },
  checks: { state: 'SUCCESS', contexts: [] },
}

const THREADS = {
  repo: { owner: 'o', name: 'r' }, number: 7, filter: 'unresolved',
  threads: [
    {
      id: 'PRRT_1', path: 'src/a.ts', line: 12, isResolved: false, isOutdated: true,
      commentCount: 2, resolvedBy: null,
      firstComment: { id: 'c1', databaseId: 1, author: 'alice', createdAt: '2026-01-01T00:00:00Z', body: 'Please fix' },
    },
    { id: 'PRRT_2', path: 'src/b.ts', line: null, isResolved: true, isOutdated: false, commentCount: 1, resolvedBy: 'bob', firstComment: null },
  ],
}

const COMMITS = {
  repo: { owner: 'o', name: 'r' }, number: 7, totalCount: 3,
  commits: [
    {
      sha: 'abcdef1234567890', headline: 'Fix the bug', authorLogin: 'alice', authorName: null,
      authoredDate: '2026-01-01T00:00:00Z',
    },
    {
      sha: 'bbbbbb1234567890', headline: 'No login', authorLogin: null, authorName: 'Alice A',
      authoredDate: '2026-01-02T00:00:00Z',
    },
    {
      sha: 'cccccc1234567890', headline: 'No author', authorLogin: null, authorName: null,
      authoredDate: '2026-01-03T00:00:00Z',
    },
  ],
}

function viewProps(github: unknown): GithubViewProps {
  return { github, t } as unknown as GithubViewProps
}

describe('GithubView', () => {
  it('loads and lists pull requests with state, draft, and check badges', async () => {
    const { remote } = makeGithub()
    const { findByText, container } = render(<GithubView {...viewProps(remote)} />)
    await findByText('Open PR')
    expect(container.textContent).toContain('Failing draft')
    expect(container.textContent).toContain(zh['view.pr.draft'])
    expect(container.textContent).toContain('success')
    expect(container.textContent).toContain('failure')
    expect(container.textContent).toContain('alice')
  })

  it('shows the empty notice when the listing has no rows', async () => {
    const { remote } = makeGithub({
      list: { ok: true, value: { ok: true, value: { repo: { owner: 'o', name: 'r' }, pullRequests: [] } } },
    })
    const { findByText } = render(<GithubView {...viewProps(remote)} />)
    await findByText(zh['view.empty'])
  })

  it('surfaces a business failure and a carrier failure as error notices', async () => {
    const business = makeGithub({
      list: { ok: true, value: { ok: false, error: { code: 'not-found', message: 'missing repo' } } },
    })
    const first = render(<GithubView {...viewProps(business.remote)} />)
    await first.findByText(zh['view.error'].replace('{message}', 'missing repo'))
    first.unmount()

    const carrier = makeGithub({ list: { ok: false, error: { code: 'transport', message: 'gateway down' } } })
    const second = render(<GithubView {...viewProps(carrier.remote)} />)
    await second.findByText(zh['view.error'].replace('{message}', 'gateway down'))
    second.unmount()
  })

  it('reloads from its refresh button', async () => {
    const script = makeGithub()
    const { findByText, getByRole } = render(<GithubView {...viewProps(script.remote)} />)
    await findByText('Open PR')
    const before = script.calls.filter(call => call.method === 'listPullRequests').length
    fireEvent.click(getByRole('button', { name: new RegExp(zh['view.refresh'], 'u') }))
    await waitFor(() => {
      expect(script.calls.filter(call => call.method === 'listPullRequests').length).toBe(before + 1)
    })
  })

  it('passes repo and state selections to the Remote call', async () => {
    const script = makeGithub({
      list: { ok: true, value: { ok: true, value: { repo: { owner: 'o', name: 'r' }, pullRequests: [] } } },
    })
    const { findByText, getByLabelText, container } = render(<GithubView {...viewProps(script.remote)} />)
    await findByText(zh['view.empty'])
    fireEvent.change(getByLabelText(zh['view.repoLabel']), { target: { value: 'deepseek-ai/deepseek-harness' } })
    fireEvent.change(getByLabelText(zh['view.title']), { target: { value: 'MERGED' } })
    await waitFor(() => {
      const last = script.calls.filter(call => call.method === 'listPullRequests').at(-1)
      expect(last?.request).toEqual({ repo: 'deepseek-ai/deepseek-harness', state: 'MERGED' })
    })
    expect(container.textContent).toContain(zh['view.empty'])
  })

  it('opens one PR into detail, threads, and commits', async () => {
    const script = makeGithub({
      list: { ok: true, value: { ok: true, value: PR_ROWS } },
      detail: { ok: true, value: { ok: true, value: DETAIL } },
      threads: { ok: true, value: { ok: true, value: THREADS } },
      commits: { ok: true, value: { ok: true, value: COMMITS } },
    })
    const { findByText, container } = render(<GithubView {...viewProps(script.remote)} />)
    fireEvent.click(await findByText('Open PR'))
    await findByText('#7 Open PR')
    expect(container.textContent).toContain('+10 −4')
    expect(container.textContent).toContain('kind/feature')
    expect(container.textContent).toContain('The description.')
    expect(container.textContent).toContain('src/a.ts:12')
    expect(container.textContent).toContain(zh['view.threads.outdated'])
    expect(container.textContent).toContain('alice: Please fix')
    expect(container.textContent).toContain('src/b.ts')
    expect(container.textContent).toContain('Fix the bug')
    expect(container.textContent).toContain('No login')
    expect(container.textContent).toContain('abcdef1')
    expect(script.calls.filter(call => call.method === 'getPullRequest')[0]?.request)
      .toEqual({ number: 7 })
  })

  it('returns to the listing from its back button', async () => {
    const script = makeGithub({
      detail: { ok: true, value: { ok: true, value: DETAIL } },
      threads: { ok: true, value: { ok: true, value: THREADS } },
      commits: { ok: true, value: { ok: true, value: COMMITS } },
    })
    const { findByText, getByText, queryByText } = render(<GithubView {...viewProps(script.remote)} />)
    fireEvent.click(await findByText('Open PR'))
    fireEvent.click(await findByText(zh['view.detail.back']))
    expect(queryByText(zh['view.detail.back'])).toBeNull()
    expect(getByText('Open PR')).toBeDefined()
  })

  it('passes a typed repo through every request when the input is set', async () => {
    const script = makeGithub({
      list: { ok: true, value: { ok: true, value: PR_ROWS } },
      detail: { ok: true, value: { ok: false, error: { code: 'not-found', message: 'gone' } } },
    })
    const { findByText, getByLabelText } = render(<GithubView {...viewProps(script.remote)} />)
    fireEvent.change(getByLabelText(zh['view.repoLabel']), { target: { value: 'o/r' } })
    fireEvent.click(await findByText('Open PR'))
    await findByText('#7')
    expect(script.calls.filter(call => call.method === 'getPullRequest')[0]?.request)
      .toEqual({ repo: 'o/r', number: 7 })
  })

  it('drops the thread and commit panes when their fetches fail', async () => {
    const script = makeGithub({
      detail: { ok: true, value: { ok: true, value: DETAIL } },
      threads: { ok: true, value: { ok: false, error: { code: 'gh-failed', message: 'threads down' } } },
      commits: { ok: true, value: { ok: false, error: { code: 'gh-failed', message: 'commits down' } } },
    })
    const { findByText, queryByText } = render(<GithubView {...viewProps(script.remote)} />)
    fireEvent.click(await findByText('Open PR'))
    await findByText('#7 Open PR')
    expect(queryByText(zh['view.threads.empty'])).toBeNull()
    expect(queryByText(zh['view.commits.empty'])).toBeNull()
  })

  it('shows the empty notices for threadless and commitless results', async () => {
    const script = makeGithub({
      list: { ok: true, value: { ok: true, value: PR_ROWS } },
      detail: { ok: true, value: { ok: true, value: { ...DETAIL, bodyText: '', labels: [] } } },
    })
    const { findByText } = render(<GithubView {...viewProps(script.remote)} />)
    fireEvent.click(await findByText('Open PR'))
    await findByText(zh['view.threads.empty'])
    await findByText(zh['view.commits.empty'])
  })

  it('switches the thread filter through the Remote call', async () => {
    const script = makeGithub({
      list: { ok: true, value: { ok: true, value: PR_ROWS } },
      detail: { ok: true, value: { ok: true, value: DETAIL } },
      threads: { ok: true, value: { ok: true, value: { ...THREADS, threads: [] } } },
    })
    const { findByText, getByLabelText } = render(<GithubView {...viewProps(script.remote)} />)
    fireEvent.click(await findByText('Open PR'))
    await findByText(zh['view.threads.empty'])
    fireEvent.change(getByLabelText(zh['view.threads.title']), { target: { value: 'all' } })
    await waitFor(() => {
      const last = script.calls.filter(call => call.method === 'listThreads').at(-1)
      expect(last?.request).toMatchObject({ filter: 'all' })
    })
  })

  it('discards a stale listing when the repo switches before it lands', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined
    const firstPending = new Promise((resolve) => { resolveFirst = resolve })
    const calls: unknown[] = []
    const remote = {
      listPullRequests: (request: unknown) => {
        calls.push(request)
        if (calls.length === 1) {
          return firstPending.then(() => ({
            ok: true, value: { ok: true, value: { repo: { owner: 'o', name: 'r' }, pullRequests: [STALE_ROW] } },
          }))
        }
        return Promise.resolve({
          ok: true, value: { ok: true, value: { repo: { owner: 'o', name: 'r' }, pullRequests: [] } },
        })
      },
      getPullRequest: () => Promise.resolve({ ok: true, value: { ok: true, value: null } }),
      listThreads: () => Promise.resolve({ ok: true, value: { ok: true, value: { threads: [] } } }),
      listCommits: () => Promise.resolve({ ok: true, value: { ok: true, value: { commits: [], totalCount: 0 } } }),
    }
    const STALE_ROW = {
      repo: { owner: 'o', name: 'r' }, number: 99, title: 'Stale row', state: 'OPEN', isDraft: false,
      author: 'zed', headRef: 'h', baseRef: 'master', updatedAt: '2026-01-01T00:00:00Z',
      mergeable: 'MERGEABLE', reviewDecision: null, checksState: null,
    }
    const { findByText, getByLabelText, queryByText } = render(<GithubView {...viewProps(remote)} />)
    fireEvent.change(getByLabelText(zh['view.repoLabel']), { target: { value: 'o/other' } })
    await findByText(zh['view.empty'])
    resolveFirst?.(undefined)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(queryByText('Stale row')).toBeNull()
  })

  it('discards a stale detail batch when the thread filter switches first', async () => {
    let resolveDetail: ((value: unknown) => void) | undefined
    const detailPending = new Promise((resolve) => { resolveDetail = resolve })
    let detailCalls = 0
    const script = makeGithub({
      list: { ok: true, value: { ok: true, value: PR_ROWS } },
      threads: { ok: true, value: { ok: true, value: THREADS } },
      commits: { ok: true, value: { ok: true, value: COMMITS } },
    })
    const remote = {
      ...script.remote,
      getPullRequest: (_request: unknown) => {
        detailCalls += 1
        if (detailCalls === 1) {
          return detailPending.then(() => ({ ok: true, value: { ok: true, value: { ...DETAIL, title: 'STALE' } } }))
        }
        return Promise.resolve({ ok: true, value: { ok: true, value: DETAIL } })
      },
    }
    const { findByText, getByLabelText, queryByText } = render(<GithubView {...viewProps(remote)} />)
    fireEvent.click(await findByText('Open PR'))
    fireEvent.change(getByLabelText(zh['view.threads.title']), { target: { value: 'all' } })
    await findByText('#7 Open PR')
    resolveDetail?.(undefined)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(queryByText(/STALE/u)).toBeNull()
  })
})
