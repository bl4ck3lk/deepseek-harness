# @deepseek-ai/dsh-github

[English](README.md) | 中文

面向 GitHub 合并请求（pull request）领域的宿主网关服务。本包注册 `ctx.github`，仅通过 `ctx.subprocess` 接缝生成已认证的 `gh` CLI 进程，并发布宿主 `github.*` 一元 Remote 契约（命名空间 `github`）。所有 GraphQL 读取与变更均经由 `gh api graphql`；合并请求评论、评审、合并、关闭与重开经由相应的 `gh pr` 子命令执行。服务拥有 argv 构造、响应映射、失败分类、TTL 缓存以及写入/富化门控。服务不持有任何 GitHub 令牌：子进程仅继承擦净后的父环境加上配置的 `childEnv` 增量，认证保持在 `gh auth` 存储的位置。

```ts ignore-check
await ctx.plugin(LocalSubprocessRuntime)   // @deepseek-ai/dsh-subprocess-local
await ctx.plugin(GithubService, {
  favorites: ['my-org/my-repo'],
})
```

## 部署要求：已认证的 gh CLI

`[Service.init]` 通过 subprocess 接缝解析 `ghPath` 可执行文件；解析失败时以 `gh-missing` 使激活失败。此后每次调用都假定 `gh` 已对目标仓库完成认证。服务从不读取、打印或转发凭据。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `ghPath` | `gh` | 通过 subprocess 接缝解析的可执行文件或绝对路径。 |
| `favorites` | `[]` | 请求可省略 `repo` 的 `owner/name` 仓库列表。恰好一个收藏时它是隐式默认；零个或多个时，省略 `repo` 以 `no-repo-configured` 失败。 |
| `cacheTtlMs` | `30000` | 读缓存存活期。`0` 禁用缓存。每次成功写入使整个缓存失效。 |
| `timeoutMs` | `60000` | 单次 `gh` 调用（读取、写入、普通上下文收集）的截止期。超时归类为 `aborted`。 |
| `enrichTimeoutMs` | `300000` | 单次 `gh pr-enrich` 收集的截止期；该命令可能运行数分钟。 |
| `maxOutputBytes` | `8388608` | 每次调用的 collect 模式 stdout 预算；有损读取归类为 `output-overflow`。 |
| `allowWrites` | `true` | 所有变更操作的总开关。`false` 时所有写入在启动任何进程前以 `writes-disabled` 失败。 |
| `allowEnrich` | `false` | `getContext` 富化的第一道门。富化还要求每次调用携带 `confirmExport: true`。 |
| `reportRoot` | `<dsh home>/github-reports` | 接收每次收集产生的 `owner-name-pr-N` 报告目录的根目录。 |
| `childEnv` | `{}` | 在擦净后的父环境之上为每次 spawn 合并的额外环境项（例如测试中的 `GH_HOST`）。 |

## Remote 契约

每个操作返回 `GithubResult<T>`：`{ ok: true, value }` 或 `{ ok: false, error: { code, message, detail? } }`。存在时 `detail` 携带有界的 `gh` stderr/stdout 尾部。

| 操作 | 类别 | 说明 |
|---|---|---|
| `listPullRequests` | 读 | `state` 过滤默认 `OPEN`；`first` 钳制在 1..100。 |
| `getPullRequest` | 读 | 详情包含标签、已解决/未解决线程计数与检查上下文。 |
| `listThreads` | 读 | `filter` 默认 `unresolved`；支持 `resolved` 与 `all`。线程摘要携带下述变更所需的 GraphQL 线程 id。 |
| `getThread` | 读 | 按 `PRRT_…` id 读取一个完整线程，包含每条评论正文。 |
| `listCommits` | 读 | 提交行加 GraphQL `totalCount`；缺失时回退为返回行数。 |
| `getContext` | 读 | 通过 `gh pr-enrich` 的批量摘要（见下文）。 |
| `addComment` | 写 | `gh pr comment` 议题级评论；返回评论 URL。 |
| `replyToThread` | 写 | 在一个评审线程内以 GraphQL 回复。 |
| `setThreadResolved` | 写 | 按 id 解决或重新打开一个评审线程。 |
| `submitReview` | 写 | `approve`、`request-changes` 或 `comment` 评审；要求 `confirm: true`。GitHub 禁止对自己的合并请求执行 approve/request-changes；服务将该 API 拒绝归类为 `self-review-forbidden` 而非通用失败。 |
| `mergePullRequest` | 写 | `squash`、`merge` 或 `rebase`；可选 `deleteBranch`；要求 `confirm: true`。 |
| `closePullRequest` | 写 | 要求 `confirm: true`。 |
| `reopenPullRequest` | 写 | 无需确认：重开是恢复先前状态。 |

