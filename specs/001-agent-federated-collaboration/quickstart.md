# Quickstart Validation Guide

本指南定义实现完成后的可运行验收入口。当前处于规划阶段，应用与测试命令尚未实现，本文未
声称任何场景已经通过。命令是后续实施必须提供的统一入口；用户旅程验收必须通过 GUI 完成，
CLI 仅用于测试环境准备和证据收集。

相关合同：[Runner API](contracts/runner-api.openapi.yaml)、[实时事件](contracts/realtime-events.md)、
[Worker](contracts/worker-protocol.md)、[联邦节点](contracts/federation-protocol.md)、
[数据模型](data-model.md)。**逐项执行目录见 [uat-catalog.md](uat-catalog.md)**；每个 UAT/TO/T
均可通过 `npm run validate:case -- --id <ID>` 独立执行并生成对应证据。

## 1. 支持环境与原则

### Stable

- Ubuntu 24.04 LTS x86_64，Docker Engine 27+ 与 Compose v2；
- Node.js 24 Maintenance LTS、npm，以及锁文件中的精确依赖；
- GUI 验证机为 Windows 11 x64 或 macOS 14+ Apple Silicon，另装对应 Tauri 构建依赖；
- 至少两个测试身份：操作者和独立审批人；五人一致性场景使用五个独立 GUI 配置。

### Federated Beta

- Stable 环境另加 Rust stable 工具链和两个 Ubuntu 24.04 x86_64 贡献者节点容器/主机；
- 至少两名不同资源所有者，以及一名工作间操作者/审批人；
- 每个节点有独立数据目录、密钥和可观察文件/进程/网络边界。

### 测试数据与安全

- 默认 `UNSPOOL_MODEL_PROVIDER=faux`，禁止真实模型密钥、付费 API、生产文件和用户会话。
- 使用固定文本、图片、代码、超长输出、20MB 边界文件、秘密 canary、符号链接和恶意节点夹具。
- 文件副作用以初始/最终 SHA-256 判断；外部副作用以受控端点精确计数；模型外发检查实际载荷。
- 每个拒绝场景都运行相同请求的合法正控制，避免“工具根本不能工作”被误判为权限正确。
- 证据写入 `artifacts/validation/<run-id>/`，包含版本、配置、日志、事件游标、哈希、请求计数、
  截图和缺失项。证据目录不得包含真实秘密。

## 2. 安装与启动

```bash
npm ci
npm run build
cp deploy/docker/env.example .env.validation
```

在 `.env.validation` 中至少设置：

```text
UNSPOOL_MODEL_PROVIDER=faux
UNSPOOL_BETA_ENABLED=false
UNSPOOL_DATA_DIR=./.tmp/validation/runner
UNSPOOL_BOOTSTRAP_CODE=<仅用于本次测试的一次性值>
UNSPOOL_FAKE_EXTERNAL_URL=http://fake-external:8080
UNSPOOL_FAKE_MODEL_URL=http://fake-model:8080
```

启动 Stable Runner、模型网关和两个隔离执行 worker：

```bash
docker compose --env-file .env.validation \
  -f deploy/docker/compose.yml \
  --profile validation up -d \
  runner-api model-gateway execution-worker-1 execution-worker-2 \
  fake-external fake-model

npm run validate:fixtures -- --profile stable
npm run dev:desktop
```

通过桌面首次引导创建初始所有者。除安装 Runner 和准备夹具外，以下用户行为不打开终端执行。

健康检查：

```bash
npm run validate:health -- --runner https://localhost:8443
```

预期：API、数据库、对象存储、模型网关、worker、schema 和 faux provider 均就绪；健康响应不含
凭据、绝对受限路径或秘密配置。任意必要组件未就绪时不能开始验收任务。

## 3. 静态、合同与底层验证

```bash
npm run check
npm run test:unit
npm run test:contracts
npm run test:integration
npm run validate:openapi -- \
  --contract specs/001-agent-federated-collaboration/contracts/runner-api.openapi.yaml
cargo test --workspace --locked
```

最低预期：

