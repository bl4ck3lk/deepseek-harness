/**
 * Domain types crossing the GitHub capability boundary: pull-request reads,
 * review-thread management, and the write actions the service performs
 * through the `gh` CLI. Types only — no runtime code.
 * @module @deepseek-ai/dsh-github/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** GraphQL node id of one pull-request review thread (`PRRT_...`). */
export type GithubThreadId = Branded<'githubThreadId'>

/** Full SHA of one commit. */
export type GithubCommitSha = Branded<'githubCommitSha'>

/** One repository addressed as its owner/name pair. */
export interface GithubRepoRef {
  /** Repository owner login or organization. */
  readonly owner: string
  /** Repository name without the owner prefix. */
  readonly name: string
}

/** Pull-request lifecycle state in GitHub's vocabulary. */
export type GithubPrState = 'OPEN' | 'MERGED' | 'CLOSED'

/** Mergeability classification in GitHub's vocabulary. */
export type GithubMergeable = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'

/** Head-commit check rollup state in GitHub's vocabulary. */
export type GithubChecksState = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR' | 'EXPECTED'

/** Review-decision classification in GitHub's vocabulary. */
export type GithubReviewDecision
  = 'APPROVED' | 'REVIEW_REQUIRED' | 'CHANGES_REQUESTED' | 'CLOSED'

/** Subset of GitHub review events accepted by `submitReview`. */
export type GithubReviewEvent = 'approve' | 'request-changes' | 'comment'

/** Merge method accepted by `mergePullRequest`. */
export type GithubMergeMethod = 'squash' | 'merge' | 'rebase'

/** Filter selecting which review threads a listing returns. */
export type GithubThreadFilter = 'all' | 'resolved' | 'unresolved'

