/**
 * Model-facing GitHub pull-request tool suite: twelve `gh_pr_*` tools over
 * the `ctx.github` gh-CLI gateway service. Reads expose PR listings, detail,
 * review threads, commits, and a bounded bulk-context digest; writes cover
 * comments, thread replies, thread resolution, reviews, merge, and close.
 *
 * ## Thin bridge over a service, not a subprocess consumer
 *
 * The tool layer owns schemas, parameter validation, canonical output
 * contracts, model-facing rendering, and card presentation metadata. All
 * subprocess work, caching, and policy gates (write enablement, enrichment
 * export consent, mutation confirmation) live in `@deepseek-ai/dsh-github`;
 * a rejected service result becomes a typed {@link GithubToolError} so the
 * registry reports an `isError` outcome with the service's stable code.
 *
 * No tool declares `timeoutMs`: every call terminates because the service
 * enforces its own `timeoutMs` / `enrichTimeoutMs` deadlines on each gh
 * invocation, and the service methods accept no external abort signal to
 * forward.
 *
 * @module @deepseek-ai/dsh-tool-github
 */

import type { Context } from '@deepseek-ai/cordis'
import { registerReadTools, registerWriteTools } from './tools.ts'

export { GithubToolError, unwrapGithubResult } from './errors.ts'
export {
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
export { registerReadTools, registerWriteTools } from './tools.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-github'

/** Services required by the GitHub tool suite. */
export const inject = ['tools', 'systemPrompt', 'github']

const GITHUB_TOOLS_PROMPT = 'Use the gh_pr_* tools — not gh CLI via shell — for GitHub pull-request work. '
  + 'Start with gh_pr_list to find numbers; gh_pr_view, gh_pr_threads, gh_pr_thread, gh_pr_commits, and gh_pr_context read one PR. '
  + 'gh_pr_threads returns the thread ids gh_pr_reply and gh_pr_thread_resolve need; gh_pr_threads defaults to unresolved threads. '
  + 'Writes (gh_pr_comment, gh_pr_reply, gh_pr_thread_resolve, gh_pr_review, gh_pr_merge, gh_pr_close) surface service rejections as typed errors instead of failing silently. '
  + 'gh_pr_review, gh_pr_merge, and gh_pr_close require confirm: true. '
  + 'gh_pr_context returns a bounded digest with on-disk report file paths; full comment bodies stay in those files — read them only when the digest is not enough. '
  + 'Enrichment (enrich: true) exports PR content to a model provider and additionally requires confirmExport: true.'

/**
 * Register the `gh_pr_*` tool suite against the live `ctx.github` service.
 * The service must mount for this plugin to activate (`inject`).
 *
 * @param ctx - plugin context; registrations are effects scoped to this plugin.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:github',
    order: 108,
    text: GITHUB_TOOLS_PROMPT,
  })
  registerReadTools(ctx)
  registerWriteTools(ctx)
}
