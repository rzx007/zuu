# Zuu Agent

一个基于 Pi SDK 的最小完整 Agent 应用，包含 Hono daemon、Vue WebUI、轻量 Client SDK、SSE 流式输出、会话持久化、最近运行记录、审批、fake workflow 合约和最小 scheduler。

## 运行

```sh
pnpm install
pnpm dev
```

默认后端监听 `http://localhost:3001`。服务运行时是 Node.js，当前按 Node 24 使用。

项目脚本使用 Node 24 原生 `--env-file-if-exists=.env` 读取环境变量文件，不需要额外安装 `dotenv`。如果 `.env` 不存在，启动不会报错。

除 `GET /v1/health` 外，所有 `/v1/*` 请求都需要 `Authorization: Bearer <token>`。如果设置了 `ZUU_API_TOKEN`，daemon 会使用该环境变量且不允许在线轮换；否则首次启动会在 `.zuu/pi-agent/auth-token.json` 生成本地 token，并在控制台打印 token 预览和文件路径。浏览器 UI 可以在 Runtime 面板保存 token；本地 token 可通过 Runtime 面板或 `POST /v1/auth/rotate` 轮换。

默认只允许操作当前项目根目录内的 `cwd`、session 文件和 import 文件；如需额外目录，可用分号分隔的 `ZUU_ALLOWED_CWD` 放行。

如果 Windows PowerShell 拦截 `pnpm.ps1`，可以使用 `pnpm.cmd dev`。

## 校验

```sh
pnpm build:client
pnpm check
pnpm typecheck
pnpm build:web
```

真实 `@agwab/pi-workflow` 环境验证不在普通检查里运行。请在 WSL2/Linux 中按 [pi-workflow runtime spike](docs/spikes/pi-workflow-runtime.md) 操作：

```sh
pnpm check:pi-workflow
ZUU_PI_WORKFLOW_RUN=1 pnpm check:pi-workflow
```

## API

