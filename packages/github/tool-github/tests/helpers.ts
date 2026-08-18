/**
 * Test helpers: one executable `gh` fixture script that answers the exact
 * argv vectors the service issues, deterministically. Behaviors key off the
 * owner login so one fixture covers the happy path and every classified
 * failure without external files.
 */

import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Behavior key embedded in the fixture script. */
const FIXTURE_SOURCE = String.raw`#!/usr/bin/env node
import { mkdirSync, writeFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
// Synchronous writes: process.exit must never truncate pending async output.
const out = value => writeSync(1, JSON.stringify(value))
const die = (code, stderr) => { writeSync(2, stderr); process.exit(code) }

const sleepMs = Number(process.env.GH_FIXTURE_SLEEP_MS ?? '0')
if (sleepMs > 0) await new Promise(resolve => setTimeout(resolve, sleepMs))

const LIST_NODES = [
  {
    number: 7, title: 'feat: fixture PR', state: 'OPEN', isDraft: false,
    author: { login: 'fixture-author' },
    headRefName: 'feat/fixture', baseRefName: 'main',
    updatedAt: '2026-01-02T03:04:05Z',
    reviewDecision: 'CHANGES_REQUESTED', mergeable: 'MERGEABLE',
    statusCheckRollup: { state: 'FAILURE' },
  },
]

const DETAIL = {
  id: 'PR_fixture', number: 7, title: 'feat: fixture PR', state: 'OPEN', isDraft: false,
  author: { login: 'fixture-author' },
  bodyText: 'fixture body',
  headRefName: 'feat/fixture', baseRefName: 'main',
  mergeable: 'MERGEABLE', reviewDecision: 'CHANGES_REQUESTED',
  additions: 12, deletions: 3, changedFiles: 2,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T03:04:05Z',
  labels: { nodes: [{ name: 'kind/feat' }, { name: 'area/github' }] },
  reviewThreads: {
    totalCount: 2,
    nodes: [
      {
        id: 'PRRT_unresolved', isResolved: false, isOutdated: false,
        path: 'src/a.ts', line: 4, resolvedBy: null,
        comments: {
          totalCount: 2,
          nodes: [{ id: 'C_1', databaseId: 101, author: { login: 'reviewer' }, createdAt: '2026-01-01T01:00:00Z', bodyText: 'first comment' }],
        },
      },
      {
        id: 'PRRT_resolved', isResolved: true, isOutdated: true,
        path: 'src/b.ts', line: null,
        resolvedBy: { login: 'fixture-author' },
        comments: {
          totalCount: 1,
          nodes: [{ id: 'C_2', databaseId: 102, author: { login: 'reviewer' }, createdAt: '2026-01-01T02:00:00Z', bodyText: 'resolved comment' }],
        },
      },
    ],
  },
  commits: {
    nodes: [{
      commit: {
        statusCheckRollup: {
          state: 'FAILURE',
          contexts: {
            nodes: [
              { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://example.test/lint' },
              { __typename: 'StatusContext', context: 'ci/build', state: 'SUCCESS', targetUrl: 'https://example.test/build' },
            ],
          },
        },
      },
    }],
  },
}

const THREAD_FULL = {
  __typename: 'PullRequestReviewThread',
  id: 'PRRT_unresolved', isResolved: false, isOutdated: false, path: 'src/a.ts', line: 4,
  comments: {
    totalCount: 2,
    nodes: [
      { id: 'C_1', databaseId: 101, author: { login: 'reviewer' }, createdAt: '2026-01-01T01:00:00Z', bodyText: 'first comment' },
      { id: 'C_2', databaseId: 103, author: { login: 'fixture-author' }, createdAt: '2026-01-01T01:30:00Z', bodyText: 'reply comment' },
    ],
  },
}

const COMMITS = {
  totalCount: 5,
  nodes: [
    { commit: { oid: 'aaa111', messageHeadline: 'feat: first', authoredDate: '2026-01-01T00:00:00Z', author: { name: 'Fixture Author', user: { login: 'fixture-author' } } } },
    { commit: { oid: 'bbb222', messageHeadline: 'fix: second', authoredDate: '2026-01-01T01:00:00Z', author: { name: null, user: null } } },
  ],
}

const envelope = data => ({ data })
const graphqlError = message => ({ errors: [{ message }] })
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
function variable(name) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-F' && args[i + 1] !== undefined && args[i + 1].startsWith(name + '=')) return args[i + 1].slice(name.length + 1)
  }
  return undefined
}

if (args[0] === 'api' && args[1] === 'graphql') {
  if (process.env.GH_FIXTURE_BIG === '1') {
    out({ data: { big: 'x'.repeat(300_000) } })
    process.exit(0)
  }
  if (process.env.GH_FIXTURE_BAD_JSON === '1') {
    writeSync(1, 'not json')
    process.exit(0)
  }
  const query = flag('-f')?.startsWith('query=') ? flag('-f').slice('query='.length) : ''
  const ownerLogin = variable('owner')
  if (ownerLogin === 'broken') die(1, 'gh: transport failure')
  if (ownerLogin === 'longerr') die(1, 'x'.repeat(3000))
  if (ownerLogin === 'missing') { out(graphqlError('Could not resolve to a Repository with the name missing/anything.')); process.exit(1) }
  if (query.includes('pullRequests(states:')) { out(envelope({ repository: { pullRequests: { nodes: LIST_NODES } } })); process.exit(0) }
  if (query.includes('node(id:')) { out(envelope({ node: THREAD_FULL })); process.exit(0) }
  if (query.includes('unresolveReviewThread')) { out(envelope({ unresolveReviewThread: { thread: { id: variable('threadId'), isResolved: false } } })); process.exit(0) }
  if (query.includes('resolveReviewThread')) { out(envelope({ resolveReviewThread: { thread: { id: variable('threadId'), isResolved: true } } })); process.exit(0) }
  if (query.includes('addPullRequestReviewThreadReply')) {
    out(envelope({ addPullRequestReviewThreadReply: { comment: { id: 'C_new', url: 'https://example.test/reply' } } }))
    process.exit(0)
  }
  if (query.includes('reviewThreads(first:')) {
    const pr = process.env.GH_FIXTURE_BAD_DETAIL === '1' ? { ...DETAIL, number: 'seven' } : DETAIL
    out(envelope({ repository: { pullRequest: pr } }))
    process.exit(0)
  }
  if (query.includes('commits(first:')) {
    const payload = process.env.GH_FIXTURE_NO_TOTAL === '1' ? { nodes: COMMITS.nodes } : COMMITS
    out(envelope({ repository: { pullRequest: { commits: payload } } }))
    process.exit(0)
  }
  die(1, 'gh: fixture received an unrecognized GraphQL query')
}

if (args[0] === 'pr' && args[1] === 'comment') {
  writeSync(1, 'https://example.test/issuecomment-1\n')
  process.exit(0)
}

if (args[0] === 'pr' && args[1] === 'review') {
  const repo = flag('--repo') ?? ''
  if (args.includes('--approve') && repo.startsWith('selfowner/')) {
    die(1, 'gh: GraphQL: Review Can not approve your own pull request (addPullRequestReview)')
  }
  writeSync(1, 'Reviewed\n')
  process.exit(0)
}

if (args[0] === 'pr' && args[1] === 'merge') {
  writeSync(1, 'Merged\n')
  process.exit(0)
}

if (args[0] === 'pr' && (args[1] === 'close' || args[1] === 'reopen')) {
  writeSync(1, 'done\n')
  process.exit(0)
}

if (args[0] === 'pr-enrich') {
  if (process.env.GH_FIXTURE_ENRICH_FAIL === '1') die(1, 'fatal: not a git repository')
  if (process.env.GH_FIXTURE_EMPTY_SUCCESS === '1') {
    writeSync(1, 'nothing written\n')
    process.exit(0)
  }
  const dirIndex = args.indexOf('--output-dir')
  const dir = dirIndex >= 0 ? args[dirIndex + 1] : undefined
  if (dir === undefined) die(1, 'fixture: missing --output-dir')
  mkdirSync(dir, { recursive: true })
  const THREAD_SHAPES = {
    2: { comment_threads: { data: {} } },
    3: { comment_threads: { data: { repository: {} } } },
    4: { comment_threads: { data: { repository: { pullRequest: {} } } } },
    5: { comment_threads: { data: { repository: { pullRequest: { reviewThreads: { nodes: 'x' } } } } } },
  }
  const shape = process.env.GH_FIXTURE_THREAD_SHAPE
  const combined = shape !== undefined && THREAD_SHAPES[shape] !== undefined
    ? THREAD_SHAPES[shape]
    : process.env.GH_FIXTURE_BAD_COMBINED === '1'
    ? { weird: true }
    : {
        metadata: { generated_at: '2026-01-02T03:04:05Z' },
        comments: [{ id: 1 }, { id: 2 }, { id: 3 }],
        comment_threads: {
          data: {
            repository: {
              pullRequest: {
                reviewThreads: { nodes: [{ id: 'PRRT_unresolved', isResolved: false }, { id: 'PRRT_resolved', isResolved: true }] },
              },
            },
          },
        },
        statistics: { checks: { total: 2, passing: 1, failing: 1, pending: 0, overall_state: 'failure' } },
      }
  if (process.env.GH_FIXTURE_NO_COMBINED !== '1') {
    writeFileSync(join(dir, 'combined-data.json'), JSON.stringify(combined))
  }
  writeFileSync(join(dir, 'comprehensive-report.md'), '# fixture report\n')
  writeFileSync(join(dir, 'comment-threads.json'), JSON.stringify(combined.comment_threads ?? null))
  if (args.includes('--enrich')) writeFileSync(join(dir, 'claude-analysis.json'), '{"analysis":"fixture"}')
  writeSync(1, 'fixture report written\n')
  process.exit(0)
}

die(1, 'gh: fixture received an unrecognized invocation')
`

