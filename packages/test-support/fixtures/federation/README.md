# B0 Federation Fixtures

本目录说明 `packages/test-support/src/federation/fixtures.ts` 提供的 B0 封闭只读 Beta 夹具。
夹具只覆盖所有者显式快照、`pathVisibility`、只读 Grant、OperationTicket、回执完整性与恶意节点
结果；不创建固定工具、Patch、跨域 Artifact、网络监听、真实凭据或真实签名。

## 安全声明

- 所有 ID、摘要、nonce、Grant 与回执签名均为合成占位值，不是真实 Ed25519 签名，也不是
  `packages/security` 的密码学测试向量。需要验证签名、JCS 或摘要合同的测试应使用安全包生成
  的真实测试向量，不应把这些值当作可通过验签的凭据。
- 所有 canary 都是随机的假标记，形如
  `UNSPOOL_TEST_CANARY_<ROLE>_<hex>_NOT_A_SECRET`。它们不是秘密，也不能用于生产。
- 夹具不访问网络，不读取宿主真实文件；临时目录默认创建在 `os.tmpdir()` 下，也可以通过
  `baseDir` 指定。
- 夹具模块目前不修改 `packages/test-support/src/index.ts`。包内测试可直接相对导入
  `../src/federation/fixtures.js`；是否从包根导出由后续集成任务决定。

## 使用方式

```ts
import { createDeterministicClock } from "../src/clock.js";
import { createB0FederationFixture } from "../src/federation/fixtures.js";

const clock = createDeterministicClock("2026-11-21T10:00:00.000Z");
const fixture = await createB0FederationFixture({ now: clock.now() });

try {
  // 使用 fixture.tree、fixture.snapshot、fixture.grants、fixture.tickets 等
} finally {
  await fixture.cleanup();
}
```

`cleanup()` 是幂等的。夹具创建失败时会先删除已经创建的临时目录，再抛出错误。
`now` 建议传入受控时钟；未传入时使用当前时间。Grant 与票据窗口全部相对 `now` 计算。

## 临时目录与显式快照树

每次创建都会生成独立的临时根目录：

```text
<root>/
├── snapshot/
│   ├── in/
│   │   ├── brief.md                    # 显式选中，普通文件，进入 Manifest
│   │   └── nested/example.ts           # 显式选中，普通文件，进入 Manifest
│   ├── not-selected/personal-note.txt  # 在快照根内但未被选中；canary
│   └── links/outside-canary            # 指向范围外 canary 的符号链接，不进入 Manifest
├── snapshot-evil/secret-canary.txt     # 同名前缀兄弟目录；canary
├── outside/secret-canary.txt           # 快照范围外；canary
└── outside/toctou-replacement.txt      # TOCTOU 替换内容；canary
```

`fixture.tree` 明确列出每个物化文件的角色、绝对路径、相对路径、大小和 SHA-256 摘要。
Manifest 只包含 `selected` 角色中的普通文件：

- `opaque_only`：默认视图，entry 只有 opaque `entryId`，不包含 `logicalPath`；
- `authorized_recipients`：在选中 entry 上增加 `logicalPath`；
- `owner_only`：同样保留 `logicalPath`，仅表示所有者本地视图。

三个 Manifest 共享同一组 entry、同一 `rootDigest` 和同一 `createdAt`，只用于
`pathVisibility` 过滤测试，不表示三次不同快照。`cachePolicy` 始终为
`centralCache=false`、`offlineRead=false`。Manifest 的 `state="sealed"` 是夹具内的固定版本
标记，具体生命周期由合同和节点实现拥有。

## 路径与 TOCTOU 探针

`fixture.pathProbes` 提供以下提交值，供节点在执行打开、读取或返回前拒绝：

| `kind` | 提交值 |
|---|---|
| `absolute_path` | 范围外 canary 的宿主绝对路径 |
| `parent_traversal` | `../outside/secret-canary.txt` |
| `nested_parent_traversal` | `in/../../outside/secret-canary.txt` |
| `backslash_parent_traversal` | `..\outside\secret-canary.txt` |
| `same_prefix_sibling` | `../snapshot-evil/secret-canary.txt` |
| `symlink` | `links/outside-canary` |

