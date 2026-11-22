# Data Model: Unspool 通用 Agent 与联邦式协作

**Date**: 2026-11-21  
**Sources**: [spec.md](spec.md), [research.md](research.md)

## 1. 通用约定

- `Run` 是规格中一次 Agent Task 的执行实体，外部合同统一使用 `runId`；不得再平行引入
  `taskId` 作为同一概念的不同标识。
- 所有聚合 ID 使用 UUIDv7 字符串；节点另持有从 1 开始、持久递增的本地事件序号。
- 时间使用 RFC 3339 UTC；授权区间为 `[notBefore, expiresAt)`，`now >= expiresAt` 即失效。
- `revision`、`operatorEpoch`、`policyRevision` 均为单调递增的 64 位整数，不得回滚复用。
- 规范化 JSON 使用 JCS；动作、Grant、Artifact 与回执摘要采用 SHA-256，签名采用 Ed25519。
- 所有写命令包含 `commandId`、`actorId`、`workspaceId`、`payloadDigest` 和适用的期望版本。
  同一主体与命令 ID 重放返回首次已接受结果，同键不同摘要返回冲突。
- `Attribution` 内嵌于责任记录：`actorId`、`displayNameAtTime`、`rolesAtTime`、`occurredAt`。
  显示名和角色快照用于保留历史语义，不替代不可变主体 ID。
- `VisibilityScope` 决定人或角色能否读取；`SecurityLabel` 决定数据可去往何处。二者不得
  合并为一个“公开/私密”布尔值。
- `DataRights` 是独立布尔权利项：`modelDisclose`、`memberDisclose`、`publicTimeline`、
  `domainPropagate`、`centralCache`、`offlineRead`，全部默认 false。
- `RecipientRules` 明确定义成员集合、模型接收方（提供方、模型、区域、保留策略）、目标域、
  公共可见与缓存策略；`ResourceBudget` 分别限制文件、字节、读取、输出、时长、并发、CPU、
  内存和进程。权限判断不得只使用笼统敏感等级。
- SQLite 保存权威业务状态；pi JSONL 只保存模型上下文；Blob 以内容摘要寻址并保存实际字节。
  三者通过 manifest 对账，不能相互冒充。

## 2. 身份、团队与工作环境

| Entity | 关键字段 | 关系与验证规则 |
|---|---|---|
| `User` | `id`, `displayName`, `status`, `authVersion`, `createdAt`, `disabledAt?` | 状态为 `active/disabled`；停用后立即终止身份认证、既有会话及受限内容读取/操作权限，历史 `Attribution` 保留。 |
| `Team` | `id`, `name`, `betaEnabled`, `defaultPolicyRevision`, `createdAt` | 新团队及升级后 `betaEnabled=false`；管理员身份不隐含工作间访问权。 |
| `Membership` | `id`, `teamId`, `userId`, `teamRoles[]`, `status`, `expiresAt?` | 团队内用户唯一；外部专家必须有期限；到期或停用立即终止该成员身份、既有会话及工作间读取/操作权限，既有贡献署名与合法副本边界保留。 |
| `Runner` | `id`, `teamId?`, `name`, `purpose`, `status`, `version`, `capabilities`, `policyRevision`, `lastHeartbeatAt` | 状态为 `available/busy/offline/upgrading/error/disabled`；受限成员不可发现；停用后不能创建新工作间。 |
| `RunnerGrant` | `runnerId`, `teamId?`, `subjectType`, `subjectId`, `allowedPolicy` | 仅授权主体可选择 Runner；个人授权使用 `subjectType=user` 且 `teamId=null`，团队授权在 US2 才关联 Team。不得改变工作间或节点资源权限。 |
| `ModelProfile` | `id`, `runnerId`, `provider`, `model`, `reasoningOptions`, `secretRef`, `enabled` | `secretRef` 只指向模型网关秘密，不保存明文；共享视图只能获得非敏感配置。 |

## 3. 工作间、上下文与协作输入

