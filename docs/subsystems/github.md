# GitHub Pull-Request Gateway

English | [中文](github.zh.md)

[`@deepseek-ai/dsh-github`](../../packages/github/github) owns the Host gateway for the GitHub pull-request domain. It registers `ctx.github`, spawns the authenticated `gh` CLI exclusively through the `ctx.subprocess` seam, and publishes the `github.*` unary Remote contract. Reads run through `gh api graphql`; comments, reviews, merges, closes, and reopens run through the matching `gh pr` subcommands. The package README owns configuration, gating, caching, and error-code semantics; this page is the public type contract those operations cross.

Source: [`packages/github/github/src/types.ts`](../../packages/github/github/src/types.ts)

## Public types

```ts type-equiv
/** GraphQL node id of one pull-request review thread (`PRRT_...`). */
type GithubThreadId = Branded<'githubThreadId'>
```

```ts type-equiv
/** Full SHA of one commit. */
type GithubCommitSha = Branded<'githubCommitSha'>
```

```ts type-equiv
/** One repository addressed as its owner/name pair. */
interface GithubRepoRef {
  /** Repository owner login or organization. */
  readonly owner: string
  /** Repository name without the owner prefix. */
  readonly name: string
}
```

```ts type-equiv
/** Pull-request lifecycle state in GitHub's vocabulary. */
type GithubPrState = 'OPEN' | 'MERGED' | 'CLOSED'
```

```ts type-equiv
/** Mergeability classification in GitHub's vocabulary. */
type GithubMergeable = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
```

```ts type-equiv
/** Head-commit check rollup state in GitHub's vocabulary. */
type GithubChecksState = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR' | 'EXPECTED'
```

```ts type-equiv
/** Review-decision classification in GitHub's vocabulary. */
type GithubReviewDecision
  = 'APPROVED' | 'REVIEW_REQUIRED' | 'CHANGES_REQUESTED' | 'CLOSED'
```

```ts type-equiv
/** Subset of GitHub review events accepted by `submitReview`. */
type GithubReviewEvent = 'approve' | 'request-changes' | 'comment'
```

```ts type-equiv
/** Merge method accepted by `mergePullRequest`. */
type GithubMergeMethod = 'squash' | 'merge' | 'rebase'
```

```ts type-equiv
/** Filter selecting which review threads a listing returns. */
type GithubThreadFilter = 'all' | 'resolved' | 'unresolved'
```

```ts type-equiv
/** Compact listing row for one pull request. */
interface GithubPrSummary {
  readonly repo: GithubRepoRef
  readonly number: number
  readonly title: string
  readonly state: GithubPrState
  readonly isDraft: boolean
  readonly author: string
  readonly headRef: string
  readonly baseRef: string
  readonly updatedAt: string
  readonly mergeable: GithubMergeable
  readonly reviewDecision: GithubReviewDecision | null
  readonly checksState: GithubChecksState | null
}
```

```ts type-equiv
/** One check context contributing to a rollup. */
interface GithubCheckContext {
  readonly kind: 'check-run' | 'status'
  readonly name: string
  readonly status: string
  readonly conclusion: string | null
  readonly url: string | null
}
```

```ts type-equiv
/** Aggregated check state of the pull request's head commit. */
interface GithubChecksSummary {
  readonly state: GithubChecksState | null
  readonly contexts: readonly GithubCheckContext[]
}
```

```ts type-equiv
/** Thread listing row: identity, location, resolution state, first comment. */
interface GithubThreadSummary {
  readonly id: GithubThreadId
  readonly path: string
  readonly line: number | null
  readonly isResolved: boolean
  readonly isOutdated: boolean
  readonly commentCount: number
  readonly resolvedBy: string | null
  readonly firstComment: GithubThreadComment | null
}
```

```ts type-equiv
/** One comment inside a review thread. */
interface GithubThreadComment {
  readonly id: string
  readonly databaseId: number
  readonly author: string
  readonly createdAt: string
  readonly body: string
}
```

```ts type-equiv
/** Complete review thread with every comment body. */
interface GithubThreadFull {
  readonly id: GithubThreadId
  readonly path: string
  readonly line: number | null
  readonly isResolved: boolean
  readonly comments: readonly GithubThreadComment[]
}
```

```ts type-equiv
/** One commit of a pull request. */
interface GithubCommitInfo {
  readonly sha: GithubCommitSha
  readonly headline: string
  readonly authorLogin: string | null
  readonly authorName: string | null
  readonly authoredDate: string
}
```

