# 怎么自己编译

## 1. 前端（ui/）

`ui/index.html` + `ui/app.js` 是纯静态的，改完直接重启 exe 就生效（exe 从磁盘读 `ui/`，没有内嵌）。

改完先自检语法：

```powershell
& $node --check .\ui\app.js
```

## 2. 外壳（build/App.cs）

依赖 WebView2 的 .NET Framework 程序集（`Microsoft.Web.WebView2.Core.dll`、`.WinForms.dll`）和一个 `WebView2Loader.dll`，放在 exe 同级。

```powershell
$csc = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe"
& $csc /nologo /target:winexe /platform:x64 /optimize+ `
  /win32icon:.\build\icon\hongguo.ico `
  /out:.\红果短剧.exe `
  /r:.\build\pkg\lib\net462\Microsoft.Web.WebView2.Core.dll `
  /r:.\build\pkg\lib\net462\Microsoft.Web.WebView2.WinForms.dll `
  .\build\App.cs
```

`build/pkg/` 是 NuGet 解出来的 WebView2 SDK（版本 1.0.4314.35），仓库里没有提交，需要自己拉：

```powershell
Invoke-WebRequest "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.4314.35" -OutFile wv2.zip
Expand-Archive wv2.zip -DestinationPath .\build\pkg
```

## 3. 图标

```powershell
.\build\make-icon.ps1 -In .\build\icon\raw.png -OutDir .\build\icon
```

会产出一套 16/24/32/48/64/128/256 的 `hongguo.ico` 和 256 的 `app-256.png`。

## 4. 调试

- `红果短剧.exe --demo` 自动开第一部剧第 1 集
- 组合参数：`?demo=1&fs=1&mini=1&mine=1`
- 日志在 exe 同级的 `app.log`，核心进程端口也从这里读（`[core] listening on 127.0.0.1:<port>`）
- 抓窗截图：`.\build\capture.ps1 -ProcId <pid> -Out shot.png`