/** One disposable directory owning the fixture `gh` executable. */
export interface FixtureGh {
  readonly dir: string
  readonly ghPath: string
  dispose(): Promise<void>
}

/**
 * Create a temp directory containing the executable `gh` fixture script.
 * @returns the fixture handle with its disposal.
 */
export async function createFixtureGh(): Promise<FixtureGh> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-github-fixture-'))
  const ghPath = join(dir, 'gh')
  await writeFile(ghPath, FIXTURE_SOURCE, 'utf8')
  await chmod(ghPath, 0o755)
  return {
    dir,
    ghPath,
    dispose: () => rm(dir, { recursive: true, force: true }),
  }
}

/** Create one disposable report-root directory. */
export async function createReportRoot(): Promise<{ dir: string; dispose(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-github-reports-'))
  return { dir, dispose: () => rm(dir, { recursive: true, force: true }) }
}

/** Standard service config over one fixture. */
export function fixtureConfig(ghPath: string, reportRoot: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ghPath,
    favorites: ['fixture-owner/fixture-repo'],
    cacheTtlMs: 0,
    timeoutMs: 30_000,
    enrichTimeoutMs: 30_000,
    reportRoot,
    ...overrides,
  }
}

/** Ensure a directory exists and looks like a git checkout to consumers. */
