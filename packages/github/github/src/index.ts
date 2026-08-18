/**
 * GitHub pull-request capability over the `gh` CLI: listing, detail, review
 * threads, commits, and checks through GraphQL; bulk context collection
 * through `gh pr-enrich`; and the write actions (comments, thread replies,
 * thread resolution, reviews, merge, close, reopen) with deployment gates
 * and explicit confirmation.
 * @module @deepseek-ai/dsh-github
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { GhExecutionError, GhRunner } from './gh.ts'
import type { GhRunnerPolicy } from './gh.ts'
import {
  GET_PULL_REQUEST_QUERY,
  GET_THREAD_QUERY,
  LIST_COMMITS_QUERY,
  LIST_PULL_REQUESTS_QUERY,
  REPLY_TO_THREAD_MUTATION,
  RESOLVE_THREAD_MUTATION,
  UNRESOLVE_THREAD_MUTATION,
  GhResponseError,
  isNotFoundMessage,
  mapCommitList,
  mapPullRequestDetail,
  mapPullRequestList,
  mapThreadFull,
  mapThreadReply,
  mapThreadResolution,
  mapThreadSummaries,
} from './graphql.ts'
import type {
  GithubAddCommentRequest,
  GithubClosePullRequestRequest,
  GithubCommentCreatedValue,
  GithubCommitListValue,
  GithubConfig,
  GithubContextDigest,
  GithubFailure,
  GithubGetContextRequest,
  GithubListCommitsRequest,
  GithubListPullRequestsRequest,
  GithubListThreadsRequest,
  GithubMergePullRequestRequest,
  GithubPrDetail,
  GithubPullRequestListValue,
  GithubPullRequestMergedValue,
  GithubPullRequestRequest,
  GithubPullRequestStateValue,
  GithubRejected,
  GithubRepoRef,
  GithubReplyToThreadRequest,
  GithubReopenPullRequestRequest,
  GithubResult,
  GithubReviewSubmittedValue,
  GithubSetThreadResolvedRequest,
  GithubSubmitReviewRequest,
  GithubSuccess,
  GithubThreadFull,
  GithubThreadListValue,
  GithubThreadRequest,
  GithubThreadResolutionValue,
} from './types.ts'

export type * from './types.ts'
export { GhExecutionError, GhRunner } from './gh.ts'
export type { GhRunnerPolicy, GhRunOptions, GhRunResult } from './gh.ts'
export { GhResponseError } from './graphql.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    github: GithubService
  }
}

const REPO_PATTERN = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/
const DEFAULT_FIRST = 30
const MAX_LIST_FIRST = 100
const MAX_COMMITS_FIRST = 250
const DETAIL_TAIL_BYTES = 2000
const SELF_REVIEW_PATTERN = /can not (approve|request changes on) your own pull request/i

/** Validate one `owner/name` reference at the configuration boundary. */
function parseRepoRef(text: string): GithubRepoRef {
  const match = REPO_PATTERN.exec(text)
  const owner = match?.[1]
  const name = match?.[2]
  if (owner === undefined || name === undefined) {
    throw new TypeError(`github: repository must be 'owner/name', got ${JSON.stringify(text)}`)
  }
  return Object.freeze({ owner, name })
}

/** Build the success branch of one result union. */
function success<T>(value: T): GithubSuccess<T> {
  return Object.freeze({ ok: true, value })
}

/** Build the rejected branch of one result union. */
function rejected(code: GithubFailure['code'], message: string, detail?: string): GithubRejected {
  return Object.freeze({
    ok: false,
    error: Object.freeze(detail === undefined ? { code, message } : { code, message, detail }),
  })
}

/** Clip one diagnostic tail to its bound. */
function clipTail(text: string | undefined): string | undefined {
  if (text === undefined || text.length === 0) return undefined
  return text.length > DETAIL_TAIL_BYTES ? text.slice(-DETAIL_TAIL_BYTES) : text
}

interface CacheEntry {
  readonly at: number
  readonly value: unknown
}

