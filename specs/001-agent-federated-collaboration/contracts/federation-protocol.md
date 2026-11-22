# Federated Beta Node Protocol

本合同适用于默认关闭的 Federated Beta。节点只主动出站，协调方不能替代资源所有者授权，
任何传输认证都不能独立读取文件或执行工具。管理端点见
[runner-api.openapi.yaml](runner-api.openapi.yaml)，实体与状态见 [data-model.md](../data-model.md)。

## 1. 安全声明与边界

- 支持平台仅限 `ubuntu-24.04-x86_64`；其他平台必须返回 `incompatible`，不能降低策略求连接。
- 节点身份使用 mTLS；所有者批准使用独立 Ed25519 密钥；OperationTicket 绑定一次具体请求。
- 节点本地 Grant、撤销墓碑、预算、去重和回执是本地权威。服务器只保存协调副本。
- 协调方被攻破时，未集中资源仍由节点拒绝，但已集中数据、有效 Grant 可用性和明文路由
  内容可能受影响。节点被攻破时可伪造本节点结果，不自动波及其他节点未传输内容。
- 不承诺防御宿主 root/内核失陷、所有侧信道、合法接收方复制，或恶意节点结果真实性。

## 2. 配对

### 2.1 流程

1. 节点本地生成身份私钥，桌面 Rust 安全边界生成所有者批准私钥；公钥可公开，私钥不出边界。
2. 所有者通过已认证 GUI 创建 10 分钟一次性配对码，提交团队、所有者批准公钥和最大能力。
3. 节点调用 `POST /v1/nodes/pair`，提交配对码、节点公钥、名称、平台、版本和能力。
4. 两端展示由配对字段和随机数生成的短校验值，所有者确认后才签发节点证书。
5. 成功状态为 `pending → online`、`securityPosture=unknown`、`resources=[]`。配对码失效。

### 2.2 拒绝条件

- 配对码过期、已使用、错误团队、错误所有者、公钥变化或校验值不一致；
- 平台/协议不兼容、请求能力超过团队上限或所有者未确认；
- 证书撤销、节点撤销或所有者被停用后的新配对请求。

节点证书可轮换和撤销，但证书只证明“哪个节点”，不赋予任何文件、工具或数据流权限。
节点不得开放公网入站端口，也不得加入默认全网互通私网。

## 3. 出站长轮询

节点调用 `POST /v1/node-operations/poll`，最长等待 30 秒。空闲时使用 1–30 秒指数退避和
随机抖动；有未确认回执时优先补交，不用新资源请求替代补交。

```json
{
  "schemaVersion": 1,
  "nodeId": "018f2d8f-2001-7f20-80b1-aaaaaaaaaaa1",
  "lastOperationCursor": 812,
  "lastReceiptSequence": 1291,
  "waitSeconds": 25,
  "capabilities": ["snapshot_read", "fixed_tool", "patch_proposal"]
}
```

响应是 `NodeOperationRequest[]`。节点对每个请求单独返回决定和回执，长轮询连接本身不构成
长寿命权限。协调方的安全指令和撤销具有最高优先级；节点本地所有者的暂停、撤销和隔离无需
等待协调方确认。

WebSocket 不在 Beta 基线中。未来增加时必须复用相同请求、票据、Grant、去重和回执合同，并
重新完成两种传输的等价安全测试；不得在不支持 mTLS 时降级为长期 bearer token。

## 4. NodeOperationRequest 与 OperationTicket

```json
{
  "schemaVersion": 1,
  "kind": "snapshot.read",
  "operationTicket": {
    "requestId": "018f2d8f-2002-7f20-80b1-aaaaaaaaaaa2",
    "nonce": "random-unique-value",
    "executionId": "018f2d8f-2003-7f20-80b1-aaaaaaaaaaa3",
    "nodeId": "018f2d8f-2001-7f20-80b1-aaaaaaaaaaa1",
    "runId": "018f2d8f-2004-7f20-80b1-aaaaaaaaaaa4",
    "grantDigest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "actionDigest": "sha256:1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "recipientDigest": "sha256:2123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "bodyDigest": "sha256:3123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "notBefore": "2026-11-21T10:20:00.000Z",
    "expiresAt": "2026-11-21T10:21:00.000Z",
    "signature": "coordinator-signature"
  },
  "body": {
    "snapshotId": "018f2d8f-2005-7f20-80b1-aaaaaaaaaaa5",
    "entryIds": ["opaque-entry-1", "opaque-entry-2"]
  }
}
```

节点按以下顺序终裁，任何一步失败都在真实读取或执行前停止：

