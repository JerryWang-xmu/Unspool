# Implementation Plan: Unspool 通用 Agent 与联邦式协作

**Branch**: `001-agent-federated-collaboration` | **Date**: 2026-11-21 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-agent-federated-collaboration/spec.md`

**Note**: 本文结束于 Phase 1 设计；实现任务分解由后续 `/speckit.tasks` 生成。

## Summary

以“个人通用 Agent 闭环优先、Stable 与 Federated Beta 分轨”为主线，采用 Tauri 2 + React
独立桌面 GUI、Node.js 模块化 Runner、SQLite 单写权威库和隔离执行 worker。pi coding-agent
SDK 仅存在于 Execution Adapter 中，Unspool 自己拥有任务、审批、操作权、上下文、证据、
时间线、恢复与业务验收语义。

Stable 先交付个人任务、选择性共享、多人协作、高风险审批、无扰接手、活证据、档案与 Docker
运维闭环。Beta 再以默认关闭的 Rust 贡献者节点提供快照、固定工具和 Patch；所有者批准密钥、
节点本地 Grant、快照和回执构成独立安全边界，协调方不能代替所有者授权。

交付顺序如下，后续任务必须保持每个纵切面可独立验证：

1. **S0 个人纵切面**：仅个人所需合同骨架、Docker Runner、faux model、个人任务、完整基线审批、共享默认 SecurityLabel、产物与恢复；团队、联邦合同和 contributor-node 不作为前置依赖。
2. **S1 共享纵切面**：Team/Membership、选择性共享、角色、三类输入、上下文版本、单操作者和多客户端一致性。
3. **S2 责任与证据**：团队审批扩展、停止队列、无扰接手、活证据、档案、指标和 Stable 发布门禁。
4. **B0 封闭只读 Beta**：独立完成节点配对、快照、Grant、外发/可见性、回执、撤销与 Stable 隔离，并单独通过 QS-07–QS-08 和只读发布门禁。
5. **B1 公开 Beta**：在 B0 验收后增加固定工具、预算、Patch、跨域 Artifact、恶意节点与第三方安全验证，单独通过 QS-09–QS-10 和公开发布门禁。
6. **P1 完整度**：提醒、模板和跨任务统计在 P0 闭环后补充，不阻塞首个 Stable 版本。

## Technical Context

**Language/Version**: TypeScript 7.0、Node.js 24 Maintenance LTS；Rust stable 固定工具链；
Tauri 2/React 桌面端与 Node.js/Rust 共享版本化 JSON 合同。

**Primary Dependencies**: Tauri 2、React、Fastify、TypeBox、
`@earendil-works/pi-coding-agent` 1.6.0、SQLite 客户端、Rust `rusqlite`/Ed25519 组件。
所有直接依赖精确锁版并进入第三方清单。

**Storage**: Runner 单写 SQLite WAL（权威业务、审计、幂等与 Outbox）＋内容寻址文件对象＋
pi JSONL 会话；共享基础层提供默认 SecurityLabel，Stable 产物不依赖 Beta；贡献者节点使用
独立本地 SQLite 保存 Grant、撤销墓碑、预算、去重和回执。

**Testing**: Vitest、fast-check、Playwright/Tauri E2E、OpenAPI/事件合同测试、真实 SQLite
并发测试、Rust `cargo test`/属性测试、Docker Compose 集成、故障注入与受控副作用端点。
默认使用 faux provider，不调用真实付费模型。

**Target Platform**: Stable GUI 为 Windows 11 x64、macOS 14+ Apple Silicon；Runner 和贡献者
节点为 Ubuntu 24.04 LTS x86_64、Docker Engine 27+、Compose v2。其他平台明确未验证。

**Project Type**: 独立桌面应用＋本地/VPC 自托管 Runner＋隔离执行 worker＋可选贡献者节点；
单协调实例，无公共云执行依赖。

**Performance Goals**: 常用概览 p95 ≤ 3 秒，普通界面反馈 p95 ≤ 1 秒，Agent 新输出正常网络
p95 ≤ 1 秒；至少 5 个客户端关键状态一致；Beta 为每工作间 5 个节点、20 个活动 Grant。

**Constraints**: 单工作间单操作者/单活动 Run；批准前目标零副作用；首版顺序工具执行；
Runner/API/worker 无宿主 Docker socket；模型长期凭据仅在模型网关；节点仅出站 mTLS HTTPS
长轮询；OperationTicket ≤ 60 秒；任意 Shell、默认直接写回、透明统一文件系统均禁止；
撤销/过期/耗尽/重启后权限不得复活；未知副作用不得自动重放；Stable 不依赖 Beta。

**Scale/Scope**: 2–20 人专业团队、至少 5 个试点团队；默认上传单文件 20MB；长历史分段加载；
个人并行任务受固定 worker 池和资源预算限制；首版单协调实例、冷备份和短维护窗口升级，
不承诺多活或零停机升级。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Phase 0 前评估

| 宪法门禁 | 结论 | 设计响应 |
|---|---|---|
| I. 通用 Agent 闭环优先 | PASS | S0 在无团队、无 Beta 条件下完成真实个人任务；个人和共享复用执行语义。 |
| II. 最小权限与本地授权终裁 | PASS | 所有者批准密钥、节点本地 Grant、逐请求票据、严格策略交集和真实执行点复核。 |
| III. 人类控制与明确责任 | PASS | 单操作者/单 Run 事务、独立审批、人工业务确认、显式交接和完整 Attribution。 |
| IV. 证据、署名与诚实状态 | PASS | 不可变来源版本、追加式事件/回执、缺失与未知一等状态，不以 pi 结束事件推断业务结果。 |
| V. 独立验证与分轨交付 | PASS | Stable/Beta 独立开关、合同、UAT、发布与回滚；真实执行边界和正反对照验证。 |
| 安全、隐私与合规约束 | PASS | 默认拒绝、分析仅元数据、私人问答隔离、MIT/第三方清单、PI-Desktop 仅抽象参考。 |
| 交付流程与质量门禁 | PASS | 先定义可观察结果，再实现；审批、撤销、传播、幂等和恢复均在实际边界验证。 |

**Phase 0 Gate Result**: PASS，无需要豁免的违规项；研究决策见 [research.md](research.md)。

### Phase 1 后复核

| 设计产物 | 复核结果 |
|---|---|
| [data-model.md](data-model.md) | PASS：个人/共享统一但私人隔离；操作权、Run、审批、证据、Grant、回执与未知状态均有明确约束和状态机。 |
| [contracts/](contracts/README.md) | PASS：命令幂等、版本、动作摘要、可见性、错误脱敏、SSE 重放、节点本地终裁和 worker 执行栅栏均有外部合同。 |
| [quickstart.md](quickstart.md) | PASS：Stable UAT-01～31、Beta UAT-32～60、TO/T 对抗预言、性能、恢复和合规均有可运行验收入口与正控制。 |
| Stable/Beta 分轨 | PASS：B0/B1 失败只阻断 Beta；Beta 停用不删除数据、不影响 Stable 与合法导出。 |
| 复杂性与范围 | PASS：未引入多活、Broker、Kubernetes、完整 CQRS/Event Sourcing 或双生产数据库。 |

**Phase 1 Gate Result**: PASS，无需修改宪法或登记豁免。

**2026-11-22 修订**：个人基础层不再前置 Team、Membership、DataRights/RecipientRules 或
contributor-node；最小默认 SecurityLabel 前移到共享基础层。execution-worker 主循环和完整基线
审批前移至 US1，US3 仅保留团队与对抗扩展。B0/B1 改为独立验收和独立发布门禁。

## Project Structure

### Documentation (this feature)

```text
specs/001-agent-federated-collaboration/
├── spec.md
├── plan.md              # 本文件
├── research.md          # Phase 0 决策、替代方案与偏差登记
├── data-model.md        # Phase 1 实体、验证与状态机
├── quickstart.md        # 可运行 UAT/安全/性能验证指南
├── uat-catalog.md       # 每个 UAT/TO/T 的独立执行、预期与证据目录
├── checklists/
│   └── requirements.md
├── contracts/
│   ├── README.md
│   ├── runner-api.openapi.yaml
│   ├── realtime-events.md
│   ├── worker-protocol.md
│   └── federation-protocol.md
└── tasks.md             # 仅由后续 /speckit.tasks 创建，本次不存在
```

### Source Code (planned repository root)

```text
apps/
├── desktop/                 # Tauri shell、React renderer、原创 UI 与桌面 E2E
├── runner-api/              # 身份、工作间、协作、审批、证据、查询与 Outbox
├── execution-worker/        # 固定池 pi SDK worker、ApprovalGate 与事件投影
├── model-gateway/           # 模型凭据、外发策略、流式协议与用量
└── contributor-node/        # Beta Rust 本地授权、快照、工具、Patch 与回执

