# Zuu Agent Platform Specification

> 状态：Draft  
> 版本：0.1.0  
> 日期：2026-08-11  
> 关联文档：[可行性分析](./feasibility-agent-app.md)

## 1. 文档目的

本文定义 Zuu Agent Platform 的产品边界、系统架构、领域模型、Daemon 协议、Client SDK、会话与工作流生命周期、Cron 行为、安全约束及验收标准。

实现应以本 Spec 为准。可行性文档用于解释选型，不作为接口契约。

## 2. 产品定义

Zuu 是运行在用户设备或自托管环境中的 Agent 平台。它将 Pi SDK 和 Pi Packages 封装在常驻 Daemon 中，并通过统一 Client SDK 向 WebUI、TUI、Desktop、IDE 插件及第三方程序提供 Agent 能力。

核心链路：

```text
WebUI / TUI / Desktop / IDE / Third-party App
                    │
                    ▼
              @zuu/client
                    │ HTTP + SSE (/v1)
                    ▼
               zuu-daemon
                    │
          Pi SDK + Pi Packages
                    │
       Model / Tools / Subagents / Workflows
```

### 2.1 核心原则

1. Pi SDK 只运行在 Daemon 内。
2. UI 和第三方应用只依赖 Client SDK，不直接依赖 Daemon 路由或 Pi 类型。
3. Client SDK 是唯一公共编程接口。
4. Daemon 是会话、工作流、审批和定时任务的运行时所有者。
5. Subagent、DAG 和 Workflow 优先使用 Pi Packages，不在 Zuu 中重写。
6. 定时任务不依赖 UI 存活；Daemon 运行时必须能够独立触发。
7. 对外协议从 `/v1` 开始版本化。
8. 所有长操作均可观察、可取消，并拥有稳定 ID。

### 2.2 目标用户

- 需要本地 Coding Agent 的个人开发者
- 需要统一 Agent Daemon 的桌面端或 IDE 产品
- 需要嵌入 Agent 能力的本机应用
- 需要工作流、Subagent 和定时自动化的技术团队

### 2.3 V1 目标

- 常驻 Daemon 与健康检查
- 类型化 Client SDK
- 项目和会话管理
- 流式 prompt、steer、follow-up 和 abort
- 模型与 thinking level 选择
- 工具调用事件与审批
- 持久会话、恢复、分支与 compact
- Pi Packages 加载和诊断
- Subagent、DAG、Workflow 的启动与观察
- Cron、interval、one-shot 定时任务
- 至少一个只通过 Client SDK 访问 Daemon 的 UI

### 2.4 V1 非目标

- 自研模型推理循环
- 自研通用 DAG/Workflow 引擎
- 自研 Cron 表达式引擎
- 公网多租户 SaaS
- UI 直接消费 Pi 原始事件
- 无沙箱条件下的全自动生产部署
- V1 内保证原生 Windows 支持所有第三方 Pi Packages

## 3. 系统组件

### 3.1 `zuu-daemon`

职责：

- 启动和管理 Pi `ModelRuntime`
- 为每个项目创建和管理 `AgentSessionRuntime`
- 加载 Settings、Extensions、Skills、Prompts 和 Pi Packages
- 保存并恢复 Session
- 将 Pi 原始事件映射为 Zuu 事件
- 管理 Workflow Run、Subagent 和 Artifact
- 管理 Schedule，并委托调度后端触发任务
- 管理审批、鉴权、并发、限流和诊断
- 暴露 `/v1` HTTP 与 SSE API

约束：

- 默认仅监听 `127.0.0.1`
- 不包含 UI
- 不导出 Pi SDK 对象
- 进程退出时应停止接收新任务，并尽可能优雅终止活动任务

### 3.2 `@zuu/client`

职责：

- 封装全部 `/v1` API
- 提供稳定 TypeScript 类型
- 解析 SSE 并提供订阅 API
- 处理 token、超时、重连和错误映射
- 隐藏 Hono、HTTP 路由和 Pi SDK 细节

约束：

- 不依赖 Pi SDK
- 支持 Node.js 及浏览器
- 允许外部应用独立安装
- 禁止以内部路由字符串作为主要公共 API

