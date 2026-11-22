# B1 固定工具与跨域测试夹具

本目录说明 `packages/test-support/src/federation/tool-fixtures.ts` 中 B1 测试夹具的用途、
不变量和使用边界。夹具只提供确定性的数据，不包含测试实现、应用源码、服务启动逻辑或真实
秘密，也不替代 B0 的独立验收。

对应规格：`spec.md` US6、`quickstart.md` QS-09、`uat-catalog.md` UAT-43～48、UAT-52、
TO-12、T11～16。

## 导入

夹具模块没有外部依赖。测试文件可直接引用源文件；以位于 `tests/integration/us6/` 的测试
为例：

```ts
import {
  B1_FIXED_TOOL_ALLOWED_INVOCATIONS,
  B1_FIXED_TOOL_REJECTED_INVOCATIONS,
  B1_FIXED_TOOL_TEMPLATE,
} from "../../../packages/test-support/src/federation/tool-fixtures.js";
```

不要把本模块的夹具当作生产配置、权限依据或真实摘要证明。

## 固定工具模板与参数

| 导出 | 内容 |
|---|---|
| `B1_FIXED_TOOL_TEMPLATE` | 无 Shell 的测试工具模板；参数只允许 `suite` 枚举 `unit` / `integration`；`networkPolicy: "disabled"`、`envAllowlist: []`。 |
| `B1_FIXED_TOOL_ALLOWED_INVOCATIONS` | `unit` 与 `integration` 两个合法请求，绑定模板 ID 与模板摘要。 |
| `B1_FIXED_TOOL_REJECTED_INVOCATIONS` | 越界请求：Shell 字符串、额外参数、命令串联、命令替换、模板摘要变化、替换可执行文件、额外 argv、注入环境变量、绝对工作目录、网络请求。 |
| `B1_FIXED_TOOL_BUDGET` | 模板的固定资源预算。 |

越界请求按 `expectedErrorCode` 分别预期为 `invalid_arguments`、`invalid_request`、
`template_digest_mismatch` 或 `network_denied`。所有拒绝都应发生在执行入口之前，不能先
启动进程再校验。

## 无 Shell 环境快照

| 导出 | 内容 |
|---|---|
| `B1_SHELL_FREE_ENVIRONMENT_SNAPSHOT` | 首次运行的预期沙箱：无 Shell、空环境、空白名单、无网络、无宿主 PID/IPC、无 Docker socket、无凭据、进程组可终止、退出后无残留。 |
| `B1_SECOND_RUN_ENVIRONMENT_SNAPSHOT` | 第二次运行；只改变可写临时根，用来说明两次运行不共享残留状态。 |

快照中的只读输入挂载对应 `B1_BASE_SNAPSHOT`，可写挂载只指向独立输出目录。测试不得把
`forbiddenHostEnvironmentKeys` 中的宿主变量带进沙箱。

## 可计数副作用端点

| 导出 | 内容 |
|---|---|
| `B1_COUNTABLE_SIDE_EFFECT_ENDPOINT` | 测试夹具自己拥有的 loopback 计数端点配置：初始为 0，副作用前强杀为 0，副作用后、回执前强杀为 1，重连重放后仍为 1。 |

该端点不是 B1 固定工具的网络许可，模板 `networkPolicy` 始终为 `disabled`，且
`reachableByB1FixedTools` 为 `false`。测试宿主负责启动、重置和关闭端点；任何重试、重连或
重放都不得让计数变成 2。

## 基础快照与冲突 Patch

| 导出 | 内容 |
|---|---|
| `B1_BASE_SNAPSHOT` | 只读基础快照，包含 `src/example.ts` 的 opaque 条目、大小和内容摘要。 |
| `B1_BASE_FILE_CONTENT` / `B1_PATCHED_FILE_CONTENT` / `B1_CONCURRENT_FILE_CONTENT` | 与摘要匹配的固定字节内容。三个文件摘要都是真实 SHA-256。 |
| `B1_PATCH_PROPOSAL` | 绑定基础快照、基础 Manifest 摘要、逐文件前置摘要和独立标签的修改建议；本身不产生写权限。 |
| `B1_PATCH_APPLICATION` | 独立本应用意图，带独立 Grant、前置摘要和 journal 引用，初始没有逐文件结果。 |
| `B1_PATCH_CONFLICT` | 当前文件摘要与 Patch 前置摘要不一致；预期 `conflict`、不自动合并、零写入、零新 Artifact 版本。 |

