/**
 * The twelve `gh_pr_*` tool definitions over `ctx.github`. Registration is an
 * effect of the owning plugin fiber; schemas are the model contract,
 * `presentationMeta` is the client-card contract, and every rejection of the
 * service result union throws {@link GithubToolError} so the registry reports
 * a typed `isError` outcome.
 * @module @deepseek-ai/dsh-tool-github/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type {
  GithubCommentCreatedValue,
  GithubCommitListValue,
  GithubContextDigest,
  GithubPrDetail,
  GithubPullRequestListValue,
  GithubPullRequestMergedValue,
  GithubPullRequestStateValue,
  GithubReviewSubmittedValue,
  GithubThreadId,
  GithubThreadFull,
  GithubThreadListValue,
  GithubThreadResolutionValue,
} from '@deepseek-ai/dsh-github'
import { unwrapGithubResult } from './errors.ts'
import {
  renderCommitList,
  renderCommentCreated,
  renderContextDigest,
  renderMerged,
  renderPrDetail,
  renderPrList,
  renderReviewSubmitted,
  renderStateChange,
  renderThreadFull,
  renderThreadList,
  renderThreadReply,
  renderThreadResolution,
} from './render.ts'

const REPO_PARAM = {
  type: 'string',
  description: '`owner/name`. Omit only when exactly one favorite repository is configured for the github service.',
} as const

const NUMBER_PARAM = {
  type: 'integer',
  required: true,
  description: 'Pull request number.',
} as const

const CONFIRM_PARAM = {
  type: 'boolean',
  required: true,
  description: 'Must be `true` to execute this mutation. Restate the target in the same turn so the human can veto.',
} as const

const PR_STATES = ['OPEN', 'MERGED', 'CLOSED'] as const
const THREAD_FILTERS = ['all', 'resolved', 'unresolved'] as const
const REVIEW_EVENTS = ['approve', 'request-changes', 'comment'] as const
const MERGE_METHODS = ['squash', 'merge', 'rebase'] as const

function presentation(kind: string): (args: unknown, value: JsonValue) => JsonValue {
  return (_args, value) => Object.freeze({ kind, value })
}

/** Bridge one frozen, JSON-safe service value across the `JsonValue` return contract. */
function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue
}

/**
 * Register all read tools against the live `ctx.github` service.
 * @param ctx - plugin context providing the tool registry.
 */
