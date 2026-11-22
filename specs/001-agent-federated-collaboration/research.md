# Phase 0 Research: Unspool 通用 Agent 与联邦式协作

**Date**: 2026-11-21  
**Specification**: [spec.md](spec.md)  
**Constitution**: [.specify/memory/constitution.md](../../.specify/memory/constitution.md)

## Research Frame

要解决的问题是：在不依赖公共云执行服务的前提下，让个人与 2–20 人团队通过独立桌面 GUI
使用同一个可持续 Agent 工作现场，并在可选 Beta 中把不同所有者的文件快照与固定工具按任务、
短期、可撤销地接入。

设计消费者包括桌面用户、工作间负责人、操作者、审批与复核成员、资源所有者、Runner 运维者，
以及后续需要依据合同实现和验证系统的工程与测试人员。

所有方案必须保持以下不变量：个人任务不依赖团队配置；单工作间单操作者和单活动任务；高风险
动作批准前零副作用；读取、模型外发、成员可见与跨域传播分离；资源所有者在节点本地拥有最终
授权；撤销与失效权限不能复活；结果未知不得自动重放；历史、署名、证据和回执不能静默丢失；
私人接手问答不能影响公共任务；Stable 与 Beta 可独立验收和停用。

## D-00: 交付边界

- **Decision**: 采用同一产品核心承载个人与共享任务，Stable 先完成个人、单 Runner 协作、审批、
  交接、活证据和档案；Federated Beta 作为默认关闭的独立能力层分阶段加入。
- **Rationale**: 个人与共享复用执行语义可避免形成两套产品；分轨门禁防止 Beta 的安全和兼容性
  工作阻塞 Stable，也符合宪法第一与第五原则。
- **Alternatives considered**: 一次性交付全部 PRD 能力会扩大首个可验证切片并混淆发布责任；
  为联邦能力建立独立产品会重复身份、任务、证据和档案模型，因此均被拒绝。

## Research Evidence Base

- PRD v5.1 与本特性规格：角色、业务规则、81 条功能需求、60 个 UAT 和分轨发布门槛。
- Unspool Constitution v1.0.0：个人闭环、最小权限、人类责任、诚实状态、独立验证。
- `references/pi/LICENSE`：pi 使用 MIT，可在保留许可和版权通知的前提下集成。
- `references/pi/packages/coding-agent/package.json`：本次参考基线为
  `@earendil-works/pi-coding-agent` 1.6.0（源码提交
  `780bf31fcaeb252fa9b68df3964c735eae75bde3`），要求 Node.js 不低于 22.19.0。
- `references/PI-Desktop/LICENSE`：PI-Desktop 使用 LGPL-3.0；本规划只允许抽象交互研究，
  不将其代码、样式、资产或识别性视觉组合纳入实现方案。
