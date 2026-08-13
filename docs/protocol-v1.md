# Zuu `/v1` 协议说明

本文描述当前实现中的 daemon HTTP/SSE 协议。第三方应用优先使用 `@zuu/client`，只有在需要跨语言集成或调试时才直接调用这些路由。

## 基础规则

- Base URL 默认是 `http://127.0.0.1:3001`。
- 除 `GET /v1/health` 外，所有 `/v1/*` 请求都需要 `Authorization: Bearer <token>`。
- 请求和响应默认使用 JSON；流式接口使用 Server-Sent Events。
- 时间字段统一使用 ISO 8601 字符串。
- 错误统一返回：

```json
{
  "error": {
    "message": "reason",
    "status": 400,
    "retryable": false,
    "code": "validation_failed",
    "details": { "field": "trigger.cron" }
  }
}
```

稳定错误码包括 `invalid_json`、`unauthorized`、`not_found`、`validation_failed`、`conflict`、`session_busy`、`session_file_busy`、`run_not_active`、`approval_already_resolved`、`default_project`、`package_untrusted` 和 `internal_error`。

## 认证与审计

`GET /v1/auth/status` 返回 token 来源、是否可轮换、token 预览、本地 token 文件路径，以及每个 token 的 `id`、`actor`、`scope`、`expiresAt`、`expired` 和 `lastUsedAt`。

如果设置了 `ZUU_API_TOKEN`，该 token 是进程外管理的 admin token，daemon 不允许通过 API 轮换、创建或撤销 token。未设置时，daemon 会在 `.zuu/pi-agent/auth-token.json` 生成本地 admin/read token。

`GET /v1/audit-events` 支持 `limit`、`action`、`outcome`、`target`、`authScope`、`authActor`、`authTokenId`、`since` 和 `until` 过滤。审计记录只保存非密钥元数据，不保存原始 token 或 provider key。

## Project 主路径

Project 是当前推荐的业务入口。全局 `/v1/runs`、`/v1/workflow-runs`、`/v1/schedules` 等路由保留给诊断、脚本和跨项目汇总。

常用 Project 级路由：

- `GET /v1/projects`
- `POST /v1/projects`
- `GET /v1/projects/:projectId`
- `PATCH /v1/projects/:projectId`
- `DELETE /v1/projects/:projectId`
- `GET /v1/projects/:projectId/sessions`
- `POST /v1/projects/:projectId/sessions`
- `GET /v1/projects/:projectId/runs`
- `GET /v1/projects/:projectId/workflows`
- `GET /v1/projects/:projectId/workflow-runs`
- `GET /v1/projects/:projectId/schedules`

`default` project 由 daemon 启动时自动提供，指向当前仓库。删除 `default` 会返回 `409 default_project`。

## Session 与 Prompt

会话可以是内存 session，也可以映射到 Pi 持久化 session file。重复打开同一个 session file 会复用已有 active session；如果同一个文件已在另一个 Project 下打开，会返回 `409 session_file_busy`。

常用路由：

- `POST /v1/sessions`
- `POST /v1/sessions/open`
- `GET /v1/sessions/:sessionId`
- `PATCH /v1/sessions/:sessionId`
- `DELETE /v1/sessions/:sessionId`
- `GET /v1/sessions/:sessionId/tree`
- `POST /v1/sessions/:sessionId/new`
- `POST /v1/sessions/:sessionId/switch`
- `POST /v1/sessions/:sessionId/fork`
- `POST /v1/sessions/:sessionId/import`
- `POST /v1/sessions/:sessionId/compact`

流式 prompt：

- `POST /v1/prompt`
- `POST /v1/sessions/:sessionId/prompts`
- `POST /v1/sessions/:sessionId/steer`
- `POST /v1/sessions/:sessionId/follow-ups`

普通 prompt 遇到 running session 会返回 `409 session_busy`。`steer` 和 `follow-ups` 会显式向 Pi SDK 传递对应 `streamingBehavior`。

## Run 与事件回放

每次 prompt、manual compact、workflow launch 或 schedule action 会产生 Agent Run。

- `GET /v1/runs`
- `GET /v1/runs/:runId`
- `POST /v1/runs/:runId/abort`
- `GET /v1/runs/:runId/events`

