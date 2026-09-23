# local-ext: Windows ConPTY 本地 Shell

临时、可还原的扩展：让 Hadice 在 Windows 上本地终端可用。官方源码不永久改动。

## 为什么需要
官方 `backend/shell.go` 使用 `creack/pty`，在 Windows 上会报 `failed to start PTY: unsupported`。
本目录用 ConPTY 提供同名 API（`StartShell` 等），前端不用改。

## 一键应用并编译
```powershell
cd F:\techtool\hadice
powershell -ExecutionPolicy Bypass -File .\local-ext\build-after-apply.ps1
```

成功后会：
1. 备份并临时给 `backend\shell.go` 加上 `//go:build !windows`
2. 把本包的 `shell_windows.go` 拷到 `backend\`
3. `go get github.com/UserExistsError/conpty` 并编译 `bin\Hadice.exe`
4. 写入标记 `local-ext\.applied`

## 重新打上补丁（误跑 revert 之后）
源码被 revert 还原后，扩展仍在 local-ext/，按下面重新打补丁并编译即可（与首次相同）：
```powershell
cd F:\techtool\hadice
powershell -ExecutionPolicy Bypass -File .\local-ext\build-after-apply.ps1
```
成功标志：存在 local-ext\.applied，backend\shell.go 开头有 //go:build !windows，且存在 backend\shell_windows.go。
然后关掉旧进程，运行：
```powershell
Start-Process F:\techtool\hadice\bin\Hadice.exe
```

## 还原（revert）会发生什么
```powershell
powershell -ExecutionPolicy Bypass -File .\local-ext\revert.ps1
```

**会做：**
- 从 `local-ext\.backup` 还原官方 `backend\shell.go`
- 删除临时拷入的 `backend\shell_windows.go`
- 删除 `local-ext\.applied` 标记

**不会做：**
- **不会删除** 整个 `local-ext/`（源码、脚本、CHANGELOG 都还在）
- **不会自动删掉或重编译** 已生成的 `bin\Hadice.exe`  
  若之前用 apply 编过，磁盘上的 exe **仍是 ConPTY 版本**，直到你再编译一次（未 apply 时再编，会回到 creack/pty，本地 Shell 又会 unsupported）

误跑 `revert.ps1`：**没有丢扩展**，只是源码回到「未打补丁」状态。重新验证请再跑上面的 `build-after-apply.ps1`。

## 如何验证实现
1. 确认已 apply（存在 `local-ext\.applied`），且刚跑过 `build-after-apply.ps1` 成功。
2. 启动：`F:\techtool\hadice\bin\Hadice.exe`（关掉旧进程后再开，避免跑到旧 exe）。
3. 打开菜单里的 **终端调试**（或 hdc-shell / 本地终端页）。
4. 期望行为：
   - 出现 `cmd` 提示符（或类似命令行提示），**不再**出现 `failed to start PTY: unsupported`
   - 输入 `echo hello` / `dir` 有回显与输出
   - 拖动窗口改大小，终端行列大致跟着变（Resize）
   - 关标签 / 退出后进程结束（可用任务管理器确认无残留 cmd）
5. 对照日志：`F:\techtool\hadice\.agent-ops.log` 里应有 apply / build 成功记录。

可选命令行自检（apply 之后）：
```powershell
Select-String -Path backend\shell.go -Pattern "go:build" -SimpleMatch
Test-Path backend\shell_windows.go
Test-Path local-ext\.applied
```

## 官网/上游更新后
1. 保留本 `local-ext/` 目录
2. 再跑 `build-after-apply.ps1`
3. 按上面步骤冒烟测试

## apply 临时改动的文件
- `backend\shell.go` — 前置 `//go:build !windows`（有备份）
- `backend\shell_windows.go` — 由本包覆盖拷入（若原先有文件会备份）

前端不变（仍用原 `StartShell` / `WriteToShell` / `shell:stdout:` / `shell:exit:`）。

## 相关文件
- `src/backend/shell_windows.go` — ConPTY 实现
- `apply.ps1` / `revert.ps1` / `build-after-apply.ps1`
- `CHANGELOG.md`
- 操作日志：`F:\techtool\hadice\.agent-ops.log`
