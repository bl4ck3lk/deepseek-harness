# `@deepseek-ai/dsh-github-app`

English | [中文](README.zh.md)

The opt-in GitHub PR surface as a profile bundle: [`cordis.patch.yml`](cordis.patch.yml) inserts the [`dsh-github`](../../github/github/README.md) gh-CLI gateway service (host) and the [`dsh-client-ui-github`](../../github/ui-github/README.md) dashboard tab plus `gh_pr_*` tool cards (browser) over the web profile. The default web bundle carries no GitHub code path at all; a deployment opts in by appending `@deepseek-ai/dsh-github-app` to the profile's `dsh.profile.bundles` list, and per-deployment tuning (favorites, write and enrichment gates, report root) belongs in the profile's own `cordis.patch.yml` overriding the `github` row by id. The package has no runtime API; the profile composer resolves the patch through the `dsh.bundle.patch` manifest field, never through code.

## Known Limitations and Deferred Work

- **Opt-in only** — the bundle neither mounts nor depends on the model-facing tool package; agents receive `gh_pr_*` tools through their own preset composition.
- **A patch replaces whole row configs** — profile overrides must restate every field a row keeps; there is no deep-merge layer.
