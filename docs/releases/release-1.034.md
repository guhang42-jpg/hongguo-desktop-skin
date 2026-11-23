# v1.034 — 默认最好那档画质、画面铺满不留黑边、全屏只看你自己

2026-11-23

三件都是"默认值"层面的改动，没有新按钮。

## 一、画质默认取最好那档

线路表原来的顺序是 `720P → 720P分段 → 540P → 480P → 360P → 1080P` —— 1080P 压在最后一格，正常情况下永远轮不到。翻成：

```js
var SRC_PLAN = [
  { q: "1080P", mode: "full",  tag: "超清·完整" },
  { q: "1080P", mode: "range", tag: "超清·分段" },
  { q: "720P",  mode: "full",  tag: "高清·完整" },
  { q: "540P",  mode: "full",  tag: "标清·完整" },
  { q: "480P",  mode: "full",  tag: "流畅·完整" },
  { q: "360P",  mode: "full",  tag: "省流·完整" }
];
```

没人手动挑过线路时从第 1 条开始试，能出画的最好那档就是默认。

**线路记忆键换成 `hg_src_v2`**：旧键 `hg_src_ok` 里存的是按"720P 打头"那张表算出来的索引（比如 `5` = 旧表的 1080P），表一翻就会指到 360P。所以另起一个键、默认 `0`，不误读老值。

设置页「默认线路」也按新档位重列：`最优·1080P / 高清·720P / 标清·540P / 省流·360P`（原来只有"高清完整 / 高清分段 / 标清完整"三项，且序号含义已经变了）。

## 二、画面默认铺满、不留黑边

`S.fit` 默认 `"contain"` → `"cover"`，并且把 `applyFit()` 挪到定义之后立刻调一次：

```js
/* 默认画面模式就是铺满裁剪：脚本在 body 末尾跑，这里先把 body 的模式类放上，
   否则第一集出画前 video 没有 object-fit，会露出一圈黑边 */
applyFit();
```

不补这一下的话，第一集出画那一刻 video 还没有 `object-fit`，会先闪一圈黑边再跳过去。

三种模式循环不变：`铺满裁剪（cover） → 拉伸铺满（fill） → 原比例（contain）`，点播放条那颗 `▤/▭` 随时切，切过就记 `fitManual`，之后全屏也不会再被强行改。

## 三、进播放页不再自己抢全屏

```js
/* 键换成 v2：老版本默认是"进播放页自动全屏"，这里改成默认不接管 */
var AUTO_FS = LS.get("hg_auto_fs_v2", 0) !== 0;
```

以前 `openViewer()` 里 220ms 后自己 `setFs(true)`；现在停在剧场面板，全屏只由你按 `⛶` / 双击画面 / `F`。设置页「进播放页直接全屏」开关还在、默认关，键换成 `hg_auto_fs_v2` —— 老版本存下过"开"的不会继续生效。

## 四、实测

`--jump <sid>~1~play --dbg --notray --noupd`：

```
官网页片源代理已起 127.0.0.1:52666
[ui] play fit=cover autoFs=0
[ui] stream req FAIL ep1 3068ms VIDEO_MODEL_EMPTY
[ui] web fallback ep1 vid=7694117511490440216 src=https://v11-hgweb.qznovelvod.com/…
[ui] metadata ok 360x640 dur=116.517732 canHEVC=probably
[ui] web fallback OK ep1 dur=116.52s
[ui] web fallback OK ep2 dur=89.23s
```

日志里**没有**「进入全屏 1920x1080」这一行，这就是这版要的效果；`fit=cover autoFs=0` 是播放时打的一行自检。

## 五、顺带降噪

片源代理在浏览器 seek / 换集 / 关页面时会被直接掐连接，`HttpWebRequest` 那头就会抛 `IOException`（"无法将数据写入传输连接：你的主机中的软件中止了一个已建立的连接"），以前被记成「媒体转发出错」。现在：

```csharp
catch (IOException) { }
catch (ObjectDisposedException) { }
catch (Exception ex) { Log("媒体转发出错：" + ex.Message); }
```

正常断连不再刷日志，真异常才记。

## 六、一句实话

"最好那档"是往 core 要 1080P —— core 这段时间对任何剧一律返空，实际出画的仍是官网兜底的 **360P（360×640）**。铺满裁剪会把这支 360P 放大到整块屏，画面会比"适应"糊一点、也更满；这是"无黑边"的代价，不是这版偷了画质。等 core 恢复，`1080P` 这条就是默认，不用再改代码。

## 七、文件

| 文件 | 字节 | SHA256 |
|---|---|---|
| `hongguo-skin-1.034-win64.zip`（轻量） | 6,992,166 | `23594F44E4A54331B172143CE51D5F3BFCD879F7B8B1FE608529C1B6242FD00D` |
| `hongguo-skin-1.034-win64-ai.zip`（语义版） | 25,417,161 | `E4366BDCA78B4991956B65E28B9393EBCF186E3224971C95F20FAB0297805C69` |

`红果短剧.exe` 273,920 B（只有代理里那两个 catch 变了，目录结构不变）。