```ts type-equiv
/** Full pull-request detail: summary fields plus bodies, counts, and checks. */
interface GithubPrDetail extends GithubPrSummary {
  readonly nodeId: string
  readonly bodyText: string
  readonly additions: number
  readonly deletions: number
  readonly changedFiles: number
  readonly createdAt: string
  readonly labels: readonly string[]
  readonly threadCounts: {
    readonly total: number
    readonly unresolved: number
  }
  readonly checks: GithubChecksSummary
}
```

```ts type-equiv
/** Digest of one `gh pr-enrich` bulk-context collection. */
interface GithubContextDigest {
  readonly repo: GithubRepoRef
  readonly number: number
  readonly generatedAt: string
  readonly reportDir: string
  readonly commentCount: number
  readonly threadCounts: {
    readonly total: number
    readonly unresolved: number
  }
  readonly checks: {
    readonly total: number
    readonly passing: number
    readonly failing: number
    readonly pending: number
    readonly overallState: string
  }
  readonly enriched: boolean
  readonly files: {
    readonly combined: string
    readonly report: string
    readonly threads: string
  }
}
```

```ts type-equiv
/** Business failure carried by every non-ok result. */
interface GithubFailure {
  /** Stable machine-readable failure class. */
  readonly code: GithubErrorCode
  /** Human-readable explanation safe to surface to model and UI alike. */
  readonly message: string
  /** Optional diagnostic tail (gh stderr excerpt) for operator inspection. */
  readonly detail?: string
}
```

```ts type-equiv
/** Successful result branch. */
interface GithubSuccess<T> {
  readonly ok: true
  readonly value: T
}
```

```ts type-equiv
/** Rejected result branch. */
interface GithubRejected {
  readonly ok: false
  readonly error: GithubFailure
}
```

```ts type-equiv
/** Result union of every service operation. */
type GithubResult<T> = GithubSuccess<T> | GithubRejected
```

```ts type-equiv
/**
 * Stable failure classes. `gh-*` and `graphql-error` are infrastructure;
 * the remaining codes are domain decisions the caller can branch on.
 */
type GithubErrorCode =
  | 'gh-missing'
  | 'gh-launch-failed'
  | 'gh-failed'
  | 'graphql-error'
  | 'invalid-response'
  | 'invalid-repo'
  | 'no-repo-configured'
  | 'not-found'
  | 'writes-disabled'
  | 'enrich-disabled'
  | 'confirmation-required'
  | 'self-review-forbidden'
  | 'enrich-failed'
  | 'output-overflow'
  | 'aborted'
```

```ts type-equiv
/** Listing request: repository selection plus optional state filter. */
interface GithubListPullRequestsRequest {
  /** `owner/name`; omit only when exactly one favorite is configured. */
  readonly repo?: string | undefined
  /** Restrict the listing to one lifecycle state. */
  readonly state?: GithubPrState | undefined
  /** Maximum rows (1..100); defaults to 30. */
  readonly first?: number | undefined
}
```

```ts type-equiv
/** One repository's listing result. */
interface GithubPullRequestListValue {
  readonly repo: GithubRepoRef
  readonly pullRequests: readonly GithubPrSummary[]
}
```

```ts type-equiv
/** Request addressing one pull request by repository and number. */
interface GithubPullRequestRequest {
  /** `owner/name`. */
  readonly repo: string
  readonly number: number
}
```

```ts type-equiv
/** Thread listing request with a resolution-state filter. */
interface GithubListThreadsRequest {
  readonly repo: string
  readonly number: number
  /** Which threads to return; defaults to `unresolved`. */
  readonly filter?: GithubThreadFilter | undefined
}
```

```ts type-equiv
/** Thread listing result. */
interface GithubThreadListValue {
  readonly repo: GithubRepoRef
  readonly number: number
  readonly filter: GithubThreadFilter
  readonly threads: readonly GithubThreadSummary[]
}
```

```ts type-equiv
/** Request addressing one review thread by GraphQL node id. */
interface GithubThreadRequest {
  readonly threadId: GithubThreadId
}
```

```ts type-equiv
/** Commit listing request. */
interface GithubListCommitsRequest {
  readonly repo: string
  readonly number: number
  /** Maximum rows (1..250); defaults to 100. */
  readonly first?: number | undefined
}
```