/**
 * The GitHub capability service. Reads are TTL-cached in memory; every
 * successful write invalidates the whole cache. All subprocess work routes
 * through the subprocess capability seam with fixed argv vectors.
 */
export class GithubService extends TypertRemoteService {
  static inject = ['subprocess']

  /** Loader validation of the deployment policy. */
  static Config: z<GithubConfig> = z.object({
    ghPath: z.string().default('gh'),
    favorites: z.array(String).default([]),
    cacheTtlMs: z.number().step(1).min(0).default(30_000),
    timeoutMs: z.number().step(1).min(1).default(60_000),
    enrichTimeoutMs: z.number().step(1).min(1).default(300_000),
    maxOutputBytes: z.number().step(1).min(65_536).default(8 * 1024 * 1024),
    allowWrites: z.boolean().default(true),
    allowEnrich: z.boolean().default(false),
    reportRoot: z.string().default(dshHomePath('github-reports')),
    childEnv: z.dict(z.string()).default({}),
  })

  private readonly favorites: readonly GithubRepoRef[]
  private readonly cache = new Map<string, CacheEntry>()
  private readonly policy: GhRunnerPolicy
  private runner?: GhRunner

  /**
   * @param ctx - Host context carrying the subprocess service.
   * @param config - Deployment policy; favorites are validated here.
   */
  constructor(ctx: Context, config: GithubConfig) {
    super(ctx, 'github')
    this.favorites = Object.freeze(config.favorites.map(parseRepoRef))
    this.policy = Object.freeze({
      ghPath: config.ghPath,
      timeoutMs: config.timeoutMs,
      maxOutputBytes: config.maxOutputBytes,
      childEnv: Object.freeze({ ...config.childEnv }),
      defaultCwd: process.cwd(),
    })
    this.config_ = Object.freeze({
      ...config,
      favorites: this.favorites.map(ref => `${ref.owner}/${ref.name}`),
    })
  }

  /** Resolved deployment policy (config plus validated favorites). */
  private readonly config_: Readonly<GithubConfig>

  /** Resolve the `gh` executable once; a missing binary fails activation. */
  protected async [Service.init](): Promise<void> {
    const bootstrap = new GhRunner(this.ctx, this.policy)
    const resolved = await bootstrap.resolveExecutable()
    this.runner = new GhRunner(this.ctx, Object.freeze({ ...this.policy, ghPath: resolved }))
  }

  /** Configured favorite repositories as parsed references. */
  get favoriteRepos(): readonly GithubRepoRef[] {
    return this.favorites
  }

  /** The deployment policy in effect. */
  get githubConfig(): Readonly<GithubConfig> {
    return this.config_
  }

  private gh(): GhRunner {
    /* v8 ignore next -- Cordis resolves [Service.init] before any Remote method can run; the guard only protects a future misuse. */
    if (this.runner === undefined) throw new Error('github: service used before init resolved the gh executable')
    return this.runner
  }

  private cacheGet(key: string): unknown {
    const ttl = this.config_.cacheTtlMs
    if (ttl <= 0) return undefined
    const entry = this.cache.get(key)
    if (entry === undefined) return undefined
    if (Date.now() - entry.at > ttl) {
      this.cache.delete(key)
      return undefined
    }
    return entry.value
  }

  private cacheSet(key: string, value: unknown): void {
    if (this.config_.cacheTtlMs <= 0) return
    this.cache.set(key, { at: Date.now(), value })
  }

  private invalidateCache(): void {
    this.cache.clear()
  }

  /** Resolve an explicit or favorite repository reference. */
  private resolveRepo(repo: string | undefined): GithubRepoRef {
    if (repo !== undefined) return parseRepoRef(repo)
    const only = this.favorites.length === 1 ? this.favorites[0] : undefined
    if (only !== undefined) return only
    throw new GhExecutionError(
      this.favorites.length === 0
        ? 'no repository given and no favorites configured'
        : 'no repository given and multiple favorites configured; pass owner/name explicitly',
      'no-repo-configured',
    )
  }

