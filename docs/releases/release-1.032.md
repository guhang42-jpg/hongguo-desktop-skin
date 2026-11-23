# v1.032 — 官方取流断供，改走官网页兜底，点集数真的能播了

2026-11-23

这一版只干一件事：**把「点开剧集、点具体集数，什么都没发生」修通。** v1.031 只是把错误说清楚了，这版是有画面。

---

## 一、病根：core 那条接口被官方停服

现象是 `GET /api/v1/play/info` 对任意剧、任意集、任意画质，一律：

```json
{"error":"VIDEO_MODEL_EMPTY","preparation":{"code":"VIDEO_MODEL_EMPTY","stage":"video_model","http_status":200,"response_bytes":0,"elapsed_ms":51}}
```

`http_status: 200` + `response_bytes: 0` —— 上游不是报错，是**回了一个空包**。

排查到确证的过程：

- 从 core 二进制里提出上游模板：`novel/player/multi_video_model/v1/`、`novel/player/video_model/v1/`、`multi_video_model/player/v1`，以及备用域名 `api5-normal-hl/-lq.fqnovel.com` 的同路径。
- 裸测这些地址：`/v1/<vid>` → 404；`/v1/` 与 `?video_id=` / `?vid=` / `?item_id=`、POST JSON → **全部 200 + 0 字节**。服务端静默拒绝，不是接口下线。
- 把官方**最新桌面内核** `hongguo-desktop-0.2.179-windows-x64.zip` 解出来（`hongguo-tv-core.exe` 13,792,768 B，SHA256 `3C63E4DD…B929578`），指到同一份生产 data-dir 单独起在 18951 端口：`logged_in:true`、`series/detail` 正常，`play/info` **照样 502 `VIDEO_MODEL_EMPTY`**。

结论：**不是我们版本旧、不是登录态、不是网络**，是签名/设备指纹在服务端被静默拒了，皮肤版手里没有那套凭据，补不出来。

## 二、修法：走官网页给普通访问者的那条兜底

官网网页播放器还留着一条不要签名的入口：

```
POST https://hongguoduanju.com/api/video/protected/fallback-play-info
Content-Type: application/json
Referer: https://hongguoduanju.com/
{"item_id":"7694117511490440216"}
```

返回：

```json
{"main_url":"https://v11-hgweb.qznovelvod.com/…","url_expire":1795429xxx,"base_resp":{"StatusCode":0}}
```

`main_url` 实测 HEAD 200、`7,692,569 B`、`video/mp4`、Range 206、`ftyp isom iso2 avc1 mp41` —— H.264 + AAC 明文，完整一集。

两个坑：

1. **字段名必须是 `item_id`**。写 `{"vid":…}` 回 400 `public_fallback_unavailable`，很容易误判成"这条路走不通"。
2. **那台 CDN 校验 Referer**。带 `Referer: http://127.0.0.1:18797/skin/index.html` → **403**；带 `https://hongguoduanju.com/` 或不带 → 200。浏览器里 `<video src=…>` 没法自定义 Referer，所以直接把地址丢给 `<video>` 是 `MEDIA_ELEMENT_ERROR` / code=4。

于是外壳 `build/App.cs` 在本机起了一个只服务自己的小转发口：

- `GET /webplay?vid=<vid>` → 转发 `fallback-play-info`，把 `main_url` / `url_expire` 以 JSON 回给页面（带 `Access-Control-Allow-Origin: *`）；
- `GET /media?u=<encodeURIComponent(url)>` → 用 `HttpWebRequest` 取真实地址，补 `Referer: https://hongguoduanju.com/`，**原样透传 `Range`**，回 206/200 并带上 `Content-Type` / `Content-Length` / `Content-Range` / `Accept-Ranges`，65KB 缓冲流式写；
- `TcpListener` 绑 `127.0.0.1:0`，端口交系统分配（日志里的「官网页片源代理已起 127.0.0.1:53727」），不占固定口、不和其他程序打架。

顺带修掉 `.NET Framework 4.6.2` 的老毛病：默认只开 TLS 1.0/1.1，不补 `ServicePointManager.SecurityProtocol` 就直接报「未能创建 SSL/TLS 安全通道」。

前端 `ui/app.js`：`VIDEO_MODEL_*` / `VIDEO_TAB_*` / `FALLBACK_API_*` / `DEVICE_REGISTER` 命中时不再去"自动换源"（六条线路打的是同一台挂掉的上游），而是进官网兜底；地址按 vid 缓存、用前比对 `url_expire`（留 30 秒余量）；播放器右上多一颗「360P · 官网」，点一下重问 core。

## 三、实测

```
官网页片源代理已起 127.0.0.1:53727
stream req FAIL ep2 3480ms VIDEO_MODEL_EMPTY
web fallback ep2 vid=7694117538048789528 src=https://v26-hgweb.qznovelvod.com/…
metadata ok 360x640 dur=89.233991 canHEVC=probably
web fallback OK ep2 dur=89.23s
```

- 第 1 集：`vid=7694117511490440216` → `metadata ok 360x640 dur=116.517732` → `web fallback OK ep1 dur=116.52s`
- 第 2 集：`vid=7694117538048789528` → `dur=89.23s`

两支都是完整正片。

顺带排掉一个假源：`https://hongguoduanju.com/video/public/<vid>/360p.mp4` 对任意 vid 都 HEAD 200、也能 Range、约 1MB，但 `<video>` 报 `dur=10.06` —— **那是 SEO 页的 10 秒预告**，没有拿来当播放源。

## 四、这一版的边界

- 兜底只有 **360P**。`video_model` 那一系要签名，皮肤版算不出来；界面上的 720P/1080P 仍在，点了会重问 core，官方修好或 core 换凭据就自动回高清。
- core 每集仍要空转 3.5~4.8 秒才回空。所以第一次撞空后记一个 **8 分钟窗口**，窗口内换集直接走兜底、基本秒开；兜底自己失败就清掉窗口，下一集老老实实先问 core。
- 兜底也断的时候，浮层写「这一集拿不到片源」并给「↗ 打开官方网页」，不再无限转圈。
- 「一集连播一小时以上」的 `url_expire` 边界没有专门实测覆盖，只有过期即重取的逻辑。

## 五、文件

| 文件 | 字节 | SHA256 |
|---|---|---|
| `hongguo-skin-1.032-win64.zip`（轻量） | 6,991,080 | `3D61FA39177C8917AE242241688B72D51D6A84DEB8E1E2C2190B552ABF0EBD85` |
| `hongguo-skin-1.032-win64-ai.zip`（语义版） | 25,416,075 | `10E7CB2E3317A43A0BF3C29AFE2E764849EB8BAFD18637177F5FD03A3ECC3B3B` |

`红果短剧.exe` 273,920 B（新增片源代理；`build/App.cs` 同步）。

## 六、参考

- 社区同题记录：`jackotom/hongguo-drama` → `docs/issue-178-179-2026-11-23.md`（同一套 `fallback-play-info` 契约），`src/native/hongguo.js` 里有完整请求头与字段。
- `miaoxiaohu/hongguoTV` README：`multi_video_model/v1/` 已停服、`video_model/v1/` 参数必须是顶层 `video_id`；写死的设备指纹会被静默拉黑（表现就是 200 + 0 字节）。
