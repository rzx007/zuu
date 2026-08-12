# SPIKE: pi-workflow Runtime 验证

## 目标

验证 Zuu 的 `pi-package` workflow adapter 能在真实支持环境中启动 `@agwab/pi-workflow`，并把 Zuu 侧 launch 结果记录为 `WorkflowRun`。

这个 spike 不要求读取真实 `pi-workflow` board/run-state。当前只验证：

- daemon 能识别 `ZUU_WORKFLOW_BACKEND=pi-package`。
- `@agwab/pi-workflow` 已配置并解析到安装路径。
- `/v1/workflows` 能列出 pi-package workflow definitions。
- `/v1/workflows/:workflowId/runs` 能通过 `/workflow run ...` 或 `/workflow dynamic ...` 发起真实 Pi extension 工作。
- Zuu 侧 workflow run 能关联到 launch artifact 和 agent run。

## 支持环境

`@agwab/pi-workflow` 包页面说明原生 Windows 不支持，Windows 用户应使用 WSL2/Linux。

建议验证环境：

- WSL2 Ubuntu 或 Linux。
- Node.js 24。
- pnpm 11。
- 可用模型认证已配置。
- Zuu 代码已同步到 Linux 文件系统内运行，避免跨 Windows/WSL 文件系统权限和 watcher 行为差异。

## 准备

在 WSL2/Linux 中安装依赖：

```sh
pnpm install
```

配置 workflow package：

```sh
pnpm dev
```

打开 WebUI 的 Packages 面板，添加并信任：

```text
npm:@agwab/pi-workflow@<reviewed-version>
```

未信任 package 会显示为 `blocked`，不会进入 Pi `ResourceLoader` 或 `pi-package` workflow backend。信任后再点击 Install；后续升级使用 Update，删除会创建后台 operation 并在成功后撤销信任记录。

如果包没有被 Pi 自动安装，需要在同一环境中先使用 Pi CLI 安装：

```sh
pi install -l npm:@agwab/pi-workflow@<reviewed-version>
```

## 启动 Zuu

用 `pi-package` backend 启动 daemon：

```sh
ZUU_WORKFLOW_BACKEND=pi-package pnpm dev
```

如果设置了 API token：

```sh
ZUU_API_TOKEN=<token> ZUU_WORKFLOW_BACKEND=pi-package pnpm dev
```

## Readiness 检查

另开终端运行：

```sh
pnpm check:pi-workflow
```

如果 daemon 不在默认地址：

```sh
ZUU_PI_WORKFLOW_BASE_URL=http://127.0.0.1:3001 pnpm check:pi-workflow
```

如果设置了 API token：

```sh
ZUU_API_TOKEN=<token> pnpm check:pi-workflow
```

期望输出：

```text
pi-workflow backend is ready.
baseUrl=http://127.0.0.1:3001
workflow=deep-research
Set ZUU_PI_WORKFLOW_RUN=1 to launch a real workflow run.
```

## 真实 Launch 检查

确认 readiness 通过后，再启动真实 workflow：

```sh
ZUU_PI_WORKFLOW_RUN=1 pnpm check:pi-workflow
```

选择其他 workflow：

```sh
ZUU_PI_WORKFLOW_RUN=1 ZUU_PI_WORKFLOW_ID=deep-review pnpm check:pi-workflow
```

自定义验证 prompt：

```sh
ZUU_PI_WORKFLOW_RUN=1 \
ZUU_PI_WORKFLOW_ID=deep-research \
ZUU_PI_WORKFLOW_PROMPT="Review the current Zuu workflow adapter and report whether it launched successfully." \
pnpm check:pi-workflow
```

通过标准：

- 脚本输出 JSON，`ok` 为 `true`。
- `workflowRunId` 存在。
- `status` 为 `completed`。
- `artifacts` 中包含 launch artifact。
- WebUI 的 Workflow Runs 面板能看到对应 run。

## 失败诊断

`Expected ZUU_WORKFLOW_BACKEND=pi-package`：

- daemon 不是用 `ZUU_WORKFLOW_BACKEND=pi-package` 启动的。
- 重新启动 daemon。

`pi-package workflow backend is not ready`：

- `@agwab/pi-workflow` 没有添加到 package source。
- package 没有安装或无法解析到安装路径。
- 当前平台是原生 Windows。
- 查看 `/v1/diagnostics` 的 `resources.workflowBackend.message`。

workflow launch 状态不是 `completed`：

- 模型认证不可用。
- `/workflow` slash command 没有被 package extension 注册。
- package extension 加载失败。
- prompt 被 approval 或工具策略阻断。
- 查看 `/v1/runs` 中对应 agent run 的错误。

## 后续工作

通过本 spike 后，下一步才进入真实 run-state 映射：

- 找到 `pi-workflow` board/run-state 的持久化位置。
- 确认 stage/task/artifact 的字段稳定性。
- 在 `PiPackageWorkflowBackend` 中增加只读 mapper。
- 将 WebUI Workflow Runs 面板从 launch 层记录升级为真实 board 状态。