  /** Classify one thrown failure into the result union's error branch. */
  private toFailure(error: unknown): GithubFailure {
    if (error instanceof GhExecutionError) {
      const detail = clipTail(error.detail)
      const haystack = `${error.message}\n${error.detail ?? ''}`
      if (SELF_REVIEW_PATTERN.test(haystack)) {
        return Object.freeze({
          code: 'self-review-forbidden',
          message: 'GitHub forbids reviewing your own pull request',
          /* v8 ignore next -- a matching self-review message arrives only through the stderr tail, so detail is defined */
          ...(detail === undefined ? {} : { detail }),
        })
      }
      if (error.code === 'gh-failed' && isNotFoundMessage(haystack)) {
        return Object.freeze({
          code: 'not-found',
          message: 'repository or pull request not found',
          /* v8 ignore next -- a matching not-found message arrives only through the stderr/stdout tail, so detail is defined */
          ...(detail === undefined ? {} : { detail }),
        })
      }
      return Object.freeze(detail === undefined
        ? { code: error.code, message: error.message }
        : { code: error.code, message: error.message, detail })
    }
    if (error instanceof GhResponseError) {
      return Object.freeze({ code: 'invalid-response', message: error.message })
    }
    /* v8 ignore start -- the false side needs a foreign non-Error throw that no internal path
    produces; the true side is exercised by parseRepoRef. */
    if (error instanceof TypeError) {
      return Object.freeze({ code: 'invalid-repo', message: error.message })
    }
    /* v8 ignore stop */
    /* v8 ignore next -- every internal throw is an Error subclass; String() keeps the union total for hostile foreign values. */
    return Object.freeze({ code: 'gh-failed', message: error instanceof Error ? error.message : String(error) })
  }

  private guardFailure(error: unknown): GithubRejected {
    const failure = this.toFailure(error)
    return Object.freeze({ ok: false, error: failure })
  }

  /** Run one cached read through the classifier. */
  private async cachedRead<T>(key: string, produce: () => Promise<T>): Promise<GithubResult<T>> {
    const hit = this.cacheGet(key)
    if (hit !== undefined) return success(hit as T)
    try {
      const value = await produce()
      this.cacheSet(key, value)
      return success(value)
    } catch (error: unknown) {
      return this.guardFailure(error)
    }
  }

  /** Run one write through gate and classifier; success clears the cache. */
  private async guardedWrite<T>(gate: () => GithubRejected | null, produce: () => Promise<T>): Promise<GithubResult<T>> {
    const denial = gate()
    if (denial !== null) return denial
    try {
      const value = await produce()
      this.invalidateCache()
      return success(value)
    } catch (error: unknown) {
      return this.guardFailure(error)
    }
  }

  private writeGate(): GithubRejected | null {
    if (!this.config_.allowWrites) {
      return rejected('writes-disabled', 'write operations are disabled by the allowWrites configuration')
    }
    return null
  }

  private requireConfirmation(confirm: boolean | undefined, action: string): GithubRejected | null {
    if (confirm !== true) {
      return rejected('confirmation-required', `${action} requires confirm: true`)
    }
    return null
  }

  /**
   * List pull requests of one repository ordered by most recently updated.
   * @param request - repository selection plus optional state filter.
   * @returns the repository's matching pull-request summaries.
   */
  @Remote('listPullRequests')
  async listPullRequests(request: GithubListPullRequestsRequest): Promise<GithubResult<GithubPullRequestListValue>> {
    let repo: GithubRepoRef
    try {
      repo = this.resolveRepo(request.repo)
    } catch (error: unknown) {
      return this.guardFailure(error)
    }
    const first = Math.min(Math.max(request.first ?? DEFAULT_FIRST, 1), MAX_LIST_FIRST)
    const variables: Record<string, string | number> = { owner: repo.owner, name: repo.name, first }
    if (request.state !== undefined) variables.states = request.state
    const key = `list:${repo.owner}/${repo.name}:${request.state ?? 'ANY'}:${first}`
    return this.cachedRead(key, async () => {
      const raw = await this.gh().graphql(LIST_PULL_REQUESTS_QUERY, variables)
      return Object.freeze({
        repo: Object.freeze({ owner: repo.owner, name: repo.name }),
        pullRequests: mapPullRequestList(raw, repo),
      })
    })
  }