| Entity | 关键字段 | 关系与验证规则 |
|---|---|---|
| `Workspace` | `id`, `kind`, `teamId?`, `ownerId`, `runnerId`, `name`, `goal`, `completionCriteria`, `status`, `visibility`, `agentConfigSnapshot`, `federationMode`, `revision`, `createdAt`, `archivedAt?` | `kind=personal/shared`；个人时 `teamId=null`，共享时必须有团队。状态为 `draft/active/archived`。名称 1–50 字符；共享任务开始前目标、完成标准、Runner、配置与责任角色完整。 |
| `WorkspaceMember` | `workspaceId`, `userId`, `role`, `canApprove`, `canReview`, `joinedAt`, `leftAt?` | 角色为 `owner/operator/contributor/observer`；审批、复核权限独立。观察者只读；归档不删除成员历史。 |
| `WorkspaceControl` | `workspaceId`, `operatorId`, `operatorEpoch`, `activeRunId?`, `activeRunEpoch`, `revision`, `updatedAt` | 每工作间一行；操作权和活动 Run 分离。所有控制命令使用 compare-and-swap，不接受旧 epoch。 |
| `ContextItem` | `id`, `workspaceId`, `kind`, `currentVersionId`, `createdBy`, `createdAt`, `removedAt?` | 类型为 `goal/fact/decision/constraint/todo/blocker/reference`；移除是状态而非删除历史。 |
| `ContextVersion` | `id`, `contextItemId`, `version`, `title`, `body`, `sourceRefs[]`, `memberVisibility`, `agentExposure`, `attribution`, `supersedesId?` | 版本不可变；`memberVisibility` 与 `agentExposure` 独立。编辑必须指定期望版本；协作者只能编辑本人内容，提供给 Agent 需当前操作者确认。 |
| `TaskContextSnapshot` | `id`, `runId`, `contextVersionIds[]`, `renderedDigest`, `createdAt` | 固定 Run 实际获得的版本和渲染摘要；后续修改不改变历史，超长不得静默截断。 |
| `InputItem` | `id`, `workspaceId`, `kind`, `body`, `authorId`, `createdAt`, `references[]` | 类型为 `discussion/suggestion/agent_instruction`；讨论不进入主 Agent 会话。已被 Agent 接收的指令不可修改。 |
| `SuggestionDecision` | `suggestionId`, `status`, `decidedBy`, `editedBody?`, `resultingInputId?`, `decidedAt` | 状态为 `pending/adopted/edited_adopted/ignored`；保留建议人和采纳人，只有当前操作者可决定。 |
| `SharePreview` | `id`, `sourceWorkspaceId`, `selectedRecordIds[]`, `excludedCategories[]`, `createdBy`, `expiresAt` | 默认排除凭据、偏好、草稿、私人问答和未选择内容；预览有期限，提交时重新核对版本。 |
| `ShareConversion` | `id`, `sourceWorkspaceId`, `targetWorkspaceId`, `selectedRecordIds[]`, `sourceRunStoppedAt`, `createdBy`, `createdAt` | 保留原个人工作间；创建共享 continuation session。活动个人 Run 不得静默转换。 |

## 4. 会话、任务与事件

