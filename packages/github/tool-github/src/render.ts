/**
 * Pure model-facing text projections for every `gh_pr_*` canonical value.
 * Each function is total over its declared output schema value.
 * @module @deepseek-ai/dsh-tool-github/render
 */

import type {
  GithubCommitListValue,
  GithubContextDigest,
  GithubPrDetail,
  GithubPullRequestListValue,
  GithubPullRequestStateValue,
  GithubThreadFull,
  GithubThreadListValue,
  GithubCommentCreatedValue,
  GithubReviewSubmittedValue,
  GithubPullRequestMergedValue,
  GithubThreadResolutionValue,
} from '@deepseek-ai/dsh-github'

function repoText(owner: string, name: string): string {
  return `${owner}/${name}`
}

/**
 * Render one pull-request listing as a bounded text table.
 * @param value - the canonical listing value.
 * @returns the bounded text table for the model.
 */
export function renderPrList(value: GithubPullRequestListValue): string {
  if (value.pullRequests.length === 0) return `No pull requests in ${repoText(value.repo.owner, value.repo.name)}.`
  const lines = value.pullRequests.map((pr) => {
    const checks = pr.checksState === null ? 'checks:?' : `checks:${pr.checksState}`
    const review = pr.reviewDecision === null ? '' : ` review:${pr.reviewDecision}`
    const draft = pr.isDraft ? ' [draft]' : ''
    return `#${pr.number} ${pr.state}${draft} ${pr.title} — by ${pr.author}, ${pr.headRef}→${pr.baseRef}, ${checks}${review}, updated ${pr.updatedAt}`
  })
  return `${repoText(value.repo.owner, value.repo.name)} pull requests (${value.pullRequests.length}):\n${lines.join('\n')}`
}

/**
 * Render one pull-request detail block.
 * @param value - the canonical detail value.
 * @returns the detail block text for the model.
 */
export function renderPrDetail(value: GithubPrDetail): string {
  const labels = value.labels.length > 0 ? `labels: ${value.labels.join(', ')}\n` : ''
  const checks = value.checks.contexts.length > 0
    ? value.checks.contexts.map((context) => {
      const conclusion = context.conclusion === null ? '' : `/${context.conclusion}`
      const url = context.url === null ? '' : ` (${context.url})`
      return `  - ${context.name}: ${context.status}${conclusion}${url}`
    }).join('\n') + '\n'
    : '  (no check contexts)\n'
  return [
    `PR #${value.number} ${value.state}${value.isDraft ? ' [draft]' : ''}: ${value.title}`,
    `repo: ${repoText(value.repo.owner, value.repo.name)}  author: ${value.author}`,
    `refs: ${value.headRef}→${value.baseRef}  mergeable: ${value.mergeable}  reviewDecision: ${value.reviewDecision ?? 'none'}`,
    `${labels}diff: +${value.additions}/-${value.deletions} across ${value.changedFiles} files`,
    `threads: ${value.threadCounts.unresolved} unresolved of ${value.threadCounts.total} total`,
    `checks (${value.checks.state ?? 'unknown'}):`,
    checks.trimEnd(),
    `created ${value.createdAt}, updated ${value.updatedAt}`,
    value.bodyText.length > 0 ? `\n${value.bodyText}` : '',
  ].filter(part => part.length > 0).join('\n')
}

/**
 * Render one review-thread listing.
 * @param value - the canonical thread-listing value.
 * @returns the thread listing text for the model.
 */
export function renderThreadList(value: GithubThreadListValue): string {
  if (value.threads.length === 0) return `No ${value.filter} review threads on PR #${value.number}.`
  const lines = value.threads.map((thread) => {
    const location = thread.line === null ? thread.path : `${thread.path}:${thread.line}`
    const resolved = thread.isResolved ? `resolved${thread.resolvedBy === null ? '' : ` by ${thread.resolvedBy}`}` : 'unresolved'
    const first = thread.firstComment === null ? '' : ` — ${thread.firstComment.author}: ${thread.firstComment.body}`
    return `${thread.id} ${location} [${resolved}${thread.isOutdated ? ', outdated' : ''}, ${thread.commentCount} comment(s)]${first}`
  })
  return `PR #${value.number} ${value.filter} review threads (${value.threads.length}):\n${lines.join('\n')}`
}

/**
 * Render one complete review thread with every comment.
 * @param value - the canonical complete-thread value.
 * @returns the thread text with every comment for the model.
 */