1. mTLS 节点身份、协议版本、OperationTicket 签名、受众、期限和各摘要匹配；
2. 本地存在所有者签名的 Grant，且 `grantDigest`、任务、目的、资源版本、操作、请求方和
   接收方精确匹配；
3. 全局安全开关、团队、工作间、节点三级启用，节点未暂停/撤销/隔离且版本兼容；
4. 节点与团队策略取更严格者，缓存、模型外发、成员可见和跨域传播分别检查；
5. nonce、`requestId`、executionId 未以不同摘要使用，次数和预算未耗尽；
6. 在本地持久化 `accepted` 回执、去重记录和 execution intent 后，才签发内部一次性 lease；
7. 分段读取、执行入口、结果交付和传播前重新检查当前状态。

OperationTicket 不超过 60 秒，也不得超过 Grant 或审批期限。传输重试只能查询既有
NodeOperation；修改正文、接收方、任务、节点或 nonce 都是新请求并需重新授权。

## 5. Grant 决定

GrantProposal 只是请求，不具备执行效力。所有者在本机预览目的、资源、操作、接收方、期限、
预算、缓存和交接规则后，可批准一次、批准到任务结束、批准固定时长、缩权或拒绝。

```json
{
  "decision": "approved",
  "grantDigest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "stateRevision": 17,
  "ownerSignature": "owner-signature-over-canonical-decision"
}
```

- 节点验证所有者签名并持久化后，Grant 才为 `active`；Runner 的 `approved=true` 不足以执行。
  `rejected` 决定也必须由所有者签名并持久化为终态，产生含原因、时间、操作者和 Run 的回执；
  后续批准或重放不得复活该 Grant，只能创建新 Grant。
- 额外团队审批不能替代所有者；高风险团队 ApprovalRequest 与 Grant 必须分别有效。
- 资源、参数、目的、接收方、模型、传播目标或模板摘要变化均需新 Grant 或明确缩权版本。
- 默认只读、短期、不可转发、不可升级；交接只保留原只读范围，高风险执行和 Patch 应用
  重新确认，接收者不继承私人可见数据。
- 拒绝、撤销、到期和预算耗尽是持久终态；旧签名、旧队列、备份恢复和重启不能使其复活。

## 6. 快照读取

`SnapshotManifest` 只含所有者显式选择的固定版本：

```json
{
  "snapshotId": "018f2d8f-2005-7f20-80b1-aaaaaaaaaaa5",
  "rootDigest": "sha256:4123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "entries": [
    {
      "entryId": "opaque-entry-1",
      "logicalPath": "src/example.ts",
      "type": "regular_file",
      "size": 1024,
      "contentDigest": "sha256:5123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }
  ],
  "createdAt": "2026-11-21T10:00:00.000Z",
  "pathVisibility": "authorized_recipients",
  "cachePolicy": { "centralCache": false, "offlineRead": false }
}
```

1. 远程请求只能使用 `snapshotId + entryId`，不得提交宿主路径、绝对路径或 `..`。
2. 节点以相对目录句柄和禁止跟随链接的安全遍历创建私有副本；默认拒绝所有符号链接、
   非普通文件、跨挂载点和未单独确认的多硬链接。
3. 打开后再次核对普通文件类型和摘要，随后只读取固定副本；检查到打开之间的替换不能
   改变快照范围。
4. 新增目录、实时内容变化和父目录变化不进入旧快照；新快照由所有者另行决定。
5. 未批准中央缓存时不得持久保存完整快照；未批准离线读取时节点离线即不可读。
6. 创建请求必须独立携带 `pathVisibility`，且快照 Manifest 保留同一值：`opaque_only`（默认）
   只向远程方提供 opaque `entryId`；`authorized_recipients` 仅向具有相应成员、模型或目标域
   权利的接收方提供 `logicalPath`；`owner_only` 仅所有者本地可见完整路径，所有远程视图均为
   opaque。该配置不授予内容读取权，也不能扩大 `DataRights`；模型外发、成员可见和跨域传播
   仍分别检查。文件名、目录结构、错误和预览使用同一过滤结果。

## 7. 固定工具执行

`tool.execute` 的 body 只能包含 `templateId`、`templateDigest` 和声明的参数：

```json
{
  "templateId": "run-project-tests",
  "templateDigest": "sha256:6123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "arguments": { "suite": "unit" }
}
```

- 节点在本地查模板，不使用协调方提供的可执行路径、命令字符串、额外 argv 或环境。
- 不使用 Shell；管道、重定向、命令替换、命令串联和未声明参数全部拒绝。
- 每次使用全新低权限沙箱：空环境加白名单、只读输入、独立输出目录、只读根文件系统、
  默认无网络、无宿主 PID/IPC/凭据/Docker socket。