### 3.3 UI 应用

职责：

- 展示会话、消息、工具调用、审批、Workflow Board 和 Schedule
- 将用户操作转换为 Client SDK 调用

约束：

- 不直接调用 `fetch("/v1/...")`
- 不读取 Session JSONL、`.pi/workflows` 或 `.crew` 文件
- 不依赖 Pi 事件类型

### 3.4 Pi 集成层

默认组成：

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-ai`
- `@agwab/pi-workflow`
- `@agwab/pi-subagent`（由 workflow 依赖或显式安装）
- `pi-crew`（Cron、团队编排和动态 Workflow）

第三方包必须固定版本，升级前进行源码审查和集成测试。

## 4. 部署与进程模型

### 4.1 默认部署

- 一个操作系统用户启动一个 Daemon
- 一个 Daemon 管理多个 Project
- 一个 Project 可有多个 Session、Workflow Run 和 Schedule
- 一个 Session 同时最多执行一个主 Agent Run
- Workflow 可以产生多个并发 Subagent

### 4.2 运行环境

- 首选：Linux 或 WSL2
- 开发运行时：Node.js
- Pi Workflow 依赖 Node.js，必须满足其最低版本要求
- 原生 Windows 下不保证 `pi-workflow`、Unix socket broker 等能力完整

### 4.3 Daemon 生命周期

状态：

```text
starting → ready → draining → stopped
              └──→ degraded
```

- `starting`：初始化配置、凭据、Package 和调度后端
- `ready`：可接受请求
- `degraded`：核心可用但存在 Package、模型或调度诊断错误
- `draining`：拒绝创建新 Run，等待或取消活动任务
- `stopped`：已退出

## 5. 核心领域模型

所有 ID 使用不可预测的字符串 ID；建议 UUIDv7。

### 5.1 Project

```ts
interface Project {
  id: string;
  name: string;
  cwd: string;
  agentDir?: string;
  createdAt: string;
  updatedAt: string;
  status: "ready" | "degraded" | "unavailable";
}
```

约束：

- `cwd` 必须是 Daemon 可访问的绝对路径
- Project ID 是 API 主键；Client 不应反复传递任意 cwd
- 工具执行默认限制在 Project cwd 内

### 5.2 Session

```ts
interface Session {
  id: string;
  projectId: string;
  name?: string;
  status: "idle" | "running" | "waiting_approval" | "compacting" | "error";
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  sessionFile?: string;
  createdAt: string;
  updatedAt: string;
}
```

### 5.3 Agent Run

一次 prompt、steer 后续执行或 Schedule 触发形成一个 Run。

```ts
interface AgentRun {
  id: string;
  sessionId: string;
  source: "user" | "schedule" | "workflow" | "api";
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "aborted";
  startedAt?: string;
  finishedAt?: string;
  error?: ZuuError;
}
```

### 5.4 Workflow Run

```ts
interface WorkflowRun {
  id: string;
  projectId: string;
  sessionId?: string;
  workflow: string;
  status: "preparing" | "running" | "paused" | "completed" | "failed" | "aborted";
  progress?: { completed: number; total?: number };
  source: "user" | "schedule" | "agent" | "api";
  artifactIds: string[];
  createdAt: string;
  updatedAt: string;
}
```

Workflow Stage 和 Task 必须使用各自稳定 ID，并公开依赖、状态、开始/结束时间和输出 Artifact 引用。

### 5.5 Approval

```ts
interface Approval {
  id: string;
  sessionId: string;
  runId: string;
  kind: "tool" | "command" | "filesystem" | "network" | "package";
  title: string;
  description: string;
  risk: "low" | "medium" | "high" | "critical";
  status: "pending" | "allowed" | "denied" | "expired";
  expiresAt?: string;
}
```

### 5.6 Schedule

```ts
type ScheduleTrigger =
  | { type: "cron"; expression: string; timezone: string }
  | { type: "interval"; intervalMs: number }
  | { type: "once"; runAt: string };

type ScheduleAction =
  | { type: "prompt"; projectId: string; sessionPolicy: SessionPolicy; prompt: string }
  | { type: "workflow"; projectId: string; workflow: string; prompt: string; profile?: string };

interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: ScheduleTrigger;
  action: ScheduleAction;
  overlapPolicy: "skip" | "queue" | "parallel";
  misfirePolicy: "skip" | "run_once";
  maxRuntimeMs?: number;
  nextRunAt?: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

`SessionPolicy`：

- `new`：每次创建新 Session
- `reuse`：复用指定 Session
- `continue_recent`：继续 Project 最近 Session

### 5.7 Schedule Run

```ts
interface ScheduleRun {
  id: string;
  scheduleId: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped" | "aborted";
  scheduledFor: string;
  startedAt?: string;
  finishedAt?: string;
  agentRunId?: string;
  workflowRunId?: string;
  reason?: string;
}
```

## 6. 状态与持久化

### 6.1 真相源

- Session 消息与树：Pi Session JSONL
- Workflow Run、Task、Artifact：编排 Package 的持久化数据
- Project、Schedule、Approval 索引和 Zuu 元数据：Zuu Store
- Client：只保留缓存，不是真相源
- UI：无持久化业务真相

### 6.2 Zuu Store

V1 可采用 SQLite。必须支持：

- Project 元数据
- Schedule 定义与 Schedule Run
- Approval 状态
- Pi Session 与 Zuu Session ID 映射
- Workflow Run 索引
- Event 游标或重放索引

不得将 API Key 明文写入 SQLite。

当前切片在 SQLite 落地前允许使用版本化 JSON store 作为过渡实现，但必须满足与 Zuu Store 一致的可观测和恢复要求：写入必须采用临时文件加原子替换；读到损坏 JSON 时必须保留 `.corrupt-*.bak` 备份并恢复为空数据；diagnostics 必须暴露每个 store 的路径、记录数、是否存在、是否恢复过以及错误信息。该过渡实现不得把 API Key 或 provider credential 写入这些 JSON 文件。

### 6.3 重启恢复

Daemon 启动时必须：

1. 加载 Project 与 Schedule。
2. 计算 Schedule 的 `nextRunAt`。
3. 按 `misfirePolicy` 处理停机期间错过的触发。
4. 将遗留 `running` Run 标记为 `failed` 或从后端恢复。
5. 重建可查询的 Workflow 索引。
6. 发布 `daemon.ready` 或 `daemon.degraded` 事件。

## 7. HTTP API

### 7.1 通用规则

- Base path：`/v1`
- Content-Type：`application/json`
- 时间：ISO 8601 UTC
- 路径 ID 必须 URL encode
- 创建类接口支持 `Idempotency-Key`
- 列表接口支持 `cursor` 和 `limit`
- 删除默认为可恢复的软删除；不可恢复操作必须明确命名

成功响应：

```json
{
  "data": {}
}
```

失败响应：

```json
{
  "error": {
    "code": "session_busy",
    "message": "Session is already running",
    "retryable": false,
    "details": {}
  }
}
```

### 7.2 Health 与 Diagnostics

- `GET /v1/health`
- `GET /v1/diagnostics`

Health 至少返回 Daemon 状态、版本、协议版本、uptime。

Diagnostics 返回模型认证状态、Package 加载错误、Project 错误和 Scheduler 状态；不得返回密钥。资源诊断必须区分已信任且会参与加载的 packages，以及因未信任而被阻止加载的 blocked packages。Package 安装、更新或删除必须有可查询的 operation 记录，至少包含来源、动作、进度事件、结束状态和失败原因。

### 7.3 Packages

- `GET /v1/packages`
- `POST /v1/packages`
- `POST /v1/packages/install`
- `POST /v1/packages/update`
- `DELETE /v1/packages`
- `POST /v1/packages/trust`
- `DELETE /v1/packages/trust`
- `GET /v1/package-operations`
- `GET /v1/package-operations/:operationId`

`POST /v1/packages` 只登记 package source，不安装、不信任、不加载。Package summary 必须返回 configured/installed/filtered 状态、trusted/untrusted 状态、enabled/blocked 加载状态和可用安装路径。未信任 package 可以保留在配置中用于审查，但不得进入 Pi `ResourceLoader`、Workflow/Subagent adapter 或任何 Extension binding 链路。

