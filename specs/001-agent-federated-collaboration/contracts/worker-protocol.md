# Execution Worker and Model Gateway Contracts

本协议只用于 Runner 控制面、固定池执行 worker 和模型网关之间的受信内部通道，不向工作间
成员或贡献者节点开放。所有内部端点使用独立服务身份、TLS 或等效受限本地通道，不暴露宿主
Docker socket、权威 SQLite、其他 worker 工作区或长期模型凭据。

## 1. 信任边界

| 组件 | 可以拥有 | 不得拥有 |
|---|---|---|
| Runner 控制面 | SQLite、权限、审批、Outbox、Artifact 权威索引、worker 调度 | 宿主通用 Docker 控制、节点所有者批准私钥 |
| Execution worker | 被分配 attempt 的会话包、受限工作区、短期模型访问票据、受控工具 | 权威数据库、长期模型密钥、其他 attempt 文件、未审查扩展 |
| Model gateway | 模型提供方凭据、提供方适配、外发策略执行、用量归一化 | 工作间写权限、节点 Grant、通用任意 URL 代理 |
| Artifact staging | 当前 attempt 的暂存字节和摘要 | 权威元数据提交、跨 attempt 读取 |

每个 worker 是独立 OS/容器边界。Node `worker_thread`、pi `cwd`、Tauri ACL、扩展 Hook 或
Docker 名称本身均不得替代该边界。

## 2. AttemptAssignment

控制面通过内部调度接口分配工作，worker 只有在租约、摘要和能力完全匹配时才接受。

```json
{
  "schemaVersion": 1,
  "assignmentId": "018f2d8f-1001-7f20-80b1-aaaaaaaaaaa1",
  "runId": "018f2d8f-1002-7f20-80b1-aaaaaaaaaaa2",
  "attemptId": "018f2d8f-1003-7f20-80b1-aaaaaaaaaaa3",
  "attemptEpoch": 4,
  "workspaceId": "018f2d8f-1004-7f20-80b1-aaaaaaaaaaa4",
  "conversationPackage": {
    "packageDigest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "sessionFormatVersion": 1,
    "downloadRef": "internal-artifact://assignment/session"
  },
  "contextSnapshot": {
    "snapshotId": "018f2d8f-1005-7f20-80b1-aaaaaaaaaaa5",
    "renderedDigest": "sha256:1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  },
  "agentProfile": {
    "profileId": "018f2d8f-1006-7f20-80b1-aaaaaaaaaaa6",
    "modelAccessTicket": "short-lived-opaque-ticket"
  },
  "resourceBudget": {
    "cpu": 2,
    "memoryMb": 4096,
    "processes": 128,
    "outputBytes": 20971520
  },
  "leaseExpiresAt": "2026-11-21T10:30:00.000Z"
}
```

验证规则：

1. `attemptId + attemptEpoch` 是执行栅栏；旧租约的心跳、事件和结果全部拒绝。
2. 分配只引用固定会话包与上下文版本，不允许 worker 选择“最近会话”或任意 Runner 路径。
3. `modelAccessTicket` 只访问指定模型网关和 Profile，短期、限预算、不可用于其他提供方。
4. 控制面先提交 Run/Attempt/Outbox 再派发；worker 接受不反推业务状态已提交。
5. worker 启动前确认审批扩展无加载错误，设置 sequential 和禁用 prompt expansion；订阅、
   `bindExtensions()`、prompt 的顺序固定。
6. 每个会话一条串行命令 lane；首版 `session.agent.toolExecution = "sequential"`。

## 3. Worker 命令

| 命令 | 关键字段 | 结果与限制 |
|---|---|---|
| `start` | `commandId`, `body`, `expectedAttemptEpoch` | 仅空闲会话可 prompt；重复命令返回首次接受结果 |
| `steer` | `commandId`, `body`, `expectedAttemptEpoch` | 只入队，不跳过当前工具；Unspool 保存指令 ID/FIFO |
| `followUp` | `commandId`, `body`, `expectedAttemptEpoch` | 无工具和 steering 后才注入；空闲时不得代替 prompt |
| `holdQueueAndStop` | `commandId`, `queueSnapshot`, `expectedAttemptEpoch` | 先持久化 stopping，保存自管队列，`clearQueue()`，再 `abort()` 并等待写通道 drain |
| `checkpoint` | `commandId`, `expectedAttemptEpoch` | 返回 pi leaf、持久化 entry、事件游标和 Artifact 清单 |
| `reconcile` | `sessionRef`, `lastCheckpoint` | 只对齐历史；live run、审批、队列和执行中工具保守标未知 |
| `dispose` | `expectedAttemptEpoch`, `reason` | 清理监听、进程、环境、临时文件和短期票据，不影响权威历史 |

`holdQueueAndStop` 的任何中断都使停止结果成为未知；不得自动重发停止、重新入队或重放工具。

