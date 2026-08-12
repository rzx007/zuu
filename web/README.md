# Zuu WebUI

`web/` 是 Zuu 的 Vue 3 + TypeScript + Vite 前端应用。浏览器侧只通过 `@zuu/client` 访问 daemon，不直接依赖 Pi SDK，也不直接读写本地 session 文件。

## 开发

```sh
pnpm --filter web dev -- --host 127.0.0.1
```

如果使用根目录 daemon 托管生产构建，先运行：

```sh
pnpm build:web
pnpm start
```

## 当前能力

- 诊断信息、模型选择、资源诊断和 JSON store 状态展示
- package source 登记、trust/revoke、install/update/remove 和 operation 进度
- prompt SSE、运行记录、run event replay 和全局 daemon event stream
- 持久化 session 打开、session tree、entry fork 和 JSONL import
- pending approval 查看与处理
- fake workflow run 启动、运行列表、stage/task/artifact 详情查看
- schedule 创建、编辑、暂停、恢复、手动触发、abort、删除，以及 schedule run 历史/详情查看

全局事件流使用 `@zuu/client.subscribeEvents()`，会保存最后事件 ID，断线后自动重连，并在组件卸载或 token 切换时清理连接。