### 7.4 Projects

- `POST /v1/projects`
- `GET /v1/projects`
- `GET /v1/projects/:projectId`
- `PATCH /v1/projects/:projectId`
- `DELETE /v1/projects/:projectId`

### 7.5 Sessions

- `POST /v1/projects/:projectId/sessions`
- `GET /v1/projects/:projectId/sessions`
- `GET /v1/sessions/:sessionId`
- `PATCH /v1/sessions/:sessionId`
- `POST /v1/sessions/:sessionId/fork`
- `POST /v1/sessions/:sessionId/compact`
- `DELETE /v1/sessions/:sessionId`

### 7.6 Prompt 与运行控制

- `POST /v1/sessions/:sessionId/prompts`
- `POST /v1/sessions/:sessionId/steer`
- `POST /v1/sessions/:sessionId/follow-ups`
- `POST /v1/runs/:runId/abort`
- `GET /v1/runs/:runId`
- `GET /v1/runs/:runId/events`

Prompt 请求：

```ts
interface PromptRequest {
  text: string;
  images?: ImageInput[];
  streamingBehavior?: "steer" | "followUp";
  idempotencyKey?: string;
}
```

当 Session 正在运行且没有指定合法 `streamingBehavior` 时，返回 `409 session_busy`。

Prompt SSE 事件必须包含稳定 `id`，并至少按 Run 保留一个可查询的事件窗口。`GET /v1/runs/:runId/events` 必须返回该 Run 已存档的标准 `PromptStreamEvent` 列表，并支持通过 `afterEventId` 补拉指定事件之后的事件；如果 `afterEventId` 不存在，应返回当前窗口内全部事件。

### 7.7 Workflows

- `GET /v1/projects/:projectId/workflows`
- `POST /v1/projects/:projectId/workflow-runs`
- `GET /v1/projects/:projectId/workflow-runs`
- `GET /v1/workflow-runs/:runId`
- `POST /v1/workflow-runs/:runId/abort`
- `GET /v1/workflow-runs/:runId/stages`
- `GET /v1/workflow-runs/:runId/tasks`
- `GET /v1/artifacts/:artifactId`

Daemon 必须通过 Adapter 隔离 `pi-workflow`、`pi-crew` 等后端差异。

### 7.8 Approvals

- `GET /v1/approvals?status=pending`
- `GET /v1/approvals/:approvalId`
- `POST /v1/approvals/:approvalId/resolve`

Resolve body：

```ts
interface ResolveApprovalRequest {
  decision: "allow_once" | "allow_session" | "deny";
}
```

### 7.9 Schedules

- `POST /v1/schedules`
- `GET /v1/schedules`
- `GET /v1/schedules/:scheduleId`
- `PATCH /v1/schedules/:scheduleId`
- `DELETE /v1/schedules/:scheduleId`
- `POST /v1/schedules/:scheduleId/pause`
- `POST /v1/schedules/:scheduleId/resume`
- `POST /v1/schedules/:scheduleId/trigger`
- `GET /v1/schedules/:scheduleId/runs`
- `GET /v1/schedule-runs/:runId`
- `POST /v1/schedule-runs/:runId/abort`

创建 Schedule 时必须校验：

- cron 表达式合法
- timezone 是有效 IANA timezone
- interval 不低于系统最小值
- Project、Workflow 和目标 Session 存在
- 调度后端可用

## 8. Event Stream

### 8.1 连接

- `GET /v1/events`
- 传输：Server-Sent Events
- 支持查询参数：`projectId`、`sessionId`、`runId`
- 支持 `Last-Event-ID` 重连
- Daemon 定期发送 heartbeat

### 8.2 Event Envelope

```ts
interface ZuuEvent<T = unknown> {
  id: string;
  type: string;
  timestamp: string;
  projectId?: string;
  sessionId?: string;
  runId?: string;
  workflowRunId?: string;
  scheduleId?: string;
  data: T;
}
```

### 8.3 V1 事件类型

Daemon：

- `daemon.ready`
- `daemon.degraded`
- `diagnostic.created`

Session 与消息：