- CPU、内存、进程数、执行时长、并发和输出取团队与节点预算中更严格者；耗尽即拒绝或停止，
  不自动提额。
- 执行前记录 authorized/dispatched，完成后记录结果；无法确认时 `outcome_unknown`，不自动重放。
- 工具输出仍为不可信来源内容，执行完成不等于真实、已验证或业务正确。

Beta 首期不支持网络型固定工具；网络能力需要独立发布评审。

## 8. 模型外发、可见性与跨域传播

`artifact.export` 必须显式声明 `destinationKind`：

| `destinationKind` | 必需独立权利与验证 |
|---|---|
| `model` | 模型提供方、模型身份、区域、内容范围、目的和保留策略匹配的 `model_disclose` |
| `member` | 指定成员或角色和字段范围匹配的 `member_disclose` |
| `public_timeline` | 独立公共可见权利，不能由成员可见推出 |
| `node` | 来源域 `domain_propagate`，以及策略要求的目标域或额外审批 |
| `central_cache` | `cache`、缓存位置、期限、接收方和离线规则 |

派生 SecurityLabel 逐维取最严格交集：成员集合、模型集合、目标域集合取交集；任一来源禁止
公共则派生禁止；缓存期限取最早；用途必须符合全部来源。摘要、翻译、脱敏、错误、日志、
文件名、代码注释和 Patch 不自动降级。

降级必须提交新标签版本、原/新摘要、具体范围、理由和所有受影响所有者的复核签名。
被拒绝的传播记录 `deniedIntentHash`；换工具、摘要、错误或分析通道仍需重新授权。
A 节点内容要求读取 B、发送模型或写入 C 时，只能生成新 GrantProposal，并将相关结论标为
可能受不可信内容影响、待复核。

## 9. Patch 生成与本地应用

1. `patch.propose` 绑定 `runId`、`purposeDigest`、`baseSnapshotId`、Manifest 摘要、逐文件基础
   摘要和标签；`runId` 必须是 Grant 所授权的同一执行，目的摘要必须与 Grant 的 `purposeDigest`
   完全一致。
2. Patch 是派生 Artifact，生成、查看和传播分别检查许可，不产生写回权限。
3. `patch.apply` 只能由节点本地所有者或明确获授权者发起，携带独立 Grant、OperationTicket、
   所有者签名和当前文件前置摘要。
4. 应用前重新验证所有文件仍为普通文件、路径范围未变、当前摘要与基础完全一致；冲突时
   返回 `conflict`，不得自动覆盖或三方合并。
5. 本地 Journal 记录逐文件开始和结果。单文件可原子替换；多文件崩溃必须标可能部分应用或
   `outcome_unknown`，不得重启后盲目重放整个 Patch。
6. 成功应用生成新文件版本和证据；拒绝 Patch 不撤销原只读 Grant。

## 10. 回执、撤销与恢复

每个 NodeReceipt 使用 `(nodeId, eventId)` 幂等，包含持久 `nodeSequence`、前序摘要、请求方
`actor`、`resourceDigest`、操作、Grant 摘要、决定、结果、字节数、数据去向、标签摘要和节点
签名。`uploadState` 仅由协调方维护，是只读的接收投影，不属于节点签名载荷，节点或客户端
不得上传修改：`pending` 表示已收到但尚未完成验签与入库，`accepted` 表示已验签去重并接受，
`duplicate` 表示重复补交已去重，`gap` 表示检测到节点序号缺口、记录不完整。节点签名覆盖
接收前的规范化业务回执；上传或重放只改变该接收状态，不得改变业务决定或重新执行操作。
协调方检测序号缺口并创建 ReceiptGap；补交只补记录，不重新执行操作。缺口未解决时任务不计入
要求完整回执的指标。

撤销、暂停、隔离、到期、预算耗尽、节点撤销和 Beta 停用统一执行：

- 立即阻断新访问和中央缓存读取；
- 可取消的在途操作安全停止，无法确认停止或副作用时进入 `outcome_unknown`；
- 节点重连先同步撤销墓碑、策略水位和未确认回执，再接受新请求；
- 只有所有者更高 `stateRevision` 的签名可解除本地隔离，服务器只能增加限制；
- 历史读取与回执保留，撤销不宣称召回合法副本。

回执签名与哈希链提高来源可追踪性和篡改可见性，但不能证明恶意节点报告真实，也不能证明
不存在侧信道。所有者始终可在本地筛选和导出本人节点回执，即使协调方不可用。
