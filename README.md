# Zuu Agent

一个基于 Pi SDK 的最小完整 Agent 应用，包含 Hono daemon、Vue WebUI、轻量 Client SDK、SSE 流式输出、会话持久化、最近运行记录、审批、fake workflow 合约和最小 scheduler。

## 运行

```sh
pnpm install
pnpm dev
```

默认后端监听 `http://localhost:3001`。服务运行时是 Node.js，当前按 Node 24 使用。

项目脚本使用 Node 24 原生 `--env-file-if-exists=.env` 读取环境变量文件，不需要额外安装 `dotenv`。如果 `.env` 不存在，启动不会报错。

如果设置了 `ZUU_API_TOKEN`，所有 `/api/*` 请求都需要 `Authorization: Bearer <token>`；浏览器 UI 可以在 Runtime 面板保存 token。

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

- `GET /api/health`
- `GET /api/diagnostics`
- `GET /api/models`
- `GET /api/packages`
- `POST /api/packages`
- `POST /api/packages/install`
- `POST /api/packages/update`
- `DELETE /api/packages`
- `POST /api/packages/trust`
- `DELETE /api/packages/trust`
- `GET /api/package-operations`
- `GET /api/package-operations/:operationId`
- `GET /api/sessions`
- `GET /api/session-files`
- `GET /api/sessions/:sessionId/tree`
- `GET /api/runs`
- `GET /api/runs/:runId`
- `GET /api/runs/:runId/events`
- `GET /api/workflows`
- `POST /api/workflows/:workflowId/runs`
- `GET /api/workflow-runs`
- `GET /api/workflow-runs/:runId`
- `POST /api/workflow-runs/:runId/abort`
- `GET /api/schedules`
- `POST /api/schedules`
- `GET /api/schedules/:scheduleId`
- `POST /api/schedules/:scheduleId/pause`
- `POST /api/schedules/:scheduleId/resume`
- `POST /api/schedules/:scheduleId/trigger`
- `DELETE /api/schedules/:scheduleId`
- `GET /api/approvals`
- `GET /api/approvals/:approvalId`
- `POST /api/approvals/:approvalId/resolve`
- `POST /api/sessions`
- `POST /api/sessions/open`
- `POST /api/prompt`：以 SSE 方式流式返回事件
- `POST /api/sessions/:sessionId/abort`
- `POST /api/sessions/:sessionId/compact`
- `POST /api/sessions/:sessionId/new`
- `POST /api/sessions/:sessionId/switch`
- `POST /api/sessions/:sessionId/fork`
- `POST /api/sessions/:sessionId/import`

浏览器 UI 通过 `@zuu/client` 调用 daemon API，业务请求不再散落手写 `fetch` 和 SSE 解析逻辑。

默认情况下，Zuu 会把 Pi 应用状态存放在 `.zuu/pi-agent`，嵌入式应用不需要写入 `~/.pi/agent`。可以通过 `ZUU_AGENT_DIR` 覆盖。

当前轻量持久化文件统一使用版本化 JSON store：`runs.json`、`run-events.json`、`approvals.json`、`workflow-runs.json`、`schedules.json`、`package-operations.json` 和 `package-trust.json` 都会先写入临时文件再原子替换。启动时如果读到损坏 JSON，会把原文件备份为 `.corrupt-*.bak`，再恢复为空数据；`GET /api/diagnostics` 的 `resources.stores` 会暴露每个 store 的路径、记录数、恢复状态和错误信息。

Packages 面板会区分 `configured`、`installed`、`filtered`、`trusted` / `untrusted` 和 `enabled` / `blocked`，`GET /api/packages` 返回结构化 package 列表。`POST /api/packages` 只登记 package source；安装或更新前需要先通过 `POST /api/packages/trust` 或 WebUI 的 Trust 按钮信任 source。未信任 package 会保留在配置清单中，但不会进入 Pi `ResourceLoader` 或 workflow backend 的加载链路。

安装、更新和删除都会创建后台 operation 并立即返回 `operation.id`；WebUI 通过 `GET /api/package-operations` 轮询最近任务，展示 SDK progress callback 的事件、完成状态和失败原因。删除成功后会同步撤销对应 source 的信任记录。operation 记录默认持久化在 `.zuu/pi-agent/package-operations.json`，package trust 记录默认持久化在 `.zuu/pi-agent/package-trust.json`。

`GET /api/diagnostics` 会返回 SDK resource diagnostics；其中 `resources.packages` 只列出已信任且会参与加载的 package，`resources.blockedPackages` 列出因未信任而被阻止加载的 package，`resources.stores` 列出 JSON store 健康状态。WebUI 的 Resources 面板会展示 extension/skill/prompt/theme 的加载错误、warning、name collision 和 store recovery 状态。

API 错误统一返回 `error.message`、`error.status`、`error.retryable`、`error.code` 和可选 `error.details`。`@zuu/client` 会把非 2xx 响应映射成 `ZuuClientError`，调用方可以直接读取 `status`、`code`、`retryable` 和 `details`，不需要解析错误文案。

Prompt SSE 事件会带稳定 `id`，并按 run 写入 `.zuu/pi-agent/run-events.json`。断线后可通过 `GET /api/runs/:runId/events?afterEventId=<event-id>` 或 `@zuu/client` 的 `listRunEvents(runId, afterEventId)` 补拉事件窗口；WebUI 的 Recent Runs 支持查看事件数量并 replay 文本片段。

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

当前 workflow API 默认使用内置 `FakeWorkflowBackend`，用于验证 `WorkflowDefinition`、`WorkflowRun`、`Stage`、`Task` 和 `Artifact` 的 daemon/client/WebUI 合约。它会立即生成一个完成态 run，不会启动真实 subagent。

可通过 `ZUU_WORKFLOW_BACKEND=fake` 或 `ZUU_WORKFLOW_BACKEND=pi-package` 选择 workflow 后端。`pi-package` 模式会探测 `@agwab/pi-workflow` 是否已配置、是否解析到安装路径，以及当前平台是否受支持；ready 后会通过 Pi 的 `/workflow run ...` 或 `/workflow dynamic ...` 命令发起真实 extension 工作，并把 Zuu 侧 launch 结果包装成 `WorkflowRun`。它还没有读取 `pi-workflow` board/run-state，因此阶段、任务和 artifact 仍只是 Zuu launch 层的记录。`@agwab/pi-workflow` 包页面说明原生 Windows 不支持，Windows 用户应使用 WSL2/Linux。

Scheduler MVP 已支持 `once` 和 `interval` trigger，支持 prompt action 和 workflow action，记录最近 schedule runs，并可在 WebUI 中创建、暂停、恢复、手动触发和删除。`cron`、timezone、misfire policy、retry policy、abort schedule run 和真实持久队列仍是后续工作。

## WebUI

当前 WebUI 是 `web/` 下的 Vue + Vite 应用，浏览器侧只通过 `@zuu/client` 调用 daemon API。

开发时建议同时运行：

```sh
pnpm dev
pnpm dev:web
```

`web/vite.config.ts` 已将开发态 `/api` 代理到 `http://127.0.0.1:3001`。

生产或单进程预览时先构建 WebUI：

```sh
pnpm build:web
pnpm start
```

构建后 Hono 会托管 `web/dist`，根路径直接返回 Vue 应用；未构建时根路径会提示先运行 `pnpm --filter web build`。
