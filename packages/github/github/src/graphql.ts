/**
 * Validated `gh api graphql` query texts and pure mappers from raw GraphQL
 * responses to the capability's frozen domain types. Every mapper accepts
 * lossless JSON parsed from `gh` stdout and returns owned, frozen values;
 * malformed shapes throw {@link GhResponseError} rather than guessing.
 * @module @deepseek-ai/dsh-github
 */

import type {
  GithubCheckContext,
  GithubChecksState,
  GithubChecksSummary,
  GithubCommitInfo,
  GithubCommitSha,
  GithubMergeable,
  GithubPrDetail,
  GithubPrState,
  GithubPrSummary,
  GithubRepoRef,
  GithubReviewDecision,
  GithubThreadComment,
  GithubThreadFull,
  GithubThreadId,
  GithubThreadSummary,
} from './types.ts'

/** Raw GraphQL response envelope as `gh api graphql` prints it. */
interface GraphqlEnvelope {
  readonly data?: unknown
  readonly errors?: readonly { readonly message?: unknown }[]
}

/** Error class for responses that do not satisfy the documented shape. */
export class GhResponseError extends Error {
  /**
   * @param message - which documented field was absent or misshapen.
   */
  constructor(message: string) {
    super(message)
    this.name = 'GhResponseError'
  }
}

/** Pull-request listing ordered by most recently updated. */
export const LIST_PULL_REQUESTS_QUERY = `
query($owner:String!, $name:String!, $states:[PullRequestState!], $first:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequests(states:$states, first:$first, orderBy:{field:UPDATED_AT, direction:DESC}) {
      nodes {
        number title state isDraft
        author { login }
        headRefName baseRefName updatedAt
        reviewDecision mergeable
        statusCheckRollup { state }
      }
    }
  }
}
`

/** Pull-request detail with review threads and head-commit check rollup. */
export const GET_PULL_REQUEST_QUERY = `
query($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      id number title state isDraft
      author { login }
      bodyText
      headRefName baseRefName
      mergeable reviewDecision
      additions deletions changedFiles
      createdAt updatedAt
      labels(first:20) { nodes { name } }
      reviewThreads(first:100) {
        totalCount
        nodes {
          id isResolved isOutdated path line
          resolvedBy { login }
          comments(first:1) {
            totalCount
            nodes { id databaseId author { login } createdAt bodyText }
          }
        }
      }
      commits(last:1) {
        nodes {
          commit {
            statusCheckRollup {
              state
              contexts(first:100) {
                nodes {
                  __typename
                  ... on CheckRun { name status conclusion detailsUrl }
                  ... on StatusContext { context state targetUrl }
                }
              }
            }
          }
        }
      }
    }
  }
}
`

/** One review thread addressed by GraphQL node id. */
export const GET_THREAD_QUERY = `
query($id:ID!) {
  node(id:$id) {
    __typename
    ... on PullRequestReviewThread {
      id isResolved isOutdated path line
      comments(first:100) {
        totalCount
        nodes { id databaseId author { login } createdAt bodyText }
      }
    }
  }
}
`

/** Commit listing plus top-level issue-comment count. */
export const LIST_COMMITS_QUERY = `
query($owner:String!, $name:String!, $number:Int!, $first:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      commits(first:$first) {
        totalCount
        nodes {
          commit {
            oid messageHeadline authoredDate
            author { name user { login } }
          }
        }
      }
    }
  }
}
`

/** Resolve one review thread by id. */
export const RESOLVE_THREAD_MUTATION = `
mutation($threadId:ID!) {
  resolveReviewThread(input:{threadId:$threadId}) { thread { id isResolved } }
}
`

/** Unresolve one review thread by id. */
export const UNRESOLVE_THREAD_MUTATION = `
mutation($threadId:ID!) {
  unresolveReviewThread(input:{threadId:$threadId}) { thread { id isResolved } }
}
`

/** Reply inside one review thread by id. */
export const REPLY_TO_THREAD_MUTATION = `
mutation($threadId:ID!, $body:String!) {
  addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId, body:$body}) {
    comment { id url }
  }
}
`

function fail(message: string): never {
  throw new GhResponseError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function field(record: Record<string, unknown>, key: string): unknown {
  return record[key]
}

function requireRecord(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${where} is not an object`)
  return value
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(`${where} is not a string`)
  return value
}

function requireNumber(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${where} is not a number`)
  return value
}