| Entity | 关键字段 | 关系与验证规则 |
|---|---|---|
| `AgentConversation` | `id`, `workspaceId`, `piSessionRef`, `sessionFormatVersion`, `continuationOfId?`, `createdAt` | 一个工作间一个主持续会话；接手准备使用不同会话。共享 continuation 不包含未选择的私人历史。 |
| `SessionCheckpoint` | `id`, `conversationId`, `runId?`, `piLeafId`, `lastPersistedEntryId`, `lastProjectedEventId`, `createdAt` | 对齐 pi 已持久化 entry 与 Unspool 投影；`message_end` 到达不等于 append 完成，必须 drain 与对账后才推进。 |
| `Run` | `id`, `workspaceId`, `conversationId`, `sequence`, `state`, `operatorEpoch`, `runnerId`, `contextSnapshotId`, `startedBy`, `startedAt`, `endedAt?`, `lastKnownCheckpoint?` | 技术状态与业务结果分离；同一工作间活动状态 Run 至多一个。Run 固定上下文、配置和操作者 epoch。 |
| `RunAttempt` | `id`, `runId`, `workerId`, `attemptEpoch`, `state`, `leaseExpiresAt`, `startedAt`, `settledAt?`, `unknownReason?` | 状态为 `assigned/dispatched/running/settled/outcome_unknown`；已派发但结果不明时不得自动创建新 attempt。 |
| `RunCommand` | `id`, `runId?`, `workspaceId`, `kind`, `payload`, `payloadDigest`, `commandId`, `actorId`, `operatorEpoch`, `acceptedAt`, `resultRef?` | 类型为 `start/steer/follow_up/stop/queue_action`；必须校验当前操作权。停止先 `clearQueue` 再 `abort`。 |
| `QueuedInstruction` | `id`, `runId`, `sourceCommandId`, `kind`, `body`, `state`, `position`, `dequeuedAt?`, `persistedAt?` | 状态为 `queued/withheld/modified/deleted/released`；停止后默认 `withheld`，不得自动释放。ID 与 FIFO 由 Unspool 管理，重复文本不是关联键；pi 内存队列恢复后不得自动重新入队。 |
| `CompletionAssessment` | `runId`, `result`, `reason?`, `assessedBy`, `assessedAt`, `evidenceExceptionId?` | 结果为 `complete/partial/incomplete/failed/cancelled`；Agent 不得生成该人工确认。 |
| `DomainEvent` | `id`, `workspaceId`, `sequence`, `schemaVersion`, `type`, `actorId?`, `runId?`, `occurredAt`, `visibility`, `payloadRef`, `payloadDigest` | `(workspaceId, sequence)` 唯一且只追加；高风险、失败和审批不得被投影隐藏。重放时重新过滤可见性。 |
| `TransientOutput` | `runId`, `offset`, `delta`, `createdAt` | 非权威、短期保留；最终 `DomainEvent` 与消息摘要替代它，不逐 token 写主库。 |
| `OutboxMessage` | `id`, `domainEventId`, `destination`, `state`, `attemptCount`, `availableAt` | 与业务提交同事务；至少一次投递，不包含超出目标权限的正文。 |
| `InboxReceipt` | `consumerId`, `messageId`, `receivedAt`, `resultDigest` | 消费去重；队列消息不能绕过审批或 Grant。 |
| `UsageRecord` | `runId`, `provider`, `inputTokens?`, `outputTokens?`, `costAmount?`, `costCurrency?`, `reliability` | 上游无可靠数据时字段为空并标 `unavailable`，不得显示虚构精确值。 |

## 5. 高风险审批

| Entity | 关键字段 | 关系与验证规则 |
|---|---|---|
| `ToolCallRecord` | `id`, `runAttemptId`, `toolCallId`, `parentToolCallId?`, `toolName`, `originalArgsDigest`, `effectiveArgsDigest`, `state`, `preflightAt`, `executionEnteredAt?`, `finalizedAt?`, `resultDigest?`, `transcriptEntryId?` | `tool_execution_start` 只记录 preflight；execution-entered 来自受控工具包装器。已 entered 而无 final receipt 时必须待人工确认，嵌套调用也独立记录。 |
| `ActionProposal` | `id`, `runId`, `attemptId`, `toolCallId`, `toolName`, `canonicalArgs`, `displayArgs`, `secretRefs[]`, `actionDigest`, `purpose`, `impact`, `risk`, `baseResourceVersions[]`, `createdAt` | `canonicalArgs` 仅存在于受控执行边界，`displayArgs` 向审批人展示完整语义参数及脱敏占位，秘密仅以 `secretRefs` 引用；`actionDigest` 仍绑定真实规范化动作、工作目录、环境、目标和接收方。任意 Bash 默认高风险，不能由模型自报只读而降级。 |
| `ApprovalRequest` | `id`, `actionProposalId`, `requesterId`, `requiredApproverPolicy`, `state`, `expiresAt`, `policyRevision`, `createdAt` | 初始 `pending`，默认 15 分钟；离线、关页和断网不改变状态；内容变化生成新 Proposal 并使旧请求 `invalidated`。 |
| `ApprovalDecision` | `id`, `approvalRequestId`, `decision`, `decidedBy`, `reason?`, `decidedAt`, `actionDigest` | 决定为 `approved/rejected/expired/invalidated`；默认禁止请求操作者自我审批，管理员例外必须留醒目记录。 |
| `ExecutionPermit` | `id`, `approvalDecisionId`, `actionDigest`, `runAttemptId`, `policyRevision`, `expiresAt`, `consumedAt?`, `consumptionResult?` | 单次使用；实际执行前原子消费并重新核对摘要、Run、Grant、Beta 开关和基础版本。结果未知时不能再次消费。 |