```ts type-equiv
/** Commit listing result. */
interface GithubCommitListValue {
  readonly repo: GithubRepoRef
  readonly number: number
  readonly totalCount: number
  readonly commits: readonly GithubCommitInfo[]
}
```

```ts type-equiv
/** Bulk-context request over `gh pr-enrich`. */
interface GithubGetContextRequest {
  readonly repo: string
  readonly number: number
  /** Run Claude analysis on the collected context (exports PR content). */
  readonly enrich?: boolean | undefined
  /** Explicit consent to the content export; required when `enrich`. */
  readonly confirmExport?: boolean | undefined
  /** Local checkout of the repository; defaults to the harness cwd. */
  readonly repoPath?: string | undefined
}
```

```ts type-equiv
/** Create one top-level issue comment. */
interface GithubAddCommentRequest {
  readonly repo: string
  readonly number: number
  readonly body: string
}
```

```ts type-equiv
/** Reply inside one review thread. */
interface GithubReplyToThreadRequest {
  readonly threadId: GithubThreadId
  readonly body: string
}
```

```ts type-equiv
/** Resolve or unresolve one review thread. */
interface GithubSetThreadResolvedRequest {
  readonly threadId: GithubThreadId
  readonly resolved: boolean
}
```

```ts type-equiv
/** Submit one pull-request review. */
interface GithubSubmitReviewRequest {
  readonly repo: string
  readonly number: number
  readonly event: GithubReviewEvent
  readonly body?: string | undefined
  /** Must be true for the review to execute. */
  readonly confirm?: boolean | undefined
}
```

```ts type-equiv
/** Merge one pull request. */
interface GithubMergePullRequestRequest {
  readonly repo: string
  readonly number: number
  readonly method: GithubMergeMethod
  readonly deleteBranch?: boolean | undefined
  /** Must be true for the merge to execute. */
  readonly confirm?: boolean | undefined
}
```

```ts type-equiv
/** Close one pull request. */
interface GithubClosePullRequestRequest {
  readonly repo: string
  readonly number: number
  /** Must be true for the close to execute. */
  readonly confirm?: boolean | undefined
}
```

```ts type-equiv
/** Reopen one closed pull request. */
interface GithubReopenPullRequestRequest {
  readonly repo: string
  readonly number: number
}
```

```ts type-equiv
/** URL of one created comment. */
interface GithubCommentCreatedValue {
  readonly url: string
}
```

```ts type-equiv
/** New resolution state of one thread. */
interface GithubThreadResolutionValue {
  readonly threadId: GithubThreadId
  readonly isResolved: boolean
}
```

```ts type-equiv
/** Submitted review facts. */
interface GithubReviewSubmittedValue {
  readonly repo: GithubRepoRef
  readonly number: number
  readonly event: GithubReviewEvent
}
```

```ts type-equiv
/** Merge outcome. */
interface GithubPullRequestMergedValue {
  readonly repo: GithubRepoRef
  readonly number: number
  readonly method: GithubMergeMethod
}
```

```ts type-equiv
/** Lifecycle outcome of a close or reopen. */
interface GithubPullRequestStateValue {
  readonly repo: GithubRepoRef
  readonly number: number
  readonly state: GithubPrState
}
```

```ts type-equiv
/** Deployment policy for the GitHub capability. */
interface GithubConfig {
  /** `gh` executable: absolute path or bare PATH name. */
  readonly ghPath: string
  /** Repositories addressable without an explicit `repo` argument. */
  readonly favorites: string[]
  /** In-memory read-cache lifetime in milliseconds; 0 disables caching. */
  readonly cacheTtlMs: number
  /** Deadline for one ordinary `gh` invocation, in milliseconds. */
  readonly timeoutMs: number
  /** Deadline for one `gh pr-enrich --enrich` invocation, in milliseconds. */
  readonly enrichTimeoutMs: number
  /** In-memory cap in bytes for one collected `gh` stdout stream. */
  readonly maxOutputBytes: number
  /** Whether write operations (comments, threads, reviews, merge) execute. */
  readonly allowWrites: boolean
  /** Whether `--enrich` analysis may export PR content to a model provider. */
  readonly allowEnrich: boolean
  /** Root directory for `gh pr-enrich` report directories. */
  readonly reportRoot: string
  /** Explicit environment layered onto every `gh` child (fixture hosts, tokens). */
  readonly childEnv: Record<string, string>
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxgithub--githubservice"></a>

### `ctx.github` — `GithubService`

The GitHub capability service. Reads are TTL-cached in memory; every successful write invalidates the whole cache. All subprocess work routes through the subprocess capability seam with fixed argv vectors.

```ts cordis-catalog
/**
 * List pull requests of one repository ordered by most recently updated.
 * @param request - repository selection plus optional state filter.
 * @returns the repository's matching pull-request summaries.
 */