export function registerReadTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'gh_pr_list',
    description: 'List GitHub pull requests of one repository ordered by most recently updated. '
      + 'Returns number, title, state, author, refs, check rollup, and review decision per row. '
      + 'Use it to find the PR number the other gh_pr_* tools need.',
    parameters: {
      repo: REPO_PARAM,
      state: { type: 'string', enum: [...PR_STATES], description: 'Lifecycle state filter; defaults to OPEN.' },
      first: { type: 'integer', description: 'Maximum rows (1..100); defaults to 30.' },
    },
    output: {
      schema: { type: 'json', description: 'The pull-request listing value from the github service.' },
      render: (_args, value) => [{ type: 'text', text: renderPrList(value as unknown as GithubPullRequestListValue) }],
      presentationMeta: presentation('github.pr-list'),
    },
    async execute(args) {
      return toJsonValue(unwrapGithubResult(await ctx.github.listPullRequests({
        ...(args.repo === undefined ? {} : { repo: args.repo }),
        ...(args.state === undefined ? {} : { state: args.state }),
        ...(args.first === undefined ? {} : { first: args.first }),
      })))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'gh_pr_view',
    description: 'Read one GitHub pull request in full: metadata, labels, additions/deletions, '
      + 'resolved and unresolved review-thread counts, head-commit check contexts, and the PR body.',
    parameters: {
      repo: REPO_PARAM,
      number: NUMBER_PARAM,
    },
    output: {
      schema: { type: 'json', description: 'The complete pull-request detail value from the github service.' },
      render: (_args, value) => [{ type: 'text', text: renderPrDetail(value as unknown as GithubPrDetail) }],
      presentationMeta: presentation('github.pr-detail'),
    },
    async execute(args) {
      return toJsonValue(unwrapGithubResult(await ctx.github.getPullRequest({
        ...(args.repo === undefined ? {} : { repo: args.repo }),
        number: args.number,
      })))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'gh_pr_threads',
    description: 'List one pull request\'s review threads with location (path and line), resolution state, '
      + 'comment counts, and the first comment preview. Defaults to unresolved threads. '
      + 'Each row carries the thread id gh_pr_thread, gh_pr_reply, and gh_pr_thread_resolve need.',
    parameters: {
      repo: REPO_PARAM,
      number: NUMBER_PARAM,
      filter: { type: 'string', enum: [...THREAD_FILTERS], description: 'Which threads to return; defaults to unresolved.' },
    },
    output: {
      schema: { type: 'json', description: 'The thread-listing value from the github service.' },
      render: (_args, value) => [{ type: 'text', text: renderThreadList(value as unknown as GithubThreadListValue) }],
      presentationMeta: presentation('github.thread-list'),
    },
    async execute(args) {
      return toJsonValue(unwrapGithubResult(await ctx.github.listThreads({
        ...(args.repo === undefined ? {} : { repo: args.repo }),
        number: args.number,
        ...(args.filter === undefined ? {} : { filter: args.filter }),
      })))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'gh_pr_thread',
    description: 'Read one complete review thread by its id, including every comment body. '
      + 'Get thread ids from gh_pr_threads.',
    parameters: {
      threadId: { type: 'string', required: true, description: 'GraphQL thread id (`PRRT_...`) from gh_pr_threads.' },
    },
    output: {
      schema: { type: 'json', description: 'The complete thread value from the github service.' },
      render: (_args, value) => [{ type: 'text', text: renderThreadFull(value as unknown as GithubThreadFull) }],
      presentationMeta: presentation('github.thread-full'),
    },
    async execute(args) {
      return toJsonValue(unwrapGithubResult(await ctx.github.getThread({ threadId: args.threadId as GithubThreadId })))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'gh_pr_commits',
    description: 'List one pull request\'s commits: short SHA, headline, author, and authored date, plus the total commit count.',
    parameters: {
      repo: REPO_PARAM,
      number: NUMBER_PARAM,
      first: { type: 'integer', description: 'Maximum rows (1..250); defaults to 100.' },
    },
    output: {
      schema: { type: 'json', description: 'The commit-listing value from the github service.' },
      render: (_args, value) => [{ type: 'text', text: renderCommitList(value as unknown as GithubCommitListValue) }],
      presentationMeta: presentation('github.commit-list'),
    },
    async execute(args) {
      return toJsonValue(unwrapGithubResult(await ctx.github.listCommits({
        ...(args.repo === undefined ? {} : { repo: args.repo }),
        number: args.number,
        ...(args.first === undefined ? {} : { first: args.first }),
      })))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'gh_pr_context',
    description: 'Collect one pull request\'s bulk context through gh pr-enrich: comment and thread counts, '
      + 'check statistics, and on-disk report files. Returns a bounded digest; full comment bodies stay in the '
      + 'returned file paths. Enrichment (enrich: true) exports PR content to a model provider and additionally '
      + 'requires confirmExport: true; without both, a plain digest is collected.',
    parameters: {
      repo: REPO_PARAM,
      number: NUMBER_PARAM,
      enrich: { type: 'boolean', description: 'Run model analysis on the collected context (exports PR content).' },
      confirmExport: { type: 'boolean', description: 'Explicit consent to the content export; required when enrich is true.' },
      repoPath: { type: 'string', description: 'Local checkout of the repository; defaults to the harness cwd.' },
    },
    output: {
      schema: { type: 'json', description: 'The context digest value from the github service.' },
      render: (_args, value) => [{ type: 'text', text: renderContextDigest(value as unknown as GithubContextDigest) }],
      presentationMeta: presentation('github.context-digest'),
    },
    async execute(args) {
      return toJsonValue(unwrapGithubResult(await ctx.github.getContext({
        ...(args.repo === undefined ? {} : { repo: args.repo }),
        number: args.number,
        ...(args.enrich === undefined ? {} : { enrich: args.enrich }),
        ...(args.confirmExport === undefined ? {} : { confirmExport: args.confirmExport }),
        ...(args.repoPath === undefined ? {} : { repoPath: args.repoPath }),
      })))
    },
  }))
}

/**
 * Register all write tools against the live `ctx.github` service.
 * @param ctx - plugin context providing the tool registry.
 */
export function registerWriteTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'gh_pr_comment',
    description: 'Create one issue-level comment on a GitHub pull request. Returns the comment URL. '
      + 'Use gh_pr_reply instead to answer inside an existing review thread.',
    parameters: {
      repo: REPO_PARAM,
      number: NUMBER_PARAM,
      body: { type: 'string', required: true, description: 'Markdown comment body.' },
    },
    output: {
      schema: { type: 'json', description: 'The created-comment value from the github service.' },
      render: (args, value) => {
        return [{ type: 'text', text: renderCommentCreated(value as unknown as GithubCommentCreatedValue, args.repo ?? '(favorite)', args.number) }]
      },
      presentationMeta: presentation('github.comment-created'),
    },
    async execute(args) {
      return toJsonValue(unwrapGithubResult(await ctx.github.addComment({
        ...(args.repo === undefined ? {} : { repo: args.repo }),
        number: args.number,
        body: args.body,
      })))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'gh_pr_reply',
    description: 'Reply inside one existing review thread. Get thread ids from gh_pr_threads. Returns the reply URL.',
    parameters: {
      threadId: { type: 'string', required: true, description: 'GraphQL thread id (`PRRT_...`) from gh_pr_threads.' },
      body: { type: 'string', required: true, description: 'Markdown reply body.' },
    },
    output: {
      schema: { type: 'json', description: 'The created-reply value from the github service.' },
      render: (args, value) => {
        return [{ type: 'text', text: renderThreadReply(value as unknown as GithubCommentCreatedValue, args.threadId) }]
      },
      presentationMeta: presentation('github.thread-reply'),
    },
    async execute(args) {
      return toJsonValue(unwrapGithubResult(await ctx.github.replyToThread({
        threadId: args.threadId as GithubThreadId,
        body: args.body,
      })))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'gh_pr_thread_resolve',
    description: 'Resolve or unresolve one review thread by id. Get thread ids from gh_pr_threads.',
    parameters: {
      threadId: { type: 'string', required: true, description: 'GraphQL thread id (`PRRT_...`) from gh_pr_threads.' },
      resolved: { type: 'boolean', required: true, description: 'True resolves the thread; false reopens it.' },
    },
    output: {
      schema: { type: 'json', description: 'The thread-resolution value from the github service.' },
      render: (_args, value) => [{ type: 'text', text: renderThreadResolution(value as unknown as GithubThreadResolutionValue) }],
      presentationMeta: presentation('github.thread-resolution'),
    },
    async execute(args) {
      return toJsonValue(unwrapGithubResult(await ctx.github.setThreadResolved({
        threadId: args.threadId as GithubThreadId,
        resolved: args.resolved,
      })))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'gh_pr_review',
    description: 'Submit one pull request review: approve, request-changes, or comment. Requires confirm: true. '
      + 'GitHub forbids approve/request-changes on your own pull request; that rejection surfaces as a typed error.',
    parameters: {
      repo: REPO_PARAM,
      number: NUMBER_PARAM,
      event: { type: 'string', enum: [...REVIEW_EVENTS], required: true, description: 'Review kind.' },
      body: { type: 'string', description: 'Review body; required in practice for request-changes, optional otherwise.' },
      confirm: CONFIRM_PARAM,
    },
    output: {
      schema: { type: 'json', description: 'The submitted-review value from the github service.' },
      render: (_args, value) => [{ type: 'text', text: renderReviewSubmitted(value as unknown as GithubReviewSubmittedValue) }],
      presentationMeta: presentation('github.review-submitted'),
    },
    async execute(args) {
      return toJsonValue(unwrapGithubResult(await ctx.github.submitReview({
        ...(args.repo === undefined ? {} : { repo: args.repo }),
        number: args.number,
        event: args.event,
        ...(args.body === undefined ? {} : { body: args.body }),
        confirm: args.confirm,
      })))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'gh_pr_merge',
    description: 'Merge one pull request via squash, merge, or rebase, optionally deleting the head branch. Requires confirm: true.',
    parameters: {
      repo: REPO_PARAM,
      number: NUMBER_PARAM,
      method: { type: 'string', enum: [...MERGE_METHODS], required: true, description: 'Merge method.' },
      deleteBranch: { type: 'boolean', description: 'Delete the head branch after merging.' },
      confirm: CONFIRM_PARAM,
    },
    output: {
      schema: { type: 'json', description: 'The merged value from the github service.' },
      render: (args, value) => {
        return [{ type: 'text', text: renderMerged(value as unknown as GithubPullRequestMergedValue, args.deleteBranch === true) }]
      },
      presentationMeta: presentation('github.merged'),
    },
    async execute(args) {
      return toJsonValue(unwrapGithubResult(await ctx.github.mergePullRequest({
        ...(args.repo === undefined ? {} : { repo: args.repo }),
        number: args.number,
        method: args.method,
        ...(args.deleteBranch === undefined ? {} : { deleteBranch: args.deleteBranch }),
        confirm: args.confirm,
      })))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'gh_pr_close',
    description: 'Close one open pull request. Requires confirm: true.',
    parameters: {
      repo: REPO_PARAM,
      number: NUMBER_PARAM,
      confirm: CONFIRM_PARAM,
    },
    output: {
      schema: { type: 'json', description: 'The lifecycle-state value from the github service.' },
      render: (_args, value) => [{ type: 'text', text: renderStateChange(value as unknown as GithubPullRequestStateValue) }],
      presentationMeta: presentation('github.state-change'),
    },
    async execute(args) {
      return toJsonValue(unwrapGithubResult(await ctx.github.closePullRequest({
        ...(args.repo === undefined ? {} : { repo: args.repo }),
        number: args.number,
        confirm: args.confirm,
      })))
    },
  }))
}