export function renderThreadFull(value: GithubThreadFull): string {
  const location = value.line === null ? value.path : `${value.path}:${value.line}`
  const header = `Thread ${value.id} at ${location} [${value.isResolved ? 'resolved' : 'unresolved'}], ${value.comments.length} comment(s):`
  const lines = value.comments.map(comment => `${comment.author} (${comment.createdAt}): ${comment.body}`)
  return `${header}\n${lines.join('\n')}`
}

/**
 * Render one commit listing.
 * @param value - the canonical commit-listing value.
 * @returns the commit listing text for the model.
 */
export function renderCommitList(value: GithubCommitListValue): string {
  if (value.commits.length === 0) return `No commits returned for PR #${value.number}.`
  const lines = value.commits.map((commit) => {
    const author = commit.authorLogin ?? commit.authorName ?? 'unknown'
    return `${commit.sha.slice(0, 10)} ${commit.headline} — ${author}, ${commit.authoredDate}`
  })
  return `PR #${value.number} commits (${value.totalCount} total, ${value.commits.length} shown):\n${lines.join('\n')}`
}

/**
 * Render one bulk context digest with its on-disk report locations.
 * @param value - the canonical context-digest value.
 * @returns the digest text with its report file paths for the model.
 */
export function renderContextDigest(value: GithubContextDigest): string {
  return [
    `PR #${value.number} context digest for ${repoText(value.repo.owner, value.repo.name)}${value.enriched ? ' (enriched)' : ''}:`,
    `comments: ${value.commentCount}; threads: ${value.threadCounts.unresolved} unresolved of ${value.threadCounts.total} total`,
    `checks: ${value.checks.passing}/${value.checks.total} passing, ${value.checks.failing} failing, ${value.checks.pending} pending (overall ${value.checks.overallState})`,
    `report directory: ${value.reportDir}`,
    `files: combined=${value.files.combined}; report=${value.files.report}; threads=${value.files.threads}`,
    'Full comment bodies stay in those files; read them only when the digest is not enough.',
  ].join('\n')
}

/**
 * Render one created comment confirmation.
 * @param value - the canonical created-comment value.
 * @param repo - `owner/name` display of the target repository.
 * @param number - pull request number.
 * @returns the confirmation text for the model.
 */
export function renderCommentCreated(value: GithubCommentCreatedValue, repo: string, number: number): string {
  return `Comment created on PR #${number} of ${repo}: ${value.url}`
}

/**
 * Render one thread reply confirmation.
 * @param value - the canonical created-reply value.
 * @param threadId - GraphQL thread id the reply joined.
 * @returns the confirmation text for the model.
 */
export function renderThreadReply(value: GithubCommentCreatedValue, threadId: string): string {
  return `Reply posted inside thread ${threadId}: ${value.url}`
}

/**
 * Render one thread resolution outcome.
 * @param value - the canonical resolution value.
 * @returns the resolution text for the model.
 */
export function renderThreadResolution(value: GithubThreadResolutionValue): string {
  return `Thread ${value.threadId} is now ${value.isResolved ? 'resolved' : 'unresolved'}.`
}

/**
 * Render one submitted review confirmation.
 * @param value - the canonical submitted-review value.
 * @returns the confirmation text for the model.
 */
export function renderReviewSubmitted(value: GithubReviewSubmittedValue): string {
  return `Review (${value.event}) submitted on PR #${value.number} of ${repoText(value.repo.owner, value.repo.name)}.`
}

/**
 * Render one merged pull-request confirmation.
 * @param value - the canonical merged value.
 * @param deleteBranch - whether the merge deleted the head branch.
 * @returns the confirmation text for the model.
 */
export function renderMerged(value: GithubPullRequestMergedValue, deleteBranch: boolean): string {
  return `PR #${value.number} of ${repoText(value.repo.owner, value.repo.name)} merged via ${value.method}${deleteBranch ? '; head branch deleted' : ''}.`
}

/**
 * Render one lifecycle state change confirmation.
 * @param value - the canonical lifecycle value.
 * @returns the confirmation text for the model.
 */
export function renderStateChange(value: GithubPullRequestStateValue): string {
  const verb = value.state === 'CLOSED' ? 'closed' : 'reopened'
  return `PR #${value.number} of ${repoText(value.repo.owner, value.repo.name)} ${verb}.`
}