符号链接由夹具尽力创建；Windows 未开启开发者模式或当前用户没有权限时会失败。失败不会使
整个夹具创建失败，`fixture.symlink.created` 为 `false`，对应探针的 `available` 为 `false`，
并给出 `unavailableReason`。因环境不支持而跳过时必须记录 `BLOCKED` 或 `SKIP`，不能记为
`PASS`。任何 canary token 出现在结果、错误、日志、导出或分析中，都表示范围外字节发生泄漏。

`fixture.toctou` 是场景描述，不是已经执行的竞态：

1. 所有者把 `snapshot/in/brief.md` 放入显式 Manifest，节点生成封存的固定版本私有副本；
2. 测试核对 Manifest 摘要后，在节点打开实时路径前用 `outside/toctou-replacement.txt` 替换；
3. 节点必须继续读取封存副本，绝不能打开或返回替换内容。

夹具只提供目标、替换路径、步骤和不变量。真正的竞态编排、文件系统恢复和正控制属于
`tests/integration/us6/snapshots.test.ts` 等测试任务，本目录不提供测试。

## Grant 与 OperationTicket

`fixture.grants` 包含四个状态：

| 键 | `state` | 用途 |
|---|---|---|
| `active` | `active` | 有效期内的只读正控制 Grant |
| `expired` | `expired` | 已过期终态 Grant |
| `revoked` | `revoked` | 已撤销终态 Grant；票据时间窗仍可能有效 |
| `rejected` | `rejected` | 所有者拒绝的终态 Grant；票据为伪造/重放形状 |

所有 Grant 只允许 `snapshot.read`，接收方仅 `fixture` 中的 recipient，默认禁止模型外发、
成员外发、缓存、跨域传播和交接。`usageLimit=1`，`budget` 只描述只读上限，不表示固定工具或
B1 执行预算。`rejected`、`revoked`、`expired` 都是终态，任何批准或重放都不得使其复活。

`fixture.tickets` 包含四张票据：

- `valid`：绑定 `active` Grant，30 秒窗口；
- `expired`：绑定 `expired` Grant，票据时间窗曾位于 Grant 有效期内但现已过期；
- `revoked`：绑定 `revoked` Grant，但票据自身时间窗仍在有效范围内；
- `rejected`：绑定 `rejected` Grant，票据形状看似有效，用于验证“票据不是独立 bearer 权限”。

OperationTicket 不超过 60 秒，并且不能超过 Grant 期限。`revoked` 和 `rejected` 票据的时间窗
仍有效，正是为了证明节点必须在本地联合检查 Grant 状态、nonce、摘要和受众，而不能只验票据。

`B0_GRANT_DIGESTS` 是夹具生成的确定性标签摘要，不是对 Grant 做 JCS 后的合同摘要。票据中的
`grantDigest` 使用同一常量，以便测试构造“匹配”和“故意不匹配”的对照；不要用这些常量断言
真实密码学合同。Grant 的 `ownerSignature`、票据 `signature` 和回执 `nodeSignature` 同理，
均为占位字符串。

## 恶意节点结果与回执缺口

`fixture.receipts` 模拟连续序号中的缺口：

- `beforeGap`：序号 `1290`，`uploadState="accepted"`；
- `afterGap`：序号 `1294`，`uploadState="gap"`，前序摘要指向缺失的 `1293`；
- `gap`：未解决的 `ReceiptGap`，缺失区间为 `1291..1293`。

`fixture.maliciousNode` 包含：

- `forgedSuccess`：恶意节点声称成功，`claimedBytes` 明显超出真实快照内容且没有任何证据，
  `uploadState="accepted"`；
- `contradictory`：同一个 `requestId` / `executionId` 下，一张回执报告成功、另一张报告失败，
  两者均为 `accepted`，用于验证协调方不能替恶意节点选择“更可信”的结果。

`uploadState="accepted"` 在这里刻意只表示“接收投影已接受该来源记录并完成结构校验”，不表示
业务结果真实、内容完整或执行成功。夹具不生成真实签名，也不模拟节点被攻破后的其他节点
暴露；相关断言由恶意节点与隔离测试任务实现。

## 生命周期

- 每次测试都应创建独立夹具并在 `finally` 中调用 `cleanup()`；
- 不要在多个测试间复用同一临时目录，特别是 TOCTOU 场景会替换文件；
- 不应把临时目录、canary token 或占位签名写入持久证据；
- 若测试需要双所有者或配对夹具，应另行创建第二个节点/所有者夹具，不要把本夹具的合成
  节点身份当作已完成配对或已撤销证书。
