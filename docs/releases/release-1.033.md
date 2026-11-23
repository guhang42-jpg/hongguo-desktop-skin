# v1.033 — 「点具体集数没反应」的真因：格子从来没接过点击

2026-11-23

这一版修的是上一版没修到的地方。反馈很具体：**「播放」能播，点具体集数点了没反应。**

## 一、真因不是取流，是按钮压根没绑事件

`renderEpisodeGrid()` 建那排格子（1、2、3…）时写了什么：

```js
var b = document.createElement("button");
b.className = "ep" + (i === S.epIndex ? " on" : "");
b.textContent = String(i + 1);
b.dataset.i = i;
b.onmouseenter = function () { prefetchStream(S.detail, n); };   /* 只有悬停预取 */
eps.appendChild(b);
```

**没有 `onclick`，`#sEps` 上也没有任何 click 委托。** 所以不管 core 通不通、兜底通不通，点 2、3、4 集都不会有任何事发生。

「播放」能播，只是因为它自己有 `onclick = playEpisode(0)`：

```js
$("#sPlay").onclick = function () { playEpisode(0); };
```

这个洞跟取流失败是两件独立的事，只在反馈里被一起说成"点了没反应"：v1.032 把取流修通之后，从没接线的那排按钮才单独露出来 —— 播放按钮能出画，点集的格子却纹丝不动。

## 二、修法

`#sEps` 挂容器级委托，只绑一次：

```js
if (eps && !eps.dataset.picked) {
  eps.dataset.picked = "1";
  eps.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest(".ep") : null;
    if (!b || !eps.contains(b)) return;
    var n = parseInt(b.dataset.i, 10);
    if (!isNaN(n)) playEpisode(n);
  });
}
```

为什么用委托而不是逐个 `onclick`：`renderEpisodeGrid` 每次换段、每次切集都会把 `innerHTML` 清空重建（`eps.innerHTML = ""`），逐个绑的事件会随节点一起丢；委托挂在容器上不会。

另外 `playEpisode` 里那条静默分支也改了：

```js
/* 以前： */
if (!S.vids.length) { if (S.active) openDetail(S.active, 0); return; }
/* 现在： */
if (!S.vids.length) {
  toast("这一部还没取到视频号，重开一次详情再点");
  if (S.active) openDetail(S.active, 0);
  return;
}
```

以前点下去会重开一次详情页 —— 因为人已经站在详情页上，看起来就是"什么都没发生"。

## 三、实测：让程序自己去点那个格子

不靠人手点，加了个联调参数 `--jump <sid>~<集号>~pick`：打开详情页 → 等分集渲染出来 → 用 `querySelector('#sEps .ep[data-i="N"]').click()` 触发一次真实 DOM 点击（走的是和鼠标一样的事件路径）。

```
2026-11-23 19:35:18  官网页片源代理已起 127.0.0.1:61020
2026-11-23 19:35:26  stream req FAIL ep5 5301ms VIDEO_MODEL_EMPTY     ← 悬停预取
2026-11-23 19:35:27  stream req FAIL ep3 3878ms VIDEO_MODEL_EMPTY     ← 点击后正式取流
2026-11-23 19:35:27  web fallback ep3 vid=7694117502464314392 src=https://v26-hgweb.qznovelvod.com/…
2026-11-23 19:35:28  metadata ok 360x640 dur=62.368798 canHEVC=probably
2026-11-23 19:35:28  web fallback OK ep3 dur=62.37s
```

从「格子上的一次 click」到「第 3 集出画面」，整条链走通：委托命中 → `playEpisode(2)` → `openViewer()` → `loadStream()` → core 返空 → 官网兜底 → 出画 62.37 秒。

（`~pick` 只是联调开关，真机不带这个参数；`~play` 保留原样。）

## 四、这版没变的

- 取流仍然是 v1.032 那套：core 断供 → 官网 `fallback-play-info` → 本机 Referer 转发，只有 360P。
- 撞空后 8 分钟内换集直接走兜底，不再每集干等 core 3.5~4.8 秒。
- 版本号 `1.033`，exe 无改动（273,920 B）。

## 五、文件

| 文件 | 字节 | SHA256 |
|---|---|---|
| `hongguo-skin-1.033-win64.zip`（轻量） | 6,991,639 | `92B72834F7409054F97DB79B3FE86B73FFDFBE3999BD07210BD20342AC90EFE9` |
| `hongguo-skin-1.033-win64-ai.zip`（语义版） | 25,416,634 | `B59E5EA54BDF2595819260158C8F9BBFED56C7628C3B5129FD24865EC8069C20` |
