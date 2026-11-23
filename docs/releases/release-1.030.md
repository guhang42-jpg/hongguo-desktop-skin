# v1.030 — Windows 7 起不来的真正原因，加启动门槛与失败诊断

2026-11-23

有人在 Windows 7 上装了这个皮肤版，弹的是老文案：

> 内置服务没有启动起来，无法继续。请查看目录里的 app.log。

拿到那台机器的 `app.log` 才看清原因。这版做两件事：把门槛说在装之前，把失败说到能定位。

---

## 一、Win7 上起不来的原因（可复现）

`core\hongguo-tv-core.exe` 是 **Go 1.25.14** 编译的二进制（符号里有 `go1.25.14`、`runtime.morestack`、`Go build ID`），只依赖 `kernel32.dll`。

用 `dumpbin /imports` 查静态导入表，47 个函数全是 Win7 时代就有的老 API（`GetQueuedCompletionStatusEx`、`CreateWaitableTimerExW`、`WerSetFlags`…），**没有** `CreateFile2`、`GetSystemTimePreciseAsFileTime`、`SetThreadDescription` 这类 Win8+ 专有函数。所以它不是加载期就死的那种「缺 DLL / 缺入口点」，而是一路进到 Go 运行时里才崩。

崩溃栈长这样，三次尝试一字不差：

```
Exception 0xc0000005 0x8 0x0 0x0
PC=0x0
runtime.asmstdcall(0x13f4826e0)
	runtime/sys_windows_amd64.s:76 +0x89 fp=0x29f900 sp=0x29f8e0 pc=0x13f4d11a9
rax     0x0
rip     0x0
```

`runtime.asmstdcall` 是 Go 在 Windows 上调用系统接口的桩函数，`rip 0x0` 表示它取了函数指针直接 `call` 过去，结果那个指针是空。对应到实现：Go 运行时用 `WaitOnAddress` / `WakeByAddressSingle`（信号量）和 `GetSystemTimePreciseAsFileTime` 这类接口，**这些是 Win8 才加进 kernel32 的**。Go 在 Win7 上 `GetProcAddress` 拿到 0，跳过去即 `0xC0000005`，退出码 2。

这条路没有修补空间：用户态伪造 `WaitOnAddress` 需要在内核层实现 futex 语义，放一个转发 DLL 是不成立的。官方口径也一致 —— Go 1.21 起最低要求 Windows 10。

第二道墙是界面内核：WebView2 在 Windows 7 上的支持已于 2023 年 1 月终止，最后能装的只有 109 版。

**结论：Windows 7 / 8 / 8.1 不在支持范围，换 Win10 或 11 的机器即可。**

---

## 二、这版改了什么

### 1. 启动先验系统，低于 Win10 直接说清

`ntdll!RtlGetVersion` 读真实版本号。之所以不用 `Environment.OSVersion`：未声明 manifest 的程序在 Win8 以上会一律谎报 `6.2`，等于白读。

低于 Win10 时弹一个说明框，讲清是 core 的运行时与界面内核不支持、补 DLL 补不出来、换台机器就行，然后退出。想自己折腾的人可以带 `--force` 启动，崩溃全文照旧写进 `app.log`。

### 2. 失败弹窗从「去看日志」改成诊断

原来只有一句「请查看目录里的 app.log」。现在给：

- 系统版本（`Windows 11 10.0` 这种真实值）
- core 退出码 + 人话翻译：`0xC0000135` 找不到依赖的 DLL、`0xC0000139` DLL 里缺入口点、`0xC000007B` 位数不对、`0xC0000142` DLL 初始化失败、`0xC000001D` 执行了这台 CPU 不认识的指令、`0xC0000409` 触发缓冲区检查、`0x80070005` 可能被杀毒软件拦住
- core 自己吐的最后 6 行（它说的话比我们猜的准）
- 「确定」直接用记事本打开 `app.log`，「取消」关掉

### 3. 认得出 Go 崩溃的指纹

日志里出现 `PC=0x0` 或 `runtime.asmstdcall`，就判定为「调了这台机器上没有的函数，跳到空地址」，不再把一屏寄存器丢给人看；低于 Win10 时再补一句病因。

### 4. 启动日志带系统信息

每次开窗口第一行写 `窗口已创建  Windows 11 10.0 build=26200`。以后任何一台机器上的问题，先看这一行。

### 5. 重试等待收紧（附带纠正一个误判）

core 退出事件本身就能立刻结束等待 —— 实测 Win7 上三次尝试共 4 秒（`17:44:55` → `17:44:59`），不是我原先估的四十多秒。所以这里只把单次上限从 15s 收到 9s、老系统只试一次 8s，为的是少写三份重复的崩溃块，不是为了省时间。

---

## 三、校验

- 外壳 exe `红果短剧.exe` 268,288 B（v1.029 是 263,168 B）
- `csc` 编译 exit 0，仅剩一条既有的 `CS4014`（那处 `Task.Run` 本就不需要 await）
- 本机（Win11）实测启动日志：`窗口已创建  Windows 11 10.0 build=26200` → `core 已启动 pid=27196` → `core 就绪: http://127.0.0.1:18797`，界面正常打开，说明 `RtlGetVersion` 的结构体与版本判定都对，正常机器不会被误拦
- 崩溃指纹识别用 1.028/1.029 时期那台 Win7 的 `app.log` 原文对照：`Exception 0xc0000005` + `PC=0x0` + `runtime.asmstdcall` 三条都在，会被判成「系统太旧导致调了不存在的函数」

包与哈希：

| 包 | 体积 | SHA-256 |
|---|---|---|
| `hongguo-skin-1.030-win64.zip`（轻量） | 6,979,169 B | `6367A32FD0449B7A09F925C494B08ACCACD537C5CE94957582D3063F31544B79` |
| `hongguo-skin-1.030-win64-ai.zip`（语义） | 25,403,856 B | `265138C84B959AF1298B562FC4F7C7F576E0F95890FD6CDCC0544048A5DEE827` |

---

## 四、已知边界

- **Windows 7 / 8 / 8.1 不支持**，原因见第一节，不是缺运行库也不是文件坏了
- Windows 10 上仍需 WebView2 运行时（Win10/11 一般随 Edge 自带；没有的话装 Evergreen 版即可）
- 换到别的机器播放只有声音、没画面，通常是那台缺 HEVC 解码器（片源 H.265），启动后顶上会出橙色提示，点「去安装」拉商店的免费 `HEVC Video Extensions`
- 语义版首次用前不会自动加载，打开 设置 · 本机 会静默把模型点着，加载完状态变「就绪」

---

## 五、安装

1. 下载对应包（不装模型选轻量版；要用小果听懂没剧名的说法选语义版）
2. 解压到任意目录，`红果短剧.exe` 与 `core\`、`ui\` 必须保持同层
3. 双击 `红果短剧.exe`
4. 建议先核对 SHA-256 与上表一致

只动外壳与版本号文件：`build\App.cs`、`ui\version.txt`、`ui\build.txt`。`core`、界面、语义模块一行未改。
