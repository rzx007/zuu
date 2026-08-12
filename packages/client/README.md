# @zuu/client

`@zuu/client` 是 Zuu daemon 的类型化 Client SDK。它只封装 HTTP/SSE 协议，不依赖 Pi SDK，因此可以在浏览器、Node.js 脚本、桌面壳或第三方应用中复用。

## 安装

```sh
pnpm add @zuu/client
```

当前仓库内开发时先构建 client：

```sh
pnpm --filter @zuu/client build
```

## 发布流程

发布前先准备版本号和更新日志，再跑发布门禁：

```sh
pnpm client:release:prepare --version 0.1.1
pnpm client:release:check
pnpm --filter @zuu/client pack:dry
```

`client:release:check` 会确认 `dist`、`README.md`、`CHANGELOG.md`、package exports、`files` 清单和当前版本的 changelog 条目都完整。真正发布 npm 前，再人工确认 npm token、registry 和 tag。

## 基础用法

```ts
import { createZuuClient } from "@zuu/client";

const client = createZuuClient({
  baseUrl: "http://127.0.0.1:3001",
  apiToken: process.env.ZUU_API_TOKEN,
});

const health = await client.health();
const auth = await client.authStatus();
const audit = await client.listAuditEvents({
  action: "package.trust",
  outcome: "success",
  authScope: "admin",
  authActor: "local",
  since: "2026-08-12T00:00:00.000Z",
  limit: 20,
});
const diagnostics = await client.diagnostics();
const packages = await client.listPackages();
```

除 `GET /v1/health` 外，daemon API 都需要 Bearer token。未设置 `ZUU_API_TOKEN` 时，daemon 会在 `.zuu/pi-agent/auth-token.json` 生成本地 admin/read 双 token；read token 只能访问受保护 `GET /v1/*`，写操作需要 admin token。本地 token 可以轮换，也可以设置可选 `expiresAt`；过期 token 会拒绝鉴权，但仍会在 `authStatus()` 中标记 `expired` 以便审计。环境变量 token 会作为 admin token 且只能在进程外变更。

```ts
const status = await client.authStatus();
if (status.auth.canRotate) {
  const rotated = await client.rotateAuthToken();
  console.log(rotated.apiToken);
  console.log(rotated.readApiToken);

  const created = await client.createAuthToken({
    scope: "read",
    actor: "readonly-dashboard",
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
  });
  console.log(created.apiToken);
  await client.revokeAuthToken(created.token.id);
}
```

`listModels()` 用于读取当前可选模型；`smokeModel()` 会发起一次极小真实调用，用来区分“模型目录可见”和“provider stream 确实可用”。

```ts
const { models } = await client.listModels();
const smoke = await client.smokeModel({
  model: models[0] ? { provider: models[0].provider, id: models[0].id } : undefined,
  timeoutMs: 60_000,
});

if (!smoke.ok) {
  console.error(smoke.status, smoke.error);
}
```

## Project

Daemon 默认提供 `default` 项目。新建项目后，优先把 `projectId` 传给 session、prompt、workflow 和 schedule，而不是在每次调用里重复传 `cwd`。