- [Node.js 官方发布策略](https://nodejs.org/en/about/previous-releases)：生产应用应采用 Active
  LTS 或 Maintenance LTS；本计划选择经过生态验证的 LTS，而非追随 Current 版本。

## D-01: 协调服务形态与权威存储

- **Decision**: 采用单写者模块化协调服务和单个权威 SQLite 数据库，数据库仅位于 Runner
  主机；使用 WAL、外键、短事务、唯一约束、条件更新、同事务 Outbox/Inbox 与幂等记录。
  文件正文、pi 会话与快照使用带校验和的受管文件存储，不放入关系文本字段。
- **Rationale**: 当前硬验收规模为 2–20 人团队、5 个并发查看客户端、单工作间单活动任务、
  5 个节点和 20 个活动 Grant，主要负载来自模型和工具而非数据库。单写者事务足以直接证明
  单活动任务、操作权版本和审批一次性消费，并显著降低个人 Docker 部署、备份与恢复成本。
- **Alternatives considered**: PostgreSQL 加独立 Broker 的分布式控制面支持多写实例与滚动
  升级，但当前没有多活、自动故障转移或零停机需求，且会增加数据库、Broker ACL、队列滞留、
  恢复一致性和分布式测试成本；完整 CQRS/Event Sourcing 与 Kafka 亦缺少当前需求支撑。
  桌面各自持有权威数据库会产生多主冲突，明确排除。

SQLite 不是多活方案：首版明确只支持单协调实例和短维护窗口，不把数据库放在 SMB/NFS 共享盘。
只有出现多 API 写实例、自动故障转移、无维护窗口升级，或经容量测试证明单写者持续违反 SLO
等触发条件时，才重新评估 PostgreSQL；迁移采用维护窗口内导出、导入和数量/版本/哈希校验，
不长期双写，也不同时维护两套生产存储实现。

## D-02: 总体架构与进程边界

- **Decision**: 采用 Tauri 2 + React 独立桌面端、Node.js 模块化 Runner、固定池隔离执行容器，
  以及同时用于桌面所有者签名和 Linux 贡献者节点的 Rust 安全核心。桌面通过类型化 Rust
  命令访问本地密钥和 Runner，不把长期令牌交给 WebView。每个 Runner 都是独立单写控制面。
- **Rationale**: Node.js 与 pi SDK 原生匹配，SQLite 单写事务足以支撑当前规模；Rust 安全核心
  把所有者批准密钥、Grant 终裁、快照和固定工具置于最小高权限边界内。桌面不捆绑 Node
  sidecar，本地 Runner 统一采用 Docker，因此关闭 GUI 不会成为停止任务的条件。
- **Alternatives considered**: 全 TypeScript + Electron 的 Stable 集成成本最低，但若要在联邦
  场景证明所有者签名、文件系统和进程边界不可被同域 Node 绕过，仍需补充独立安全代理；
  完整 Tauri + Rust + 桌面 Node sidecar 会增加不必要的生命周期与打包复杂度；仅使用 Tauri
  ACL、Node `worker_thread` 或 pi Hook 均不构成宿主资源隔离，不能替代实际执行边界。

Runner API 不持有宿主 Docker socket。部署使用固定数量的执行 worker 容器，每个 worker 有独立
身份、资源预算和工作区；控制面按 attempt 租约分配任务。worker 通过受限内部接口获取会话包、
读写暂存产物和提交事件，不能直接访问权威数据库、其他 worker 工作区或模型长期凭据。
空闲 worker 必须清理上一任务进程、环境和暂存文件。模型网关是独立小进程，只有它持有模型
长期凭据；无法经该网关保持流式、工具调用和用量语义的提供方不进入首发支持矩阵。

## D-03: 运行时与首发支持矩阵

- **Decision**: TypeScript 7.0 与 Node.js 24 Maintenance LTS 作为 Runner 基线，精确锁定
  `@earendil-works/pi-coding-agent` 1.6.0；Rust 使用 `rust-toolchain.toml` 固定的 stable
  工具链。Stable GUI 首发支持 Windows 11 x64 和 macOS 14+ Apple Silicon；Runner 与贡献者
  节点首发支持 Ubuntu 24.04 LTS x86_64、Docker Engine 27+ 与 Compose v2。
- **Rationale**: Node.js 24 在调研基准日处于 Maintenance LTS，符合官方生产建议，且高于 pi
  要求的 Node.js 22.19.0；TypeScript 7.0 与参考 pi 基线一致。收窄桌面和节点矩阵可把签名、
  更新、密钥库、文件系统及沙箱验证做完整，避免把“可构建”误述为“同等安全”。
- **Alternatives considered**: Node.js 26 是更新的 LTS 线，但当前没有必要为最新运行时增加
  原生依赖和 pi 兼容验证；Node.js 22 虽满足 pi 最低版本，却不是新的长期基线首选。Linux
  桌面、Windows/macOS 贡献者节点、ARM 和其他 Linux 发行版均暂不声明支持，需各自通过独立
  兼容与安全评审，而不是随构建自动加入。

## D-04: 客户端与节点通信、身份和防重放

- **Decision**: GUI 使用版本化 HTTPS JSON 命令、查询和 SSE；节点仅主动出站，采用
  TLS 1.3 mTLS 的 HTTPS 长轮询、结果提交和回执补交，并为每个操作使用不超过 60 秒的
  一次性 OperationTicket。所有写命令具有幂等键，实体更新使用期望 revision，事件按游标恢复。
- **Rationale**: GUI 需要低延迟状态流，SSE 与持久化序号、`Last-Event-ID` 和权限重过滤自然
  匹配。Beta 节点规模小且没有跨节点一秒执行承诺，长轮询在代理兼容、逐请求认证、断线恢复
  和去重方面比长驻 WebSocket 更简单。mTLS 证明节点身份，OperationTicket 绑定具体请求，
  所有者 Grant 独立证明资源许可，三者不能互相替代。
- **Alternatives considered**: WSS + mTLS 可降低节点推送延迟，但会引入代理兼容、背压、长连接
  撤销和重放等额外状态，留作后续优化；长期 bearer token、无逐请求票据的 WebSocket，以及
  不支持 mTLS 时的静默降级均被拒绝。集中式 WebSocket  Broker 不会提供授权或恰好一次语义。

桌面首次启动由 Runner 管理员或初始所有者完成本地引导；成员通过一次性邀请码设置独立身份。
密码使用 Argon2id 哈希，Runner 会话令牌只保存哈希，桌面令牌由 Rust 存入系统密钥库。
VPC 或非回连访问必须启用 TLS；外部 OIDC 与邮件邀请不属于 MVP。节点配对码 10 分钟内有效、
只能使用一次，绑定节点公钥、所有者批准公钥、团队、平台和最大能力。节点私钥不出节点，
所有者批准私钥不出桌面安全边界。配对后状态仅为“已连接、未贡献资源、安全状态未知”。

HTTP 层采用 Fastify + TypeBox：Fastify 原生执行 JSON Schema 验证，TypeBox 从同一 Schema
生成 TypeScript 类型并支持 OpenAPI/跨语言合同，避免运行时验证与文档分叉。NestJS 的模块与
DI 能力超出单写控制面需要，Express 需要额外组装验证和错误管道，Zod 则需要额外的 JSON
Schema 转换，因此不作为本计划的合同基线。

所有时间采用 RFC 3339 UTC，授权区间为 `[notBefore, expiresAt)`。OperationTicket 绑定节点、
任务、Grant 摘要、操作、参数、接收方、正文摘要、nonce 和期限；`(nodeId, requestId)`、nonce、
一次性使用标记、预算和撤销 tombstone 均持久化。相同请求的传输重试只查询既有状态，副作用
操作不得因重试创建第二次执行。

## D-05: 个人转共享与无扰接手

- **Decision**: 个人与共享任务复用同一 Workspace/Conversation/Run 领域模型，个人工作间允许
  `teamId` 为空。开启共享时保留原个人工作间和原 pi 会话为私人，把获准记录、上下文版本、
  证据与产物版本复制到新的共享工作间，并从获准内容创建共享 continuation session。
- **Rationale**: 仅修改原工作间 ACL 会把原 pi JSONL 中未选择的私人上下文一并暴露给共享
  模型会话。复制获准内容并保留原作者、时间和来源链接，既避免重建工作，也保证未选择内容
  不进入新的模型上下文。
- **Alternatives considered**: 直接共享完整原会话最简单但违反选择性共享；强行迁移正在执行
  的个人 Run 会混淆任务状态与可见范围，因此活动 Run 必须先完成或停止，再以获准上下文
  开始共享 Run。要求用户手工复制目标、文件和决定则违背自然转化目标，也不采用。

无扰接手使用独立 PreparationSession 和独立只读执行上下文，绝不向主会话发送 prompt、
steer 或 followUp。默认无工具；检索只能调用按接收者 Principal 过滤的服务端只读查询。
回答携带来源 ID、`asOfRevision` 和记录时间，服务端只接受实际提供给模型的来源 ID。
未知、推测和权限不足分别呈现。私人问答不进入公共 DomainEvent、产品分析或默认档案；
发布澄清是新建人工确认内容。接受交接只原子更新操作者 epoch，不替换主会话或重启 Run。

## D-06: 事件、可靠性、性能与备份

- **Decision**: SQLite 保存产品权限、审批、任务、时间线和审计权威状态；pi JSONL 只用于
  重建模型上下文；不可变对象保存文件字节。领域状态、审计、幂等响应和 Outbox 同事务提交。
  已提交事件使用 `workspaceId + sequence`，瞬时输出 delta 使用 `runId + offset` 并按
  50–100ms 合并，最终权威消息落库后替代 delta。
- **Rationale**: 低延迟 token 流与可恢复审计不是同一数据。分离两类事件可避免每 token 一次
  数据库事务，同时确保断线重放只使用已提交且仍有权查看的内容。对象采用“临时文件、fsync、
  校验、原子改名、元数据提交”，孤儿对象延迟清理，缺失对象必须显式标记。
- **Alternatives considered**: 内存事件总线无法承受重启；将 SSE 或 WebSocket 当可靠队列会
  丢失提交语义；每 token 持久化会放大写锁；完整 Event Sourcing/CQRS 超出当前需要。简单
  并发复制 SQLite、WAL、工作目录和 pi 文件不能形成一致备份，不能作为上线方案。

`WorkspaceControl` 单行保存 `operatorEpoch`、`activeRunId` 和 `revision`，配合活动状态 Run
的部分唯一约束。开始、纠偏、停止、接管和审批消费均在短事务中比较并更新，再做外部派发。
备份首发提供经过验证的冷备份：暂停新命令、quiesce worker、记录最后序号和 Run 状态、备份
整个数据卷或一致快照、生成应用/schema/对象清单与校验 manifest、加密并在空主机恢复演练。
在线备份只有在使用 SQLite Online Backup 或 `VACUUM INTO`、对象保留和 manifest 对账后
才可声明支持。升级前强制备份；单实例 RPO/RTO 数值在发布评审中公开，不作无依据承诺。

## D-07: Federated Beta 安全设计

- **Decision**: Grant 由所有者批准密钥签名并由节点持久化；每次访问在节点重新验证三级
  开关、所有者 Grant、OperationTicket、节点状态、任务/目的/资源/操作/接收方/期限、严格
  策略和预算。协调方只能提出建议，不能铸造本地许可。所有副作用在启动前持久化 intent 和
  execution ID，已派发但无确定结果时进入 `outcome_unknown`，不得自动重放。
- **Rationale**: 服务器认证或中央批准不能替代资源所有者，本地持久撤销墓碑和去重记录才能
  防止重启、重放与旧消息复活权限。显式日志与对账承认跨数据库、进程和外部系统不存在全局
  原子事务，不承诺“恰好一次”或“可回滚一切”。
- **Alternatives considered**: 仅在 Runner 检查 Grant、把证书当资源能力、通用 bearer
  capability、直接远程写回和失败自动重试均违反宪法，明确拒绝。

快照以节点私有存储中的不可变副本为读取对象，远程请求只能使用 `snapshotId + entryId`。
创建时使用相对目录句柄和禁止跟随链接的安全遍历，默认拒绝符号链接、非普通文件、跨挂载点
及未单独确认的多硬链接；打开后核对类型和摘要，覆盖检查到打开之间的替换竞争。新增目录和
实时变化不进入旧快照。中央缓存、离线访问、路径结构可见性均是独立许可。

固定工具在节点本地注册并绑定模板与可执行程序/镜像摘要，不使用 Shell，不拼接命令，采用
空环境加白名单、专用低权限身份、只读输入、独立输出目录、只读根文件系统、默认无网络、
进程组超时和 CPU/内存/进程/输出预算。模板语义变化必须生成新摘要并重新授权。

所有原文、摘要、工具输出、模型回答、日志、错误、文件名、Artifact 与 Patch 都携带逐维度
安全标签：可见成员、模型接收方和目标域取交集，公共可见取最严格禁止，缓存期限取最早，
用途必须符合所有来源。任何转换不自动降级；降级需要所有受影响所有者的显式复核和新版本。
Patch 只绑定基础快照和逐文件摘要，应用是独立授权；冲突不自动覆盖或三方合并，多文件应用
不承诺全局原子性。

节点回执采用追加式节点序号、前序摘要和节点签名，操作前后分别记录；补交按节点与事件 ID
幂等，序号缺口显式标记。签名只能证明来源，不能证明恶意节点报告真实或不存在侧信道。

## D-08: 验证与发布门禁

- **Decision**: 测试分为纯领域单元、真实 SQLite 并发、API/事件合同、pi 适配合同、桌面
  E2E、Runner/节点真实执行边界、故障注入和发布合规；默认使用 faux model provider 与受控
  模型端点，不调用付费或真实用户服务。每个拒绝测试必须有相同请求的合法正控制。
- **Rationale**: 宪法要求验证实际执行边界。文件哈希、进程轨迹、网络载荷、外部副作用计数、
  其他成员视图和重启后的持久状态能够证伪“界面显示拒绝但真实出口仍可用”的假阳性。
- **Alternatives considered**: 只做 UI、mock 权限矩阵或路径规范化单测不足以证明安全；
  默认调用真实模型成本高且不可重复；用一次演示或覆盖率替代 UAT 不能作为发布证据。

最小高风险预言为 TO-01～TO-13：审批前零副作用、批准摘要变化、并发开始/接管、丢响应重试、
私人接手隔离、证据失效、本地 Grant 终裁、撤销/到期/重启/重放、链接 TOCTOU、模型与跨域
许可交叉、派生标签严格交集、未知结果不重复、Stable/Beta 隔离。联邦另执行 T01～T20，覆盖
配对、恶意协调方、缓存、侧信道、固定工具、预算、Patch、回执、恶意节点和紧急停用。
Stable UAT-01～31 与 Beta UAT-32～60 分别作为发布套件；Beta GA 前另做独立威胁模型评审
和第三方安全测试。性能验收必须包含长历史、5 个 SSE 客户端、5 个节点、20 个活动 Grant
和慢节点，而不是只测空工作间。

## D-09: 开源、设计与发布合规

- **Decision**: 自有代码沿用仓库 MIT；pi、Tauri、React、Node.js、Rust crates、SQLite、基础
  镜像及所有直接/间接资产在引入时登记名称、版本、来源、许可证、版权、用途和修改情况。
  每次发布生成 SBOM 或等效清单并检查镜像内容、通知、秘密和示例资产。
- **Rationale**: MIT 不自动覆盖第三方内容、品牌或模型，也不消除保留通知义务。提前登记
  避免发布前集中补账，确保 Docker 打包不会绕过第三方许可。
- **Alternatives considered**: fork 或复制 PI-Desktop 代码、样式、图标、截图、文案、动画或
  识别性视觉组合会引入 LGPL-3.0 与原创性风险，MVP 明确排除。只保留一个最终依赖列表而
  不记录设计来源和修改情况不足以满足 PRD 合规门禁。

## D-10: pi Agent 接入与会话语义

- **Decision**: 在隔离的执行 worker 内通过 `@earendil-works/pi-coding-agent` SDK 建立唯一的
  Execution Adapter，按工作间显式恢复指定会话；领域模型和 REST 合同不得泄漏 pi 类型。
  `prompt` 仅用于明确开始或空闲后的输入，运行中必须分别调用 `steer()` 或 `followUp()`。
  `subscribe` 先于扩展绑定和执行命令注册，listener 只同步写入自有有序通道且不得抛错；
  流式 delta 只用于显示，完成消息和 settled 状态才用于权威投影。首版在 prompt 前设置
  `session.agent.toolExecution = "sequential"`，并关闭 prompt template 自动展开。
- **Rationale**: SDK 与 TypeScript worker 同语言，直接提供会话、事件和扩展 Hook，避免再
  维护一层 RPC 包装；worker 已提供进程/容器隔离，因此无需为隔离目的重复选择 RPC。
  pi 明确要求运行中输入选择纠偏或排队，与产品语义一致。
- **Alternatives considered**: pi RPC 适合非 TypeScript 客户端和独立进程协议，但当前会增加
  第二份命令、事件和错误映射；保留为未来替换适配器的选项。共享一个全局 `continueRecent()`
  会话可能恢复错误任务，明确禁止；直接改写 pi JSONL 或 `agent.state.messages` 作为业务
  状态也被拒绝。

会话恢复必须精确指定目标 `SessionManager`/会话入口，不能猜测最近会话。
`createAgentSession` 返回的 `extensionsResult.errors` 必须检查，审批扩展加载失败时禁止启动；
事件订阅、`bindExtensions()`、prompt 的顺序必须保持。停止前必须先调用
`clearQueue()` 并持久化返回的 steering/followUp，再调用 `abort()` 等待 idle；否则 pi 可能
在 abort 后继续排队消息，违反“停止后保留但不自动继续”。排队项恢复由用户逐项决定。

`tool_call` 在真实工具执行前触发并可返回 `{ block: true, reason }`；扩展错误默认阻断工具，
适合 fail-closed 审批。ApprovalRequest 绑定规范化动作摘要、task、attempt、工具调用和策略
版本；批准决定先持久化，返回前再次检查。审批服务必须自己实现 15 分钟 deadline、监听取消
signal 并拒绝晚到批准，不能只用 `Promise.race` 留下仍可生效的后台批准。pi 没有通用
`tool_call` 超时，永不 settle 的 handler 也会拖住 abort，因此该风险必须通过受控 handler、
执行隔离和故障测试处理。内容变化、停止、撤销、审批扩展加载失败或异常均阻断。

首版强制 sequential，避免默认并行模式的队头等待、早期批准过期和同文件竞争。并行工具合同
仍需保留对抗测试，只有已证明无副作用且无共享状态的工具才可在未来独立评审后开放并行。
`tool_execution_start` 只是预检，不代表已批准或副作用开始；受控工具包装器必须单独记录
execution-entered 与 final receipt。每个直接及嵌套调用都经过 Gate，未审查的项目扩展、MCP、
codemode、自动资源发现和用户命令保持关闭；pi Hook 仍只是工作流 Gate，外层容器和网络出口
必须防止被攻陷 worker 绕过。

`agent_end` 不等于业务验收或所有后续工作 settled；业务结果始终由用户确认。`message_end`
到达也不等于 pi 已完成磁盘 append，适配层必须通过对账和写通道 drain 确认持久化，不能
假设 listener 调用时数据已落盘。Runner 在工具已派发但结果不确定时标记
`needs_confirmation`，不根据 pi 的结束事件推断副作用成功或失败。pi 不恢复 live run、
内存队列、等待审批、流式增量或执行中工具，这些状态必须由 Unspool 保守恢复。

## Accepted Deviations Register

| 相对候选草图的偏差 | 接受依据 | 实施时必须兑现的验证 |
|---|---|---|
| 采用 Tauri/Rust 安全核心，但不捆绑桌面 Node sidecar | PRD 已要求本地 Runner 支持 Docker；统一 Docker 避免两套本地执行生命周期 | UAT-25、26、29：关闭 GUI 不影响任务，干净 Docker 主机可安装和恢复 |
| 执行隔离采用固定 worker 容器池，而不是由 API 动态创建容器 | 避免向 API 或 worker 暴露 Docker socket，同时保留明确的并发上限 | worker 绕过、跨工作区访问、空闲清理和资源预算测试 |
| Beta 采用 HTTPS 长轮询，而不是候选 A 的 WSS | 当前只有 5 节点验收规模，优先逐请求认证、代理兼容与恢复语义 | 节点断线、重放、背压、撤销和两种合法/非法正反对照 |
| 使用 Runner 模型网关，不承诺 Rust 代理全部模型协议 | Unspool 只需保证凭据不进入共享记录和 worker；无需为 Rust 代理增加未验证协议工作 | 支持矩阵内提供方必须通过流式、工具调用、取消、用量与错误合同测试，其余提供方排除 |
| 首发只承诺冷备份，在线备份后置 | 冷备份可用较短维护窗口换取明确一致性，避免虚假在线备份承诺 | 空主机恢复、对象/会话/manifest 对账和升级前备份验收 |
| GUI 首发不含 Linux 桌面，Runner/节点不含 ARM 或其他发行版 | 安全能力必须按平台验证，不能以可构建替代支持承诺 | 支持矩阵之外的安装与启用明确标为未验证或不兼容 |
