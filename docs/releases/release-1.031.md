# v1.031 — 「我的」页照官方形态补齐，播放失败说人话

2026-11-23

这一版两件事：把「我的」页按官方那两行的形态做齐（大字 tab + 筛选胶囊 + 视图切换 + 管理），以及把「点了没反应 / 只弹一串错误码」这两件最让人抓瞎的事讲清楚。

---

## 一、「我的」页：照官方那两行

官方「我的」页顶部是两行结构：一行大字 tab（作品 / 历史 / 收藏 / 点赞 / 预约，右端一颗放大镜），一行筛选胶囊（全部 / 已看完 / 未看完，右端是列表切换图标 + 竖分隔 + 管理）。这版把其中能对得上真数据的部分照做了：

- **追剧 / 收藏 两个 tab**，26px、未选 46% 灰、选中纯白加重；tab 行右端一颗 32px 圆形搜索钮（官方放大镜的位置），点开是本页输入框，按剧名边打边筛，`Esc` 收起。没做「作品 / 点赞 / 预约」三个 tab —— 本机 `library` 里只有 `last_played_at` / `favorite_at`，硬造三个空壳不如不做。
- **筛选胶囊**「全部 / 已看完 / 未看完」，选中态从原来的"橙细边 + 浅橙底"改成官方那种「橙字压半透明橙底、无边框」。右侧依次：计数、网格/列表视图切换（两颗线性图标）、竖分隔、「管理」。
- **「管理」默认是纯文字**（原来带一圈描边，像表单控件），进管理模式才变白底药丸、文字变「完成」。

「已看完」只用真数据判：条目自己 `completed` → 否则 `position/duration ≥ 96%` → 否则 `episode ≥ episode_count`（看到最后一集）。三种都是实际记录，不猜。

## 二、管理模式的批量动作按能力分级

- 收藏 tab：**取消收藏**，真的回写 core 的收藏位。
- 追剧 tab：**从本机隐藏**，只动这台机器的 localStorage，底部条上写明「云端记录还在」；隐藏后 chips 行多一个「恢复 N」，点了放回来。

core 那边删除类动作在外部调用里没能确认可用（`POST /api/v1/library` 从非 WebView2 同源页面外呼一律 400「账号已切换」），所以没有做「云端删除」——不摆做不了的按钮。

## 三、一千部不会一次全铺

原来网格硬切 60 部、列表全渲染，计数写着 996 却只能翻到前 60 张。现在默认 40 部，底部一颗「再看 40 部（还剩 N 部）」，点一次放一批；切 tab / 切筛选自动回到 40。

## 四、成就墙折叠成一行横滑

折叠态原来也要占 4 行（约 200px），加上档案卡把追剧列表压到屏幕最底下、只露一排卡片。现在折叠态横着排一行、可拖动查看，展开照样 45 项全铺，`28 / 45　还有 17 项未解锁` 的计数不变。

## 五、播放失败：从错误码到一句人话

core 的内部 stage 码直接甩在页面上等于没说。现在统一翻成「一句中文 + 原码」：

| core 返回 | 页面上现在写的 |
|---|---|
| `VIDEO_MODEL_EMPTY` | 官方片源这次返回了空内容 |
| `VIDEO_MODEL_HTTP` | 取片源的请求没通 |
| `VIDEO_MODEL_READ` | 取片源的响应读到一半断了 |
| `VIDEO_MODEL_JSON` | 取片源的响应看不懂（格式变了） |
| `VIDEO_MODEL_SIGN` | 片源签名校验没过 |
| `VIDEO_TAB_EMPTY` | 这一集的播放信息是空的 |
| `DEVICE_REGISTER_FAILED` | 设备注册没过，官方认不出这台机器 |
| `MEDIA_DECRYPT_FAILED` | 片源解密失败 |
| `FALLBACK_API_*` | 备用取流接口没通 / 读取失败 |

判定是上游返空时，浮层直接写明「所有线路和清晰度拿到的都是同一个空响应，是官方片源侧的问题，不是这台机器也不是登录态」，并多给一颗「↗ 打开官方网页」（外壳的链接白名单从只放 GitHub 扩到 GitHub + `hongguoduanju.com`）。

另外 `loadStream` 里原来有一句 `if (!vid) return;` —— 分集数据不全时点哪一集都像卡住。现在浮层和气泡都说清「这一集缺视频号，退回列表重开详情取全再试」。

---

## 实机核对（本轮）

```
GET /api/v1/play/info?series_id=…&vid=…&episode=1&content_type=1004
                     &quality=720P&mode=full&fallback=1
502 {"error":"VIDEO_MODEL_EMPTY","ok":false,
     "preparation":{"code":"VIDEO_MODEL_EMPTY","stage":"video_model",
                    "http_status":200,"response_bytes":0,"elapsed_ms":68},
     "stage":"video_model"}
```

同机其它接口全部正常，可以排除网络、登录与 core 版本：

```
GET /api/v1/status         200  service=hongguo-tv-core 0.2.177-737acc2…
GET /api/v1/account        200  logged_in=true  uid=3965266488459652
GET /api/v1/library        200  entries=1138
GET /api/v1/lists/recommend 200 items=6
GET /api/v1/lists/rank     200  items=…（32 KB）
GET /api/v1/series/detail  200  ep_count=211  vid_list=211  accessible=3（locked 208）
```

试过的组合都失败：`quality=720P/480P/1080P`、`mode=full/range`、`fallback=0/1`；换剧（`content_type=1` 的《铁血信使》75 集）同样 `VIDEO_MODEL_EMPTY`。`dist` 里 1.026 ~ 1.030 的 `hongguo-tv-core.exe` 是同一个二进制（`0.2.177-737acc217201586f83a440877d9f29c53fdd46be`），行为一致，不是某一版的回归。

**结论**：上游 `video_model` 这一跳回了 HTTP 200 但 body 为空。core 是 Go 二进制、没有源码，皮肤版改不了它内部这一跳；能做的就是把失败讲明白、并让官方网页顶上。等 core 更新或上游恢复。

---

## 下载

- 轻量版：`hongguo-skin-1.031-win64.zip`　6,985,196 B　`9587F25F4D9765CC9B8A4D209871D8D218737A506086EB9594F78CC71E0A0BF5`
- 语义版：`hongguo-skin-1.031-win64-ai.zip`　25,409,883 B　`D8DEF4690A426FBB1A0B83BF6EA145BB361EFE8C5C1D856F6CA38C2045323E5B`

解压后双击 `红果短剧.exe`。系统要求 Windows 10 及以上。