- `session.created`
- `session.updated`
- `run.started`
- `message.started`
- `message.text_delta`
- `message.thinking_delta`
- `message.completed`
- `run.completed`
- `run.failed`
- `run.aborted`

工具与审批：

- `tool.started`
- `tool.updated`
- `tool.completed`
- `tool.failed`
- `approval.requested`
- `approval.resolved`

Workflow：

- `workflow.started`
- `workflow.updated`
- `workflow.stage_updated`
- `workflow.task_updated`
- `workflow.artifact_created`
- `workflow.completed`
- `workflow.failed`

Schedule：

- `schedule.created`
- `schedule.updated`
- `schedule.triggered`
- `schedule.run_started`
- `schedule.run_completed`
- `schedule.run_failed`
- `schedule.run_skipped`

### 8.4 事件兼容性

- 新字段只能以可选字段加入
- Client 必须忽略未知事件和未知字段
- 已发布的事件语义不得在同一主版本内改变
- Pi 原始事件不得直接穿透为公共事件

## 9. Client SDK

### 9.1 初始化

```ts
const client = createZuuClient({
  baseUrl: "http://127.0.0.1:8787",
  token,
  timeoutMs: 30_000,
});
```

### 9.2 公共模块

```ts
client.health.get()
client.diagnostics.list()

client.projects.create()
client.projects.list()
client.projects.get()
client.projects.update()
client.projects.remove()

client.sessions.create()
client.sessions.list()
client.sessions.get()
client.sessions.prompt()
client.sessions.steer()
client.sessions.followUp()
client.sessions.compact()
client.sessions.fork()

client.runs.get()
client.runs.abort()

client.packages.list()
client.packages.add()
client.packages.install()
client.packages.update()
client.packages.remove()
client.packages.trust()
client.packages.revokeTrust()
client.packages.listOperations()
client.packages.getOperation()

client.workflows.list()
client.workflows.run()
client.workflows.getRun()
client.workflows.abort()
client.workflows.listTasks()
client.workflows.getArtifact()

client.approvals.list()
client.approvals.resolve()

client.schedules.create()
client.schedules.list()
client.schedules.get()
client.schedules.update()
client.schedules.pause()
client.schedules.resume()
client.schedules.trigger()
client.schedules.remove()
client.schedules.listRuns()

client.events.subscribe()
```

### 9.3 订阅语义

```ts
const subscription = client.events.subscribe(
  { projectId, sessionId },
  {
    onEvent(event) {},
    onError(error) {},
    onReconnect(attempt) {},
  },
);

subscription.close();
```

Client 自动：

- 携带 token
- 保存最后 Event ID
- 指数退避重连
- 去重重复 Event ID
- 将 HTTP/SSE 错误映射为 `ZuuClientError`
- 在 `ZuuClientError` 上保留 `status`、`code`、`retryable` 和 `details`

Client 不自动：

- 重发非幂等 prompt
- 自动批准工具
- 自动创建缺失 Project

`@zuu/client` 对外发布时必须暴露构建后的 ESM 入口和 `.d.ts` 类型声明；第三方应用不得依赖 workspace 内的 `src/*.ts` 作为运行时入口。

## 10. Agent 与 Session 行为

### 10.1 Session Runtime

- 每个活动 Session 对应一个可加载的 Runtime
- 非活动 Runtime 可按 LRU 释放
- Session 被再次使用时从 JSONL 恢复
- `newSession`、`switchSession`、`fork` 后必须重绑事件和 Extensions
- Daemon 对 Runtime 替换进行原子化封装

### 10.2 队列

- Session 同时只允许一个主 Run
- `steer` 在当前 turn 工具调用结束后进入
- `followUp` 在 Agent 停止后进入
- 普通 prompt 在 streaming 时必须显式指定行为，否则拒绝
- Workflow 和 Schedule 不能隐式抢占交互式 Run

### 10.3 Compaction

- 支持手动 compact
- 支持 Pi Settings 自动 compact
- compact 开始和结束必须发事件
- compact 不得丢失 Project 安全约束
- 关键长期状态应写入 Artifact 或 Project Context，而非仅依赖历史消息

## 11. Workflow 与 Subagent

### 11.1 Backend Adapter