@Remote('listPullRequests') async listPullRequests(request: GithubListPullRequestsRequest): Promise<GithubResult<GithubPullRequestListValue>>

/**
 * Read one pull request's full detail: metadata, thread counts, checks.
 * @param request - repository and pull-request number.
 * @returns the complete detail row.
 */
@Remote('getPullRequest') async getPullRequest(request: GithubPullRequestRequest): Promise<GithubResult<GithubPrDetail>>

/**
 * List one pull request's review threads with a resolution filter.
 * @param request - repository, number, and `unresolved`-default filter.
 * @returns matching thread summaries with GraphQL thread ids.
 */
@Remote('listThreads') async listThreads(request: GithubListThreadsRequest): Promise<GithubResult<GithubThreadListValue>>

/**
 * Read one review thread's complete comment bodies by GraphQL node id.
 * @param request - the thread id.
 * @returns the full thread.
 */
@Remote('getThread') async getThread(request: GithubThreadRequest): Promise<GithubResult<GithubThreadFull>>

/**
 * List one pull request's commits.
 * @param request - repository, number, and optional row cap.
 * @returns commit rows plus the total commit count.
 */
@Remote('listCommits') async listCommits(request: GithubListCommitsRequest): Promise<GithubResult<GithubCommitListValue>>

/**
 * Collect one pull request's bulk context through `gh pr-enrich`.
 * Enrichment exports PR content to a model provider and is double-gated:
 * the `allowEnrich` configuration and a per-call `confirmExport`.
 * @param request - target plus optional enrichment consent and checkout path.
 * @returns the context digest with on-disk report locations.
 */
@Remote('getContext') async getContext(request: GithubGetContextRequest): Promise<GithubResult<GithubContextDigest>>

/**
 * Create one top-level issue comment on a pull request.
 * @param request - target and comment body.
 * @returns the created comment's URL.
 */
@Remote('addComment') addComment(request: GithubAddCommentRequest): Promise<GithubResult<GithubCommentCreatedValue>>

/**
 * Reply inside one review thread.
 * @param request - thread id and reply body.
 * @returns the created reply's URL.
 */
@Remote('replyToThread') replyToThread(request: GithubReplyToThreadRequest): Promise<GithubResult<GithubCommentCreatedValue>>

/**
 * Resolve or unresolve one review thread.
 * @param request - thread id and desired resolution state.
 * @returns the thread's new resolution state.
 */
@Remote('setThreadResolved') setThreadResolved(request: GithubSetThreadResolvedRequest): Promise<GithubResult<GithubThreadResolutionValue>>

/**
 * Submit one pull-request review. Requires `confirm: true`; GitHub
 * forbids approving or requesting changes on your own pull request,
 * which surfaces as the `self-review-forbidden` domain outcome.
 * @param request - target, event, optional body, and confirmation.
 * @returns the submitted review facts.
 */
@Remote('submitReview') submitReview(request: GithubSubmitReviewRequest): Promise<GithubResult<GithubReviewSubmittedValue>>

/**
 * Merge one pull request. Requires `confirm: true`.
 * @param request - target, merge method, optional branch deletion, confirmation.
 * @returns the merge facts.
 */
@Remote('mergePullRequest') mergePullRequest(request: GithubMergePullRequestRequest): Promise<GithubResult<GithubPullRequestMergedValue>>

/**
 * Close one pull request without merging. Requires `confirm: true`.
 * @param request - target and confirmation.
 * @returns the new lifecycle state.
 */
@Remote('closePullRequest') closePullRequest(request: GithubClosePullRequestRequest): Promise<GithubResult<GithubPullRequestStateValue>>

/**
 * Reopen one closed pull request.
 * @param request - the target.
 * @returns the new lifecycle state.
 */
@Remote('reopenPullRequest') reopenPullRequest(request: GithubReopenPullRequestRequest): Promise<GithubResult<GithubPullRequestStateValue>>
```

Source: [`packages/github/github/src/index.ts:128`](../../packages/github/github/src/index.ts)
<!-- END GENERATED cordis-surface -->