审批状态机为 `pending → approved/rejected/expired/invalidated`，不得从终态恢复。
工具执行状态独立为 `preflight/waiting_approval/dispatched/succeeded/failed/cancelled/timed_out/
outcome_unknown`；审批通过不等于执行成功。

## 6. 操作权交接与私人准备

| Entity | 关键字段 | 关系与验证规则 |
|---|---|---|
| `HandoffInvitation` | `id`, `workspaceId`, `fromOperatorId`, `recipientId`, `summarySnapshotId`, `baseRevision`, `status`, `reason?`, `createdAt`, `expiresAt?` | 状态为 `invited/preparing/accepted/rejected/cancelled/expired`；接受必须原子更新 `WorkspaceControl`，任务状态不变。 |
| `HandoffSummary` | `id`, `workspaceId`, `revision`, `goal`, `criteria`, `runState`, `decisions[]`, `completedWork[]`, `pendingApprovalIds[]`, `queueIds[]`, `todoIds[]`, `artifactIds[]`, `blockers[]`, `grantIds[]` | 不可变；联邦摘要还包含 Grant 期限、节点状态与受限结果。 |
| `PreparationSession` | `id`, `handoffId`, `recipientId`, `readOnlyConversationId`, `asOfRevision`, `latestRevision`, `status`, `startedAt`, `endedAt?` | 仅被邀请接收者可用；只读、独立会话，无真实工具；关键背景变化递增 `latestRevision` 并要求接受前刷新。 |
| `PrivateQA` | `id`, `preparationSessionId`, `question`, `answer`, `asOfRevision`, `answerKind`, `createdAt` | `answerKind=sourced/speculative/unknown/permission_denied`；仅接收者可见，不进入公共事件、分析或默认档案。 |
| `Citation` | `privateQAId`, `sourceType`, `sourceId`, `sourceRevision`, `recordedAt` | 来源必须实际存在于接收者获过滤的准备上下文；禁止引用原操作者私人来源。 |
| `UnresolvedIssue` | `id`, `preparationSessionId`, `body`, `visibility`, `status` | 默认私人；公开时创建新讨论或交接说明，不修改原私人问答。 |
| `ClarificationPublication` | `id`, `preparationSessionId`, `targetType`, `targetId`, `editedBody`, `publishedBy`, `publishedAt` | 发布前必须编辑确认；目标为讨论、上下文或交接说明；关键结论仍走证据确认。 |

操作者 Presence 独立保存 `lastSeenAt` 与连接状态。离线 2 分钟只开放接管资格；
负责人强制接管必须有理由。并发接受或接管通过 `operatorEpoch` 保证只有一人成功。

## 7. 活证据、文件与档案