Run 状态为 `queued`、`running`、`waiting_approval`、`completed`、`failed` 或 `aborted`。`GET /v1/runs/:runId/events?afterEventId=<id>` 可补拉指定事件之后的事件。

## Daemon Event Stream

`GET /v1/events` 是 daemon 级 SSE。支持：

- `runId`
- `sessionId`
- `afterEventId`
- `Last-Event-ID`

连接建立时会先 replay 当前窗口，再接收 live 事件。每个非 heartbeat 事件都包含稳定 `id`、`createdAt`、`runId` 和 `type`。当前事件类型包括 `session`、`text_delta`、`tool_start`、`tool_update`、`tool_end`、`agent_event`、`approval_requested`、`approval_resolved`、`done` 和 `error`。

## Approval

- `GET /v1/approvals`
- `GET /v1/approvals/:approvalId`
- `POST /v1/approvals/:approvalId/resolve`

`status` 可为 `pending`、`allowed`、`denied` 或 `expired`。Resolve decision 可为 `allow_once`、`allow_session` 或 `deny`。已处理 approval 再次 resolve 会返回 `409 approval_already_resolved`。

## Package

- `GET /v1/packages`
- `POST /v1/packages`
- `POST /v1/packages/install`
- `POST /v1/packages/update`
- `DELETE /v1/packages`
- `POST /v1/packages/trust`
- `DELETE /v1/packages/trust`
- `GET /v1/package-operations`
- `GET /v1/package-operations/:operationId`

`POST /v1/packages` 只登记 source。`npm:` source 必须固定到精确版本。安装或更新前必须先信任 source；未信任 source 会返回 `403 package_untrusted`，并且不会进入 Pi `ResourceLoader` 或 `pi-package` workflow backend。

## Workflow

- `GET /v1/workflows`
- `POST /v1/workflows/:workflowId/runs`
- `GET /v1/workflow-runs`
- `GET /v1/workflow-runs/:runId`
- `GET /v1/workflow-runs/:runId/stages`
- `GET /v1/workflow-runs/:runId/tasks`
- `GET /v1/artifacts/:artifactId`
- `POST /v1/workflow-runs/:runId/abort`

当前已支持 `fake` 和 `pi-package` backend，下一阶段默认后端调整为 `native`。`native` 由 Zuu daemon 自己保存 workflow definition、run、stage、task、artifact 和 board 状态，并通过独立 Pi SDK worker session 执行逻辑 subagent。`fake` 仅用于稳定 daemon/client/WebUI 合约；`pi-package` 是可选第三方 adapter，ready 后通过 Pi extension 命令启动真实 workflow，但不作为 Windows 默认路径。

## Schedule

- `GET /v1/schedules`
- `POST /v1/schedules`
- `GET /v1/schedules/:scheduleId`
- `PATCH /v1/schedules/:scheduleId`
- `DELETE /v1/schedules/:scheduleId`
- `POST /v1/schedules/:scheduleId/pause`
- `POST /v1/schedules/:scheduleId/resume`
- `POST /v1/schedules/:scheduleId/trigger`
- `GET /v1/schedules/:scheduleId/runs`
- `GET /v1/schedule-runs/:runId`
- `POST /v1/schedule-runs/:runId/abort`

Trigger 支持：

- `once`：`{ "kind": "once", "runAt": "..." }`
- `interval`：`{ "kind": "interval", "everyMs": 60000 }`，最小 1000ms
- `cron`：`{ "kind": "cron", "cron": "0 9 * * *", "timezone": "Asia/Shanghai" }`

`overlapPolicy` 为 `skip`、`queue` 或 `parallel`，默认 `skip`。`misfirePolicy` 为 `skip` 或 `run_once`，默认 `skip`。`retryPolicy` 支持 `maxAttempts`、`backoffMs` 和可选 `retryableCodes`。

## Diagnostics

`GET /v1/diagnostics` 返回 SDK 版本、模型状态、resource diagnostics、trusted packages、blocked packages、workflow backend 信息和 JSON store 健康状态。它用于区分“配置看起来可用”和“真实 provider/package 能运行”。

`POST /v1/models/smoke` 会创建临时 in-memory session 做极小真实模型调用，并把失败也写入 run/events，方便排查 provider、网络或代理问题。
