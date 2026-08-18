# @deepseek-ai/dsh-tool-github

[English](README.md) | 中文

面向模型的 GitHub pull request 工具套件：基于 `ctx.github` 网关服务（`@deepseek-ai/dsh-github`）的十二个 `gh_pr_*` 工具。读取类工具提供 PR 列表、详情、评审线程、提交以及有界的批量上下文摘要；写入类工具覆盖评论、线程回复、线程状态切换、评审、合并与关闭。工具层拥有参数模式、规范化渲染与卡片展示元数据；所有子进程调用、缓存与策略闸门都在服务层。

```yaml
- name: '@deepseek-ai/dsh-github'
  config:
    favorites: ['my-org/my-repo']
- name: '@deepseek-ai/dsh-tool-github'
```

该插件注入 `tools`、`systemPrompt` 与 `github`：只有网关服务挂载成功后它才会激活。

## 部署要求：已认证的 gh CLI

工具继承服务层的同一要求：一个通过子进程接缝可达、已完成认证的 `gh` 可执行文件。网关的完整契约、配置与错误词汇见 `@deepseek-ai/dsh-github` 的 README。

## 工具

| 工具 | 类别 | 用途 |
| --- | --- | --- |
| `gh_pr_list` | 读取 | 列出某个仓库的 PR（状态过滤、行数上限）。 |
| `gh_pr_view` | 读取 | 单个 PR 的完整详情：元数据、线程计数、检查、正文。 |
| `gh_pr_threads` | 读取 | 评审线程，含 id、位置与解决状态。 |
| `gh_pr_thread` | 读取 | 单个完整线程及其全部评论正文。 |
| `gh_pr_commits` | 读取 | 提交列表与真实总数。 |
| `gh_pr_context` | 读取 | 经 `gh pr-enrich` 的批量摘要及磁盘报告路径。 |
| `gh_pr_comment` | 写入 | 创建一条 issue 级评论。 |
| `gh_pr_reply` | 写入 | 在一个评审线程内回复。 |
| `gh_pr_thread_resolve` | 写入 | 解决或重新打开一个线程。 |
| `gh_pr_review` | 写入 | 提交评审（需要 `confirm: true`）。 |
| `gh_pr_merge` | 写入 | 以 squash/merge/rebase 合并（需要 `confirm: true`）。 |
| `gh_pr_close` | 写入 | 关闭一个 PR（需要 `confirm: true`）。 |

只有当服务恰好配置了一个收藏仓库时，工具才可以省略 `repo`；收藏为零或多于一个时，省略 `repo` 会以 `no-repo-configured` 失败。

## 错误

被拒绝的服务结果会转换为携带服务稳定错误码的 `GithubToolError`（`HarnessError` 子类），因此 `isError` 结果会暴露 `info.name: 'GithubToolError'` 以及来自网关词汇表的 `info.code`（`not-found`、`confirmation-required`、`writes-disabled`、`self-review-forbidden`、`enrich-disabled` 等）。存在 gh stderr 尾部时，它会附在错误消息中。任何路由都不解析消息文本：只按 `code` 分支。

## 展示契约

每次成功调用都会把 `presentationMeta` 投影为 `{ kind, value }`，其中 `kind` 取值之一为 `github.pr-list`、`github.pr-detail`、`github.thread-list`、`github.thread-full`、`github.commit-list`、`github.context-digest`、`github.comment-created`、`github.thread-reply`、`github.thread-resolution`、`github.review-submitted`、`github.merged`、`github.state-change`。客户端工具卡片消费该元数据；模型只看到渲染后的文本。

## 模型体验

### 系统提示

#### What the model sees

该插件注册范围内的每次请求都包含下面这条独立注册的指引。

##### GitHub tool guidance

```markdown
Use the gh_pr_* tools — not gh CLI via shell — for GitHub pull-request work. Start with gh_pr_list to find numbers; gh_pr_view, gh_pr_threads, gh_pr_thread, gh_pr_commits, and gh_pr_context read one PR. gh_pr_threads returns the thread ids gh_pr_reply and gh_pr_thread_resolve need; gh_pr_threads defaults to unresolved threads. Writes (gh_pr_comment, gh_pr_reply, gh_pr_thread_resolve, gh_pr_review, gh_pr_merge, gh_pr_close) surface service rejections as typed errors instead of failing silently. gh_pr_review, gh_pr_merge, and gh_pr_close require confirm: true. gh_pr_context returns a bounded digest with on-disk report file paths; full comment bodies stay in those files — read them only when the digest is not enough. Enrichment (enrich: true) exports PR content to a model provider and additionally requires confirmExport: true.
```

#### Token effect

工具注册期间，每次请求承担固定的指引成本。

#### KV Cache effect

在插件范围与指引文本不变时保持前缀稳定。激活或卸载可能使该提示小节起的复用失效。

### 工具模式

#### What the model sees

生成的 [`gh_pr_*` 模式](../../../docs/tool-catalog.md#deepseek-aidsh-tool-github)承载上文的参数契约；网关服务挂载后工具即无条件注册。

#### Token effect

在工具可见的每次请求上承担固定的模式成本。

#### KV Cache effect

在工具可见性与定义不变时保持前缀稳定。注册生命周期或范围限制可能使自第一个变更模式 token 起的复用失效。

### 结果

#### What the model sees

读取类工具为每个值渲染一段紧凑文本投影（列表行、详情块、线程行、提交行、摘要概要）。写入类工具渲染一行确认，附结果 URL 或状态。`gh_pr_context` 会列出磁盘报告文件名，并提醒模型完整正文保留在这些文件中。

#### Token effect

内联文本受服务值大小约束；调用与保留结果留在历史中直到压缩。

#### KV Cache effect

仅追加；新可见内容跟在可复用请求前缀之后，不会使既有 KV 缓存条目失效。

### 工具错误

#### What the model sees

失败被规范化为 `Error: <message>`，其 `GithubToolError` 元数据携带网关稳定错误码（`not-found`、`confirmation-required`、`writes-disabled`、`self-review-forbidden`、`enrich-disabled` 及其余网关词汇），存在 gh stderr 尾部时一并附上。

#### Token effect

只有失败调用才增加这些保留 token。

#### KV Cache effect

仅追加；新可见内容跟在可复用请求前缀之后，不会使既有 KV 缓存条目失效。

## 已知限制与后续工作

- 重新打开（reopen）是服务能力，但 v1 不提供工具；关闭是唯一暴露给模型的生命周期工具。
- 工具均不声明 `timeoutMs`：终止时限由服务自身的 `timeoutMs` / `enrichTimeoutMs` 截止约束，因为服务方法不接受可转发的外部中止信号。
- `gh_pr_context` 摘要按设计不包含评审正文；返回的文件路径是获取完整正文的唯一通道。