```ts
interface WorkflowBackend {
  listDefinitions(projectId: string): Promise<WorkflowDefinition[]>;
  start(input: StartWorkflowInput): Promise<WorkflowRun>;
  getRun(id: string): Promise<WorkflowRun>;
  listTasks(id: string): Promise<WorkflowTask[]>;
  abort(id: string): Promise<void>;
  subscribe(listener: (event: WorkflowBackendEvent) => void): () => void;
}
```

首个 Adapter 使用 `@agwab/pi-workflow`。`pi-crew` 可同时作为 Scheduler/Team 后端，但不得将其内部数据结构暴露给 Client。

### 11.2 并发与隔离

- Project 级 Subagent 并发必须可配置
- 默认最大并发建议为 4
- 并行编辑默认启用 Git worktree 隔离
- 只读研究任务默认只启用 read/grep/find/ls
- Subagent 默认不继承所有 Extensions
- 子 Agent 输出以 Artifact 传递，避免无限写入主 Session 上下文

### 11.3 失败行为

- 单 Task 失败是否阻断下游由 Workflow 定义决定
- DAG 循环或死锁必须在执行前或首次发现时失败
- Workflow 失败必须保留已有 Artifact
- Run 必须可查询失败节点与错误原因

## 12. Cron 与定时任务

### 12.1 调度所有权

- Daemon 是 Schedule 的产品级所有者
- V1 调度执行优先桥接 `pi-crew` schedule 能力
- Zuu 使用 `ScheduleBackend` 隔离具体实现
- UI 和 Client 不包含调度循环

```ts
interface ScheduleBackend {
  create(schedule: Schedule): Promise<void>;
  update(schedule: Schedule): Promise<void>;
  remove(id: string): Promise<void>;
  reconcile(schedules: Schedule[]): Promise<void>;
  shutdown(): Promise<void>;
}
```

### 12.2 时间语义

- 持久化时间统一使用 UTC
- Cron 必须显式提供 IANA timezone
- `nextRunAt` 对外返回 UTC
- 夏令时按 timezone 数据库解释
- 同一墙上时间重复时，默认只执行一次
- 不存在的墙上时间默认跳过

### 12.3 Misfire

Daemon 停机导致错过触发：

- `skip`：忽略所有错过触发，计算下一次
- `run_once`：启动后补跑一次，不按错过次数重复

V1 不支持无限补跑。

### 12.4 Overlap

上一次仍在运行时：

- `skip`：本次记为 skipped
- `queue`：排队，默认最多积压 1 次
- `parallel`：并发执行，仍受 Project 并发上限约束

默认：`skip`。

### 12.5 重试

Schedule 负责触发，Workflow/Agent Runtime 负责内部模型重试。Schedule Run 级重试为可选策略：

```ts
interface ScheduleRetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  retryableCodes?: string[];
}
```

不得对审批拒绝、配置错误或明确不可重试错误自动重试。

### 12.6 可观测性

每次触发都必须创建 `ScheduleRun`，包括 skipped。运行历史至少保留：

- 计划触发时间
- 实际开始与结束时间
- 状态和原因
- 关联 Agent Run / Workflow Run
- 错误码

## 13. 安全

### 13.1 网络

- 默认只绑定 loopback
- 首次启动生成本地访问 token
- 所有 `/v1` 接口（health 可例外）要求 Bearer token
- 非 loopback 监听必须显式配置，并输出高风险警告
- 远程部署建议 TLS 或反向代理

### 13.2 文件系统

- 默认只允许访问 Project cwd
- `.env`、密钥文件、SSH 目录等采用额外保护规则
- 写入 Project 外路径必须审批或拒绝
- Daemon 不在日志、事件或 Artifact 中回显密钥

### 13.3 工具审批

默认策略：

- 读取 Project 内普通文件：允许
- 编辑 Project 内文件：按模式允许或询问
- Shell 只读命令：按 allowlist
- 网络访问、包安装、删除、权限提升：询问
- 破坏性命令与敏感路径：拒绝或 critical 审批

Schedule 触发没有在线用户时：

- 不允许等待无限期审批
- 默认拒绝需要交互审批的操作并使 Run 失败
- 可配置预授权策略，但必须限定 Project、工具和命令范围

