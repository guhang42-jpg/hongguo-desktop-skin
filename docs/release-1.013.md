# 红果短剧・桌面皮肤版 v1.013 — 小果接了个本机脑子

小果以前只会认剧名、认关键字。这一版它多了一层「意思」：说「有没有那种开局很惨后来翻身的」，它能把《开局狂死，我靠送死绝境逆袭》挑出来 —— 全程不联网，不带常驻进程。

![](https://raw.githubusercontent.com/guhang42-jpg/hongguo-desktop-skin/main/docs/preview-sem.jpg)

## 两个包，你挑一个

| | 大小 | 差在哪 |
|---|---|---|
| `hongguo-skin-1.013-win64.zip` | 6.6 MB | 跟以前一模一样，字面搜不到就如实说没搜到 |
| `hongguo-skin-1.013-win64-ai.zip` | 24 MB | 多一个 `ui/ai/` 目录，小果会"按意思找剧" |

轻量版不是阉割版：它探测不到 `ui/ai/` 就直接不启动语义引擎，**不报错、不吃内存**，其余功能一字不差。

## 这 37.4 MB 花在哪

```
ui/ai/model.onnx                    23.9 MB   bge-small-zh-v1.5 int8（512 维、4 层）
ui/ai/ort-wasm-simd-threaded.wasm   11.8 MB   onnxruntime-web 1.23 的 SIMD 运行时
ui/ai/vectors.bin                    1.1 MB   1130 部剧 × 512 维，float16
ui/ai/vocab.txt                      0.1 MB   从 tokenizer.json 重建的词表
ui/ai/index.json                     0.1 MB   sid / 剧名 / 集数
ui/ai/ort.min.js                     0.35 MB  运行时本体
ui/ai/bge-tok.js                     3.5 KB   自研 WordPiece 分词器
```

没有 Python、没有 ONNX Runtime 桌面版、没有显存占用，全部跑在 WebView2 的 WASM 里。

## 实测数字（这台机器）

- 模型加载：**0.47 s**（打开面板时就悄悄热起来，第一次问不用等）
- 单句编码：**13 ms**（后面几次）/ 39 ms（第一条）
- 1130 部剧全库点积：**几毫秒**，向量一次性摊平成 Float32Array，之后就是纯点积
- 常驻内存：模型 24 MB 权重 + 1.1 MB 向量，没有后台线程、没有轮询

## 为什么不选更大的模型

大不一定好，这一版是靠实测选的 small。同样的库、同样的 query，两个档的结果：

| | bge-small-zh-v1.5 int8 | bge-base-zh-v1.5 int8 |
|---|---|---|
| 体积 | 23.9 MB | 102.4 MB |
| 随机向量对余弦均值 | **0.381** | 0.755 |
| 9 个真实 query 的 top1 | **命中 6 个** | 几乎全被少数"hub 剧"霸占 |
| 「宫斗的娘娘那种」 | 《娘娘吉人自有天相》 ✓ | 前五名全是无关剧 |
| 「找部修仙的」 | 三部修仙剧 ✓ | 同样被 hub 剧挤掉 |

base 的 0.755 说明这个 int8 量化版把表示压坏了：所有分数挤在 0.818–0.862 的窄带里，谁排前面全看"哪部剧跟谁都像"。试过减去库均值再归一化（中心化），没救回来 —— 不是单纯偏移，是量化本身伤了模型。

榜单上 `bge-large-zh-v1.5`（C-MTEB 64.53 / Retrieval 70.46）确实比 small（57.82 / 61.77）高一档，但它 326 MB，端侧不划算；`Qwen3-Embedding-0.6B` 的 CMTEB-R 71.02 是里面最强的，可它 int8 也要 600 MB 左右，跟"低功耗小助理"是两条路。**在这台机器上，24 MB 的 small 是正确档。**

## 搜的时候发生了什么

1. 先走原来的字面搜（core 的 `/api/v1/lists/search`）
2. 做一次**严格字面校验**：结果标题里得有 query 连续 3 个字以上的片段（2 字太松，「翻身」这种词会把无关剧拉进来）
3. 没有严格命中，才把 query 编码成向量，跟 1130 条库向量点积排前 3
4. 气泡底下加一行小字：`本机语义 · 单句 39 ms · 库内 1130 部`

所以「修仙」这种短词仍然先走字面，「开局很惨后来翻身的」这种没有剧名的话才落到语义 —— 两条路互不打架。

## 几个真实例子

| 你问 | 它挑的 |
|---|---|
| 有没有那种开局很惨后来翻身的 | 开局狂死，我靠送死绝境逆袭 / 开局盲娶绝世女仙，爽翻了 / 震惊系统：开局撞大运 |
| 系统流的，有金手指 | 系统在手，女神心别动 / 大帝晚年新手系统 / S级错撩在手，千金大小姐乖乖低头 |
| 找部修仙的 | 我自创功法修仙 / 修仙：众人看我顾疯癫 / 观仙问道，我在修仙界无敌 |
| 我想看穿越回古代的 | 穿越古代，我一勺河水救了全城 |
| 网恋奔现发现被骗 | 奔现当天，室友阻止我和网恋对象见面 / 网恋对象竟在我身边 |
| 玄幻里当玩家那种 | 玄幻世界唯一真玩家 |

弱项是「打得狠的武打片」这类抽象动作描述 —— 会挑到《金鳞凶猛》《扫黑》，算沾边。

## 顺手修掉的两个坑

- `ort.env.wasm.wasmPaths` 不能给字符串 `"ai/"`：ort 内部动态 `import()` 加载 `.mjs` 时把它当裸模块名，报 `Failed to resolve module specifier`。必须给 `{mjs, wasm}` 对象 + 绝对 URL
- `Xenova/bge-small-zh-v1.5` 的 `vocab.txt` 和 `tokenizer.json` 的 vocab 不一致（前者是 `[unused58]` 占位、没有 `58` 整词），数字会被拆成单字。得从 `tokenizer.json` 的 `model.vocab` 重建词表；重建后 10 句测试跟官方 `tokenizers` 逐 token 完全一致

## 校验

```
hongguo-skin-1.013-win64.zip      6,937,740 B
29CDE2A7CBFB5D6D75452CB8A0260469148995C831C00A64FC4070E330A3C148

hongguo-skin-1.013-win64-ai.zip   25,241,648 B
1A975D8A65F2DD3A7049799B2C7BF30BB06E72581ACF8F8407B679C7D293E97D
```

`ui/index.html` · `ui/app.js` · `ui/ai/*` · `build/App.cs` 均已更新并推送。