## 4. Worker 事件与回执

worker 以批次提交事件，控制面按 `(workerId, eventSequence)` 去重。

```json
{
  "schemaVersion": 1,
  "workerId": "worker-02",
  "attemptId": "018f2d8f-1003-7f20-80b1-aaaaaaaaaaa3",
  "attemptEpoch": 4,
  "eventSequence": 91,
  "events": [
    {
      "kind": "tool_execution_entered",
      "observedAt": "2026-11-21T10:20:00.000Z",
      "toolCallId": "call-1",
      "effectiveArgsDigest": "sha256:2123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }
  ]
}
```

| worker 事件 | 控制面投影 |
|---|---|
| `session_started`, `output_delta`, `message_completed` | Run 状态、TransientOutput、最终权威消息；delta 不逐条写主库 |
| `tool_preflight` | ToolCallRecord=preflight；不是副作用开始 |
| `approval_requested` | 建立 ActionProposal/ApprovalRequest，使用有效参数摘要 |
| `tool_execution_entered` | 真实执行入口；由受控工具包装器生成 |
| `tool_finalized` | 工具报告结果；不自动证明无副作用或业务成功 |
| `session_checkpoint` | pi leaf、最后持久化 entry 与投影游标的对账点 |
| `agent_settled` | 技术不再自动继续；仍须 drain 自有事件和检查最终错误 |
| `execution_unknown` | `needs_confirmation`，保留最后已知状态并禁止自动重放 |

监听器只同步写入 worker 自有有序通道，不抛错、不启动未等待的异步写入。`message_end` 到达后
仍需等待 pi append 与对账；不能仅凭通知顺序声称持久化完成。

## 5. ApprovalGate

1. 受信任 inline 扩展在 `tool_call` 生成 ActionProposal，未知工具、Bash、写入和外部动作默认
   高风险或拒绝。真实 `canonicalArgs` 仅存在受控执行边界；审批 API 只返回完整语义的
   `displayArgs` 与秘密引用 `secretRefs`，摘要仍绑定真实规范化载荷。
2. Runner 持久化审批请求后才返回 `approvalId`；worker 等待本地 deadline、取消 signal 和决定。
3. 批准决定先在 Runner 持久化。worker 返回允许前重新检查 approval、actionDigest、attempt、
   策略版本和取消状态。
4. 实际工具入口原子消费单次 ExecutionPermit；参数或范围变化、旧 attempt、过期、停止、撤销、
   数据库异常、扩展加载失败均阻断。
5. 15 分钟到期、取消、离线和晚到批准均为未批准。不得只用 `Promise.race` 留下后台批准。
6. pi 没有通用 `tool_call` 超时；受控 handler 必须 settle。永不 settle 的故障通过隔离和故障
   测试暴露，不得宣称 abort 能强制唤醒它。
7. `tool_call` 错误默认阻断；审批审计来自 Unspool，不能依赖 RPC `extension_error` 一定存在。

## 6. Model Gateway

| 操作 | 合同 |
|---|---|
| `createCompletion` | `modelAccessTicket`, `profileId`, `purposeDigest`, `approvedSourceLabels`, 标准化消息与工具声明 |
| `streamEvents` | 统一 token、工具调用、错误、取消和完成事件；支持背压，不记录正文日志 |
| `cancelCompletion` | `completionId`, `attemptEpoch`；取消只表示请求，不推断外部副作用 |
| `getUsage` | 提供方原始标识、可靠 token/cost；不可靠时返回 `unavailable` |

- 网关验证每个待发内容的模型外发许可，模型、区域、保留策略和接收方必须匹配。
- 长期凭据只存在网关秘密存储；worker、SSE、日志、审批、导出和分析不得获得。
- 首发提供方必须通过流式、工具调用、取消、错误和用量合同测试；不兼容者不在支持矩阵。
- 网关不是任意 URL 代理，也不能以秘密扫描替代权限或承诺发现所有敏感信息。

## 7. 恢复矩阵

| 故障点 | 恢复要求 |
|---|---|
| 控制面提交前崩溃 | 命令未接受；客户端可用原幂等键重试 |
| 提交后、响应前崩溃 | 从 CommandReceipt 找回首次结果，不创建第二 Run |
| 分配后、prompt 前崩溃 | 可证明未 dispatch 时由人工决定重新分配 |
| 审批允许后、执行入口前崩溃 | 批准保留历史但不可盲目重用；重新核对实际状态 |
| execution-entered 后无结果 | `outcome_unknown`；不得自动重放 |
| `clearQueue` 后、`abort` 前崩溃 | 停止结果未知，队列保持 withheld |
| pi append 后、Outbox 前崩溃 | 用 SessionCheckpoint 对账，缺失投影补齐或标记录不完整 |
| worker 空闲复用 | 清除上一任务进程、环境、暂存字节、监听器和短期票据 |
