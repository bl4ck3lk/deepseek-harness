# `@deepseek-ai/dsh-client-ui-github`

[English](README.md) | 中文

GitHub PR 浏览器界面：一个 `conversation.view` 仪表盘标签页（`id: 'github'`，序号 20），通过 `ctx.remote.github` 命名空间列出某一个仓库的拉取请求，并提供详情窗格（基础数据、按 全部/已解决/未解决 过滤的评审线程、提交记录）；另外为每个 `gh_pr_*` 工具提供一张 keyed `tool.call.toolview` 卡片，按工具结果 `presentationMeta` 上 stamp 的展示 kind（从 `github.pr-list` 到 `github.state-change`）渲染。仪表盘按设计为只读：写操作保留给面向模型的工具，它们带有确认门槛。全部文案在双语的 `github` locale 命名空间中，每个注册都经由 slot effect 包装，卸载即移除全部界面。

## 已知限制与暂缓工作

- **只读仪表盘** — 合并、关闭、评审与线程解决只能通过面向模型的工具及其确认流程完成；GUI 操作通道暂缓。
- **单列表范围** — 标签页一次只列一个仓库（手动输入 `owner/name`，或使用服务的单一收藏默认值）；多收藏浏览暂缓。
- **仓库输入为纯文本** — 没有自动补全；收藏列表后续可以补充选择器。