- TypeScript/Rust 检查、格式和依赖规则通过；
- OpenAPI 可解析，operationId 唯一，所有引用可解析，请求/响应经过 Schema 验证；
- SQLite 双开始只有一个活动 Run，并发接管只有一人成功，同幂等键不产生第二副作用；
- pi 使用精确会话恢复、sequential、禁用 prompt expansion；审批扩展加载失败时禁止启动；
- `clearQueue()` 后接 `abort()`，停止后的队列保持 withheld；
- `message_end` 不被误当磁盘已持久化，`tool_execution_start` 不被误当副作用开始；
- 所有测试使用 faux provider、spy tool 和可控时钟，不访问真实模型。

## 4. Stable 端到端场景

### QS-01：个人闭环、历史与 Docker 恢复

**覆盖**：UAT-25、26、29；SC-001、002。

1. 在全新 GUI 配置中不创建团队，选择本地 Runner 和 faux 模型；需要写工具的场景由本机
   所有者显式开启单人试用自我审批例外，并核对醒目记录。
2. 创建个人任务，要求生成 Markdown 报告与代码差异，调用只读工具和一个需审批的写工具；
   在审批中心查看完整语义参数和秘密引用，通过 GUI 批准一次写操作，并另拒绝一次确认无副作用。
3. 保存产物后关闭 GUI，停止并重新启动 Runner，再打开历史任务并继续。
4. 执行一次冷备份，在空数据目录恢复并核对 manifest。

**预期**：无团队配置也完成真实任务；GUI 拒绝分支的文件哈希不变且记录拒绝原因，批准分支仅执行一次并保留完整审批与单次 Permit 记录；历史、文件、产物和会话精确恢复；GUI 关闭不停止活动 Runner 任务；升级/恢复无静默清空，缺失对象和未决副作用显著标出。

### QS-02：选择性共享、协作输入与多客户端

**覆盖**：UAT-01～07、12、13、18、27、28、30；TO-03；SC-003、007、008。

1. 在个人任务中加入私人草稿、模拟凭据、正常历史、上下文、证据和产物，预览并只选择部分共享。
2. 邀请第二名成员为协作者、第三名成员为观察者；通过概览理解目标和关键决定。
3. 分别发送讨论、指令建议、直接指令，执行采纳和编辑后采纳；核对双方署名。
4. 两个客户端同时开始任务，第三人尝试越权读取，随后断线重连。
5. 扩展至五个独立 GUI，验证状态一致、个人草稿/滚动位置互不影响，仅查看不计有效协作。

**预期**：未选择内容和原私人 pi 会话不可见；讨论不触发 Agent，建议采纳后才执行；只有一个
活动 Run；无权限主体在搜索、时间线、错误和下载中均无法发现受限内容；断线先提示可能过期，
恢复后显示主要变化。

### QS-03：审批、停止、幂等与故障恢复

**覆盖**：UAT-10、11、14～16；TO-01、TO-02、TO-04、TO-12；SC-006、010。

夹具：文件 `F` 初始哈希固定，外部端点计数为 0，准备相同动作的合法批准正控制。

1. 未批准、拒绝、关闭页面、断网和推进到 15 分钟后分别尝试修改 `F` 和调用外部端点，
   并在默认配置下验证当前操作者不能自我审批。
2. 批准动作 `A0` 后改变正文、目标或接收方，重放原批准；再执行未变化的正控制。
3. 对已接受命令丢弃客户端响应，刷新并以相同幂等键重试。
4. 在 execution-entered 前后、结果返回前分别强杀 worker；停止含排队指令的任务。

**预期**：批准前文件哈希与外部计数不变，默认自我审批被拒绝；变化后旧批准失效；正控制只执行一次；重试恢复同一
逻辑结果；停止先保存并清空 pi 队列，排队项不自动继续；任何未知副作用均为待人工确认，
不会自动重放或变成确定成功/失败。

### QS-04：运行中交接与无扰准备

**覆盖**：UAT-08、09、22～24；TO-03、TO-05；SC-004、005。

1. 原操作者保持长任务运行并邀请接收者交接；接收者先进入准备模式。
2. 询问有权限来源和仅原操作者可见的秘密来源，再要求停止任务、审批和写文件。
3. 准备期间改变关键决策和阻塞，接收者刷新背景并发布一条编辑后的澄清。
4. 接收者接受交接；另测两人同时离线接管和负责人无理由强制接管。

**预期**：私人问答只对接收者可见并带来源和记录时间；越权问题拒答或标未知；主任务持续且
无准备阶段工具副作用；接受前提醒关键变化；交接只改变操作者，强制接管必须有理由且仅一人
成功；原操作者重连后不能直接控制。

