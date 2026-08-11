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

如果 Windows PowerShell 拦截 `pnpm.ps1`，可以使用 `pnpm.cmd dev`。

## 校验

```sh
pnpm check
pnpm typecheck
```

## API

- `GET /api/health`
- `GET /api/diagnostics`
- `GET /api/packages`
- `POST /api/packages`
- `DELETE /api/packages`
- `GET /api/sessions`
- `GET /api/session-files`
- `GET /api/sessions/:sessionId/tree`
- `GET /api/runs`
- `GET /api/runs/:runId`
- `POST /api/sessions`
- `POST /api/sessions/open`
- `POST /api/prompt`：以 SSE 方式流式返回事件
- `POST /api/sessions/:sessionId/abort`
- `POST /api/sessions/:sessionId/compact`
- `POST /api/sessions/:sessionId/new`
- `POST /api/sessions/:sessionId/switch`
- `POST /api/sessions/:sessionId/fork`
- `POST /api/sessions/:sessionId/import`

浏览器 UI 通过 `/client.js` 加载 `src/client.ts` 转译出的同一套 client 实现；业务请求不再散落手写 `fetch` 和 SSE 解析逻辑。

默认情况下，Zuu 会把 Pi 应用状态存放在 `.zuu/pi-agent`，这样嵌入式应用不需要写入 `~/.pi/agent`。可以通过 `ZUU_AGENT_DIR` 覆盖。

## 说明

浏览器会话默认启用 `read`、`grep`、`find`、`ls` 和 `zuu_status`。如果需要更强的 coding agent 能力，可以在界面里有意识地启用 `bash`、`edit` 或 `write`。

Workflow、subagent 和 cron 风格调度目前会被诊断接口明确标记为缺口。只有安装并信任类似 `npm:@agwab/pi-workflow` 的 Pi package，以及类似 `pi-crew` 的调度适配方案后，才应承诺这些能力已经可用。
