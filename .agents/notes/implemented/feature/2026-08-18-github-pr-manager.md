# Agent Note: GitHub PR manager — static packages and opt-in surface

Status: implemented

## Problem

The agent has no GitHub interaction path beyond raw `gh` CLI calls through the bash tool — no typed responses, no
presentation cards, no conversation-view dashboard. Review-thread navigation, comment threading, and PR lifecycle
actions (merge, close, review, resolve/unresolve) are inaccessible without model-visible typed tools that the
harness can act on reliably.

## Decision

Four static packages (gateway service, model-facing tools, browser surface, opt-in bundle) form a complete
GitHub capability:

**Gateway service** (`@deepseek-ai/dsh-github`, `packages/github/github`) — a TypertRemoteService wrapping the
local `gh` CLI via the subprocess seam. The typed remote protocol exposes 13 methods (listPullRequests,
getPullRequest, listThreads, getThread, listCommits, getContext, addComment, replyToThread, setThreadResolved,
submitReview, mergePullRequest, closePullRequest, reopenPullRequest). Reads use a TTL cache; successful writes
invalidate the cache. GraphQL queries are authoritative for thread location and mutation; `gh pr-enrich` is an
optional bulk-collector, double-gated by `allowEnrich` config (default false) and per-call `confirmExport`.

**Tool suite** (`@deepseek-ai/dsh-tool-github`, `packages/github/tool-github`) — twelve model-facing tools
(gh_pr_list, gh_pr_view, gh_pr_threads, gh_pr_thread, gh_pr_commits, gh_pr_context, gh_pr_comment, gh_pr_reply,
gh_pr_thread_resolve, gh_pr_review, gh_pr_merge, gh_pr_close) with typed JSON output schemas and
presentationMeta (kind + structured value) the browser cards consume. Write tools carry a confirmation gate
(confirm: true). Results surface typed GithubToolError outcomes for domain, infrastructure, and policy failures.

**Browser surface** (`@deepseek-ai/dsh-client-ui-github`, `packages/github/ui-github`) — one conversation.view
dashboard tab (id 'github', order 20) listing one repository's pull requests over the remote namespace with a
detail pane (facts, review threads filtered all/resolved/unresolved, commits), and one keyed tool.call.toolview
card per gh_pr_* tool rendering each stamped presentation kind from the result's presentationMeta. The dashboard
is read-only by design; write actions stay with the model-facing tools. Twelve keyed card registrations, one
tab registration, bilingual github locale namespace; unmount cleans the whole surface.

**Opt-in bundle** (`@deepseek-ai/dsh-github-app`, `packages/bundle/github`) — a profile patch layer inserting
the gateway service (host) and browser surface (client). Default profiles carry no GitHub code path; a
deployment opts in by appending the bundle to the profile's `dsh.profile.bundles`. The bundle resolves from the
dsh installation anchor (apps/cli dependency) but renders only when listed in the profile.

**Snapshot scenario** — the `github-pr-list` snapshot in `examples/acp-agent/` drives the REAL gateway and
tool suite against a deterministic fixture gh executable materialized by `prepareWorkspace` at a stable /tmp
path. Recording and keyless replay execute the complete service + tool pipeline without network or credentials.

**Adapter hardening** — the live-model recording exposed a gateway interoperability gap: OpenAI-compatible
gateways repeat tool-call id and name as empty strings on continuation SSE deltas, and the adapter's assembly
overwrote the pinned values. The translate function now keeps the first non-empty id/name; a regression test
covers the shape.

**Live e2e** — `packages/github/github/tests/live-github.spec.ts` is GH_TOKEN-gated and self-skips without
the token, exercising list and classify-not-found against real GitHub.

## Trust and boundaries

The gateway service executes the `gh` CLI as a subprocess and surfaces all 13 typed remote methods to the
browser. The remote namespace is mounted unconditionally in the api-remotes client assembly; the host service
exists only when the bundle (or an equivalent composition row) mounts it. A session without the gateway
service that calls a github remote method receives a carrier service-unavailable failure. Write actions
carry model-facing confirmation gates; browser-initiated writes (resolve/unresolve, merge) are deferred.

## Deferred

- GUI write actions from the dashboard (resolve, merge through buttons)
- Multi-repo favorites browsing (picker over configured favorites)
- Repo-name autocomplete
- Display of context-digest report files in the detail pane