| Entity | 关键字段 | 关系与验证规则 |
|---|---|---|
| `Conclusion` | `id`, `workspaceId`, `kind`, `body`, `state`, `scope`, `proposedBy`, `confirmedBy?`, `confirmedAt?`, `currentVersion`, `lastReviewedAt?` | 类型为 `fact/assumption/decision`；状态为 `unverified/confirmed/review_required/invalid`。Agent 只能提议，确认需权限与来源。 |
| `EvidenceSource` | `id`, `workspaceId`, `originType`, `originId`, `currentVersionId`, `state`, `lastConfirmedAt`, `reviewDueAt?`, `externalMonitoring` | 状态为 `active/review_required/superseded/revoked/invalid/unavailable`；未监测外部来源必须显示最后确认时间。 |
| `SourceVersion` | `id`, `sourceId`, `version`, `contentRef`, `contentDigest`, `recordedAt`, `supersedesId?` | 不可变；历史任务继续引用旧版本，更新不能改写历史来源。 |
| `EvidenceLink` | `conclusionId`, `sourceVersionId`, `relation`, `createdBy`, `createdAt` | 关系为 `supports/conflicts/context`；冲突并列呈现，不自动选择来源。 |
| `ConclusionImpact` | `id`, `conclusionId`, `targetType`, `targetId`, `impactKind`, `state` | 目标可为完成标准、后续结论、产物或待审批动作；来源失效将直接依赖标为待复核，不撤销业务行为。 |
| `ReviewRecord` | `id`, `conclusionId`, `previousState`, `newState`, `reason`, `sourceVersionIds[]`, `reviewedBy`, `reviewedAt` | 只追加；重新确认保留此前失效与复核历史。 |
| `EvidenceException` | `id`, `runId`, `conclusionIds[]`, `reason`, `approvedBy`, `createdAt` | 负责人例外完成不增加有效证据覆盖率，也不清除缺证记录。 |
| `BlobObject` | `id`, `storageKey`, `sha256`, `size`, `mediaType`, `state`, `createdAt` | 内容寻址、不可变；缺失或待对账必须显式标记，预览不执行主动内容。 |
| `ArtifactVersion` | `id`, `artifactId`, `version`, `blobId`, `kind`, `originType`, `originId`, `runId?`, `attribution`, `securityLabelId`, `sourceSummary` | 类型为 `reference/agent_output/node_artifact/patch/export`；默认 20MB 上传限制可由管理员收窄或调整；历史 Run 固定版本。`securityLabelId` 引用共享基础层默认标签，不要求 Beta 组件。 |
| `SecurityLabel` | `id`, `version`, `purposeRules`, `memberRules`, `modelRecipientRules`, `targetDomainRules`, `publicVisibility`, `cacheAndRetention`, `untrustedContent`, `reviewHistory[]` | Stable 在共享基础层创建默认标签，保证产物不依赖 Beta；Beta 扩展跨域严格交集，派生合并逐维取最严格限制。转换、摘要、脱敏不自动降级，降级生成新标签版本并保留复核。 |
| `ArchiveExport` | `id`, `workspaceId`, `scope`, `formatVersion`, `manifestBlobId`, `missingItems[]`, `unknownItems[]`, `exportedBy`, `exportedAt` | 导出包含产物清单和异常标记；记录人、时间与范围；权限过滤不能静默省略，应标不可访问。 |

## 8. Federated Beta

### 8.1 节点、资源与授权