### 13.4 Package 信任

Pi Packages 和 Extensions 具有本机代码执行权限。必须：

- 固定精确版本
- 记录安装来源与校验信息
- 记录安装 operation、进度事件和失败原因
- 安装前必须有用户或策略产生的 package source 信任记录
- 更新前必须复用同一 package source 信任边界
- 删除必须有 operation 记录，删除成功后应撤销对应 package source 的信任记录
- 未信任 package 必须从 ResourceLoader、Workflow/Subagent adapter 和 Extension binding 链路中过滤
- diagnostics 必须同时暴露 trusted packages 与 blocked packages，不得让 blocked package 只在静默状态中存在
- 资源加载 warning、error 和 name collision 必须能通过 diagnostics 查询
- 项目首次加载前获得信任
- 升级后重新运行安全和集成测试

## 14. 错误模型

核心错误码：

- `unauthorized`
- `forbidden`
- `not_found`
- `validation_failed`
- `project_unavailable`
- `session_busy`
- `run_not_active`
- `approval_required`
- `model_unavailable`
- `provider_auth_missing`
- `package_load_failed`
- `workflow_not_found`
- `workflow_failed`
- `schedule_backend_unavailable`
- `schedule_overlap`
- `rate_limited`
- `internal_error`

错误响应必须使用 `{ error: { message, status, retryable, code?, details? } }`，其中输入校验失败使用 `validation_failed`，非法 JSON 使用 `invalid_json`，未授权使用 `unauthorized`，资源不存在使用 `not_found`。内部堆栈不得通过生产 API 返回。

## 15. 可观测性

### 15.1 日志

结构化日志至少包含：

- requestId
- projectId
- sessionId
- runId
- workflowRunId
- scheduleId
- event
- durationMs
- errorCode

不得记录完整 prompt、模型输出或工具结果，除非用户显式开启调试日志。

### 15.2 指标

V1 指标：

- 活动 Session / Run 数
- prompt 成功率与时延
- 工具失败率
- Workflow 成功率与时长
- Subagent 并发数
- Schedule 触发、成功、失败、skipped 数
- SSE 连接数和重连数
- 模型 token/cost（Provider 可提供时）

## 16. 配置

配置优先级：

```text
运行时参数 > 环境变量 > Project 配置 > Global 配置 > 默认值
```

建议环境变量：

```text
ZUU_HOST=127.0.0.1
ZUU_PORT=8787
ZUU_DATA_DIR=...
ZUU_TOKEN=...
ZUU_LOG_LEVEL=info
ZUU_MAX_PROJECT_RUNS=4
ZUU_MAX_SUBAGENTS=4
```

Provider API Key 继续遵循 Pi `ModelRuntime` 解析顺序。Client 永远不能读取 API Key。

## 17. 包结构

目标 monorepo：

```text
apps/
  web/
  tui/
packages/
  daemon/
    src/
      agent/
      workflow/
      scheduler/
      approvals/
      http/v1/
      store/
  client/
    src/
      projects.ts
      sessions.ts
      workflows.ts
      schedules.ts
      approvals.ts
      events.ts
  protocol/
    src/
      dto.ts
      events.ts
      errors.ts
.pi/
  settings.json
docs/
  feasibility-agent-app.md
  spec.md
```

`@zuu/protocol` 只包含可序列化 DTO、事件和错误码，不依赖 Hono 或 Pi SDK。Daemon 和 Client 共同依赖该包。

## 18. 测试要求

### 18.1 单元测试

- DTO 校验与错误映射
- Client URL、token 和超时
- SSE 解析、去重和重连
- Schedule 时间计算、timezone、misfire、overlap
- Pi 事件到 Zuu 事件映射
- 权限策略

### 18.2 集成测试

- Daemon 启动与 health
- Client 创建 Project 和 Session
- prompt 流式完成
- abort
- Session 持久化并在重启后恢复
- Workflow 启动、Task 状态和 Artifact
- Subagent 并发限制
- Schedule 自动触发 Workflow
- Daemon 重启后的 Schedule 恢复
- Approval allow/deny

### 18.3 契约测试