packages/
├── contracts/               # 版本化 DTO、JSON Schema、OpenAPI/事件生成与兼容检查
├── domain/                  # 纯实体、状态机、权限/证据/指标规则
├── pi-adapter/              # 唯一了解 pi SDK 的包；顺序执行、队列、审批与恢复
├── persistence/             # SQLite 事务、迁移、对象清单、备份与对账
├── security/                # 摘要、签名、标签、脱敏与共享密码学测试向量
├── rust-security-core/      # 桌面签名与节点共用的 Rust 安全核心
└── test-support/            # faux provider、spy tool、固定时钟、夹具与副作用端点

deploy/
├── docker/                  # Runner、worker、模型网关、节点与验证 Compose
└── support-matrix/          # 平台、协议、备份、威胁模型和发布说明

tests/
├── contract/                # API、事件、worker、节点和跨语言合同
├── integration/             # SQLite、pi、文件、网络、恢复与权限边界
├── e2e/                     # 多 GUI Stable/Beta 用户旅程
├── security/                # 越权、注入、TOCTOU、重放、恶意节点与故障注入
└── performance/             # 长历史、5 客户端、5 节点、20 Grant 与慢节点
```

**Structure Decision**: 采用单一仓库的模块化产品核心，而不是按业务微服务拆分。
`runner-api` 是单写控制面；`execution-worker` 和 `model-gateway` 是安全隔离部署单元，不拥有
独立业务真相。`packages/domain` 不依赖 pi、Tauri、Fastify 或具体存储；pi 类型限制在
`packages/pi-adapter`；节点本地授权限制在 Rust 安全核心。测试目录按实际执行边界组织，
与 [quickstart.md](quickstart.md) 的验证入口一一对应。

## Complexity Tracking

无宪法违规或豁免。混合 TypeScript/Rust、固定 worker 池和冷备份属于经替代方案比较的
安全与运维取舍，不构成原则偏离；决策及实施验证义务记录于
[research.md](research.md#accepted-deviations-register)。

## Artifact Traceability

- 技术选择、运行时、支持矩阵、通信与替代方案：`research.md` D-01～D-04、D-10。
- 共享转换、无扰接手、事件/备份、联邦安全和验证：`research.md` D-05～D-09。
- FR-001～052：`data-model.md` 第 2～7、9～10 节，Runner API、实时事件与 worker 合同。
- FR-053～075：`data-model.md` 第 8 节、联邦协议和 Beta 验证场景。
- FR-076～081：worker 恢复矩阵、标准错误、备份/迁移模型、发布与合规验证。
- SC-001～014：`quickstart.md` 的个人、协作、审批、交接、证据、Beta、性能与发布门禁。