| Entity | 关键字段 | 关系与验证规则 |
|---|---|---|
| `ContributorNode` | `id`, `ownerId`, `teamId`, `name`, `publicKey`, `ownerApprovalPublicKey`, `platform`, `agentVersion`, `state`, `supportState`, `securityPosture`, `capabilities`, `policyRevision`, `lastHeartbeatAt` | 状态为 `pending/online/busy/offline/paused/revoked/quarantined/incompatible`；配对后无资源共享，`securityPosture=unknown`。 |
| `ResourceRegistration` | `id`, `nodeId`, `kind`, `localAlias`, `displayMetadata`, `allowedOperations`, `templateDigest?`, `registeredAt` | 只暴露所有者选择的别名与元数据；远程方不得提交任意宿主路径。 |
| `SnapshotManifest` | `id`, `nodeId`, `resourceId`, `rootDigest`, `entries[]`, `createdAt`, `pathVisibility`, `cachePolicy`, `state` | 每项含 opaque `entryId`、可选逻辑路径、类型、大小和摘要；`pathVisibility=opaque_only/authorized_recipients/owner_only`，独立于内容与数据流权利且默认 `opaque_only`。只含普通文件；默认拒绝链接、跨挂载点和未确认硬链接。 |
| `Grant` | `id`, `nodeId`, `ownerId`, `teamId`, `workspaceId`, `runId`, `purposeDigest`, `resourceId`, `resourceDigest`, `operations[]`, `requesterIds[]`, `recipientRules`, `rights`, `notBefore`, `expiresAt`, `usageLimit`, `budget`, `cachePolicy`, `handoffPolicy`, `policyRevision`, `ownerSignature`, `state` | 默认只读、短期、不可转让/转发/升级。状态为 `requested/active/suspended/rejected/revoked/expired/exhausted`；拒绝、撤销、过期与耗尽均为终态，不得复活，只能创建新 Grant。 |
| `OperationTicket` | `requestId`, `nonce`, `executionId`, `nodeId`, `runId`, `grantDigest`, `actionDigest`, `recipientDigest`, `bodyDigest`, `notBefore`, `expiresAt`, `signature` | 不超过 60 秒且不超过 Grant/审批期限；只在节点本地与 Grant 联合有效，不是独立 bearer capability。 |
| `NodeOperation` | `id`, `requestId`, `nodeId`, `grantId`, `executionId`, `kind`, `state`, `authorizedAt`, `dispatchedAt?`, `completedAt?`, `unknownReason?`, `resultDigest?` | `(nodeId, requestId)` 与 nonce 持久去重；已 dispatched 无确定结果时只能 `outcome_unknown`，重放只查询状态。 |

### 8.2 工具、Artifact 与 Patch

| Entity | 关键字段 | 关系与验证规则 |
|---|---|---|
| `FixedToolTemplate` | `id`, `nodeId`, `version`, `digest`, `displayName`, `purpose`, `executableDigest`, `parameterSchema`, `workingScope`, `envAllowlist`, `networkPolicy`, `outputLimit`, `sideEffectClass`, `budget` | 不允许 Shell 字符串、未声明 argv、管道或重定向；模板或语义变化生成新摘要并重新授权。 |
| `ToolExecution` | `id`, `nodeOperationId`, `templateDigest`, `canonicalArgs`, `resourceBudget`, `state`, `startedAt`, `endedAt?`, `outputArtifactId?` | 使用干净低权限沙箱；默认无网络、无宿主环境/凭据/PID/IPC/Docker socket；超时终止进程组。 |
| `NodeArtifact` | `id`, `originNodeIds[]`, `originOwnerIds[]`, `originGrantDigests[]`, `derivedFrom[]`, `contentDigest`, `securityLabelId`, `createdAt` | 每个出口重新检查标签；节点签名与执行成功不代表业务真实或已验证。 |
| `PatchProposal` | `id`, `nodeId`, `baseSnapshotId`, `baseManifestDigest`, `fileChanges[]`, `runId`, `purposeDigest`, `patchDigest`, `securityLabelId`, `state` | 状态为 `proposed/conflict/rejected/application_approved/applied/outcome_unknown`；生成或读取不产生写权限。 |
| `PatchApplication` | `id`, `patchId`, `independentGrantId`, `preconditionDigests[]`, `journalRef`, `resultByFile[]`, `appliedBy`, `startedAt`, `completedAt?` | 应用前重新比较当前文件摘要；冲突不自动合并。多文件不承诺全局原子，异常标部分应用或未知。 |

### 8.3 回执与本地状态