  /**
   * Read one pull request's full detail: metadata, thread counts, checks.
   * @param request - repository and pull-request number.
   * @returns the complete detail row.
   */
  @Remote('getPullRequest')
  async getPullRequest(request: GithubPullRequestRequest): Promise<GithubResult<GithubPrDetail>> {
    let repo: GithubRepoRef
    try {
      repo = this.resolveRepo(request.repo)
    } catch (error: unknown) {
      return this.guardFailure(error)
    }
    const key = `detail:${repo.owner}/${repo.name}:${request.number}`
    return this.cachedRead(key, async () => {
      const raw = await this.gh().graphql(GET_PULL_REQUEST_QUERY, { owner: repo.owner, name: repo.name, number: request.number })
      return mapPullRequestDetail(raw, repo)
    })
  }

  /**
   * List one pull request's review threads with a resolution filter.
   * @param request - repository, number, and `unresolved`-default filter.
   * @returns matching thread summaries with GraphQL thread ids.
   */
  @Remote('listThreads')
  async listThreads(request: GithubListThreadsRequest): Promise<GithubResult<GithubThreadListValue>> {
    let repo: GithubRepoRef
    try {
      repo = this.resolveRepo(request.repo)
    } catch (error: unknown) {
      return this.guardFailure(error)
    }
    const filter = request.filter ?? 'unresolved'
    const key = `threads:${repo.owner}/${repo.name}:${request.number}:${filter}`
    return this.cachedRead(key, async () => {
      const raw = await this.gh().graphql(GET_PULL_REQUEST_QUERY, { owner: repo.owner, name: repo.name, number: request.number })
      const threads = mapThreadSummaries(raw)
      const filtered = filter === 'all'
        ? threads
        : threads.filter(thread => filter === 'resolved' ? thread.isResolved : !thread.isResolved)
      return Object.freeze({
        repo: Object.freeze({ owner: repo.owner, name: repo.name }),
        number: request.number,
        filter,
        threads: Object.freeze(filtered),
      })
    })
  }

  /**
   * Read one review thread's complete comment bodies by GraphQL node id.
   * @param request - the thread id.
   * @returns the full thread.
   */
  @Remote('getThread')
  async getThread(request: GithubThreadRequest): Promise<GithubResult<GithubThreadFull>> {
    const key = `thread:${request.threadId}`
    return this.cachedRead(key, async () => {
      const raw = await this.gh().graphql(GET_THREAD_QUERY, { id: request.threadId })
      return mapThreadFull(raw)
    })
  }

  /**
   * List one pull request's commits.
   * @param request - repository, number, and optional row cap.
   * @returns commit rows plus the total commit count.
   */
  @Remote('listCommits')
  async listCommits(request: GithubListCommitsRequest): Promise<GithubResult<GithubCommitListValue>> {
    let repo: GithubRepoRef
    try {
      repo = this.resolveRepo(request.repo)
    } catch (error: unknown) {
      return this.guardFailure(error)
    }
    const first = Math.min(Math.max(request.first ?? 100, 1), MAX_COMMITS_FIRST)
    const key = `commits:${repo.owner}/${repo.name}:${request.number}:${first}`
    return this.cachedRead(key, async () => {
      const raw = await this.gh().graphql(LIST_COMMITS_QUERY, {
        owner: repo.owner,
        name: repo.name,
        number: request.number,
        first,
      }) as Record<string, unknown>
      const commits = mapCommitList(raw)
      const totalCount = this.extractTotalCount(raw) ?? commits.length
      return Object.freeze({
        repo: Object.freeze({ owner: repo.owner, name: repo.name }),
        number: request.number,
        totalCount,
        commits,
      })
    })
  }