合法应用必须重新校验当前文件仍为普通文件、路径范围未变且摘要匹配；冲突时不得覆盖或三方
合并。`B1_PATCH_PROPOSAL` 的生成、读取和传播各自仍需权限。

## 跨域 Artifact 来源与接收方

| 导出 | 内容 |
|---|---|
| `B1_CROSS_DOMAIN_SOURCE_LABEL` | 来源标签：只允许节点域传播，不允许成员、模型、公共或中央缓存；内容标记为不可信。 |
| `B1_CROSS_DOMAIN_DERIVED_LABEL` | 单来源派生标签，将目标域进一步收窄到实际接收节点；其余限制保持不变。 |
| `B1_NODE_ARTIFACT` | 来源节点、所有者、Grant 摘要和内容摘要。 |
| `B1_CROSS_DOMAIN_ARTIFACT` | `node_artifact` 版本的 ArtifactVersion，引用来源标签和来源 Artifact。 |
| `B1_CROSS_DOMAIN_RECIPIENT` | 接收节点、接收方所有者、目标域规则，以及源/接收方双重批准要求。 |
| `B1_CROSS_DOMAIN_APPROVALS` 相关常量 | 源所有者和接收方所有者的批准记录。 |
| `B1_CROSS_DOMAIN_TRANSFER` | 双批准后的正控制，预期只向目标节点发送声明的 Artifact 版本。 |
| `B1_CROSS_DOMAIN_TRANSFER_MISSING_APPROVAL` | 缺少接收方所有者批准，预期拒绝且有效载荷为 0。 |

派生标签按维取最严格交集；摘要、翻译、脱敏和 Patch 不会自动降级。没有对应独立权利和批准
时，不得向模型、成员、公共视图或第三节点传输。

## 预算耗尽与结果未知

| 导出 | 内容 |
|---|---|
| `B1_BUDGET_EXHAUSTION_SCENARIO` | 输出预算 1024 字节，尝试 1025 字节；预检拒绝，HTTP 429、错误码 `budget_exhausted`，不自动提额、不派发、无副作用。 |
| `B1_UNKNOWN_OUTCOME_SCENARIOS.beforeSideEffect` | 已派发、副作用前强杀；结果未知，重放只查询状态，副作用计数保持 0。 |
| `B1_UNKNOWN_OUTCOME_SCENARIOS.afterSideEffectBeforeReceipt` | 副作用后、回执前强杀；结果未知，重放只查询状态，副作用计数保持 1。 |

两个未知结果场景都保留原 `requestId` 和 nonce，但 `reexecute` 为 `false`。测试不得把
`outcome_unknown` 描述成成功、失败或可自动重试。

## 不变量

1. 所有 ID、时间和摘要固定可复现；除三个文件内容摘要外，摘要值是格式合法的 opaque 占位，
   不得用于证明真实对象或签名。
2. 模板、环境、端点和场景都不包含真实凭据、私钥、Cookie 或生产地址。
3. 固定工具只接受模板声明参数；Shell、额外 argv、环境、宿主路径和网络字段全部拒绝。
4. Patch 默认不写回；冲突不自动合并；合法应用需要独立授权和当前前置摘要。
5. 跨域 Artifact 必须同时满足来源标签、接收方规则和双方/额外批准；未批准时有效载荷为 0。
6. 预算取团队与节点中更严格者，耗尽不自动提额；未知结果不自动重放，副作用计数绝不为 2。
7. 夹具不得削弱 B0 的只读边界，也不得让 Stable 依赖 Beta 组件。

## 维护

- 新增场景时只追加具名导出，保持现有键和预期错误码稳定；不要为通过测试删掉拒绝分支。
- 修改模板、快照、Patch 或标签字段前，先核对 `data-model.md` 与联邦协议合同；字段语义变化
  应视为新的夹具版本并触发重新授权场景。
- 本文件不启动端点、不写测试、不修改 `tasks.md`，也不生成验证证据。