### QS-05：活证据、完成门槛与档案

**覆盖**：UAT-17、19～21；TO-06；SC-006、009。

1. 两项结论、一个完成标准、一个产物和一个待审批动作共同引用同一来源。
2. 更新、撤销和标记失效该来源；另测来源到期和来源冲突。
3. 尝试标记任务完成，分别执行补证、部分完成和负责人例外；重新复核并导出档案。

**预期**：直接影响完整且同源只提醒一次；到期不是自动失效；系统不自动选冲突一方或撤销
外部动作；缺证不能无提示完成，例外保留风险且不计有效覆盖；档案可由通用工具阅读，产物与
清单对应，缺失和未知显著标注，导出行为留痕。

### QS-06：Stable 发布套件与合规

```bash
npm run validate:uat -- --suite stable
npm run validate:release -- --track stable
```

**覆盖**：UAT-01～31；SC-010、013。

预期：31 个 Stable UAT 全部通过，无未解决高严重度越权、数据泄露或审批绕过；发布物包含
MIT、第三方/SBOM 清单和必要通知；无秘密、用户数据、内部地址或未获许可的 PI-Desktop 代码、
资产与识别性视觉复刻。

## 5. Federated Beta 场景

启动两名所有者的隔离节点，保持 Stable 数据目录不变：

```bash
docker compose --env-file .env.validation \
  -f deploy/docker/compose.yml \
  --profile federation up -d contributor-node-a contributor-node-b

npm run validate:fixtures -- --profile federation
npm run validate:beta-gates -- --expect-disabled-by-default
```

### QS-07：默认关闭、配对与本地 Grant 终裁

**覆盖**：UAT-32～38、55、59、60；TO-07、TO-08、TO-13；T01～04、15、20。

1. 新团队、既有团队和升级部署均检查 Beta 默认状态及节点请求记录。
2. 配对两个节点，重放配对码、替换公钥和选择错误团队；确认成功后无资源可调用。
3. 缺少团队/工作间/节点/资源任一层时请求快照；再用中央管理员批准代替所有者。
4. 所有者分别批准、拒绝和缩权短期只读 Grant 后执行正控制；拒绝决定必须进入终态并留下签名回执，随后撤销/到期后重放原票据并重启各组件。
5. 所有者暂停和隔离节点，管理员尝试远程解除；执行 Beta 停用与版本升级。

**预期**：只有全部层级和具体 Grant 均有效时才读取；中央身份不能替代所有者；拒绝进入终态且不能复活；撤销/过期/耗尽/重启/重放均不复活权限；所有者可立即暂停隔离，他人不能解除；升级不扩权，Stable 始终
可用且合法导出不受影响。

### QS-08：快照、模型外发、成员可见与侧信道（B0）

**覆盖**：UAT-39～42、49～51、57；TO-09～11；T05～10、T18～19。

夹具：普通文件 `in`、范围外秘密、指向外部的符号链接、授权后新增目录、两个不同限制来源，
以及记录实际载荷的 faux model 和目标节点。

1. 正控制读取 `in`；随后测试绝对路径、`..`、链接、同前缀兄弟目录、新增目录和 TOCTOU 替换。
2. 只有读取 Grant 时尝试发送原文、摘要、错误、日志和文件名到模型或无权成员视图。
3. 分别授予模型外发和成员可见，验证另一接收方仍被拒绝；加入 A 节点诱导读取 B、向模型外发
   或写入 C 的注入内容，确认它们只形成新的 GrantProposal，并检查指定关键结论被关联标记为
   “可能受不可信内容影响、待复核”及跨模块复核事件。
4. 合并两个来源生成派生结果，尝试非所有者降级，再由全部相关所有者复核一个特定范围。
5. 制造回执断线补交、序号缺口和恶意节点虚假成功；从无权成员视图和分析中搜索 canary。

**预期**：范围外字节从未离开节点；快照版本固定；模型外发与成员可见许可能独立放行且不能互推；
派生标签逐维取最严格交集；提示注入只形成新权限请求，且指定结论及其复核事件可在证据视图中核对；
回执缺口和恶意结果不被描述为真实或完整；任何日志、错误、导出和分析均无越权秘密。
B0 阶段不得出现固定工具执行、Patch 应用或跨域 Artifact 传输。