  private extractTotalCount(raw: Record<string, unknown>): number | undefined {
    /* v8 ignore start -- mapCommitList validated this exact container chain before the total is
    extracted; only the totalCount leaf varies. */
    const data = raw.data
    if (typeof data !== 'object' || data === null) return undefined
    const repository = (data as Record<string, unknown>).repository
    if (typeof repository !== 'object' || repository === null) return undefined
    const pullRequest = (repository as Record<string, unknown>).pullRequest
    if (typeof pullRequest !== 'object' || pullRequest === null) return undefined
    const commits = (pullRequest as Record<string, unknown>).commits
    if (typeof commits !== 'object' || commits === null) return undefined
    /* v8 ignore stop */
    const totalCount = (commits as Record<string, unknown>).totalCount
    return typeof totalCount === 'number' ? totalCount : undefined
  }

  /**
   * Collect one pull request's bulk context through `gh pr-enrich`.
   * Enrichment exports PR content to a model provider and is double-gated:
   * the `allowEnrich` configuration and a per-call `confirmExport`.
   * @param request - target plus optional enrichment consent and checkout path.
   * @returns the context digest with on-disk report locations.
   */
  @Remote('getContext')
  async getContext(request: GithubGetContextRequest): Promise<GithubResult<GithubContextDigest>> {
    let repo: GithubRepoRef
    try {
      repo = this.resolveRepo(request.repo)
    } catch (error: unknown) {
      return this.guardFailure(error)
    }
    const enrich = request.enrich === true
    if (enrich && !this.config_.allowEnrich) {
      return rejected('enrich-disabled', 'enrichment is disabled by the allowEnrich configuration')
    }
    if (enrich && request.confirmExport !== true) {
      return rejected(
        'confirmation-required',
        'enrichment exports pull-request content to a model provider; pass confirmExport: true to consent',
      )
    }
    const reportDir = join(this.config_.reportRoot, `${repo.owner}-${repo.name}-pr-${request.number}`)
    try {
      await mkdir(reportDir, { recursive: true })
      const args = ['pr-enrich', String(request.number), '--json', '--output-dir', reportDir]
      if (enrich) args.push('--enrich')
      const result = await this.gh().run(args, {
        cwd: request.repoPath,
        timeoutMs: enrich ? this.config_.enrichTimeoutMs : this.config_.timeoutMs,
      })
      return success(await this.buildContextDigest(repo, request.number, reportDir, enrich, result.stderr))
    } catch (error: unknown) {
      if (error instanceof GhExecutionError && error.code === 'gh-failed') {
        return rejected(
          'enrich-failed',
          `gh pr-enrich failed; repoPath must be a local checkout of ${repo.owner}/${repo.name} when the session workspace is not`,
          clipTail(error.detail),
        )
      }
      return this.guardFailure(error)
    }
  }

  private async buildContextDigest(
    repo: GithubRepoRef,
    number: number,
    reportDir: string,
    enrich: boolean,
    stderrTail: string,
  ): Promise<GithubContextDigest> {
    const combinedPath = join(reportDir, 'combined-data.json')
    let combined: Record<string, unknown>
    try {
      combined = JSON.parse(await readFile(combinedPath, 'utf8')) as Record<string, unknown>
    } catch (error: unknown) {
      throw new GhExecutionError('gh pr-enrich produced no parsable combined-data.json', 'enrich-failed', clipTail(stderrTail), { cause: error })
    }
    const metadata = (combined.metadata ?? {}) as Record<string, unknown>
    const comments = Array.isArray(combined.comments) ? combined.comments : []
    const threads = (combined.comment_threads as Record<string, unknown> | undefined) ?? {}
    const threadNodes = this.threadNodesOf(threads)
    const checksStats = this.checkStatsOf(combined)
    const enriched = enrich && existsSync(join(reportDir, 'claude-analysis.json'))
    return Object.freeze({
      repo: Object.freeze({ owner: repo.owner, name: repo.name }),
      number,
      generatedAt: typeof metadata.generated_at === 'string' ? metadata.generated_at : '',
      reportDir,
      commentCount: comments.length,
      threadCounts: Object.freeze({
        total: threadNodes.length,
        unresolved: threadNodes.filter(node => node.isResolved === false).length,
      }),
      checks: Object.freeze(checksStats),
      enriched,
      files: Object.freeze({
        combined: combinedPath,
        report: join(reportDir, 'comprehensive-report.md'),
        threads: join(reportDir, 'comment-threads.json'),
      }),
    })
  }

