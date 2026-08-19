# `@deepseek-ai/dsh-client-ui-github`

English | [中文](README.zh.md)

The GitHub PR browser surface: one `conversation.view` dashboard tab (`id: 'github'`, order 20) that lists one repository's pull requests over the `ctx.remote.github` namespace with a detail pane (facts, review threads filtered all/resolved/unresolved, commits), plus one keyed `tool.call.toolview` card per `gh_pr_*` tool rendering each stamped presentation kind (`github.pr-list` … `github.state-change`) from the tool result's `presentationMeta`. The dashboard is read-only by design: write actions stay with the model-facing tools, which carry the confirmation gates. All copy lives in a bilingual `github` locale namespace, every registration rides the slot effect wrapper, and disposal removes the whole surface.

## Known Limitations and Deferred Work

- **Read-only dashboard** — merge, close, review, and thread resolution reachable only through the model-facing tools with their confirmation flow; a GUI action lane is deferred.
- **Single-listing scope** — the tab lists one repository at a time (typed `owner/name` or the service's single favorite default); multi-repo favorites browsing is deferred.
- **Repo input is plain text** — no autocomplete; the favorites list could feed a picker later.