function requireBoolean(value: unknown, where: string): boolean {
  if (typeof value !== 'boolean') fail(`${where} is not a boolean`)
  return value
}

function optionalString(value: unknown, where: string): string | null {
  if (value === null || value === undefined) return null
  return requireString(value, where)
}

/**
 * Unwrap the envelope, surfacing GraphQL errors and absent data.
 * @param raw - Parsed `gh api graphql` stdout.
 * @param operation - Operation name used in error messages.
 * @returns the envelope's `data` record.
 */
export function unwrapGraphql(raw: unknown, operation: string): Record<string, unknown> {
  const envelope = requireRecord(raw, `${operation}: response`) as GraphqlEnvelope
  if (Array.isArray(envelope.errors) && envelope.errors.length > 0) {
    const first: unknown = envelope.errors[0]
    const message = isRecord(first) && typeof first.message === 'string' ? first.message : 'unknown GraphQL error'
    fail(`${operation}: GraphQL error: ${message}`)
  }
  if (envelope.data === undefined) fail(`${operation}: response carries no data`)
  return requireRecord(envelope.data, `${operation}: data`)
}

/**
 * `gh api graphql` exit-1 "HTTP 404"-style absent-repo/PR classification.
 * @param message - Combined failure message plus diagnostic tail.
 * @returns true when the wording matches a documented absent referent.
 */
export function isNotFoundMessage(message: string): boolean {
  return /could not resolve to a (repository|pullrequest)|not found|http 404/i.test(message)
}

function requireRepository(data: Record<string, unknown>, operation: string): Record<string, unknown> {
  const repository = field(data, 'repository')
  if (repository === null || repository === undefined) fail(`${operation}: repository is null`)
  return requireRecord(repository, `${operation}: repository`)
}

function asState(value: unknown, where: string): GithubPrState {
  const text = requireString(value, where)
  if (text !== 'OPEN' && text !== 'MERGED' && text !== 'CLOSED') fail(`${where} has unexpected state ${text}`)
  return text
}

function asMergeable(value: unknown, where: string): GithubMergeable {
  const text = requireString(value, where)
  if (text !== 'MERGEABLE' && text !== 'CONFLICTING' && text !== 'UNKNOWN') {
    fail(`${where} has unexpected mergeable ${text}`)
  }
  return text
}

function asChecksState(value: unknown, where: string): GithubChecksState | null {
  if (value === null || value === undefined) return null
  const text = requireString(value, where)
  if (text !== 'SUCCESS' && text !== 'FAILURE' && text !== 'PENDING' && text !== 'ERROR' && text !== 'EXPECTED') {
    fail(`${where} has unexpected checks state ${text}`)
  }
  return text
}

function asReviewDecision(value: unknown, where: string): GithubReviewDecision | null {
  if (value === null || value === undefined) return null
  const text = requireString(value, where)
  if (text !== 'APPROVED' && text !== 'REVIEW_REQUIRED' && text !== 'CHANGES_REQUESTED' && text !== 'CLOSED') {
    fail(`${where} has unexpected reviewDecision ${text}`)
  }
  return text
}

function userLogin(user: Record<string, unknown>, where: string): string {
  return requireString(field(user, 'login'), `${where}.login`)
}

function authorLogin(node: Record<string, unknown>, where: string): string {
  const author = field(node, 'author')
  if (author === null || author === undefined) return 'ghost'
  return userLogin(requireRecord(author, `${where}.author`), `${where}.author`)
}

function mapComment(node: Record<string, unknown>, where: string): GithubThreadComment {
  return Object.freeze({
    id: requireString(field(node, 'id'), `${where}.id`),
    databaseId: requireNumber(field(node, 'databaseId'), `${where}.databaseId`),
    author: authorLogin(node, where),
    createdAt: requireString(field(node, 'createdAt'), `${where}.createdAt`),
    body: requireString(field(node, 'bodyText'), `${where}.bodyText`),
  })
}