```bash
npm run validate:release -- --track beta-b0
```

只有 QS-07～08 和 B0 独立用例全部通过后，才允许开始 B1 的固定工具、Patch 和跨域 Artifact 工作。

### QS-09：固定工具、预算、Patch、跨域 Artifact 与未知结果（B1）

**覆盖**：UAT-43～48、52；TO-12；T11～16。

1. 将经批准的 Artifact 从 A 域传输到 B 域，核对来源、目的、内容类型、数量、接收方、任务原因及双方/额外审批；未批准时检查零有效载荷。
2. 运行注册的测试工具正控制，再尝试任意 Shell、额外参数、命令串联、替换程序和模板摘要。
3. 检查两次运行的环境、挂载、网络和临时状态；耗尽 CPU/内存/进程/时间/输出预算。
4. 生成 Patch 时核对源文件零写入；制造基础版本冲突，未经独立授权尝试应用，再执行合法应用。
5. 在工具副作用前、后但回执前强杀节点/断网，重连并重放原请求。

**预期**：跨域 Artifact 只有在双方/额外审批完成且来源标签允许时才离开来源域；仅固定模板和声明参数可运行；无宿主凭据、环境、额外挂载、网络或 Docker socket；预算不自动提额且两次运行无残留；Patch 冲突和未授权应用被拒绝；合法应用生成新版本与证据；结果未知不自动重放，外部副作用计数始终为 0 或 1，绝不因系统重试变成 2。

### QS-10：联邦交接、专家退出与 Beta 发布

**覆盖**：UAT-53、54、56、58 及全部 UAT-32～60；SC-011、012、014。

1. 在只读和高风险 Grant 同时存在时交接，检查接收者权限与私人数据。
2. 让外部专家到期退出，核对身份认证、既有会话、历史工作间读取与操作全部终止，贡献署名保留。
3. 检查 Beta 北极星：单所有者或回执不完整不计入，两名不同所有者且 Grant、回执和结果确认
   完整才计入。
4. 导出工作间联邦档案，在不依赖产品界面的阅读器中核对节点、快照、Grant、执行版本、传播链，
   以及不可访问、已撤销、内容失效和回执缺口标记；同时验证所有者到期后身份、既有会话及
   历史工作间读取与操作均被终止，但贡献署名保留。

```bash
npm run validate:uat -- --suite beta
npm run validate:security -- --track federation
npm run validate:release -- --track beta-b1
```

预期：只读 Grant 仅按原期限和范围保留，高风险重新确认；专家身份、既有会话和历史工作间访问均终止、署名保留；联邦档案可独立阅读并包含全部节点/快照/Grant/执行/传播状态；29 个
Beta UAT 全部通过，本地拒绝经过独立验证，严重/高危问题清零；Stable 发布结果不受 Beta 失败
影响。GA 还需 PRD 规定的真实使用证据、独立威胁模型和第三方安全测试，本命令不能替代。

## 6. 性能、容量与长历史

```bash
npm run validate:performance -- \
  --clients 5 --nodes 5 --active-grants 20 \
  --history-events 100000 --long-output
```

**覆盖**：SC-008、011。

预期：正常网络与 Runner 可用时，常用概览 p95 不超过 3 秒，普通界面操作反馈 p95 不超过
1 秒，Agent 新输出 p95 不超过 1 秒；五个客户端关键状态一致。五个节点和 20 个活动 Grant
下，慢节点不阻塞无依赖步骤；跨节点不作统一 1 秒执行承诺。长历史分段加载，SSE 背压不会
导致主库写放大或事件丢失。

## 7. 完成与清理

每次验收生成 `summary.json` 和人类可读报告，至少列出：UAT/TO/T 映射、实际执行命令、版本、
退出码、外部副作用计数、文件哈希、网络载荷检查、缺失回执、跳过项和剩余风险。未执行、
环境不支持或仅有 UI 证据的项目必须标为 `BLOCKED` 或 `NOT RUN`，不得写成 `PASS`。

```bash
npm run validate:report -- --input artifacts/validation/<run-id>
npm run validate:clean -- --profile validation
```

`validate:clean` 只能删除专用测试目录、测试容器和测试密钥。不得在真实 Runner 数据目录上
使用该清理入口；历史证据与依法可导出的记录不得因安全回滚被删除。