```ts
const { projects } = await client.listProjects();
const currentProjectId = projects[0]?.id ?? "default";

const { session } = await client.createProjectSession(currentProjectId, {
  name: "当前项目会话",
});

for await (const event of client.prompt({
  projectId: currentProjectId,
  sessionId: session.id,
  prompt: "总结这个项目的当前状态",
})) {
  console.log(event.type);
}

for await (const event of client.steerSession(session.id, {
  projectId: currentProjectId,
  prompt: "先暂停手头计划，优先检查 package API。",
})) {
  console.log(event.type);
}

for await (const event of client.followUpSession(session.id, {
  projectId: currentProjectId,
  prompt: "当前 run 结束后继续补齐中文文档。",
})) {
  console.log(event.type);
}

await client.compact(session.id, "保留项目结构、当前限制和下一步计划。");

const projectRuns = await client.listProjectRuns(currentProjectId);
const loadedSession = await client.getProjectSession(currentProjectId, session.id);
const updatedSession = await client.updateProjectSession(currentProjectId, session.id, {
  name: "当前项目会话",
  tools: ["read", "grep", "find", "ls", "zuu_status"],
});
if (projectRuns.runs[0]?.status === "running" || projectRuns.runs[0]?.status === "waiting_approval") {
  await client.abortProjectRun(currentProjectId, projectRuns.runs[0].id);
}
const projectSessions = await client.listProjectSessions(currentProjectId);
const storedSessions = await client.listProjectStoredSessions(currentProjectId);
const workflows = await client.listProjectWorkflows(currentProjectId);
const workflowRuns = await client.listProjectWorkflowRuns(currentProjectId);
const workflowDetails = workflowRuns.runs[0]
  ? {
      stages: await client.listProjectWorkflowStages(currentProjectId, workflowRuns.runs[0].id),
      tasks: await client.listProjectWorkflowTasks(currentProjectId, workflowRuns.runs[0].id),
      artifact: workflowRuns.runs[0].artifacts[0]
        ? await client.getProjectWorkflowArtifact(currentProjectId, workflowRuns.runs[0].artifacts[0].id)
        : undefined,
    }
  : undefined;
const schedules = await client.listProjectSchedules(currentProjectId);
const createdSchedule = await client.createProjectSchedule(currentProjectId, {
  trigger: { kind: "interval", everyMs: 30 * 60_000 },
  action: { type: "workflow", workflowId: workflows.workflows[0].id },
  overlapPolicy: "queue",
  misfirePolicy: "skip",
  retryPolicy: { maxAttempts: 2, backoffMs: 1_000 },
});
await client.updateProjectSchedule(currentProjectId, createdSchedule.schedule.id, {
  name: "daily project review",
  misfirePolicy: "run_once",
});
const scheduleRuns = schedules.schedules[0]
  ? await client.listProjectScheduleRuns(currentProjectId, schedules.schedules[0].id)
  : { runs: [] };
if (scheduleRuns.runs[0]?.status === "queued" || scheduleRuns.runs[0]?.status === "running") {
  await client.abortProjectScheduleRun(currentProjectId, scheduleRuns.runs[0].id);
}
```

## 错误处理

非 2xx 响应会抛出 `ZuuClientError`，其中包含稳定的 `status`、`code`、`retryable` 和可选 `details`。

```ts
import { ZuuClientError } from "@zuu/client";

try {
  await client.addPackage({ source: "" });
} catch (error) {
  if (error instanceof ZuuClientError) {
    console.log(error.status, error.code, error.details);
  }
}
```

## 流式 Prompt

```ts
for await (const event of client.prompt({ prompt: "你好，介绍一下当前项目。" })) {
  if (event.type === "agent_event") {
    console.log(event.event);
  }
}
```

## 事件订阅

`subscribeEvents()` 会先按 `afterEventId` replay 已存档事件，再持续接收 daemon live 事件。它默认保存最后事件 ID，断线后用 `Last-Event-ID` 自动重连，并去重重复事件。事件必须包含稳定 `id` 和 `createdAt`。

Agent Run 摘要包含 `source`、`status`、`startedAt` 和 `finishedAt`。`status` 使用 `queued`、`running`、`waiting_approval`、`completed`、`failed`、`aborted`。Workflow Run、Stage 和 Task 使用 `queued/running/completed/failed/aborted`。Schedule Run 使用 `scheduledFor`、`startedAt`、`finishedAt`、`attempts` 和 `queued/running/completed/failed/skipped/aborted`；Package Operation 仍使用自己的领域状态。

```ts
for await (const event of client.subscribeEvents({ runId, afterEventId })) {
  console.log(event.id, event.type, event.createdAt);
}
```

可以用 `onOpen` 和 `onReconnect` 更新 UI 连接状态：

```ts
for await (const event of client.subscribeEvents({
  afterEventId,
  onOpen: () => console.log("live"),
  onReconnect: (attempt) => console.log("reconnecting", attempt),
})) {
  console.log(event.id, event.type);
}
```

需要一次性读取当前窗口时，可以关闭自动重连：

```ts
for await (const event of client.subscribeEvents({ runId, reconnect: false })) {
  console.log(event.id, event.type);
}
```

## Package 管理

Package source 需要先登记和信任，才能安装或更新。未信任 package 会显示为 `blocked`，不会进入 Pi `ResourceLoader`。

```ts
await client.addPackage({ source: "npm:@agwab/pi-workflow" });
await client.trustPackage({ source: "npm:@agwab/pi-workflow" });

const { operation } = await client.installPackage({ source: "npm:@agwab/pi-workflow" });
console.log(operation.id);
```

`installPackage`、`updatePackage` 和 `removePackage` 都会返回后台 operation，可通过 `listPackageOperations()` 或 `getPackageOperation(id)` 查询进度。