- `GET /v1/health`
- `GET /v1/auth/status`
- `POST /v1/auth/rotate`
- `GET /v1/audit-events`
- `GET /v1/diagnostics`
- `GET /v1/events`：以 SSE 方式订阅 daemon 级事件，支持 `runId`、`sessionId`、`afterEventId` 和 `Last-Event-ID`
- `GET /v1/models`
- `POST /v1/models/smoke`：用极小 prompt 验证真实 provider stream，返回 `ok/status/runId/error/durationMs`
- `GET /v1/projects`
- `POST /v1/projects`
- `GET /v1/projects/:projectId`
- `PATCH /v1/projects/:projectId`
- `DELETE /v1/projects/:projectId`
- `GET /v1/projects/:projectId/sessions`
- `POST /v1/projects/:projectId/sessions`
- `GET /v1/projects/:projectId/sessions/:sessionId`
- `PATCH /v1/projects/:projectId/sessions/:sessionId`
- `DELETE /v1/projects/:projectId/sessions/:sessionId`
- `GET /v1/projects/:projectId/session-files`
- `POST /v1/projects/:projectId/sessions/open`
- `GET /v1/projects/:projectId/runs`
- `GET /v1/projects/:projectId/runs/:runId`
- `POST /v1/projects/:projectId/runs/:runId/abort`
- `GET /v1/projects/:projectId/runs/:runId/events`
- `GET /v1/projects/:projectId/workflows`
- `POST /v1/projects/:projectId/workflows/:workflowId/runs`
- `GET /v1/projects/:projectId/workflow-runs`
- `GET /v1/projects/:projectId/workflow-runs/:runId`
- `GET /v1/projects/:projectId/workflow-runs/:runId/stages`
- `GET /v1/projects/:projectId/workflow-runs/:runId/tasks`
- `GET /v1/projects/:projectId/artifacts/:artifactId`
- `POST /v1/projects/:projectId/workflow-runs/:runId/abort`
- `GET /v1/projects/:projectId/schedules`
- `POST /v1/projects/:projectId/schedules`
- `GET /v1/projects/:projectId/schedules/:scheduleId`
- `PATCH /v1/projects/:projectId/schedules/:scheduleId`
- `GET /v1/projects/:projectId/schedules/:scheduleId/runs`
- `GET /v1/projects/:projectId/schedule-runs/:runId`
- `POST /v1/projects/:projectId/schedule-runs/:runId/abort`
- `POST /v1/projects/:projectId/schedules/:scheduleId/pause`
- `POST /v1/projects/:projectId/schedules/:scheduleId/resume`
- `POST /v1/projects/:projectId/schedules/:scheduleId/trigger`
- `DELETE /v1/projects/:projectId/schedules/:scheduleId`
- `GET /v1/packages`
- `POST /v1/packages`
- `POST /v1/packages/install`
- `POST /v1/packages/update`
- `DELETE /v1/packages`
- `POST /v1/packages/trust`
- `DELETE /v1/packages/trust`
- `GET /v1/package-operations`
- `GET /v1/package-operations/:operationId`
- `GET /v1/sessions`
- `GET /v1/session-files`
- `GET /v1/sessions/:sessionId`
- `PATCH /v1/sessions/:sessionId`
- `DELETE /v1/sessions/:sessionId`
- `GET /v1/sessions/:sessionId/tree`
- `GET /v1/runs`
- `GET /v1/runs/:runId`
- `POST /v1/runs/:runId/abort`
- `GET /v1/runs/:runId/events`
- `GET /v1/workflows`
- `POST /v1/workflows/:workflowId/runs`
- `GET /v1/workflow-runs`
- `GET /v1/workflow-runs/:runId`
- `GET /v1/workflow-runs/:runId/stages`
- `GET /v1/workflow-runs/:runId/tasks`
- `GET /v1/artifacts/:artifactId`
- `POST /v1/workflow-runs/:runId/abort`
- `GET /v1/schedules`
- `POST /v1/schedules`
- `GET /v1/schedules/:scheduleId`
- `PATCH /v1/schedules/:scheduleId`
- `GET /v1/schedules/:scheduleId/runs`
- `GET /v1/schedule-runs/:runId`
- `POST /v1/schedule-runs/:runId/abort`
- `POST /v1/schedules/:scheduleId/pause`
- `POST /v1/schedules/:scheduleId/resume`
- `POST /v1/schedules/:scheduleId/trigger`
- `DELETE /v1/schedules/:scheduleId`
- `GET /v1/approvals`
- `GET /v1/approvals/:approvalId`
- `POST /v1/approvals/:approvalId/resolve`
- `POST /v1/sessions`
- `POST /v1/sessions/open`
- `POST /v1/prompt`：以 SSE 方式流式返回事件
- `POST /v1/sessions/:sessionId/prompts`：向已有 Session 发送普通 prompt，正在运行时未指定 `streamingBehavior` 会返回 `409 session_busy`
- `POST /v1/sessions/:sessionId/steer`：向正在运行的 Session 发送 steer 消息
- `POST /v1/sessions/:sessionId/follow-ups`：向 Session 队列追加 follow-up 消息
- `POST /v1/sessions/:sessionId/abort`
- `POST /v1/sessions/:sessionId/compact`
- `POST /v1/sessions/:sessionId/new`
- `POST /v1/sessions/:sessionId/switch`
- `POST /v1/sessions/:sessionId/fork`
- `POST /v1/sessions/:sessionId/import`

浏览器 UI 通过 `@zuu/client` 调用 daemon API，业务请求不再散落手写 `fetch` 和 SSE 解析逻辑。
Project 已作为一等资源持久化在 `.zuu/pi-agent/projects.json`。Daemon 启动后会提供一个稳定的 `default` 项目指向当前仓库；新建 session、prompt、workflow 和 schedule action 都可以传 `projectId`。Session 主入口是 `GET/POST /v1/projects/:projectId/sessions` 和 `GET /v1/projects/:projectId/session-files`；`GET /v1/runs`、`GET /v1/session-files`、`GET /v1/workflow-runs` 与 `GET /v1/schedules` 也支持按项目过滤。直接传 `cwd` 创建 session 时会复用同 cwd 的已有 Project，缺失时才创建新记录；workflow 和 schedule 未传 `projectId` 时会归属到 `default`。后续建议使用 `projectId`。

默认情况下，Zuu 会把 Pi 应用状态存放在 `.zuu/pi-agent`，嵌入式应用不需要写入 `~/.pi/agent`。可以通过 `ZUU_AGENT_DIR` 覆盖。