function mapCheckContext(node: Record<string, unknown>, where: string): GithubCheckContext {
  const typename = requireString(field(node, '__typename'), `${where}.__typename`)
  if (typename === 'CheckRun') {
    return Object.freeze({
      kind: 'check-run',
      name: requireString(field(node, 'name'), `${where}.name`),
      status: requireString(field(node, 'status'), `${where}.status`),
      conclusion: optionalString(field(node, 'conclusion'), `${where}.conclusion`),
      url: optionalString(field(node, 'detailsUrl'), `${where}.detailsUrl`),
    })
  }
  if (typename === 'StatusContext') {
    return Object.freeze({
      kind: 'status',
      name: requireString(field(node, 'context'), `${where}.context`),
      status: requireString(field(node, 'state'), `${where}.state`),
      conclusion: null,
      url: optionalString(field(node, 'targetUrl'), `${where}.targetUrl`),
    })
  }
  return fail(`${where} has unexpected check context type ${typename}`)
}

function mapSummaryNode(node: Record<string, unknown>, repo: GithubRepoRef, where: string): GithubPrSummary {
  const rollup = field(node, 'statusCheckRollup')
  return Object.freeze({
    repo: Object.freeze({ owner: repo.owner, name: repo.name }),
    number: requireNumber(field(node, 'number'), `${where}.number`),
    title: requireString(field(node, 'title'), `${where}.title`),
    state: asState(field(node, 'state'), `${where}.state`),
    isDraft: requireBoolean(field(node, 'isDraft'), `${where}.isDraft`),
    author: authorLogin(node, where),
    headRef: requireString(field(node, 'headRefName'), `${where}.headRefName`),
    baseRef: requireString(field(node, 'baseRefName'), `${where}.baseRefName`),
    updatedAt: requireString(field(node, 'updatedAt'), `${where}.updatedAt`),
    mergeable: asMergeable(field(node, 'mergeable'), `${where}.mergeable`),
    reviewDecision: asReviewDecision(field(node, 'reviewDecision'), `${where}.reviewDecision`),
    checksState: rollup === null || rollup === undefined
      ? null
      : asChecksState(requireRecord(rollup, `${where}.statusCheckRollup`).state, `${where}.statusCheckRollup.state`),
  })
}

/**
 * Map one repository pull-request listing response.
 * @param raw - Parsed GraphQL envelope.
 * @param repo - Repository the listing targeted.
 * @returns Frozen summary rows in response order.
 */
export function mapPullRequestList(raw: unknown, repo: GithubRepoRef): readonly GithubPrSummary[] {
  const data = unwrapGraphql(raw, 'listPullRequests')
  const repository = requireRepository(data, 'listPullRequests')
  const pullRequests = requireRecord(field(repository, 'pullRequests'), 'listPullRequests: pullRequests')
  const nodes = field(pullRequests, 'nodes')
  if (!Array.isArray(nodes)) fail('listPullRequests: pullRequests.nodes is not an array')
  return Object.freeze(nodes.map((node, index) =>
    mapSummaryNode(requireRecord(node, `listPullRequests: node[${index}]`), repo, `listPullRequests: node[${index}]`)))
}

function mapChecks(rollup: unknown, where: string): GithubChecksSummary {
  if (rollup === null || rollup === undefined) return Object.freeze({ state: null, contexts: Object.freeze([]) })
  const record = requireRecord(rollup, where)
  const contexts = requireRecord(field(record, 'contexts'), `${where}.contexts`)
  const nodes = field(contexts, 'nodes')
  if (!Array.isArray(nodes)) fail(`${where}.contexts.nodes is not an array`)
  return Object.freeze({
    state: asChecksState(field(record, 'state'), `${where}.state`),
    contexts: Object.freeze(nodes.map((node, index) =>
      mapCheckContext(requireRecord(node, `${where}.contexts.nodes[${index}]`), `${where}.contexts.nodes[${index}]`))),
  })
}

function mapThreadSummary(node: Record<string, unknown>, where: string): GithubThreadSummary {
  const comments = requireRecord(field(node, 'comments'), `${where}.comments`)
  const commentNodes = field(comments, 'nodes')
  if (!Array.isArray(commentNodes)) fail(`${where}.comments.nodes is not an array`)
  return Object.freeze({
    id: requireString(field(node, 'id'), `${where}.id`) as GithubThreadId,
    path: requireString(field(node, 'path'), `${where}.path`),
    line: field(node, 'line') === null || field(node, 'line') === undefined
      ? null
      : requireNumber(field(node, 'line'), `${where}.line`),
    isResolved: requireBoolean(field(node, 'isResolved'), `${where}.isResolved`),
    isOutdated: requireBoolean(field(node, 'isOutdated'), `${where}.isOutdated`),
    commentCount: requireNumber(field(comments, 'totalCount'), `${where}.comments.totalCount`),
    resolvedBy: field(node, 'resolvedBy') === null || field(node, 'resolvedBy') === undefined
      ? null
      : userLogin(requireRecord(field(node, 'resolvedBy'), `${where}.resolvedBy`), `${where}.resolvedBy`),
    firstComment: commentNodes.length === 0
      ? null
      : mapComment(requireRecord(commentNodes[0], `${where}.comments.nodes[0]`), `${where}.comments.nodes[0]`),
  })
}