- Daemon 与 Client 使用同一 protocol fixtures
- 未知字段兼容
- 未知事件兼容
- `/v1` 错误响应稳定

### 18.4 平台测试

- Linux：必须通过
- WSL2：必须通过
- 原生 Windows：记录能力矩阵，不要求所有 Pi Package 通过

## 19. V1 验收标准

满足以下全部条件才可标记 V1：

1. Daemon 可独立启动、健康检查并优雅退出。
2. Client SDK 可创建 Project、Session，并流式执行 prompt。
3. UI 没有直接 HTTP 调用 Daemon。
4. Session 在 Daemon 重启后可恢复。
5. 工具调用、审批和错误通过标准事件送达 Client。
6. 可启动至少一个真实 Workflow，并查看 Stage、Task 和 Artifact。
7. Workflow 至少启动一个真实 Subagent。
8. 可通过 Client 创建 Cron Schedule。
9. UI 关闭时，Daemon 仍能按时触发 Schedule。
10. Schedule Run 可查询状态，并关联 Workflow Run 或 Agent Run。
11. Daemon 重启后 Schedule 可恢复，misfire 行为符合配置。
12. 默认仅监听 loopback，未授权请求被拒绝。
13. Package 加载错误可通过 diagnostics 查询。
14. Linux/WSL2 集成测试通过。

## 20. 实施阶段

### Phase 0：Daemon + Client 基线

- 建立 `protocol`、`daemon`、`client` 包
- Project、Session、Prompt、SSE
- Pi Runtime 生命周期
- SQLite Store
- Client 基础模块

### Phase 1：Workflow + Cron MVP

- `pi-workflow` Adapter
- `pi-crew`/Schedule Adapter
- Workflow Run 和 Artifact API
- Schedule create/list/remove/trigger
- interval 与 cron 自动触发
- 首个 UI 只通过 Client 接入

### Phase 2：完整控制面

- fork、compact、steer、follow-up
- Approval
- Workflow Board
- Schedule pause/resume/history/timezone/misfire/overlap
- 第二个 UI 验证 Client 复用

### Phase 3：SDK 与运维

- 发布 Client SDK
- Daemon 系统服务与开机自启
- 指标、审计、配额和沙箱
- Desktop、IDE 或第三方集成示例

## 21. 待定决策

实施 Phase 0 前必须确定：

1. Daemon 数据目录默认位置。
2. SQLite 驱动及迁移工具。
3. 本地 token 的生成、轮换与存储。
4. Schedule Backend 是直接桥接 `pi-crew`，还是采用独立可靠调度器后调用 Workflow Adapter。
5. V1 首个 UI 选择 WebUI 还是 TUI。
6. Daemon 是否从第一版就作为系统服务安装。

除第 4 项外，上述决策不改变本 Spec 的公共架构。

## 22. SDK 集成约束补充

Zuu 集成 Pi SDK 时必须遵守以下约束：

1. Daemon 必须显式传入 app-owned `agentDir`，并让 `ModelRuntime`、`SettingsManager`、`DefaultResourceLoader` 和 `SessionManager` 使用同一目录策略。不得依赖 SDK 默认的 `~/.pi/agent` 作为应用状态目录。
2. Session 持久化目录必须由 Daemon 管理。若使用 `SessionManager.create(cwd)`，必须显式传入 sessionDir。
3. Daemon 不得把 Pi 原始事件直接暴露给 UI。必须映射为 Zuu 协议事件，并对未知事件保持前向兼容。
4. Assistant message 中的 `stopReason: "error"` 必须映射为标准错误事件。
5. Model diagnostics 必须区分“认证/目录可用”和“真实 provider stream 成功”。
6. Package 加载前必须有信任边界；package 来源、错误和启用状态必须能通过 diagnostics 查询。
7. Resume、fork、import 等替换 session 的能力必须重新建立订阅和 extension binding。
8. Workflow、Subagent、DAG 和 Schedule 是 packages/adapter 能力，不属于 Pi SDK core。Spec 中相关 V1 目标只有在对应 package 或 adapter 验证通过后才可标记完成。
9. 原生 Windows 不作为 workflow/subagent packages 的默认完整支持平台；Windows 用户优先走 WSL2。