写入门控顺序：先 `allowWrites`（`writes-disabled`），再逐操作确认（`confirmation-required`），最后执行。

## 错误码

| 码 | 含义 |
|---|---|
| `gh-missing` | 激活时 `ghPath` 未解析为可执行文件。 |
| `gh-launch-failed` | subprocess 接缝拒绝了 spawn 或其结算。 |
| `gh-failed` | 非零退出或被信号终止；`detail` 携带输出尾部。 |
| `invalid-response` | JSON 不可解析，或响应违反文档化的 GraphQL 形状。 |
| `invalid-repo` | `repo` 参数不是 `owner/name`。 |
| `no-repo-configured` | 在零个或多个收藏下省略了 `repo`。 |
| `not-found` | GitHub 报告仓库或合并请求不存在。 |
| `writes-disabled` | `allowWrites` 为 `false` 时尝试写入。 |
| `enrich-disabled` | `allowEnrich` 为 `false` 时请求富化。 |
| `confirmation-required` | 需确认的写入未携带 `confirm: true`。 |
| `self-review-forbidden` | GitHub 拒绝对调用者自己的合并请求执行 approve/request-changes。 |
| `enrich-failed` | `gh pr-enrich` 失败或未产生可解析的 `combined-data.json`。 |
| `output-overflow` | 单次调用超过 `maxOutputBytes`。 |
| `aborted` | 截止期超时或调用方取消。 |

## 缓存

读取（`listPullRequests`、`getPullRequest`、`listThreads`、`listCommits`）按精确请求键缓存 `cacheTtlMs`。每次成功写入使整个缓存失效，使变更对下一次读取可见。`getThread` 与 `getContext` 从不缓存：线程正文与报告文件是对新鲜度最敏感的界面。

## 通过 gh pr-enrich 的批量上下文

`getContext` 以 `cwd` 设为 `repoPath`（默认 `process.cwd()`）运行 `gh pr-enrich <number> --json --output-dir <reportRoot>/<owner>-<name>-pr-<number>`，随后把 `combined-data.json` 解析为有界摘要：评论数、已解决/未解决线程计数、检查统计以及磁盘文件位置。摘要从不内嵌完整评论正文；需要正文的消费者读取返回的文件路径。富化（`--enrich` 标志，会把 PR 内容导出给模型提供方）受双重门控：配置中的 `allowEnrich` 加上请求中的 `confirmExport: true`。两者未同时满足时，`getContext` 仍收集普通摘要。

## 模型体验

### 服务界面

#### 模型看到什么

什么都没有。`ctx.github` 不注册任何工具、提示词段落、面向模型的上下文或会话事件。模型访问仅经由单独文档化的消费者（例如拥有自身 schema 与提示词指引的 `dsh-tool-github` 工具包）。

#### Token 影响

零。本包的任何请求、结果或失败都不进入模型请求，除非某个消费者转发它。

#### KV Cache 影响

独立。调用 `ctx.github` 不触碰模型请求前缀，不会使本可复用的提供方缓存条目失效。

## 已知限制与待办

- **每个宿主一个 gh 账号** —— 服务使用 `gh auth` 选定的账号；没有逐请求身份或多账号切换。
- **报告不做垃圾回收** —— 每次收集在 `reportRoot` 下创建一个报告目录；在留存策略落地前，清理由运维负责。
- **分页为单页** —— 列表请求单个 GraphQL 页（`first` 已钳制）；面向超大 PR 集合的游标跟进留待后续。
- **无 webhook 或轮询新鲜度** —— 新鲜度仅来自 TTL 缓存与写入失效。
- **可信调用方边界** —— Remote 操作不携带已认证的行动者；部署必须仅通过其可信边界暴露宿主网关，且在授权落地前 `allowWrites` 是唯一的写入节流手段。