/**
 * Map one pull-request detail response.
 * @param raw - Parsed GraphQL envelope.
 * @param repo - Repository the detail targeted.
 * @returns The frozen pull-request detail value.
 */
export function mapPullRequestDetail(raw: unknown, repo: GithubRepoRef): GithubPrDetail {
  const data = unwrapGraphql(raw, 'getPullRequest')
  const repository = requireRepository(data, 'getPullRequest')
  const pr = field(repository, 'pullRequest')
  if (pr === null || pr === undefined) fail('getPullRequest: pullRequest is null')
  const node = requireRecord(pr, 'getPullRequest: pullRequest')
  const summary = mapSummaryNode(node, repo, 'getPullRequest')
  const labels = requireRecord(field(node, 'labels'), 'getPullRequest: labels')
  const labelNodes = field(labels, 'nodes')
  if (!Array.isArray(labelNodes)) fail('getPullRequest: labels.nodes is not an array')
  const threads = requireRecord(field(node, 'reviewThreads'), 'getPullRequest: reviewThreads')
  const threadNodes = field(threads, 'nodes')
  if (!Array.isArray(threadNodes)) fail('getPullRequest: reviewThreads.nodes is not an array')
  const threadRows = threadNodes.map((entry, index) =>
    mapThreadSummary(requireRecord(entry, `getPullRequest: thread[${index}]`), `getPullRequest: thread[${index}]`))
  const commits = requireRecord(field(node, 'commits'), 'getPullRequest: commits')
  const commitNodes = field(commits, 'nodes')
  if (!Array.isArray(commitNodes)) fail('getPullRequest: commits.nodes is not an array')
  let checks: GithubChecksSummary = Object.freeze({ state: null, contexts: Object.freeze([]) })
  if (commitNodes.length > 0) {
    const commit = requireRecord(
      requireRecord(commitNodes[0], 'getPullRequest: commits.nodes[0]').commit,
      'getPullRequest: commits.nodes[0].commit',
    )
    checks = mapChecks(field(commit, 'statusCheckRollup'), 'getPullRequest: statusCheckRollup')
  }
  return Object.freeze({
    ...summary,
    nodeId: requireString(field(node, 'id'), 'getPullRequest: id'),
    bodyText: requireString(field(node, 'bodyText'), 'getPullRequest: bodyText'),
    additions: requireNumber(field(node, 'additions'), 'getPullRequest: additions'),
    deletions: requireNumber(field(node, 'deletions'), 'getPullRequest: deletions'),
    changedFiles: requireNumber(field(node, 'changedFiles'), 'getPullRequest: changedFiles'),
    createdAt: requireString(field(node, 'createdAt'), 'getPullRequest: createdAt'),
    labels: Object.freeze(labelNodes.map((entry, index) =>
      requireString(requireRecord(entry, `getPullRequest: labels.nodes[${index}]`).name, `getPullRequest: labels.nodes[${index}].name`))),
    threadCounts: Object.freeze({
      total: requireNumber(field(threads, 'totalCount'), 'getPullRequest: reviewThreads.totalCount'),
      unresolved: threadRows.filter(thread => !thread.isResolved).length,
    }),
    checks,
  })
}

/**
 * Map one thread listing from a detail response's threads connection.
 * @param raw - Parsed GraphQL envelope.
 * @returns Frozen thread summaries in response order.
 */
export function mapThreadSummaries(raw: unknown): readonly GithubThreadSummary[] {
  const data = unwrapGraphql(raw, 'listThreads')
  const repository = requireRepository(data, 'listThreads')
  const pr = requireRecord(field(repository, 'pullRequest'), 'listThreads: pullRequest')
  const threads = requireRecord(field(pr, 'reviewThreads'), 'listThreads: reviewThreads')
  const nodes = field(threads, 'nodes')
  if (!Array.isArray(nodes)) fail('listThreads: reviewThreads.nodes is not an array')
  return Object.freeze(nodes.map((entry, index) =>
    mapThreadSummary(requireRecord(entry, `listThreads: thread[${index}]`), `listThreads: thread[${index}]`)))
}