/** Compact listing row for one pull request. */
export interface GithubPrSummary {
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

/** One check context contributing to a rollup. */
export interface GithubCheckContext {
  readonly kind: 'check-run' | 'status'
  readonly name: string
  readonly status: string
  readonly conclusion: string | null
  readonly url: string | null
}

/** Aggregated check state of the pull request's head commit. */
export interface GithubChecksSummary {
  readonly state: GithubChecksState | null
  readonly contexts: readonly GithubCheckContext[]
}

/** Thread listing row: identity, location, resolution state, first comment. */
export interface GithubThreadSummary {
  readonly id: GithubThreadId
  readonly path: string
  readonly line: number | null
  readonly isResolved: boolean
  readonly isOutdated: boolean
  readonly commentCount: number
  readonly resolvedBy: string | null
  readonly firstComment: GithubThreadComment | null
}

/** One comment inside a review thread. */
export interface GithubThreadComment {
  readonly id: string
  readonly databaseId: number
  readonly author: string
  readonly createdAt: string
  readonly body: string
}

/** Complete review thread with every comment body. */
export interface GithubThreadFull {
  readonly id: GithubThreadId
  readonly path: string
  readonly line: number | null
  readonly isResolved: boolean
  readonly comments: readonly GithubThreadComment[]
}

/** One commit of a pull request. */
export interface GithubCommitInfo {
  readonly sha: GithubCommitSha
  readonly headline: string
  readonly authorLogin: string | null
  readonly authorName: string | null
  readonly authoredDate: string
}

/** Full pull-request detail: summary fields plus bodies, counts, and checks. */
export interface GithubPrDetail extends GithubPrSummary {
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

/** Digest of one `gh pr-enrich` bulk-context collection. */
export interface GithubContextDigest {
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

/** Business failure carried by every non-ok result. */
export interface GithubFailure {
  /** Stable machine-readable failure class. */
  readonly code: GithubErrorCode
  /** Human-readable explanation safe to surface to model and UI alike. */
  readonly message: string
  /** Optional diagnostic tail (gh stderr excerpt) for operator inspection. */
  readonly detail?: string
}

/** Successful result branch. */
export interface GithubSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Rejected result branch. */
export interface GithubRejected {
  readonly ok: false
  readonly error: GithubFailure
}

/** Result union of every service operation. */
export type GithubResult<T> = GithubSuccess<T> | GithubRejected

/**
 * Stable failure classes. `gh-*` and `graphql-error` are infrastructure;
 * the remaining codes are domain decisions the caller can branch on.
 */
export type GithubErrorCode =
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

/** Listing request: repository selection plus optional state filter. */
export interface GithubListPullRequestsRequest {
  /** `owner/name`; omit only when exactly one favorite is configured. */
  readonly repo?: string | undefined
  /** Restrict the listing to one lifecycle state. */
  readonly state?: GithubPrState | undefined
  /** Maximum rows (1..100); defaults to 30. */
  readonly first?: number | undefined
}

/** One repository's listing result. */
export interface GithubPullRequestListValue {
  readonly repo: GithubRepoRef
  readonly pullRequests: readonly GithubPrSummary[]
}

/** Request addressing one pull request by repository and number. */
export interface GithubPullRequestRequest {
  /** `owner/name`; omit only when exactly one favorite is configured. */
  readonly repo?: string | undefined
  readonly number: number
}

/** Thread listing request with a resolution-state filter. */
export interface GithubListThreadsRequest {
  readonly repo?: string | undefined
  readonly number: number
  /** Which threads to return; defaults to `unresolved`. */
  readonly filter?: GithubThreadFilter | undefined
}

/** Thread listing result. */
export interface GithubThreadListValue {
  readonly repo: GithubRepoRef
  readonly number: number
  readonly filter: GithubThreadFilter
  readonly threads: readonly GithubThreadSummary[]
}

/** Request addressing one review thread by GraphQL node id. */
export interface GithubThreadRequest {
  readonly threadId: GithubThreadId
}

/** Commit listing request. */
export interface GithubListCommitsRequest {
  readonly repo?: string | undefined
  readonly number: number
  /** Maximum rows (1..250); defaults to 100. */
  readonly first?: number | undefined
}

/** Commit listing result. */
export interface GithubCommitListValue {
  readonly repo: GithubRepoRef
  readonly number: number
  readonly totalCount: number
  readonly commits: readonly GithubCommitInfo[]
}

/** Bulk-context request over `gh pr-enrich`. */
export interface GithubGetContextRequest {
  readonly repo?: string | undefined
  readonly number: number
  /** Run Claude analysis on the collected context (exports PR content). */
  readonly enrich?: boolean | undefined
  /** Explicit consent to the content export; required when `enrich`. */
  readonly confirmExport?: boolean | undefined
  /** Local checkout of the repository; defaults to the harness cwd. */
  readonly repoPath?: string | undefined
}

/** Create one top-level issue comment. */
export interface GithubAddCommentRequest {
  readonly repo?: string | undefined
  readonly number: number
  readonly body: string
}

/** Reply inside one review thread. */
export interface GithubReplyToThreadRequest {
  readonly threadId: GithubThreadId
  readonly body: string
}

/** Resolve or unresolve one review thread. */
export interface GithubSetThreadResolvedRequest {
  readonly threadId: GithubThreadId
  readonly resolved: boolean
}

/** Submit one pull-request review. */
export interface GithubSubmitReviewRequest {
  readonly repo?: string | undefined
  readonly number: number
  readonly event: GithubReviewEvent
  readonly body?: string | undefined
  /** Must be true for the review to execute. */
  readonly confirm?: boolean | undefined
}

/** Merge one pull request. */
export interface GithubMergePullRequestRequest {
  readonly repo?: string | undefined
  readonly number: number
  readonly method: GithubMergeMethod
  readonly deleteBranch?: boolean | undefined
  /** Must be true for the merge to execute. */
  readonly confirm?: boolean | undefined
}

/** Close one pull request. */
export interface GithubClosePullRequestRequest {
  readonly repo?: string | undefined
  readonly number: number
  /** Must be true for the close to execute. */
  readonly confirm?: boolean | undefined
}

/** Reopen one closed pull request. */
export interface GithubReopenPullRequestRequest {
  readonly repo?: string | undefined
  readonly number: number
}

/** URL of one created comment. */
export interface GithubCommentCreatedValue {
  readonly url: string
}

/** New resolution state of one thread. */
export interface GithubThreadResolutionValue {
  readonly threadId: GithubThreadId
  readonly isResolved: boolean
}

/** Submitted review facts. */
export interface GithubReviewSubmittedValue {
  readonly repo: GithubRepoRef
  readonly number: number
  readonly event: GithubReviewEvent
}

/** Merge outcome. */
export interface GithubPullRequestMergedValue {
  readonly repo: GithubRepoRef
  readonly number: number
  readonly method: GithubMergeMethod
}

/** Lifecycle outcome of a close or reopen. */
export interface GithubPullRequestStateValue {
  readonly repo: GithubRepoRef
  readonly number: number
  readonly state: GithubPrState
}

/** Deployment policy for the GitHub capability. */
export interface GithubConfig {
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
