# v1.035 — 画面默认原比例、全屏不抢；官方锁着的集直接在格子上标出来

2026-11-23

这一版两件事：画面默认值按你的口径改回来，以及把「点进去白等四秒才报取不到」的锁集问题在点之前就说清。

## 一、画面默认回到原比例

上一版（1.034）默认是「铺满裁剪」——不留黑边，但会把竖屏剧放大裁掉两侧。你改口「优先原比例」，所以：

```js
S.fit: "contain"        /* 原来是 "cover" */
```

同时把 1.034 里那段「进全屏就偷偷把 cover 填回去」的逻辑删掉：

```js
/* 不再在进入全屏时替用户改画面比例：全屏只放大画面，不重设裁剪方式 */
```

`setMini(false)` 的兜底也从 `cover` 改回 `contain`。设置页那一行的标签统一成「原比例 / 铺满」，文案写「默认按哪种方式铺（原比例最稳）」。

进全屏仍然不接管（`AUTO_FS` 默认 0，键 `hg_auto_fs_v2`），全屏只由你按 `⛶` / 双击 / `F`。全屏里想铺满，点播放条那颗循环键切成「铺满」即可，切过就记 `fitManual`，之后不会被改回去。

## 二、官方锁着的集，点之前就告诉你了

这是这次新加的。长剧靠后的集数点开会返回：

```
取不到播放源：官方片源这次返回了空内容（VIDEO_MODEL_EMPTY）
core 的取流接口对所有剧都返空，官网页那条兜底接口也没给出这一集的片源（no_public_source）
```

不是接口坏了，是**官方按集数锁**。`series/detail` 里给得明明白白：

```json
{"episode_count": 48, "accessible_episode_cnt": 3,
 "episodes": [ {"index":1,"locked":false}, … {"index":4,"locked":true,"locked_inferred":true} ]}
```

所以这版把这件事提前到详情页：

1. `openDetail` 拿到 detail 后建三个态 —— `S.locked`（哪几集锁着）、`S.lockN`（锁了多少集）、`S.freeN`（本机免费到第几集，取 `accessible_episode_cnt`）；集数那一行直接写成「共 48 集 · 前 3 集公开」。
2. `renderEpisodeGrid()` 给锁着的格子打 `data-lock="1"` 和 `.locked`，样式上压暗、右上角一个小字「锁」。
3. `#sEps` 的 click 委托先看 `data-lock`：锁着的集不播，直接弹一句「第 4 集要官方解锁（这部剧本机免费到第 3 集），官方网页那边也不会公开给这一集」。
4. `playEpisode` 顶部同样拦一道 —— 连续播放/自动接集走到锁集就停住，不会跳过去变成一片黑。
5. 顺带把鼠标悬停的预取也跳过锁集：以前扫过去就开始排队拉流，等于白等 4 秒。
6. `giveUp()` 的文案改成锁集口径（不再写"大概是还没公开"），`PLAY_ERR` 补上 `no_public_source` → 「官网也没公开这一集的片源」。

## 三、实测

点第 4 集（锁着的那一集）：

```
[ui] ep4 locked 拦截 free=3
```

后面**没有** `stream req ep4`、也没有 `web fallback ep4` —— 不再空转，不再进播放页。

点第 2 集（正常集）：

```
[ui] play fit=contain autoFs=0
[ui] stream req FAIL ep2 3116ms VIDEO_MODEL_EMPTY
[ui] web fallback ep2 vid=7694117538048789528 src=https://v26-hgweb.qznovelvod.com/…
[ui] metadata ok 360x640 dur=89.233991 canHEVC=probably
[ui] web fallback OK ep2 dur=89.23s
```

`fit=contain` 说明默认原比例生效；播放本身没受影响。

## 四、一句实话

锁不锁是 core 的 `locked` 字段（带 `locked_inferred` 标记，属推断值）。实测第 4 集确实是 `no_public_source`，和判定一致；但没逐集穷举。万一某一集判错了，现在的行为是"不给点"而不是"点了报错"——要强试得等 core 或者走官方网页。

## 五、文件

| 文件 | 字节 | SHA256 |
|---|---|---|
| `hongguo-skin-1.035-win64.zip`（轻量） | 6,992,872 | `1C9052957B7DAAACC1322A0D777B13141BC7949FEA0C209C177FDFA220C81890` |
| `hongguo-skin-1.035-win64-ai.zip`（语义版） | 25,417,559 | `539E5F5DA52823153684F9AB1A8B129FF8F54C8AC809D50A05C23ECA98061FB4` |

`红果短剧.exe` 273,920 B，目录结构不变（只改了 `ui\app.js`、`ui\index.html` 两个界面文件）。