| Entity | 关键字段 | 关系与验证规则 |
|---|---|---|
| `NodeReceipt` | `eventId`, `nodeId`, `nodeSequence`, `previousDigest`, `runId`, `requestId`, `executionId?`, `actor`, `resourceDigest`, `operation`, `grantDigest`, `decision`, `reason`, `occurredAt`, `result`, `byteCount`, `destinations[]`, `labelDigest`, `uploadState`, `nodeSignature` | 追加式；操作前后分别记录；协调方按 `(nodeId,eventId)` 幂等接收。`uploadState=pending/accepted/duplicate/gap` 仅为协调方只读接收投影，不属于节点签名载荷。角色过滤详细字段。 |
| `ReceiptGap` | `nodeId`, `fromSequence`, `toSequence`, `detectedAt`, `reason`, `resolvedAt?` | 缺口必须显著展示；含未解决缺口的任务不计入要求完整回执的 Beta 北极星。 |
| `NodePolicyState` | `nodeId`, `stateRevision`, `betaEnabled`, `pauseState`, `quarantineState`, `revocationTombstones[]`, `deniedIntentDigests[]`, `budgetWatermarks` | 节点本地权威；只有所有者更高版本签名可解除隔离，服务器只能增加限制。 |
| `RevocationDirective` | `id`, `targetType`, `targetId`, `stateRevision`, `effectiveAt`, `reason`, `scope`, `ownerOrSecuritySignature` | 撤销立即阻断新访问；旧版本解除命令无效；在途操作安全取消或标未知。 |

## 9. 运维与分析

| Entity | 关键字段 | 规则 |
|---|---|---|
| `CommandReceipt` | `actorId`, `workspaceId`, `commandId`, `payloadDigest`, `responseDigest`, `acceptedAt`, `response` | 提交与业务状态同事务；响应丢失后可按原键恢复结果。 |
| `BackupManifest` | `id`, `appVersion`, `schemaVersion`, `lastWorkspaceSequences`, `objectEntries[]`, `sessionEntries[]`, `createdAt`, `digest` | 冷备份包含一致序号、对象和会话校验；空主机恢复验收后才算有效备份。 |
| `SchemaMigration` | `version`, `checksum`, `appliedAt`, `backupManifestId` | 单实例维护模式执行；应用拒绝打开未知更高 schema；升级不开启 Beta 或扩大 Grant。 |
| `AnalyticsEvent` | `eventName`, `occurredAt`, `actorPseudonym?`, `workspacePseudonym?`, `metadata` | 与安全审计分离；禁止指令、讨论、文件、路径、参数、模型外发内容和私人问答正文。 |
| `CollaborationMetric` | `week`, `metricName`, `subjectId`, `value`, `calculationVersion` | Stable 北极星要求完成任务与两名有效协作者；Beta 还要求两个不同所有者、完整 Grant/回执和结果确认。 |

MVP 历史、署名、审批、证据和回执默认保留至显式删除。归档只读；删除资源和撤销授权不承诺
召回合法副本。私人准备内容的保留期限由接收者控制，退出页面必须明确保留与删除范围；
任何保留策略都不得把私人正文转入公共档案或产品分析。

## 10. 核心状态转换

### Workspace

`draft → active → archived`。个人 `active` 可在活动 Run 停止后执行 ShareConversion，生成新的
共享 `active` 工作间；原个人工作间不变成公共记录。归档只能从 `active` 进入且不可逆，
归档后只允许查询和受控导出。

### Run

`created → running ↔ waiting_approval → stopping → technical_complete/failed/cancelled`。
任何执行中或等待状态在无法确认结果时进入 `needs_confirmation`；客户端断线不改变 Run。
`CompletionAssessment` 是独立人工决定，不是上述技术状态的自动下一步。

### Handoff

`invited → preparing → accepted/rejected/expired/cancelled`。退出准备返回 `invited` 或按接收者
选择结束；接受时若 `baseRevision` 落后且存在关键变化，必须先刷新。只有接受改变操作者。

### Conclusion

`unverified → confirmed → review_required → confirmed/invalid`。到期进入 `review_required` 而非
`invalid`；来源冲突只增加待复核与冲突证据；负责人例外不改变结论状态。

### Grant 与 NodeOperation

Grant：`requested → active/rejected`，`active ↔ suspended → revoked/expired/exhausted`；`rejected/revoked/expired/exhausted` 均为终态。拒绝决定必须保留所有者签名、原因与回执，批准或重放不得复活已拒绝 Grant。
NodeOperation：`requested → authorized → dispatched → succeeded/failed/cancelled/timed_out`；
`dispatched` 后任何无法确认的结果均进入 `outcome_unknown`。不得从 `outcome_unknown` 自动
回到 `dispatched`，人工核查后只能创建关联的新操作。
