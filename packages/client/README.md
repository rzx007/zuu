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

## 流式 Prompt

```ts
for await (const event of client.prompt({ prompt: "你好，介绍一下当前项目。" })) {
  if (event.type === "agent_event") {
    console.log(event.event);
  }
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