/**
 * Map one thread-by-id response.
 * @param raw - Parsed GraphQL envelope.
 * @returns The frozen complete thread value.
 */
export function mapThreadFull(raw: unknown): GithubThreadFull {
  const data = unwrapGraphql(raw, 'getThread')
  const node = field(data, 'node')
  if (node === null || node === undefined) fail('getThread: node is null')
  const thread = requireRecord(node, 'getThread: node')
  if (requireString(field(thread, '__typename'), 'getThread: __typename') !== 'PullRequestReviewThread') {
    fail('getThread: node is not a PullRequestReviewThread')
  }
  const comments = requireRecord(field(thread, 'comments'), 'getThread: comments')
  const commentNodes = field(comments, 'nodes')
  if (!Array.isArray(commentNodes)) fail('getThread: comments.nodes is not an array')
  return Object.freeze({
    id: requireString(field(thread, 'id'), 'getThread: id') as GithubThreadId,
    path: requireString(field(thread, 'path'), 'getThread: path'),
    line: field(thread, 'line') === null || field(thread, 'line') === undefined
      ? null
      : requireNumber(field(thread, 'line'), 'getThread: line'),
    isResolved: requireBoolean(field(thread, 'isResolved'), 'getThread: isResolved'),
    comments: Object.freeze(commentNodes.map((entry, index) =>
      mapComment(requireRecord(entry, `getThread: comments.nodes[${index}]`), `getThread: comments.nodes[${index}]`))),
  })
}

/**
 * Map one commit-listing response.
 * @param raw - Parsed GraphQL envelope.
 * @returns Frozen commit rows in response order.
 */
export function mapCommitList(raw: unknown): readonly GithubCommitInfo[] {
  const data = unwrapGraphql(raw, 'listCommits')
  const repository = requireRepository(data, 'listCommits')
  const pr = requireRecord(field(repository, 'pullRequest'), 'listCommits: pullRequest')
  const commits = requireRecord(field(pr, 'commits'), 'listCommits: commits')
  const nodes = field(commits, 'nodes')
  if (!Array.isArray(nodes)) fail('listCommits: commits.nodes is not an array')
  return Object.freeze(nodes.map((entry, index) => {
    const where = `listCommits: commits.nodes[${index}]`
    const commit = requireRecord(requireRecord(entry, where).commit, `${where}.commit`)
    const author = requireRecord(field(commit, 'author'), `${where}.author`)
    const user = field(author, 'user')
    return Object.freeze({
      sha: requireString(field(commit, 'oid'), `${where}.oid`) as GithubCommitSha,
      headline: requireString(field(commit, 'messageHeadline'), `${where}.messageHeadline`),
      authorLogin: user === null || user === undefined
        ? null
        : requireString(requireRecord(user, `${where}.author.user`).login, `${where}.author.user.login`),
      authorName: optionalString(field(author, 'name'), `${where}.author.name`),
      authoredDate: requireString(field(commit, 'authoredDate'), `${where}.authoredDate`),
    })
  }))
}

/**
 * Map one resolve/unresolve mutation response to the new resolved state.
 * @param raw - Parsed GraphQL envelope.
 * @param key - Mutation alias present in the envelope.
 * @returns The thread's new resolved state.
 */
export function mapThreadResolution(raw: unknown, key: 'resolveReviewThread' | 'unresolveReviewThread'): boolean {
  const data = unwrapGraphql(raw, key)
  const mutation = requireRecord(field(data, key), `${key}: payload`)
  const thread = requireRecord(field(mutation, 'thread'), `${key}: thread`)
  return requireBoolean(field(thread, 'isResolved'), `${key}: thread.isResolved`)
}

/**
 * Map one thread-reply mutation response to the created comment's URL.
 * @param raw - Parsed GraphQL envelope.
 * @returns The created comment's URL.
 */
export function mapThreadReply(raw: unknown): string {
  const data = unwrapGraphql(raw, 'replyToThread')
  const mutation = requireRecord(field(data, 'addPullRequestReviewThreadReply'), 'replyToThread: payload')
  const comment = requireRecord(field(mutation, 'comment'), 'replyToThread: comment')
  return requireString(field(comment, 'url'), 'replyToThread: comment.url')
}
