# @deepseek-ai/dsh-github

English | [中文](README.zh.md)

Host gateway service for the GitHub pull-request domain. The package registers `ctx.github`, spawns the authenticated `gh` CLI exclusively through the `ctx.subprocess` seam, and publishes the Host `github.*` unary Remote contract (namespace `github`). All GraphQL reads and mutations run through `gh api graphql`; pull-request comments, reviews, merges, closes, and reopens run through the corresponding `gh pr` subcommands. The service owns argv construction, response mapping, failure classification, TTL caching, and write/enrichment gating. It owns no GitHub token: the child inherits only the scrubbed parent environment plus the configured `childEnv` additions, so authentication stays wherever `gh auth` stored it.

```ts ignore-check
await ctx.plugin(LocalSubprocessRuntime)   // @deepseek-ai/dsh-subprocess-local
await ctx.plugin(GithubService, {
  favorites: ['my-org/my-repo'],
})
```

## Deployment requirement: an authenticated gh CLI

`[Service.init]` resolves the `ghPath` executable through the subprocess seam and fails activation with `gh-missing` when it does not resolve. Every call afterwards assumes that `gh` is authenticated for the target repositories. The service never reads, prints, or forwards credentials.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `ghPath` | `gh` | Executable or absolute path resolved through the subprocess seam. |
| `favorites` | `[]` | `owner/name` repositories a request may omit `repo` for. Exactly one favorite makes it the implicit default; with zero or many, an omitted `repo` fails with `no-repo-configured`. |
| `cacheTtlMs` | `30000` | Read-cache lifetime. `0` disables caching. Every successful write invalidates the whole cache. |
| `timeoutMs` | `60000` | Deadline for one `gh` invocation (reads, writes, plain context collection). Expiry classifies as `aborted`. |
| `enrichTimeoutMs` | `300000` | Deadline for one `gh pr-enrich` collection, which can run minutes long. |
| `maxOutputBytes` | `8388608` | Collect-mode stdout budget per invocation; a lossy read classifies as `output-overflow`. |
| `allowWrites` | `true` | Master switch for every mutating operation. `false` makes all writes fail with `writes-disabled` before any process starts. |
| `allowEnrich` | `false` | First gate for `getContext` enrichment. Enrichment additionally requires a per-call `confirmExport: true`. |
| `reportRoot` | `<dsh home>/github-reports` | Directory that receives one `owner-name-pr-N` report directory per collection. |
| `childEnv` | `{}` | Extra environment entries merged over the scrubbed parent environment for every spawn (for example `GH_HOST` in tests). |

## Remote contract

Every operation returns `GithubResult<T>`: `{ ok: true, value }` or `{ ok: false, error: { code, message, detail? } }`. `detail` carries a bounded `gh` stderr/stdout tail when one exists.

| Operation | Kind | Notes |
|---|---|---|
| `listPullRequests` | read | `state` filter defaults to `OPEN`; `first` clamps to 1..100. |
| `getPullRequest` | read | Detail with labels, resolved/unresolved thread counts, and check contexts. |
| `listThreads` | read | `filter` defaults to `unresolved`; `resolved` and `all` supported. Thread summaries carry the GraphQL thread id needed by the mutations below. |
| `getThread` | read | One complete thread by `PRRT_…` id, including every comment body. |
| `listCommits` | read | Commit rows plus the GraphQL `totalCount`, falling back to the returned row count when absent. |
| `getContext` | read | Bulk digest through `gh pr-enrich` (see below). |
| `addComment` | write | `gh pr comment` issue-level comment; returns the comment URL. |
| `replyToThread` | write | GraphQL reply inside one review thread. |
| `setThreadResolved` | write | Resolve or unresolve one review thread by id. |
| `submitReview` | write | `approve`, `request-changes`, or `comment` review; `confirm: true` required. GitHub forbids approve/request-changes on your own pull request; the service classifies that API rejection as `self-review-forbidden` instead of a generic failure. |
| `mergePullRequest` | write | `squash`, `merge`, or `rebase`; optional `deleteBranch`; `confirm: true` required. |
| `closePullRequest` | write | `confirm: true` required. |
| `reopenPullRequest` | write | No confirmation: reopening restores a prior state. |

Write gating order: `allowWrites` first (`writes-disabled`), then per-operation confirmation (`confirmation-required`), then execution.

## Error codes

| Code | Meaning |
|---|---|
| `gh-missing` | `ghPath` did not resolve to an executable at activation. |
| `gh-launch-failed` | The subprocess seam rejected the spawn or its settlement. |
| `gh-failed` | Non-zero exit or signal kill; `detail` carries the output tail. |
| `invalid-response` | Unparsable JSON or a response that violates the documented GraphQL shape. |
| `invalid-repo` | A `repo` argument that is not `owner/name`. |
| `no-repo-configured` | `repo` omitted with zero or multiple favorites. |
| `not-found` | GitHub reported an absent repository or pull request. |
| `writes-disabled` | A write attempt while `allowWrites` is `false`. |
| `enrich-disabled` | Enrichment requested while `allowEnrich` is `false`. |
| `confirmation-required` | A confirmable write without `confirm: true`. |
| `self-review-forbidden` | GitHub rejected approve/request-changes on the caller's own pull request. |
| `enrich-failed` | `gh pr-enrich` failed or produced no parsable `combined-data.json`. |
| `output-overflow` | One invocation exceeded `maxOutputBytes`. |
| `aborted` | Deadline expiry or caller cancellation. |

## Caching

Reads (`listPullRequests`, `getPullRequest`, `listThreads`, `listCommits`) are cached per exact request key for `cacheTtlMs`. Every successful write invalidates the entire cache so a mutation is visible to the next read. `getThread` and `getContext` are never cached: thread bodies and report files are the freshness-critical surfaces.

## Bulk context through gh pr-enrich

`getContext` runs `gh pr-enrich <number> --json --output-dir <reportRoot>/<owner>-<name>-pr-<number>` with `cwd` set to `repoPath` (default `process.cwd()`), then parses `combined-data.json` into a bounded digest: comment count, resolved/unresolved thread counts, check statistics, and the on-disk file locations. The digest never embeds full comment bodies; consumers that need them read the returned file paths. Enrichment (the `--enrich` flag, which exports PR content to a model provider) is double-gated: `allowEnrich` in configuration and `confirmExport: true` on the request. Without both, `getContext` still collects the plain digest.

## Model Experience

### Service surface

#### What the model sees

Nothing. `ctx.github` registers no tool, prompt section, model-facing context, or Session event. Model access happens only through separately documented Consumers such as the `dsh-tool-github` tool package, which owns its own schemas and prompt guidance.

#### Token effect

Zero. No request, result, or failure from this package enters a model request unless a Consumer forwards it.

#### KV Cache effect

Independent. Calling `ctx.github` does not touch a model request prefix and cannot invalidate an otherwise reusable provider cache entry.

## Known Limitations and Deferred Work

- **One gh account per Host** — the service uses whatever account `gh auth` selected; there is no per-request identity or multi-account switching.
- **Reports are not garbage-collected** — each collection creates a report directory under `reportRoot`; pruning is an operator task until a retention policy ships.
- **Pagination is single-page** — listings request one GraphQL page (`first` clamped); cursor-following for very large PR sets is deferred.
- **No webhook or poll-based freshness** — freshness comes from the TTL cache and write invalidation only.
- **Trusted caller boundary** — Remote operations carry no authenticated actor; a deployment must expose the Host gateway only through its trusted boundary, and `allowWrites` is the only write throttle until authorization lands.
