# Realtime Event Contracts

GUI 使用两类 SSE 流。它们都不直接暴露 pi 事件，也不承担跨系统恰好一次投递保证。

| 流 | 端点 | 权威性与用途 |
|---|---|---|
| 领域事件流 | `GET /v1/workspaces/{workspaceId}/events` | 已提交、可重放的时间线、状态、审批、交接、证据和回执 |
| 输出增量流 | `GET /v1/workspaces/{workspaceId}/runs/{runId}/output` | 低延迟展示 Agent 输出；非权威，最终由领域事件替代 |

## 1. DomainEvent 信封

```json
{
  "schemaVersion": 1,
  "eventId": "018f2d8f-0b3d-7b3e-a2a4-7cd64ad89a01",
  "workspaceId": "018f2d8f-0b1c-7f20-a6f3-eeaa70c32801",
  "sequence": 421,
  "type": "run.approval_decided",
  "occurredAt": "2026-11-21T10:15:30.000Z",
  "actor": {
    "actorId": "018f2d8f-0a9e-7d01-b5c3-98a3670f2101",
    "displayNameAtTime": "Reviewer",
    "rolesAtTime": ["contributor", "approver"]
  },
  "runId": "018f2d8f-0c11-7e30-a5d2-07ca1299f201",
  "visibility": {
    "kind": "workspace_members",
    "securityLabelId": "018f2d8f-0d31-7e60-8f21-229e6adf1101"
  },
  "payloadDigest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "payload": {}
}
```

- `(workspaceId, sequence)` 唯一且严格递增；事件与业务状态、审计和 Outbox 同事务提交。
- SSE `id` 为 `<workspaceId>:<sequence>`，`event` 为 `type`，`data` 为完整 JSON 信封。
- 客户端以 `Last-Event-ID` 或 `after=<sequence>` 重连；服务端重放后接实时事件。
- 事件载荷是已经按当前订阅者过滤的版本，不是原始 pi JSONL。不同成员可收到不同
  `payload` 或完全收不到该事件；隐藏事件不能泄露内容、路径或参数。
- 若隐藏事件会造成序号空隙，客户端必须允许空隙并用概览快照对齐，不得把空隙解释为
  数据损坏。需要告知“存在受限步骤”时，使用不含敏感信息的 `restricted.step_observed`。

## 2. 事件类型

| 前缀 | 代表事件 | 必须保留的责任与状态 |
|---|---|---|
| `workspace.*` | `created`, `updated`, `shared`, `archived` | revision、actor、配置和共享来源 |
| `context.*` | `version_added`, `agent_exposure_changed`, `removed` | 原版本、新版本、作者、操作者确认 |
| `input.*` | `discussion_added`, `suggestion_added`, `suggestion_decided`, `instruction_accepted` | 输入类型、建议人、采纳人、幂等命令 ID |
| `run.*` | `accepted`, `started`, `steered`, `follow_up_queued`, `queue_held`, `stopping`, `settled`, `result_assessed`, `needs_confirmation` | Run、attempt、operatorEpoch、技术状态与人工结果 |
| `tool.*` | `preflight`, `execution_entered`, `progress`, `finalized`, `receipt_gap` | toolCallId、parentToolCallId、有效参数摘要、时间与结果摘要 |
| `approval.*` | `requested`, `approved`, `rejected`, `expired`, `invalidated`, `permit_consumed` | actionDigest、请求人、审批人、期限、理由与策略版本 |
| `handoff.*` | `invited`, `accepted`, `rejected`, `takeover`, `background_changed` | 原/新操作者、理由、baseRevision、operatorEpoch |
| `evidence.*` | `proposed`, `confirmed`, `review_required`, `invalidated`, `reviewed`, `exception_recorded` | 结论、来源版本、影响、复核人和例外 |
| `artifact.*` | `added`, `version_added`, `missing`, `export_started`, `export_completed` | 来源、版本、摘要、可见性和缺失状态 |
| `federation.*` | `node_state_changed`, `grant_decided`, `grant_revoked`, `operation_state_changed`, `artifact_propagated`, `patch_state_changed` | 节点、Grant/策略版本、操作、接收方和本地决定 |
| `receipt.*` | `received`, `gap_detected`, `gap_resolved` | 节点序号、缺口范围、补交状态，不包含越权参数 |

`tool.preflight` 对应预检，不代表批准或副作用开始。只有受控包装器的
`tool.execution_entered` 才表示真实执行入口已进入；已 entered 而无 finalized 时，恢复必须进入
`needs_confirmation`。`run.settled` 只表示技术执行不再自动继续，不产生业务 `complete`。

## 3. TransientOutput 信封

```json
{
  "schemaVersion": 1,
  "runId": "018f2d8f-0c11-7e30-a5d2-07ca1299f201",
  "offset": 8192,
  "kind": "assistant_text_delta",
  "delta": "partial output",
  "observedAt": "2026-11-21T10:15:29.900Z"
}
```

- SSE `id` 为 `<runId>:<offset>`；`offset` 单调递增，但不要求跨重连保留全部 delta。
- Runner 以 50–100ms 或帧大小上限合并输出，避免逐 token 写库和广播。
- 客户端按 offset 去重；断线后先获取当前 Run 快照，再从可用 offset 继续。
- 对应的最终 `DomainEvent` 包含完整权威消息及摘要。客户端必须用最终消息替换所有临时
  delta，不得把临时文本当成已持久化证据。
- pi 的 `message_end` 通知不等于 JSONL append 已落盘；只有 SessionCheckpoint 与自有写通道
  完成对账后，最终事件才可标为 `transcript_persisted`。

## 4. 连接、权限与背压

1. 建立连接时验证工作间、Run 与事件级可见性；成员停用、角色收窄或 Grant 撤销时，已有
   连接必须关闭、重新鉴权或切换到过滤后的流。
2. 每 15 秒发送不含业务内容的 SSE comment heartbeat。心跳不表示任务活跃或授权有效。
3. 单帧和客户端积压均有限额；慢客户端收到可理解的断连原因后以快照和游标恢复。
4. 断线期间任务继续。重连界面必须先显示“内容可能不是最新”，再展示离线期间的已过滤
   关键变化和同步结果。
5. 长历史使用概览快照加 keyset 分段，不要求新成员下载全部事件后才能看到当前状态。
6. 高风险、失败、待审批、结果未知和回执缺口在任何投影中均不得默认隐藏。
7. 私人接手问答、个人草稿和未选择共享内容从不进入公共 DomainEvent 或 TransientOutput。

## 5. 重连不变量

- 已提交事件可重放，pi live run、内存队列、等待审批和执行中工具不可由 SSE 恢复。
- 重放只读操作不改变任务、审批、Grant 或有效协作者统计。
- 相同 `eventId` 只投影一次；重复 delta 不重复生成产物、结论或业务完成。
- `outcome_unknown` 的 Run 在重连后仍为待人工确认，不自动重新 prompt 或重新执行工具。
