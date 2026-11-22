# Windows 本机运行与 win64 客户端

## 交付文件

- Runner 一键启动：`Start-Unspool-Runner.cmd`（仓库根目录）。
- 便携客户端：`release/windows-x64/Unspool-Client-win64.exe`。
- NSIS 安装包：`release/windows-x64/Unspool-Setup-win64.exe`。
- 校验值：`release/windows-x64/SHA256SUMS.txt`。

## 首次启动

1. 双击仓库根目录的 **`Start-Unspool-Runner.cmd`**。
   - 脚本自动寻找 Node.js 24 x64。
   - 首次缺少编译产物时，会使用现有依赖构建 Runner。
   - 默认监听 `http://127.0.0.1:8080/v1`。
   - 默认使用 faux model，不需要真实模型密钥或付费 API。
2. 保持 Runner 窗口开启。
3. 启动 **`Unspool-Client-win64.exe`**；或者先运行 **`Unspool-Setup-win64.exe`** 安装，再从开始菜单启动 Unspool。
4. 客户端右上角应显示 **Available**。

客户端需要 Windows WebView2。当前 Windows 通常已安装；若系统没有，请先安装 Microsoft Edge WebView2 Runtime。

## Runner 数据与连接

默认位置：

- 数据：`%LOCALAPPDATA%\Unspool\data`
- 连接配置：`%LOCALAPPDATA%\Unspool\runner-connection.json`

一键脚本会生成并复用随机的本机 Owner token。客户端通过 Tauri 命令读取连接配置；token 不会编译进 EXE，也不会显示在启动日志中。不要分享该配置文件。

如果先打开客户端时才没有连接配置，客户端会提示：先运行 Runner 一键脚本，再重启客户端。

## 自定义端口

在仓库根目录执行：

```powershell
.\Start-Unspool-Runner.cmd -Port 8085
```

脚本会更新连接配置。重启客户端后使用 `http://127.0.0.1:8085/v1`。

如果 Node 24 不在 PATH，可指定安装目录：

```powershell
$env:UNSPOOL_NODE_HOME = "C:\Tools\node-v24"
.\Start-Unspool-Runner.cmd
```

也可以给 CMD 传入 `-NodeHome "C:\Tools\node-v24"`。`-DataDir` 和 `-ConnectionFile` 可用于独立的验证环境。

## 停止与重置

- 在 Runner 窗口按 **Ctrl+C** 停止 Runner。
- 直接关闭客户端窗口即可退出客户端。
- 便携版客户端可直接删除；任务数据仍保留在上述数据目录。
- 只有在确定要清空本机任务历史时，才先停止 Runner，再删除 `%LOCALAPPDATA%\Unspool`。

## 构建与验证

win64 EXE 使用 `x86_64-pc-windows-msvc` target 构建。便携版已实际启动并连接独立验证 Runner，确认：

- PE machine 为 `0x8664`（x64）；
- 原生窗口显示 Runner Available；
- 本机任务列表能够读取；
- 验证 token 未嵌入 EXE；
- Node 24 类型检查、Biome、Rust 测试和 Clippy 通过。
