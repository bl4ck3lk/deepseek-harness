# @deepseek-ai/dsh-tool-github

English | [中文](README.zh.md)

The model-facing GitHub pull-request tool suite: twelve `gh_pr_*` tools over the `ctx.github` gateway service (`@deepseek-ai/dsh-github`). Reads expose PR listings, detail, review threads, commits, and a bounded bulk-context digest; writes cover comments, thread replies, thread resolution, reviews, merge, and close. The tool layer owns schemas, canonical rendering, and card presentation metadata; every subprocess call, cache, and policy gate lives in the service.

```yaml
- name: '@deepseek-ai/dsh-github'
  config:
    favorites: ['my-org/my-repo']
- name: '@deepseek-ai/dsh-tool-github'
```

The plugin injects `tools`, `systemPrompt`, and `github`: it activates only after the gateway service mounts.

## Deployment requirement: an authenticated gh CLI

The tools inherit the service's requirement: an authenticated `gh` executable reachable through the subprocess seam. See the `@deepseek-ai/dsh-github` README for the full gateway contract, configuration, and error vocabulary.

## Tools

| Tool | Kind | Purpose |
| --- | --- | --- |
| `gh_pr_list` | read | List PRs of one repository (state filter, row cap). |
| `gh_pr_view` | read | Full detail of one PR: metadata, thread counts, checks, body. |
| `gh_pr_threads` | read | Review threads with ids, locations, and resolution states. |
| `gh_pr_thread` | read | One complete thread with every comment body. |
| `gh_pr_commits` | read | Commit listing plus the real total count. |
| `gh_pr_context` | read | Bulk digest via `gh pr-enrich` with on-disk report paths. |
| `gh_pr_comment` | write | Create one issue-level comment. |
| `gh_pr_reply` | write | Reply inside one review thread. |
| `gh_pr_thread_resolve` | write | Resolve or unresolve one thread. |
| `gh_pr_review` | write | Submit a review (`confirm: true` required). |
| `gh_pr_merge` | write | Merge via squash/merge/rebase (`confirm: true` required). |
| `gh_pr_close` | write | Close one PR (`confirm: true` required). |

Every tool omits `repo` only when exactly one favorite repository is configured for the service; with zero or many favorites an omitted `repo` fails as `no-repo-configured`.

## Errors

A rejected service result becomes a `GithubToolError` (a `HarnessError` subclass) carrying the service's stable code, so `isError` outcomes expose `info.name: 'GithubToolError'` and `info.code` from the gateway vocabulary (`not-found`, `confirmation-required`, `writes-disabled`, `self-review-forbidden`, `enrich-disabled`, ...). The gh stderr tail, when present, rides the error message. Nothing parses messages to route: branch on `code`.

## Presentation contract

Every successful call projects `presentationMeta` as `{ kind, value }` where `kind` is one of `github.pr-list`, `github.pr-detail`, `github.thread-list`, `github.thread-full`, `github.commit-list`, `github.context-digest`, `github.comment-created`, `github.thread-reply`, `github.thread-resolution`, `github.review-submitted`, `github.merged`, `github.state-change`. Client tool cards consume that metadata; the model only sees the rendered text.

## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains the independently registered guidance below.

##### GitHub tool guidance

```markdown
Use the gh_pr_* tools — not gh CLI via shell — for GitHub pull-request work. Start with gh_pr_list to find numbers; gh_pr_view, gh_pr_threads, gh_pr_thread, gh_pr_commits, and gh_pr_context read one PR. gh_pr_threads returns the thread ids gh_pr_reply and gh_pr_thread_resolve need; gh_pr_threads defaults to unresolved threads. Writes (gh_pr_comment, gh_pr_reply, gh_pr_thread_resolve, gh_pr_review, gh_pr_merge, gh_pr_close) surface service rejections as typed errors instead of failing silently. gh_pr_review, gh_pr_merge, and gh_pr_close require confirm: true. gh_pr_context returns a bounded digest with on-disk report file paths; full comment bodies stay in those files — read them only when the digest is not enough. Enrichment (enrich: true) exports PR content to a model provider and additionally requires confirmExport: true.
```

#### Token effect

Fixed guidance cost per request while the tools are registered.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged. Activation or disposal may invalidate reuse from this prompt section.

### Tool schemas

#### What the model sees

The generated [`gh_pr_*` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-github) carry the parameter contracts above; the tools are registered unconditionally once the gateway service mounts.

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while tool visibility and definitions are unchanged. Registration lifecycle or scoped restrictions may invalidate reuse from the first changed schema token.

### Results

#### What the model sees

Reads render one compact text projection per value (listing rows, detail block, thread lines, commit rows, digest summary). Writes render one confirmation line with the resulting URL or state. `gh_pr_context` names its on-disk report files and reminds the model that full bodies stay there.

#### Token effect

Inline text is bounded by the service value sizes; the call and retained result remain in history until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Tool errors

#### What the model sees

Failures are normalized as `Error: <message>` with `GithubToolError` metadata carrying the gateway's stable code (`not-found`, `confirmation-required`, `writes-disabled`, `self-review-forbidden`, `enrich-disabled`, and the remaining gateway vocabulary), plus the gh stderr tail when present.

#### Token effect

Only a failing call adds these retained tokens.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- Reopen is a service capability without a v1 tool; close is the only lifecycle tool exposed to the model.
- No tool declares `timeoutMs`: termination is bounded by the service's own `timeoutMs` / `enrichTimeoutMs` deadlines because service methods accept no external abort signal to forward.
- `gh_pr_context` digests omit review bodies by design; the returned file paths are the only access route to full bodies.
