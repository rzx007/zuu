# Zuu Agent

一个基于 Pi SDK 的最小完整 Agent 应用，包含 Hono daemon、浏览器 UI、轻量 Client SDK、SSE 流式输出、会话持久化、最近运行记录持久化、运行诊断，以及一个只读的自定义状态工具。

## 运行

```sh
pnpm install
pnpm dev
```

打开 http://localhost:3000。

服务运行时是 Node.js，当前已验证 Node `v24.18.1`。

项目脚本使用 Node 24 原生 `--env-file-if-exists=.env` 读取环境变量文件，不需要额外安装 `dotenv`。如果 `.env` 不存在，启动不会报错。

如果设置了 `ZUU_API_TOKEN`，所有 `/api/*` 请求都需要 `Authorization: Bearer <token>`；浏览器 UI 可以在 Runtime 面板保存 token。

默认只允许操作当前项目根目录内的 `cwd`、session 文件和 import 文件；如需额外目录，可用分号分隔的 `ZUU_ALLOWED_CWD` 放行。

如果 Windows PowerShell 拦截 `pnpm.ps1`，可以使用 `pnpm.cmd dev`。

## 校验

```sh
pnpm check
pnpm typecheck
```

## API

- `GET /api/health`
- `GET /api/diagnostics`
- `GET /api/models`
- `GET /api/packages`
- `POST /api/packages`
- `DELETE /api/packages`
- `GET /api/sessions`
- `GET /api/session-files`
- `GET /api/sessions/:sessionId/tree`
- `GET /api/runs`
- `GET /api/runs/:runId`
- `GET /api/workflows`
- `POST /api/workflows/:workflowId/runs`
- `GET /api/workflow-runs`
- `GET /api/workflow-runs/:runId`
- `POST /api/workflow-runs/:runId/abort`
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

浏览器 UI 通过 `/client.js` 加载 `packages/client` 中 `@zuu/client` 的同一套 client 实现；业务请求不再散落手写 `fetch` 和 SSE 解析逻辑。

默认情况下，Zuu 会把 Pi 应用状态存放在 `.zuu/pi-agent`，这样嵌入式应用不需要写入 `~/.pi/agent`。可以通过 `ZUU_AGENT_DIR` 覆盖。

## 说明

浏览器会话默认启用 `read`、`grep`、`find`、`ls` 和 `zuu_status`。如果需要更强的 coding agent 能力，可以在界面里有意识地启用 `bash`、`edit` 或 `write`。

Workflow、subagent 和 cron 风格调度目前会被诊断接口明确标记为缺口。只有安装并信任类似 `npm:@agwab/pi-workflow` 的 Pi package，以及类似 `pi-crew` 的调度适配方案后，才应承诺这些能力已经可用。

当前 workflow API 先使用内置 `FakeWorkflowBackend`，用于验证 WorkflowDefinition、WorkflowRun、Stage、Task 和 Artifact 的 daemon/client/WebUI 合约。它会立即生成一个完成态 run，不会启动真实 subagent；真实编排仍需要后续接入 `pi-workflow` adapter。

## WebUI

当前 WebUI 已迁移到 `web/` 下的 Vue + Vite 应用，浏览器侧只通过 `@zuu/client` 调用 daemon API。

开发时建议同时运行：

```sh
pnpm dev
pnpm dev:web
```

默认后端监听 `http://localhost:3001`；`web/vite.config.ts` 已将开发态 `/api` 代理到 `http://127.0.0.1:3001`。

生产或单进程预览时先构建 WebUI：

```sh
pnpm build:web
pnpm start
```

构建后 Hono 会托管 `web/dist`，根路径直接返回 Vue 应用；未构建时根路径会提示先运行 `pnpm --filter web build`。
