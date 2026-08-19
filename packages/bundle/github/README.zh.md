# `@deepseek-ai/dsh-github-app`

[English](README.md) | 中文

GitHub PR 界面的可选配置包：[`cordis.patch.yml`](cordis.patch.yml) 在 web profile 之上插入 [`dsh-github`](../../github/github/README.md) gh-CLI 网关服务（主机端）和 [`dsh-client-ui-github`](../../github/ui-github/README.md) 仪表盘标签页与 `gh_pr_*` 工具卡片（浏览器端）。默认 web 配置包不包含任何 GitHub 代码路径；部署方通过把 `@deepseek-ai/dsh-github-app` 追加到 profile 的 `dsh.profile.bundles` 列表来启用，而每个部署的调优（收藏仓库、写入与富化开关、报告根目录）应放在 profile 自己的 `cordis.patch.yml` 中按 id 覆盖 `github` 行。本包没有运行时 API；profile 组合器通过 `dsh.bundle.patch` manifest 字段解析该 patch，而不是通过代码。

## 已知限制与暂缓工作

- **仅可选启用** — 本配置包既不挂载也不依赖面向模型的工具包；agent 通过各自的 preset 组合获得 `gh_pr_*` 工具。
- **patch 整行替换配置** — profile 的行覆盖必须重述该行保留的每个字段；没有深合并层。
