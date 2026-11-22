# Unspool Interface Contracts

本目录定义桌面 GUI、Runner、执行 worker 与贡献者节点之间的外部合同。合同不包含业务实现，
字段和状态含义以 [data-model.md](../data-model.md) 为准，端到端验证见 [quickstart.md](../quickstart.md)。

## 合同文件

- [runner-api.openapi.yaml](runner-api.openapi.yaml)：GUI 与节点管理使用的 `/v1` HTTPS API。
- [realtime-events.md](realtime-events.md)：GUI SSE、输出 delta、断线恢复和可见性规则。
- [federation-protocol.md](federation-protocol.md)：配对、mTLS 长轮询、OperationTicket、Grant、
  快照、固定工具、Artifact、Patch、回执和撤销协议。
- [worker-protocol.md](worker-protocol.md)：Runner 控制面、隔离执行 worker 与模型网关的内部边界；
  该协议不暴露给普通工作间成员。

## 通用约定

| 项目 | 约定 |
|---|---|
| API 基线 | `/v1`；实体、命令、事件、导出和节点协议分别带 `schemaVersion` |
| ID | UUIDv7 字符串；SSE 另用 `workspaceId:sequence`；节点回执另用持久 `nodeSequence` |
| 时间 | RFC 3339 UTC；有效区间为 `[notBefore, expiresAt)` |
| 内容格式 | HTTPS 请求/响应为 JSON，文件使用流式字节和显式摘要，错误为 `application/problem+json` |
| 摘要 | JCS 规范化 JSON 后计算 SHA-256，格式为 `sha256:<64 位小写 hex>` |
| 签名 | 所有者、节点和安全指令使用 Ed25519；签名不替代具体 Grant 和权限检查 |
| 写命令 | `Idempotency-Key: <UUID>` 必填；请求另含 `commandId` 与 `payloadDigest` |
| 并发更新 | `If-Match: "<revision>"`；操作命令另带 `operatorEpoch` 或 `attemptEpoch` |
| 分页 | keyset `cursor + limit`，默认 50、最大 200；禁止用大型 offset 扫描长时间线 |
| 兼容 | 同一大版本只做向后兼容新增；未知必填字段、枚举或协议版本必须拒绝，不得猜测执行 |

## 认证与授权

- GUI 使用 Runner 会话认证，长期令牌只保存在桌面 Rust 系统密钥库；WebView 不接收长期令牌。
- Runner 对每个查询、命令、事件重放、下载和导出重新执行对象级权限与可见性过滤。
- 节点连接使用 mTLS；节点证书只证明身份。OperationTicket 只绑定一次操作，Grant 才是资源许可。
- 团队审批、模型外发、成员可见、跨域传播、中央缓存和 Patch 应用分别授权。
- 任意错误响应都必须先脱敏。详细路径、参数、正文和受限失败原因仅返回给有权查看的主体。

## 标准错误

```json
{
  "type": "https://unspool.dev/problems/approval-required",
  "title": "Approval required",
  "status": 409,
  "code": "approval_required",
  "detail": "This action requires an independent approval.",
  "instance": "/v1/approvals/018f...",
  "retryable": false,
  "revision": 42
}
```

`detail` 是安全、可展示的通用说明，不含内部堆栈或秘密。最小错误码如下：

| HTTP | `code` | 使用条件 |
|---:|---|---|
| 400 | `invalid_request` | Schema、时间、摘要或参数不符合合同 |
| 401 | `unauthenticated` | 会话、证书或签名无效 |
| 403 | `permission_denied` | 当前主体无对象或操作权限 |
| 403 | `grant_required` | 缺少匹配的所有者 Grant，或本地策略更严格 |
| 404 | `not_found` | 对象不存在，或无权发现该对象；两者不得通过内容差异泄露 |
| 409 | `revision_conflict` | `If-Match`、上下文版本或基础快照已变化 |
| 409 | `operator_changed` | `operatorEpoch` 已过期 |
| 409 | `task_active` | 工作间已有活动任务 |
| 409 | `approval_required` | 高风险动作尚无有效独立批准 |
| 409 | `approval_invalid` | 批准已拒绝、超时、消费、撤销或因内容变化失效 |
| 409 | `outcome_unknown` | 既有操作结果未知，禁止自动重放 |
| 409 | `workspace_archived` | 工作间只读，不能新增内容 |
| 410 | `grant_inactive` | Grant 已撤销、到期或耗尽；不得通过重试恢复 |
| 422 | `evidence_incomplete` | 缺证、失效或待复核结论尚未处理或记录例外 |
| 423 | `node_unavailable` | 节点离线、暂停、隔离、撤销或不兼容 |
| 429 | `budget_exhausted` | 文件、执行、并发、时间或输出预算耗尽 |
| 500 | `internal_error` | 未预期失败；响应不得包含敏感内部细节 |
| 503 | `runner_unavailable` | Runner 或必要依赖不可用，`retryable` 指明是否可查询重试 |

## 成功与副作用语义

- `2xx` 命令响应只表示对应合同明确的成功：命令已接受、状态已提交或结果已确认。
- 已接受命令只有在权威状态、审计、幂等响应与 Outbox 同事务提交后才返回。
- `202 Accepted` 不表示 Agent 已完成、工具已执行或外部副作用已发生。
- 已派发操作丢失结果时返回或投影 `outcome_unknown`；客户端不得自动重放。
- 相同幂等键只恢复首次结果，不同载荷摘要复用该键返回 `revision_conflict`。
- 拒绝响应必须产生其权限范围内的责任记录；仅显示“拒绝”不足以证明真实出口无副作用。