  private threadNodesOf(threads: Record<string, unknown>): readonly Record<string, unknown>[] {
    const data = threads.data
    if (typeof data !== 'object' || data === null) return []
    const repository = (data as Record<string, unknown>).repository
    if (typeof repository !== 'object' || repository === null) return []
    const pullRequest = (repository as Record<string, unknown>).pullRequest
    if (typeof pullRequest !== 'object' || pullRequest === null) return []
    const reviewThreads = (pullRequest as Record<string, unknown>).reviewThreads
    if (typeof reviewThreads !== 'object' || reviewThreads === null) return []
    const nodes = (reviewThreads as Record<string, unknown>).nodes
    return Array.isArray(nodes) ? nodes.filter((node): node is Record<string, unknown> => typeof node === 'object' && node !== null) : []
  }

  private checkStatsOf(combined: Record<string, unknown>): {
    total: number
    passing: number
    failing: number
    pending: number
    overallState: string
  } {
    const statistics = (combined.statistics ?? {}) as Record<string, unknown>
    const checks = (statistics.checks ?? {}) as Record<string, unknown>
    const count = (key: string): number => (typeof checks[key] === 'number' ? checks[key] : 0)
    return {
      total: count('total'),
      passing: count('passing'),
      failing: count('failing'),
      pending: count('pending'),
      overallState: typeof checks.overall_state === 'string' ? checks.overall_state : 'unknown',
    }
  }

  /**
   * Create one top-level issue comment on a pull request.
   * @param request - target and comment body.
   * @returns the created comment's URL.
   */
  @Remote('addComment')
  addComment(request: GithubAddCommentRequest): Promise<GithubResult<GithubCommentCreatedValue>> {
    return this.guardedWrite(() => this.writeGate(), async () => {
      const repo = this.resolveRepo(request.repo)
      const result = await this.gh().run([
        'pr', 'comment', String(request.number),
        '--repo', `${repo.owner}/${repo.name}`,
        '--body', request.body,
      ])
      return Object.freeze({ url: result.stdout.trim() })
    })
  }

  /**
   * Reply inside one review thread.
   * @param request - thread id and reply body.
   * @returns the created reply's URL.
   */
  @Remote('replyToThread')
  replyToThread(request: GithubReplyToThreadRequest): Promise<GithubResult<GithubCommentCreatedValue>> {
    return this.guardedWrite(() => this.writeGate(), async () => {
      const raw = await this.gh().graphql(REPLY_TO_THREAD_MUTATION, {
        threadId: request.threadId,
        body: request.body,
      })
      return Object.freeze({ url: mapThreadReply(raw) })
    })
  }

  /**
   * Resolve or unresolve one review thread.
   * @param request - thread id and desired resolution state.
   * @returns the thread's new resolution state.
   */
  @Remote('setThreadResolved')
  setThreadResolved(request: GithubSetThreadResolvedRequest): Promise<GithubResult<GithubThreadResolutionValue>> {
    return this.guardedWrite(() => this.writeGate(), async () => {
      const mutation = request.resolved ? RESOLVE_THREAD_MUTATION : UNRESOLVE_THREAD_MUTATION
      const raw = await this.gh().graphql(mutation, { threadId: request.threadId })
      const isResolved = mapThreadResolution(raw, request.resolved ? 'resolveReviewThread' : 'unresolveReviewThread')
      return Object.freeze({ threadId: request.threadId, isResolved })
    })
  }