当前轻量持久化文件统一使用版本化 JSON store：`projects.json`、`runs.json`、`run-events.json`、`approvals.json`、`workflow-runs.json`、`schedules.json`、`package-operations.json` 和 `package-trust.json` 都会先写入临时文件再原子替换。启动时如果读到损坏 JSON，会把原文件备份为 `.corrupt-*.bak`，再恢复为空数据；`GET /v1/diagnostics` 的 `resources.stores` 会暴露每个 store 的路径、记录数、恢复状态和错误信息。Agent Run 摘要使用 `source`、`status`、`startedAt` 和 `finishedAt`，其中 `status` 为 `queued`、`running`、`waiting_approval`、`completed`、`failed` 或 `aborted`。

Packages 面板会区分 `configured`、`installed`、`filtered`、`trusted` / `untrusted` 和 `enabled` / `blocked`，`GET /v1/packages` 返回结构化 package 列表。`POST /v1/packages` 只登记 package source；安装或更新前需要先通过 `POST /v1/packages/trust` 或 WebUI 的 Trust 按钮信任 source。未信任 package 会保留在配置清单中，但不会进入 Pi `ResourceLoader` 或 workflow backend 的加载链路。

安装、更新和删除都会创建后台 operation 并立即返回 `operation.id`；WebUI 通过 `GET /v1/package-operations` 轮询最近任务，展示 SDK progress callback 的事件、完成状态和失败原因。删除成功后会同步撤销对应 source 的信任记录。operation 记录默认持久化在 `.zuu/pi-agent/package-operations.json`，package trust 记录默认持久化在 `.zuu/pi-agent/package-trust.json`。

`GET /v1/auth/status` 会返回 token 来源、是否可轮换、token 预览和本地 token 文件路径；`POST /v1/auth/rotate` 只对本地 token 生效，并在响应中返回新的 `apiToken`，调用方应立即替换后续请求的 Bearer token。

`GET /v1/audit-events` 会返回最近审计事件，并支持 `limit`、`action`、`outcome` 和 `target` 过滤。当前覆盖 auth rotate、approval resolve 和 package add/trust/install/update/remove 等治理动作，只记录 token 预览、source、decision、错误摘要等非密钥信息。

`GET /v1/diagnostics` 会返回 SDK resource diagnostics；其中 `resources.packages` 只列出已信任且会参与加载的 package，`resources.blockedPackages` 列出因未信任而被阻止加载的 package，`resources.stores` 列出 JSON store 健康状态，包括本地 auth token store 和 audit event store。WebUI 的 Resources 面板会展示 extension/skill/prompt/theme 的加载错误、warning、name collision 和 store recovery 状态。

`GET /v1/models` 只说明当前认证和模型目录看起来可用；需要确认 DeepSeek 等 provider 是否真的能流式返回时，使用 `POST /v1/models/smoke` 或 WebUI 模型区的 Smoke test。该接口会创建一个临时 in-memory session，发送极小 prompt，并返回 `ok/status/runId/error/durationMs`；失败也会写入 run/events，方便继续排查网络、代理或 provider 错误。

API 错误统一返回 `error.message`、`error.status`、`error.retryable`、`error.code` 和可选 `error.details`。`@zuu/client` 会把非 2xx 响应映射成 `ZuuClientError`，调用方可以直接读取 `status`、`code`、`retryable` 和 `details`，不需要解析错误文案。

Prompt SSE 事件会带稳定 `id` 和 `createdAt`，并按 run 写入 `.zuu/pi-agent/run-events.json`。断线后可通过 `GET /v1/runs/:runId/events?afterEventId=<event-id>` 或 `@zuu/client` 的 `listRunEvents(runId, afterEventId)` 补拉事件窗口；也可以通过 `GET /v1/events` 或 `@zuu/client.subscribeEvents()` 先 replay 历史事件再订阅 live 事件。`subscribeEvents()` 默认会保存最后事件 ID、用指数退避自动重连，并去重重复事件。已有 Session 可通过 `client.promptSession()` 发送普通 prompt，也可在 Session 运行中通过 `client.steerSession()` 或 `client.followUpSession()` 显式传递 Pi SDK 的 `streamingBehavior`。WebUI 会用全局 Event Stream 面板展示 daemon live 事件，并用该事件流节流刷新 runs、approvals、session tree、schedule 和 workflow run 状态。

