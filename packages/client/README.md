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

## 基础用法

```ts
import { createZuuClient } from "@zuu/client";

const client = createZuuClient({
  baseUrl: "http://127.0.0.1:3001",
  apiToken: process.env.ZUU_API_TOKEN,
});

const health = await client.health();
const diagnostics = await client.diagnostics();
const packages = await client.listPackages();
```

## Project

Daemon 默认提供 `default` 项目。新建项目后，优先把 `projectId` 传给 session、prompt、workflow 和 schedule，而不是在每次调用里重复传 `cwd`。

```ts
const { projects } = await client.listProjects();
const currentProjectId = projects[0]?.id ?? "default";

const { session } = await client.createSession({
  projectId: currentProjectId,
  name: "当前项目会话",
});

for await (const event of client.prompt({
  projectId: currentProjectId,
  sessionId: session.id,
  prompt: "总结这个项目的当前状态",
})) {
  console.log(event.type);
}

const projectRuns = await client.listRuns(undefined, currentProjectId);
const workflowRuns = await client.listWorkflowRuns(currentProjectId);
const schedules = await client.listSchedules(currentProjectId);
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