  /**
   * Submit one pull-request review. Requires `confirm: true`; GitHub
   * forbids approving or requesting changes on your own pull request,
   * which surfaces as the `self-review-forbidden` domain outcome.
   * @param request - target, event, optional body, and confirmation.
   * @returns the submitted review facts.
   */
  @Remote('submitReview')
  submitReview(request: GithubSubmitReviewRequest): Promise<GithubResult<GithubReviewSubmittedValue>> {
    return this.guardedWrite(() => {
      const write = this.writeGate()
      if (write !== null) return write
      return this.requireConfirmation(request.confirm, 'submitting a review')
    }, async () => {
      const repo = this.resolveRepo(request.repo)
      const flag = request.event === 'approve' ? '--approve' : request.event === 'request-changes' ? '--request-changes' : '--comment'
      const args = ['pr', 'review', String(request.number), '--repo', `${repo.owner}/${repo.name}`, flag]
      if (request.body !== undefined) args.push('--body', request.body)
      await this.gh().run(args)
      return Object.freeze({
        repo: Object.freeze({ owner: repo.owner, name: repo.name }),
        number: request.number,
        event: request.event,
      })
    })
  }

  /**
   * Merge one pull request. Requires `confirm: true`.
   * @param request - target, merge method, optional branch deletion, confirmation.
   * @returns the merge facts.
   */
  @Remote('mergePullRequest')
  mergePullRequest(request: GithubMergePullRequestRequest): Promise<GithubResult<GithubPullRequestMergedValue>> {
    return this.guardedWrite(() => {
      const write = this.writeGate()
      if (write !== null) return write
      return this.requireConfirmation(request.confirm, 'merging a pull request')
    }, async () => {
      const repo = this.resolveRepo(request.repo)
      const flag = request.method === 'squash' ? '--squash' : request.method === 'rebase' ? '--rebase' : '--merge'
      const args = ['pr', 'merge', String(request.number), '--repo', `${repo.owner}/${repo.name}`, flag]
      if (request.deleteBranch === true) args.push('--delete-branch')
      await this.gh().run(args)
      return Object.freeze({
        repo: Object.freeze({ owner: repo.owner, name: repo.name }),
        number: request.number,
        method: request.method,
      })
    })
  }

  /**
   * Close one pull request without merging. Requires `confirm: true`.
   * @param request - target and confirmation.
   * @returns the new lifecycle state.
   */
  @Remote('closePullRequest')
  closePullRequest(request: GithubClosePullRequestRequest): Promise<GithubResult<GithubPullRequestStateValue>> {
    return this.guardedWrite(() => {
      const write = this.writeGate()
      if (write !== null) return write
      return this.requireConfirmation(request.confirm, 'closing a pull request')
    }, async () => {
      const repo = this.resolveRepo(request.repo)
      await this.gh().run(['pr', 'close', String(request.number), '--repo', `${repo.owner}/${repo.name}`])
      return Object.freeze({
        repo: Object.freeze({ owner: repo.owner, name: repo.name }),
        number: request.number,
        state: 'CLOSED' as const,
      })
    })
  }

  /**
   * Reopen one closed pull request.
   * @param request - the target.
   * @returns the new lifecycle state.
   */
  @Remote('reopenPullRequest')
  reopenPullRequest(request: GithubReopenPullRequestRequest): Promise<GithubResult<GithubPullRequestStateValue>> {
    return this.guardedWrite(() => this.writeGate(), async () => {
      const repo = this.resolveRepo(request.repo)
      await this.gh().run(['pr', 'reopen', String(request.number), '--repo', `${repo.owner}/${repo.name}`])
      return Object.freeze({
        repo: Object.freeze({ owner: repo.owner, name: repo.name }),
        number: request.number,
        state: 'OPEN' as const,
      })
    })
  }
}

export default GithubService