Project 推荐使用成组路径作为主入口：Session 用 `client.createProjectSession()` 和 `client.listProjectSessions()`；Runs、Workflow Runs 与 Schedules 分别用 `client.listProjectRuns()`、`client.listProjectWorkflowRuns()`、`client.listProjectSchedules()`。全局 `/v1/runs`、`/v1/workflow-runs`、`/v1/schedules` 仍保留给诊断、迁移脚本和需要跨项目汇总的调用方。

## Client SDK

`packages/client` 是可独立构建的 `@zuu/client` 包，入口是 `dist/index.js`，类型声明是 `dist/index.d.ts`。根目录的 `dev`、`check`、`typecheck`、`build:web` 和 `start` 脚本会先运行 `pnpm build:client`，确保 daemon、WebUI 和第三方脚本消费的是同一个包入口。

第三方调用示例：

```sh
pnpm example:client
ZUU_EXAMPLE_PROMPT="介绍一下当前项目" pnpm example:client
```

更多用法见 [packages/client/README.md](packages/client/README.md)。

## 当前能力边界

浏览器会话默认启用 `read`、`grep`、`find`、`ls` 和 `zuu_status`。如果需要更强的 coding agent 能力，可以在界面里有意识地启用 `bash`、`edit` 或 `write`。

当前 workflow API 默认使用内置 `FakeWorkflowBackend`，用于验证 `WorkflowDefinition`、`WorkflowRun`、`Stage`、`Task` 和 `Artifact` 的 daemon/client/WebUI 合约。Workflow Run、Stage 和 Task 使用 `queued/running/completed/failed/aborted` 状态以及 `finishedAt` 完成时间。Fake 后端会立即生成一个完成态 run，不会启动真实 subagent。

可通过 `ZUU_WORKFLOW_BACKEND=fake` 或 `ZUU_WORKFLOW_BACKEND=pi-package` 选择 workflow 后端。`pi-package` 模式会探测 `@agwab/pi-workflow` 是否已配置、是否解析到安装路径，以及当前平台是否受支持；ready 后会通过 Pi 的 `/workflow run ...` 或 `/workflow dynamic ...` 命令发起真实 extension 工作，并把 Zuu 侧 launch 结果包装成 `WorkflowRun`。它还没有读取 `pi-workflow` board/run-state，因此阶段、任务和 artifact 仍只是 Zuu launch 层的记录。`@agwab/pi-workflow` 包页面说明原生 Windows 不支持，Windows 用户应使用 WSL2/Linux。

Scheduler MVP 已支持 `once`、`interval` 和基础 5 字段 `cron` trigger；cron 可指定 IANA timezone，未指定时默认 `UTC`，`nextRunAt` 仍以 UTC ISO 返回。它支持 prompt action 和 workflow action，记录最近 schedule runs，并可在 WebUI 中创建、编辑、暂停、恢复、手动触发、abort 和删除。Schedule 默认 `overlapPolicy` 为 `skip`；同一 schedule 仍在运行时，`skip` 会记录 `skipped` 和 `reason: "schedule_overlap"`，`queue` 会最多积压一个 queued run，`parallel` 会并发启动新 run。Schedule 默认 `misfirePolicy` 为 `skip`；daemon 重启时遇到错过触发会记录 `reason: "schedule_misfire"`，也可显式设为 `run_once` 在启动后补跑一次。可选 `retryPolicy` 支持 `maxAttempts`、`backoffMs` 和 `retryableCodes`，Schedule Run 会记录最终 `attempts`。Schedule Run 摘要使用 `scheduledFor`、`startedAt`、`finishedAt` 和 `completed/failed/aborted/skipped` 等状态。真实跨进程持久调度后端仍是后续工作。

## WebUI

当前 WebUI 是 `web/` 下的 Vue + Vite 应用，浏览器侧只通过 `@zuu/client` 调用 daemon API。它会在挂载时通过 `subscribeEvents()` 订阅 daemon 级事件流，保存最后事件 ID，卸载或 token 切换时清理连接。

开发时建议同时运行：

```sh
pnpm dev
pnpm dev:web
```

`web/vite.config.ts` 已将开发态 `/v1` 代理到 `http://127.0.0.1:3001`。

生产或单进程预览时先构建 WebUI：

```sh
pnpm build:web
pnpm start
```

构建后 Hono 会托管 `web/dist`，根路径直接返回 Vue 应用；未构建时根路径会提示先运行 `pnpm --filter web build`。
