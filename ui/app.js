/* 红果短剧 · 自绘界面（跑在原版 core 的同源下，全部接口沿用官方 /api/v1） */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var qs = new URLSearchParams(location.search);
  var BASE = qs.get("base") || "";

  var S = {
    view: "home", tab: "recommend", items: [], offset: 0, next: 0, hasMore: false, loading: false,
    hero: null, active: null, detail: null, vids: [], epIndex: 0, playInfo: null, quality: "",
    danmaku: [], dmIdx: 0, dmOn: true, account: null, library: null, q: "", fs: false, mini: false, fit: "contain",
    fitManual: false, prevFitFs: null, fsFromMini: false,
    filterTag: "", filterEps: "all", sort: "default", collapsed: { cont: false, rank: true }, gridOpen: false,
    resumeAt: 0, epTotal: 0, epSeg: 0, rate: 1, vol: 1,
    src: null
  };

  /* ---------- 本地一处小记忆：续播点 / 音量 / 倍速 / 上次榜单名次 ---------- */
  var LS = {
    get: function (k, def) { try { var v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  };
  var RESUME = LS.get("hg_resume_v1", {}) || {};
  function resumeKey(sid, ep) { return String(sid) + "|" + String(ep); }
  /* 只有"看了一会儿、又没看完"的集才值得续播；刚开就退、或已经到尾部，都按从头来 */
  function resumeOf(sid, ep) {
    if (!sid) return 0;
    var r = RESUME[resumeKey(sid, ep)];
    if (!r || !r.t || r.t < 5) return 0;
    if (r.d && r.t > r.d - 6) return 0;
    return r.t;
  }
  /* 看过多少：拿存下来的「当前秒 + 总时长」算比例，给集数格底部那条进度线用 */
  function resumePct(sid, ep) {
    if (!sid) return 0;
    var r = RESUME[resumeKey(sid, ep)];
    if (!r || !r.t || r.t < 5) return 0;
    if (!r.d) return 0;    /* 记不下总时长的，就当没进度，别给整片选集糊一条假线 */
    if (r.t > r.d - 6) return 100;
    return Math.max(6, Math.min(99, Math.round(r.t / r.d * 100)));
  }


  function trimResume() {
    var keys = Object.keys(RESUME);
    if (keys.length <= 240) return;
    keys.sort(function (a, b) { return (RESUME[a].at || 0) - (RESUME[b].at || 0); });
    keys.slice(0, keys.length - 240).forEach(function (k) { delete RESUME[k]; });
  }
  function saveResume() {
    if (!S.active || !S.active.series_id) return;
    var t = video.currentTime || 0, d = video.duration || 0;
    if (!t || t < 1) return;
    RESUME[resumeKey(S.active.series_id, S.epIndex)] = { t: t, d: d || 0, at: Date.now() };
    trimResume();
    LS.set("hg_resume_v1", RESUME);
  }

  function api(path, opts, ms) {
    opts = opts || {};
    if (opts.json) {
      opts.method = opts.method || "POST";
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(opts.json);
      delete opts.json;
    }
    opts.cache = "no-store";
    /* 带超时的取数：core 对没缓存过的剧，play/info 要走上游现拉片源，实测 20~60 秒；
       原来没有超时，请求一直挂着，界面就只能干转圈。这里给一个上限，超了按失败处理。 */
    var ctl = null, timer = null;
    if (ms && typeof AbortController !== "undefined") {
      ctl = new AbortController();
      opts.signal = ctl.signal;
      timer = setTimeout(function () { try { ctl.abort(); } catch (e) { } }, ms);
    }
    var clear = function () { if (timer) { clearTimeout(timer); timer = null; } };
    return fetch(BASE + path, opts).then(function (r) {
      clear();
      return r.text().then(function (t) {
        var payload = null;
        try { payload = JSON.parse(t); } catch (e) { payload = null; }
        if (!r.ok || (payload && payload.ok === false)) {
          throw new Error((payload && payload.error) ? String(payload.error) : ("HTTP " + r.status));
        }
        return payload ? payload.data : null;
      });
    }, function (e) {
      clear();
      if (e && e.name === "AbortError") throw new Error("等太久了（" + Math.round(ms / 1000) + " 秒没有响应）");
      throw e;
    });
  }

  var fmt = function (s) {
    s = Math.max(0, Math.floor(s || 0));
    var m = Math.floor(s / 60), x = s % 60;
    return (m < 10 ? "0" : "") + m + ":" + (x < 10 ? "0" : "") + x;
  };
  var toastT;
  function toast(msg) {
    var t = $("#toast"), s = $("#toastTxt");
    if (s) s.textContent = msg; else t.textContent = msg;
    t.classList.add("on");
    /* 连续弹多条时重新播一次"展开"动画，像灵动岛回应你 */
    t.classList.remove("pop"); void t.offsetWidth; t.classList.add("pop");
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("on"); }, 1900);
  }
  /* 版本推送：同一个胶囊，但停得久、点得动 —— 点了交给宿主开浏览器（只放行 GitHub 链接） */
  var UPDKEY = "xg.upd.v";
  function toastUpd(v, url, manual) {
    var t = $("#toast"), s = $("#toastTxt");
    if (!t) return;
    if (!manual) {
      var seen = "";
      try { seen = localStorage.getItem(UPDKEY) || ""; } catch (e) { }
      if (seen === v) return;            /* 同一版本只提一次，别每次开机都来一遍 */
    }
    try {
      VER.remote = String(v || ""); VER.remoteUrl = url || ""; VER.at = Date.now();
      if ($("#verBlk") && $("#setWrap") && $("#setWrap").classList.contains("on")) paintVer();
    } catch (e) { }
    var line = "新版 v" + v + " 出来了 · 点这里看看";
    if (s) s.textContent = line;
    t.classList.add("on", "upd");
    t.classList.remove("pop"); void t.offsetWidth; t.classList.add("pop");
    t.onclick = function () {
      try { if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(JSON.stringify({ action: "openUrl", url: url })); } catch (e) { }
      t.classList.remove("on", "upd"); t.onclick = null;
    };
    try { localStorage.setItem(UPDKEY, v); } catch (e) { }
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.remove("on", "upd"); t.onclick = null; }, 9000);
  }
  function coverOf(item) {
    if (!item) return "";
    return item.cover_fallback || item.cover || "";
  }

  /* ---------- HEVC(H.265) 解码能力检测 ----------
     红果的片源是 bytevc1（H.265）。WebView2 不解码，只能让 Windows 的
     Media Foundation 来解；机器上没装 HEVC 扩展时，就是"有声音、没画面"。
     这里启动即探测一次，缺了就把提示条顶上去，并在真要播的时候再兜一次。 */
  var NOHEVC = (function () {
    if (qs.get("nohev")) return true;   /* 自检：--nohev 强制走提示态 */
    try {
      var probe = document.createElement("video");
      var ok = function (r) { return r === "probably" || r === "maybe"; };
      return !(ok(probe.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"')) ||
        ok(probe.canPlayType('video/mp4; codecs="hev1.1.6.L120.90"')));
    } catch (e) { return false; }
  })();
  function hevcBar(on) {
    var b = $("#hevcBar"); if (b) b.hidden = !on;
  }
  function bindHevcBar() {
    if (!NOHEVC) return;
    var bar = $("#hevcBar"); if (!bar) return;
    $("#hevcX").onclick = function () { bar.hidden = true; LS.set("hg_hevc_dismiss", 1); };
    $("#hevcFix").onclick = function () {
      if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify({ action: "openStore" }));
        $("#hevcRe").hidden = false;
        $("#hevcTip").innerHTML = "商店里搜到 <b>HEVC Video Extensions</b>（￥0，设备制造商版）点「获取」下载安装即可。装完点右边按钮重启。";
      } else {
        toast("请到微软商店安装 HEVC Video Extensions");
      }
    };
    $("#hevcRe").onclick = function () {
      if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(JSON.stringify({ action: "relaunch" }));
      else location.reload();
    };
    if (!LS.get("hg_hevc_dismiss", 0)) hevcBar(true);
  }
  var noPicWarned = false;
  function warnNoPicture() {
    if (noPicWarned) return;
    noPicWarned = true;
    hevcBar(true);
    toast("这台电脑解不出画面（缺 HEVC 解码器），点顶部提示装一下");
  }
  function big(n) {
    n = Number(n) || 0;
    if (n >= 100000000) return (n / 100000000).toFixed(1) + "亿";
    if (n >= 10000) return (n / 10000).toFixed(1) + "万";
    return String(n);
  }

  /* ---------- 列表渲染 ---------- */
  function cardEl(item, i, rank, snapMap) {
    var el = document.createElement("div");
    el.className = "card";
    el.style.animationDelay = Math.min(i, 12) * 26 + "ms";
    var cov = coverOf(item);
    el.innerHTML =
      '<div class="cov">' +
        (cov ? '<img src="' + cov + '" loading="lazy" referrerpolicy="no-referrer" alt="">' : "") +
        '<div class="grad"></div><div class="hov"><b>▶</b></div>' +
        (item.score ? '<div class="score">★ ' + item.score + '</div>' : "") +
        (item.episode_count ? '<div class="badge">全 ' + item.episode_count + ' 集</div>' : "") +
      '</div><h3></h3><p></p>';
    if (rank) {
      el.classList.add("rnk");
      var rb = document.createElement("div");
      rb.className = "rkb" + (rank <= 3 ? " t" + rank : "");
      rb.textContent = rank;
      el.querySelector(".cov").appendChild(rb);
      /* 名次变化只跟"上次在这个榜/这个视角看到的顺序"比，是真实差值，不是编的 */
      if (snapMap) {
        var old = snapMap[item.series_id];
        if (old && old !== rank) {
          var rk = document.createElement("div");
          rk.className = "rkd " + (old > rank ? "up" : "dn");
          rk.textContent = (old > rank ? "↑" : "↓") + Math.abs(old - rank);
          rb.appendChild(rk);
        }
      }
    }
    el.querySelector("h3").textContent = item.title || "未命名";
    var sub = item.tags && item.tags.length ? item.tags.slice(0, 3).join(" / ")
      : (item.play_count ? big(item.play_count) + " 次播放" : (item.intro || "").slice(0, 16));
    el.querySelector("p").textContent = sub || "红果短剧";
    var img = el.querySelector("img");
    if (img) img.onerror = function () { if (item.cover && img.src !== item.cover) img.src = item.cover; };
    el.onclick = function () { openDetail(item, i); };
    /* 鼠标在卡片上停一会儿就先把第 1 集拉上来——他真点进去时大概率已经拉完了。
       延迟 700ms 且只排队，慢慢扫过去不会乱开枪。 */
    var hovT = null;
    el.onmouseenter = function () {
      clearTimeout(hovT);
      hovT = setTimeout(function () { warmSeries(item); }, 700);
    };
    el.onmouseleave = function () { clearTimeout(hovT); };
    return el;
  }

  /* 卡片级预热：先要分集表，再把第 1 集（或续播那一集）的流排队 */
  var warmCache = {}, warmQ = [], warmBusy = false;
  function warmSeries(item, epIndex) {
    if (!item || !item.series_id) return;
    var sid = String(item.series_id);
    var ep = Math.max(0, epIndex || 0);
    if (S.active && String(S.active.series_id) === sid && S.vids.length) {
      prefetchStream(S.detail || S.active, Math.max(0, Math.min(ep, S.vids.length - 1)));
      return;
    }
    var k = sid + "|" + ep;
    if (warmCache[k]) return;
    warmCache[k] = 1;
    warmQ.push({ item: item, ep: ep });
    if (!warmBusy) pumpWarm();
  }
  function pumpWarm() {
    var job = warmQ.shift();
    if (!job) { warmBusy = false; return; }
    warmBusy = true;
    var item = job.item;
    api("/api/v1/series/detail?series_id=" + encodeURIComponent(item.series_id) +
      (item.content_type ? "&content_type=" + encodeURIComponent(item.content_type) : ""))
      .then(function (d) { if (d) prefetchStream(d, job.ep); })
      .catch(function () { })
      .then(function () { warmBusy = false; setTimeout(pumpWarm, 400); });
    return;
  }

  function renderList(list, append, snapMap) {
    var grid = $("#grid");
    if (!append) grid.innerHTML = "";
    var ranked = S.view === "rank";
    list.forEach(function (item, i) {
      grid.appendChild(cardEl(item, ranked ? i : (append ? 0 : i), ranked ? (append ? 0 : i + 1) : 0, snapMap));
    });
  }

  /* 榜单名次快照：每次渲染先算差值，再覆盖本榜本视角 */
  var SNAP = LS.get("hg_rank_snap_v1", {}) || {};
  function snapKey() { return (S.rankTab || "all") + "|" + (S.sort || "default"); }
  function saveSnapshot(list) {
    var k = snapKey(), map = {};
    list.forEach(function (it, i) { map[it.series_id] = i + 1; });
    SNAP[k] = { map: map, at: Date.now() };
    LS.set("hg_rank_snap_v1", SNAP);
  }

  /* ---------- 本地筛选 + 排序（找剧 / 榜单共用） ---------- */
  function matchFilter(item) {
    if (S.filterTag && (item.tags || []).indexOf(S.filterTag) < 0) return false;
    var eps = Number(item.episode_count) || 0;
    if (S.filterEps === "s" && !(eps > 0 && eps <= 40)) return false;
    if (S.filterEps === "m" && !(eps > 40 && eps <= 80)) return false;
    if (S.filterEps === "l" && !(eps > 80)) return false;
    return true;
  }

  function sortedItems() {
    var list = S.items.filter(matchFilter);
    var by = {
      hot: function (a, b) { return (Number(b.play_count) || 0) - (Number(a.play_count) || 0); },
      score: function (a, b) { return (parseFloat(b.score) || 0) - (parseFloat(a.score) || 0); },
      epsAsc: function (a, b) { return (Number(a.episode_count) || 9999) - (Number(b.episode_count) || 9999); },
      epsDesc: function (a, b) { return (Number(b.episode_count) || 0) - (Number(a.episode_count) || 0); }
    }[S.sort];
    return by ? list.slice().sort(by) : list;
  }

  function paintList() {
    var list = sortedItems();
    var isRank = S.view === "rank";
    var oldMap = isRank ? (SNAP[snapKey()] || {}).map : null;
    renderList(list, false, oldMap);
    if (isRank && list.length) saveSnapshot(list);
    if (!list.length) {
      $("#grid").innerHTML = "";
      if (S.items.length) {
        $("#grid").appendChild(emptyBox({ icon: "filter", text: "这个筛选条件下没有剧", sub: "换个题材、集数或者排序再试", btn: "清除筛选", btnIcon: false, onClick: function () {
          S.filterTag = ""; S.filterEps = "all"; S.sort = "default"; renderFilters(); paintList();
        } }));
      } else if (S.view === "search" || S.q) {
        $("#grid").appendChild(emptyBox({ icon: "search", text: "没搜到「" + (S.q || "") + "」", sub: "剧名对不上？换一个关键词，或者去小果那儿按意思找", btn: "清空重搜", onClick: function () {
          S.q = ""; if ($("#q")) $("#q").value = ""; switchView("home");
        } }));
      } else {
        $("#grid").appendChild(emptyBox({ icon: "film", text: "这里暂时没有内容", sub: "换个分类，或者过一会儿点标题右边那颗钮刷新", btn: "回发现页", onClick: function () { switchView("home"); } }));
      }
    }
    $("#secCount").textContent = S.items.length ? "共 " + list.length + " / " + S.items.length + " 部" : "";
  }

  function chips(box, label, defs, active, pick) {
    if (label) {
      var l = document.createElement("span");
      l.className = "lbl"; l.textContent = label;
      box.appendChild(l);
    }
    defs.forEach(function (d) {
      var b = document.createElement("button");
      b.className = "chip2" + (d.k === active ? " on" : "");
      b.textContent = d.n;
      b.onclick = function () { pick(d.k); };
      box.appendChild(b);
    });
  }

  function renderFilters() {
    var bar = $("#fbar");
    bar.innerHTML = "";
    if (S.view === "home" || S.view === "mine") { bar.classList.add("hide"); return; }
    bar.classList.remove("hide");

    if (S.view === "category") {
      chips(bar, "排序", [
        { k: "default", n: "推荐" }, { k: "hot", n: "热度" }, { k: "score", n: "口碑" },
        { k: "epsAsc", n: "集数少" }, { k: "epsDesc", n: "集数多" }
      ], S.sort, function (k) { S.sort = k; paintList(); renderFilters(); });

      chips(bar, "集数", [
        { k: "all", n: "全部" }, { k: "s", n: "≤40 集" }, { k: "m", n: "41–80 集" }, { k: "l", n: "80 集以上" }
      ], S.filterEps, function (k) { S.filterEps = k; paintList(); renderFilters(); });

      /* 题材：直接从已加载的剧里统计标签出现次数，取最热门的 10 个 */
      var cnt = {};
      S.items.forEach(function (it) {
        (it.tags || []).forEach(function (t) { if (t && t.length <= 6) cnt[t] = (cnt[t] || 0) + 1; });
      });
      var hot = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 10);
      if (hot.length) {
        chips(bar, "题材", [{ k: "", n: "全部" }].concat(hot.map(function (t) { return { k: t, n: t }; })), S.filterTag,
          function (k) { S.filterTag = k; paintList(); renderFilters(); });
      }
    } else if (S.view === "rank") {
      chips(bar, "看哪种榜", [
        { k: "default", n: "官方推荐序" }, { k: "hot", n: "🔥 最热播" },
        { k: "score", n: "⭐ 口碑高" }, { k: "epsAsc", n: "短剧精选" }, { k: "epsDesc", n: "长剧专场" }
      ], S.sort, function (k) { S.sort = k; paintList(); renderFilters(); });
    } else if (S.view === "search") {
      chips(bar, "排序", [
        { k: "default", n: "相关度" }, { k: "hot", n: "热度" }, { k: "score", n: "口碑" }, { k: "epsAsc", n: "集数少" }
      ], S.sort, function (k) { S.sort = k; paintList(); renderFilters(); });
    }
  }

  function foot(text, spin) {
    $("#foot").innerHTML = text ? (spin ? '<span class="spin"></span><span>' + text + "</span>" : "<span>" + text + "</span>") : "";
  }

  function setHero(item) {
    if (!item) return;
    S.hero = item;
    var cov = coverOf(item);
    $("#heroCover").style.backgroundImage = cov ? 'url("' + cov + '")' : "none";
    $("#bg").style.backgroundImage = cov ? 'url("' + cov + '")' : "none";
    $("#heroPoster").style.backgroundImage = cov ? 'url("' + cov + '")' : "none";
    $("#heroTitle").textContent = item.title || "";
    if (typeof AMB !== "undefined" && AMB) AMB.theme(item);
    $("#heroRate").textContent = "★ " + (item.score || "9.0");
    $("#heroRate").style.display = item.score ? "" : "none";
    var meta = [];
    if (item.episode_count) meta.push("全 " + item.episode_count + " 集");
    if (item.content_type === 1004 || (item.tags || []).indexOf("漫剧") >= 0) meta.push("漫剧");
    if (item.play_count) meta.push(big(item.play_count) + " 播放");
    (item.tags || []).slice(0, 2).forEach(function (t) { meta.push(t); });
    $("#heroMeta").textContent = meta.join(" · ");
    $("#heroSub").textContent = (item.intro || "").replace(/\s+/g, " ") || (item.tags || []).join(" / ");
    var on = item.following_update || item.followed;
    $("#heroFollow").textContent = on ? "🔔 已追更" : "🔔 追更";
    $("#heroFollow").classList.toggle("on", !!on);
  }

  /* ---------- 继续观看 / 热播榜 ---------- */
  function continueItem(e) {
    var drama = e.drama || e;
    var ep = Math.max(1, Number(e.episode) || 1);
    var pos = Number(e.position) || 0, dur = Number(e.duration) || 0;
    var pct = dur > 0 ? Math.min(100, pos / dur * 100) : (ep > 1 ? 100 : 12);
    var el = document.createElement("div");
    el.className = "hcard";
    el.innerHTML = '<img src="' + coverOf(drama) + '" loading="lazy" referrerpolicy="no-referrer" alt="">' +
      '<div class="hg"></div><div class="hp">▶</div>' +
      '<div class="hs">看到第 ' + ep + ' 集' + (dur ? " · " + fmt(pos) + "/" + fmt(dur) : "") + '</div>' +
      '<div class="hn"></div><div class="hb"><em style="width:' + pct.toFixed(1) + '%"></em></div>';
    el.querySelector(".hn").textContent = drama.title || "未命名";
    el.onclick = function () { openDetail(drama, ep - 1); };
    /* 停在"继续观看"卡上就先把那一集排队预取，点进去基本不用等 */
    var hovT = null;
    el.onmouseenter = function () {
      clearTimeout(hovT);
      hovT = setTimeout(function () { warmSeries(drama, ep - 1); }, 600);
    };
    el.onmouseleave = function () { clearTimeout(hovT); };
    return el;
  }

  function renderContinue() {
    if (S.view !== "home") return;      /* 其它页面不摆这两条横滑，页面才短 */
    var entries = (S.library && S.library.entries) || [];
    var hist = entries.filter(function (e) { return e.last_played_at && (e.drama || e).series_id; })
      .sort(function (a, b) { return (b.last_played_at || 0) - (a.last_played_at || 0); }).slice(0, 10);
    var row = $("#contRow");
    row.innerHTML = "";
    $("#contSec").style.display = hist.length ? "" : "none";
    if (!hist.length) return;
    $("#contCount").textContent = hist.length + " 部在看";
    hist.forEach(function (e) { row.appendChild(continueItem(e)); });
  }

  function renderRank() {
    if (S.view !== "home") return;      /* 其它页面不摆这两条横滑，页面才短 */
    api("/api/v1/lists/rank?offset=0&count=10").then(function (d) {
      if (S.view !== "home") return;
      var items = (d && d.items) || [];
      var row = $("#rankRow");
      row.innerHTML = "";
      $("#rankSec").style.display = items.length ? "" : "none";
      items.forEach(function (item, i) {
        var el = document.createElement("div");
        el.className = "ritem";
        el.innerHTML = '<div class="rk">' + (i + 1) + '</div><div class="rc"><img src="' + coverOf(item) +
          '" loading="lazy" referrerpolicy="no-referrer" alt=""></div><p></p><span></span>';
        el.querySelector("p").textContent = item.title || "未命名";
        el.querySelector("span").textContent = (item.score ? "★ " + item.score + " · " : "") +
          (item.episode_count ? "全 " + item.episode_count + " 集" : "");
        el.onclick = function () { openDetail(item, 0); };
        row.appendChild(el);
      });
    }).catch(function () { $("#rankSec").style.display = "none"; });
  }

  /* ---------- 数据加载 ---------- */
  function load(view, reset) {
    S.view = view;
    if (reset) { S.items = []; S.offset = 0; S.next = 0; }
    S.loading = true;
    foot("正在加载…", true);
    paintSkel();

    var path;
    if (view === "home") {
      path = "/api/v1/lists/recommend?offset=" + (S.next || 0) + "&count=12";
    } else if (view === "category") {
      path = "/api/v1/category?content_type=" + (S.tab === "comic" ? "1004" : (S.tab === "real" ? "1" : "")) +
        "&offset=" + (S.offset || 0) + "&count=18";
    } else if (view === "rank") {
      /* 榜单：除"官方榜"外，都走分类接口拿全集，再由本地按热度/口碑/集数重排，真正做到分榜 */
      path = (S.tab === "official")
        ? "/api/v1/lists/rank?offset=" + (S.offset || 0) + "&count=18"
        : "/api/v1/category?content_type=" + (S.tab === "comic" ? "1004" : (S.tab === "real" ? "1" : "")) +
          "&offset=" + (S.offset || 0) + "&count=18";
    } else if (view === "search") {
      path = "/api/v1/lists/search?q=" + encodeURIComponent(S.q) + "&offset=" + (S.offset || 0) + "&count=18";
    } else {
      S.loading = false; foot("");
      return;
    }

    api(path).then(function (data) {
      var items = (data && data.items) || [];
      if (S.view !== view) return;
      var had = !!S.items.length;
      S.items = S.items.concat(items);
      if (!had) { S.filterTag = ""; S.filterEps = "all"; S.sort = "default"; }
      paintList();
      renderFilters();
      if (!S.hero || reset) setHero(S.items[0]);
      if (view === "home" && reset) { renderContinue(); renderRank(); }
      S.hasMore = !!(data && (data.has_more || data.next_offset || data.next_cursor || items.length >= 12));
      S.next = (data && (data.next_offset || data.next_cursor)) || (S.next + items.length);
      S.offset = (S.offset || 0) + items.length;
      foot(S.hasMore ? (view === "home" && !S.gridOpen ? "下面还有 · 点「展开全部」继续" : "继续下滑加载更多")
        : (S.items.length ? "到底啦 · 共 " + S.items.length + " 部" : ""));
      S.loading = false;
    }).catch(function (e) {
      foot("加载失败：" + e.message);
      S.loading = false;
    });
  }

  function switchView(view) {
    S.view = view;   /* 先记账：首页的异步 list 回来时靠它判断"人已经切走了"，别把 grid 覆盖回去 */
    if (window.chrome && window.chrome.webview && window.DBG) window.chrome.webview.postMessage(JSON.stringify({ action: "log", text: "switchView -> " + view }));
    $("#main").scrollTop = 0;
    var tabs = $("#tabs");
    tabs.innerHTML = "";
    var defs;
    if (view === "home") defs = [{ k: "recommend", n: "推荐" }, { k: "comic", n: "漫剧" }, { k: "real", n: "真人剧" }];
    else if (view === "category") defs = [{ k: "all", n: "全部" }, { k: "real", n: "真人短剧" }, { k: "comic", n: "漫剧 / AI 剧" }];
    else if (view === "rank") defs = [{ k: "all", n: "综合榜" }, { k: "real", n: "真人剧榜" }, { k: "comic", n: "漫剧榜" }, { k: "official", n: "官方推荐榜" }];
    else if (view === "search") defs = [{ k: "search", n: "搜索结果" }];
    else defs = [{ k: "mine", n: "我的" }];

    defs.forEach(function (d) {
      var b = document.createElement("button");
      b.className = "tab" + ((view === "home" && d.k === "recommend") || (view === "category" && d.k === "all") ||
        (view === "rank" && d.k === (S.rankTab || "all")) ? " on" : "");
      b.textContent = d.n;
      b.onclick = function () {
        if (view === "home" && d.k !== "recommend") { S.tab = d.k; S.offset = 0; S.items = []; load("category", true); markTabs(d.k); setTitle((d.k === "comic" ? "漫剧 / AI 剧" : "真人短剧")); return; }
        markTabs(d.k); S.tab = d.k;
        if (view === "home") load("home", true);
        else if (view === "category") load("category", true);
        else if (view === "rank") { S.rankTab = d.k; S.offset = 0; S.items = []; load("rank", true); }
      };
      b.dataset.k = d.k;
      tabs.appendChild(b);
    });
    [...$("#tabs").children].forEach(function (x) { x.classList.toggle("on", x.dataset.k === (view === "home" ? "recommend" : undefined)); });

    [].forEach.call(document.querySelectorAll("nav.rail button"), function (b) {
      b.classList.toggle("on", b.dataset.view === (view === "search" ? "home" : view));
    });

    var isMine = view === "mine";
    var isHome = view === "home";
    document.body.dataset.view = view;
    /* 只有「发现」页才需要大图 hero + 两条横滑；找剧/榜单/我的页直接铺列表，页面短一半 */
    if ($("#hero")) $("#hero").style.display = (isMine || !isHome) ? "none" : "";
    if ($("#contSec") && !isHome) $("#contSec").style.display = "none";
    if ($("#rankSec") && !isHome) $("#rankSec").style.display = "none";
    if ($("#secMore")) $("#secMore").style.display = isMine ? "none" : "";
    if ($("#gridFold")) $("#gridFold").style.display = (view === "home" && !S.gridOpen) ? "" : "none";
    $("#grid").classList.toggle("clip", view === "home" && !S.gridOpen);
    if (isMine) {
      if ($("#contSec")) $("#contSec").style.display = "none";
      if ($("#rankSec")) $("#rankSec").style.display = "none";
    } else if (view === "home") {
      renderContinue(); renderRank();
      applyFold();
    }

    if (view === "home") { setTitle("为你推荐"); S.offset = 0; S.next = 0; load("home", true); }
    else if (view === "category") { setTitle("找剧 · 分类"); S.offset = 0; renderFilters(); load("category", true); }
    else if (view === "rank") { if (window.GRO) GRO.flag("rank"); setTitle("榜单 · 分类排行"); S.offset = 0; renderFilters(); load("rank", true); }
    else if (view === "mine") renderMine();
  }

  /* ---------- 首页分区折叠：省点滚动，一眼看全 ---------- */
  function applyFold() {
    var cont = $("#contSec"), rank = $("#rankSec");
    if (cont) { cont.classList.toggle("foldIn", !!S.collapsed.cont); cont.querySelector(".hrow").style.display = S.collapsed.cont ? "none" : ""; }
    if (rank) { rank.classList.toggle("foldIn", !!S.collapsed.rank); rank.querySelector(".rrow").style.display = S.collapsed.rank ? "none" : ""; }
    [].forEach.call(document.querySelectorAll("[data-fold]"), function (b) {
      var k = b.dataset.fold;
      var off = !!S.collapsed[k];
      b.setAttribute("data-dir", off ? "down" : "up"); b.setAttribute("data-hint", off ? "展开这块" : "收起这块");
    });
  }
  [].forEach.call(document.querySelectorAll("[data-fold]"), function (b) {
    b.onclick = function () {
      S.collapsed[b.dataset.fold] = !S.collapsed[b.dataset.fold];
      applyFold();
    };
  });
  if ($("#gridFold")) $("#gridFold").onclick = function () {
    S.gridOpen = true;
    $("#grid").classList.remove("clip");
    this.style.display = "none";
    $("#secCount").textContent = S.items.length ? "共 " + S.items.length + " 部" : "";
    foot(S.hasMore ? "继续下滑加载更多" : "");
  };

  function markTabs(k) {
    [].forEach.call($("#tabs").children, function (x) { x.classList.toggle("on", x.dataset.k === k); });
  }
  function setTitle(t) { $("#secTitle").textContent = t; }

  /* ---------- 详情 ---------- */
  var sheet = $("#sheet"), mask = $("#mask");
  function closeDetail() { mask.classList.remove("on"); sheet.classList.remove("on"); if ($("#sGlow")) $("#sGlow").classList.remove("on"); }

  /* 选集按每 24 集一段折叠：面板加宽后一屏放得下三行，不再只给两行留一大片空 */
  var EP_SEG = 24;
  function renderEpisodeGrid(total, seg) {
    S.epTotal = total;
    var segs = Math.max(1, Math.ceil(total / EP_SEG));
    var cur = typeof seg === "number" ? Math.max(0, Math.min(segs - 1, seg)) : Math.floor(S.epIndex / EP_SEG);
    S.epSeg = cur;
    var bar = $("#sEpSegs");
    if (bar) {
      bar.innerHTML = "";
      if (segs > 1) {
        bar.classList.remove("hide");
        for (var s = 0; s < segs; s++) {
          var c = document.createElement("button");
          c.className = "epseg" + (s === cur ? " on" : "");
          c.textContent = (s * EP_SEG + 1) + "-" + Math.min(total, (s + 1) * EP_SEG);
          c.dataset.from = s * EP_SEG;
          c.dataset.to = Math.min(total, (s + 1) * EP_SEG);
          c.onclick = (function (k) { return function () { renderEpisodeGrid(total, k); }; })(s);
          bar.appendChild(c);
        }
      } else {
        bar.classList.add("hide");
      }
    }
    var eps = $("#sEps");
    /* 分集格子的点击入口：以前每个格只挂了 onmouseenter 预取，没有 click ——
       所以「点具体集数没反应」不是取流的问题，是按钮压根没接上 playEpisode。
       用容器委托绑一次，renderEpisodeGrid 反复重建 innerHTML 也不会掉。 */
    if (eps && !eps.dataset.picked) {
      eps.dataset.picked = "1";
      eps.addEventListener("click", function (e) {
        var b = e.target && e.target.closest ? e.target.closest(".ep") : null;
        if (!b || !eps.contains(b)) return;
        var n = parseInt(b.dataset.i, 10);
        if (isNaN(n)) return;
        /* 官方锁着的集：当场说清楚，别让用户等四秒再看到"取不到播放源" */
        if (b.dataset.lock === "1") {
          try { if (window.DBG) window.chrome.webview.postMessage(JSON.stringify({ action: "log", text: "ep" + (n + 1) + " locked 拦截 free=" + S.freeN })); } catch (e2) { }
          toast("第 " + (n + 1) + " 集要官方解锁" +
            (S.freeN ? "（这部剧本机免费到第 " + S.freeN + " 集）" : "") + "，官方网页那边也不会公开给这一集");
          return;
        }
        playEpisode(n);
      });
    }
    eps.innerHTML = "";
    var from = cur * EP_SEG, to = Math.min(total, from + EP_SEG);
    for (var i = from; i < to; i++) {
      var b = document.createElement("button");
      b.className = "ep" + (i === S.epIndex ? " on" : "");
      b.textContent = String(i + 1);
      b.dataset.i = i;
      var rv = resumeOf(S.active && S.active.series_id, i);
      /* 屏幕阅读器与鼠标悬停提示共用这一行，不再依赖系统 title */
      b.setAttribute("aria-label", "第 " + (i + 1) + " 集");
      var pct = resumePct(S.active && S.active.series_id, i);
      if (rv > 4 || pct > 0) b.classList.add("seen");
      b.style.setProperty("--p", Math.max(6, pct) + "%");
      /* 官方锁着的集（locked）在格子上直接标出来：官方没给公开片源，
         点进去只会白等一轮再报 no_public_source */
      if (S.locked && S.locked[i]) {
        b.dataset.lock = "1";
        b.classList.add("locked");
        b.setAttribute("aria-label", "第 " + (i + 1) + " 集 · 需在官方解锁");
      }
      /* 鼠标扫过哪一集就先给那一集排队预取，点下去基本已经在拉了；锁集别预取，白等 4 秒 */
      b.onmouseenter = (function (n) {
        return function () {
          if (S.locked && S.locked[n]) return;
          prefetchStream(S.detail, n);
        };
      })(i);
      eps.appendChild(b);
    }
    if (!total) eps.innerHTML = '<div class="foot" style="padding:16px 0">暂时取不到分集</div>';
  }

  /* ---------- 详情底部「看完这集，再看看」：只用本机剧库，按题材重合度排，不联网不调模型 ---------- */
  function renderMore(item, d) {
    var wrap = $("#sMore");
    if (!wrap || !item) return;
    var base = {
      series_id: item.series_id,
      content_type: item.content_type || (d && d.content_type),
      tags: (item.tags && item.tags.length) ? item.tags : ((d && d.tags) || [])
    };
    var cur = String(base.series_id || "");
    var myTags = base.tags || [];
    var entries = (S.library && S.library.entries) || [];
    var pool = [];
    entries.forEach(function (e) {
      var dr = e.drama || e;
      if (!dr || !dr.series_id) return;
      if (String(dr.series_id) === cur) return;
      var tags = dr.tags || [];
      var hit = 0;
      for (var k = 0; k < tags.length; k++) { if (myTags.indexOf(tags[k]) >= 0) hit++; }
      pool.push({ d: dr, s: hit * 2 + (dr.content_type === base.content_type ? 1 : 0), at: (e.last_played_at || e.favorite_at || 0) });
    });
    pool.sort(function (a, b) { return (b.s - a.s) || (b.at - a.at); });
    var pick = pool.filter(function (x) { return x.s > 0; }).slice(0, 6);
    if (pick.length < 6) pick = pick.concat(pool.filter(function (x) { return x.s === 0; }).slice(0, 6 - pick.length));
    if (pick.length < 2) { wrap.innerHTML = ""; wrap.classList.remove("on"); return; }

    var h = '<div class="mh"><b>看完这集，再看看</b><span>本机剧库 ' + pick.length + ' 部</span></div><div class="mg">';
    pick.forEach(function (x) {
      var c = coverOf(x.d);
      h += '<div class="mc"><div class="cv">' + (c ? '<img src="' + c + '" loading="lazy" referrerpolicy="no-referrer" alt="">' : '') +
        '</div><div class="tx"><b></b><p></p></div></div>';
    });
    wrap.innerHTML = h + "</div>";

    var cards = wrap.querySelectorAll(".mc");
    pick.forEach(function (x, k) {
      var el = cards[k];
      if (!el) return;
      el.querySelector("b").textContent = x.d.title || "未命名";
      el.querySelector("p").textContent = (x.d.tags || []).slice(0, 2).join(" / ") ||
        (x.d.episode_count ? "全 " + x.d.episode_count + " 集" : "短剧");
      el.onclick = function () { openDetail(x.d, 0); };
    });
    wrap.classList.add("on");
  }

  /* 选集：鼠标压上去时，标题行右端直接从“共 N 集”变成这一集 / 这一段的说明，不再弹浮层挡按钮 */
  (function () {
    var cnt = $("#sEpCount"), cur = null;
    if (!cnt) return;
    function base() { return "共 " + (S.epTotal || 0) + " 集"; }
    function reset() {
      cur = null;
      cnt.textContent = base();
      cnt.classList.remove("hot");
    }
    function segText(el) {
      var a = parseInt(el.dataset.from, 10) || 0;
      var z = parseInt(el.dataset.to, 10) || 0;
      var sid = S.active && S.active.series_id;
      var seen = 0, done = 0;
      for (var i = a; i < z; i++) {
        var p = resumePct(sid, i);
        if (p > 0) seen++;
        if (p >= 96) done++;
      }
      return "第 " + (a + 1) + "-" + z + " 集 · 看过 " + seen + "/" + (z - a) + (done ? " · 看完 " + done : "");
    }
    document.addEventListener("mousemove", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var sg = t.closest("#sEpSegs .epseg");
      if (sg) {
        if (sg === cur) return;
        cur = sg;
        cnt.textContent = segText(sg);
        cnt.classList.add("hot");
        return;
      }
      var b = t.closest("#sEps .ep");
      if (b === cur) return;
      cur = b;
      if (!b) { reset(); return; }
      var n = parseInt(b.dataset.i, 10) || 0;
      var pct = resumePct(S.active && S.active.series_id, n);
      var rv = resumeOf(S.active && S.active.series_id, n);
      if (pct >= 96) cnt.innerHTML = "第 " + (n + 1) + " 集 · <em>已看完</em>";
      else if (rv > 4) cnt.innerHTML = "第 " + (n + 1) + " 集 · 上次 <em>" + fmt(rv) + "</em> · " + pct + "%";
      else cnt.textContent = "第 " + (n + 1) + " 集";
      cnt.classList.add("hot");
    });
    document.addEventListener("mousedown", reset, true);
    document.addEventListener("mouseout", function (e) {
      if (e.relatedTarget === null || !e.relatedTarget) reset();
    });
  })();
  /* 多季：core 的 /series/seasons 会返回这部剧的第 1..N 季，直接拿来做成换季横排 */
  var seasonToken = 0;
  function renderSeasonBar(list, curSid) {
    var bar = $("#sSeasons");
    if (!bar) return;
    bar.innerHTML = "";
    var seasons = (list || []).filter(function (s) { return s && s.series_id; })
      .sort(function (a, b) { return (Number(a.season_index) || 0) - (Number(b.season_index) || 0); });
    if (seasons.length < 2) { bar.classList.add("hide"); return; }
    bar.classList.remove("hide");
    seasons.forEach(function (s) {
      var b = document.createElement("button");
      var off = s.playable === false || !!s.upcoming || !!s.reservation_id;
      b.className = "sseason" + (String(s.series_id) === String(curSid) ? " on" : "") + (off ? " off" : "");
      b.innerHTML = "<b>" + (s.label || ("第 " + (s.season_index || 1) + " 季")) + "</b>" +
        "<span>" + (off ? "未上线" : ((s.episode_count ? "全 " + s.episode_count + " 集" : "") || (s.score ? "★ " + s.score : "")) ) + "</span>";
      if (off) b.onclick = function () { toast((s.label || "这一季") + "还没上线，先追更等通知"); };
      else if (String(s.series_id) !== String(curSid)) {
        b.onclick = function () { S.epIndex = 0; openDetail(s, 0); };
      }
      bar.appendChild(b);
    });
  }

  function loadSeasons(item) {
    var bar = $("#sSeasons");
    var tok = ++seasonToken;
    if (bar) bar.classList.add("hide");
    api("/api/v1/series/seasons?series_id=" + encodeURIComponent(item.series_id))
      .then(function (d) {
        if (tok !== seasonToken) return;
        renderSeasonBar((d && d.items) || [], item.series_id);
      }).catch(function () { if (tok === seasonToken && bar) bar.classList.add("hide"); });
  }

  function openDetail(item, idx) {
    /* v1.024：小窗播放中点开详情，先把小窗还原，否则面板一开就把画面压没了 */
    if (S.mini && viewer.classList.contains("on")) { setMini(false); toast("已退出小窗，方便看详情"); }
    /* 换一部剧才把详情滚回顶部；同一个 series 再次打开保持原来的阅读位置 */
    var mw0 = $("#sMore"); if (mw0) { mw0.classList.remove("on"); mw0.innerHTML = ""; }
    var sameSeries = S.active && String(S.active.series_id) === String(item.series_id);
    if (!sameSeries) { var sm = $(".smain"); if (sm) sm.scrollTop = 0; }
    S.active = item; S.epIndex = idx || 0;
    if (typeof AMB !== "undefined" && AMB) AMB.theme(item);
    $("#sCover").src = coverOf(item);
    var gc = coverOf(item);
    if ($("#sGlowImg")) { $("#sGlowImg").style.backgroundImage = gc ? 'url("' + gc + '")' : "none"; $("#sGlow").classList.toggle("on", !!gc && LS.get("hg_glow", 1) !== 0); }
    $("#sTitle").textContent = item.title || "";
    $("#sSub").textContent = [
      item.episode_count ? "全 " + item.episode_count + " 集" : "",
      item.score ? "★ " + item.score : "",
      (item.tags || []).slice(0, 4).join(" / ")
    ].filter(Boolean).join(" · ");
    $("#sDesc").textContent = item.intro || "";
    $("#sEps").innerHTML = '<div class="foot" style="padding:16px 0"><span class="spin"></span><span>正在取分集…</span></div>';
    $("#sEpCount").textContent = "";
    $("#sFav").querySelector("b").textContent = isFavorite(item) ? "已藏" : "收藏";
    $("#sFav").querySelector("i").textContent = isFavorite(item) ? "♥" : "♡";
    $("#sFollow").querySelector("b").textContent = item.following_update || item.followed ? "已追" : "追更";
    var rv0 = resumeOf(item.series_id, S.epIndex);
    $("#sPlay").querySelector("b").textContent = rv0 > 4 ? "续看" : "播放";
    mask.classList.add("on"); sheet.classList.add("on");
    loadSeasons(item);

    api("/api/v1/series/detail?series_id=" + encodeURIComponent(item.series_id) +
      (item.content_type ? "&content_type=" + encodeURIComponent(item.content_type) : ""))
      .then(function (d) {
        if (!d) throw new Error("详情为空");
        S.detail = d;
        S.vids = d.vid_list || [];
        /* 官方按集数锁：episodes[i].locked 为 true 的集，core 取流和官网兜底都拿不到片源。
           记下来给分集格子做标记，别让用户点进去空转四秒再弹一句"取不到"。
           freeN = 本机免费能看到的集数（core 的 accessible_episode_cnt）。 */
        var lk = {}, lockN = 0, eps = d.episodes || [];
        for (var qi = 0; qi < eps.length; qi++) {
          var qe = eps[qi];
          if (!qe) continue;
          var qk = (Number(qe.index) || (qi + 1)) - 1;
          if (qe.locked) { lk[qk] = 1; lockN++; }
        }
        S.locked = lk; S.lockN = lockN;
        S.freeN = Number(d.accessible_episode_cnt) || (S.vids.length - lockN);
        $("#sTitle").textContent = d.title || item.title || "";
        $("#sDesc").textContent = d.intro || item.intro || "";
        $("#sEpCount").textContent = "共 " + (d.episode_count || S.vids.length) + " 集" +
          (lockN ? " · 前 " + S.freeN + " 集公开" : "");
        var total = S.vids.length || (d.episode_count || 0);
        renderEpisodeGrid(total, Math.floor(S.epIndex / EP_SEG));
        renderMore(item, d);
        /* 他这会儿正在看简介，先把这一集（默认第 1 集 / 上次那集）的播放源拉上来 */
        prefetchStream(d, Math.max(0, Math.min(S.epIndex, total - 1)));
      }).catch(function (e) {
        $("#sEps").innerHTML = '<div class="foot" style="padding:16px 0">分集获取失败：' + e.message + "</div>";
      });
  }

  $("#sheetClose").onclick = closeDetail;
  mask.onclick = closeDetail;
  $("#sPlay").onclick = function () { playEpisode(0); };
  $("#sFav").onclick = function () { toggleFavorite(S.active); };
  $("#sFollow").onclick = function () { toggleFollow(S.active); };
  $("#hero").onclick = function (e) {
    if (e.target.closest(".btn")) return;
    if (S.hero) { S.active = S.hero; openDetail(S.hero, 0); }
  };
  $("#heroPlay").onclick = function (e) { e.stopPropagation(); if (S.hero) { S.active = S.hero; playEpisode(0); } };
  $("#heroFollow").onclick = function (e) { e.stopPropagation(); toggleFollow(S.hero); };

  /* ---------- 播放 ---------- */
  var video = $("#video"), viewer = $("#viewer");
  if (window.chrome && window.chrome.webview) {
    var devLog = function (t) { window.chrome.webview.postMessage(JSON.stringify({ action: "log", text: t })); };
    video.addEventListener("error", function () {
      devLog("video error code=" + (video.error && video.error.code) + " msg=" + (video.error && video.error.message) + " src=" + video.src);
    });
    video.addEventListener("loadedmetadata", function () {
      devLog("metadata ok " + video.videoWidth + "x" + video.videoHeight + " dur=" + video.duration + " canHEVC=" + video.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"'));
      if (S.mini && video.videoWidth && video.videoHeight) sendMiniSize();
    });
    var lastTickAt = 0;
    video.addEventListener("timeupdate", function () {
      var t = video.currentTime || 0;
      var d = lastTickAt ? t - lastTickAt : 0;
      lastTickAt = t;
      if (!video.paused && window.GRO) GRO.tick(d);
    });
  }
  function epLabel(i) { return "第 " + (i + 1) + " 集"; }
  /* 剧名现在是横向浮标签，整条给全名就行，不再按竖排时代的 9 字截断 */
  function vTitleOf(d) {
    return String((d && d.title) || "");
  }

  function playEpisode(i) {
    clearNextCue();
    if (!S.vids.length) {
      /* 分集列表拿到了集数、却没有一集的视频号：别静默退回详情页（那样点下去看着就是"没反应"） */
      toast("这一部还没取到视频号，重开一次详情再点");
      if (S.active) openDetail(S.active, 0);
      return;
    }
    if (S.locked && S.locked[i]) {
      /* 自动接集 / 右侧队列也会走到这里：到锁集就停，别往前跳成一片黑 */
      toast("第 " + (i + 1) + " 集要官方解锁" + (S.freeN ? "（本机免费到第 " + S.freeN + " 集）" : ""));
      return;
    }
    S.epIndex = Math.max(0, Math.min(i, S.vids.length - 1));
    /* 用户主动点某一集：这一集看过一半就接着上次的位置，没看过就从头 */
    S.resumeAt = resumeOf(S.active && S.active.series_id, S.epIndex);
    if (S.epTotal) renderEpisodeGrid(S.epTotal, Math.floor(S.epIndex / EP_SEG));
    else [...$("#sEps").children].forEach(function (b) { b.classList.toggle("on", Number(b.dataset.i) === S.epIndex); });
    openViewer();
    if (S.resumeAt > 4) toast("接着上次的 " + fmt(S.resumeAt) + " 继续");
    if (window.GRO && S.active) GRO.episode(S.active.series_id, S.epIndex, S.quality, S.active.tags);
  }

  function closeViewer() {
    clearNextCue();
    viewer.classList.remove("on");
    document.body.classList.remove("theater");
    document.body.classList.remove("idle");
    video.pause();
    if (typeof AMB !== "undefined" && AMB) AMB.play(false);
  }

  /* 键换成 v2：老版本默认是"进播放页自动全屏"，这里改成默认不接管，
     全屏由用户自己按 ⛶ / 双击画面 / F 切 */
  var AUTO_FS = LS.get("hg_auto_fs_v2", 0) !== 0;
  var FFTEST = /[?&]ff=1/.test(location.search);   /* 联调用：每集自动跳到末尾 1.2 秒，快速验证自动接集 */
  /* ---------- v1.025：播放页剧名卡 + 右侧集数队列 ---------- */
  function paintVTitle(d) {
    var cv = $("#vTitleCv"), nm = $("#vTitleName"), ep = $("#vTitleEp");
    if (!nm) return;
    var c = coverOf(d);
    if (cv) { if (c) { cv.src = c; cv.style.visibility = "visible"; } else { cv.style.visibility = "hidden"; } }
    nm.textContent = vTitleOf(d);
    if (ep) ep.textContent = epLabel(S.epIndex) +
      (S.epTotal ? " · 共 " + S.epTotal + " 集" : "");
  }

  /* 右侧竖窄队列：一集一格，当前那格白底，看过的格底一条细线；点一下直接跳集 */
  function renderVQueue() {
    var q = $("#vQueue");
    if (!q) return;
    var n = S.vids.length || S.epTotal || 0;
    if (!n) { q.innerHTML = ""; q.classList.remove("hot"); return; }
    var sid = S.active && S.active.series_id;
    var h = "";
    for (var i = 0; i < n; i++) {
      var p = resumePct(sid, i);
      h += '<button class="vq" data-i="' + i + '"' + (i === S.epIndex ? ' data-cur="1"' : "") +
        (p > 0 ? ' data-seen="1" style="--p:' + Math.max(6, p) + '%"' : "") +
        ' data-hint="第 ' + (i + 1) + ' 集' + (p >= 96 ? " · 已看完" : (p > 0 ? " · 看过 " + p + "%" : "")) + '">' +
        (i + 1) + '</button>';
    }
    q.innerHTML = h;
    var cur = q.querySelector('[data-cur="1"]');
    if (cur) q.scrollTop = Math.max(0, cur.offsetTop - q.clientHeight / 2 + cur.offsetHeight / 2);
  }
  (function () {
    var q = $("#vQueue");
    if (q) q.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".vq") : null;
      if (!b) return;
      playEpisode(Number(b.dataset.i));
    });
    var t = null;
    document.addEventListener("mousemove", function (e) {
      var qq = $("#vQueue");
      if (!qq || !viewer.classList.contains("on") || !qq.children.length) return;
      var near = e.clientX > window.innerWidth - 96;
      clearTimeout(t);
      if (near) qq.classList.add("hot");
      else t = setTimeout(function () { qq.classList.remove("hot"); }, 260);
    });
  })();
  /* ---------- v1.026：空态三件套（居中图标 + 一句话 + 一枚胶囊按钮） ---------- */
  var ECO = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.7" cy="10.7" r="6.4"/><path d="M15.4 15.4L20.4 20.4"/></svg>',
    film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.6"/><path d="M3.2 9.4h17.6M3.2 14.6h17.6M8.2 4.6v14.8M15.8 4.6v14.8"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20c-4.5-3.1-7.2-5.9-7.2-9 0-2.2 1.7-3.8 3.8-3.8 1.5 0 2.8.8 3.4 1.9.6-1.1 1.9-1.9 3.4-1.9 2.1 0 3.8 1.6 3.8 3.8 0 3.1-2.7 5.9-7.2 9z"/></svg>',
    filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.4h16M7 12h10M10 17.6h4"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.6"/><path d="M10.2 8.8l5 3.2-5 3.2z"/></svg>'
  };
  function emptyBox(o) {
    o = o || {};
    var box = document.createElement("div");
    box.className = "empty";
    box.style.gridColumn = "1 / -1";
    var ic = document.createElement("div");
    ic.className = "ei";
    ic.innerHTML = ECO[o.icon] || ECO.film;
    box.appendChild(ic);
    if (o.text) {
      var t = document.createElement("div");
      t.className = "et"; t.textContent = o.text;
      box.appendChild(t);
    }
    if (o.sub) {
      var s = document.createElement("div");
      s.className = "es"; s.textContent = o.sub;
      box.appendChild(s);
    }
    if (o.btn) {
      var b = document.createElement("button");
      b.className = "eb";
      b.innerHTML = (o.btnIcon === false ? "" : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5.5l6.5 6.5L9 18.5"/></svg>');
      b.appendChild(document.createTextNode(o.btn));
      b.onclick = function () { if (o.onClick) o.onClick(); };
      box.appendChild(b);
    }
    return box;
  }

  /* ---------- v1.026：设置面板 ---------- */
  var SETW = $("#setWrap");
  var SETGRP = { ui: "界面", play: "播放", local: "本机", adv: "高级" };
  var SETTAB = "ui";
  var setTick = null;   /* 语义模型加载中，设置页自己轮询重绘一次 */

  function setFlag(k, def) { var v = LS.get("hg_" + k, def === undefined ? 1 : def); return v !== 0; }
  function putFlag(k, on) { LS.set("hg_" + k, on ? 1 : 0); }

  function selRow(title, sub, onText, offText, isOn, onChange) {
    var row = document.createElement("div");
    row.className = "row";
    var tx = document.createElement("div");
    tx.className = "tx";
    tx.innerHTML = "<b></b><span></span>";
    tx.querySelector("b").textContent = title;
    tx.querySelector("span").textContent = sub || "";
    row.appendChild(tx);
    var sw = document.createElement("button");
    sw.className = "sw";
    sw.setAttribute("data-on", isOn ? "1" : "0");
    sw.setAttribute("data-hint", (isOn ? onText : offText) || (isOn ? "已开" : "已关"));
    sw.innerHTML = "<i></i>";
    sw.onclick = function () {
      var next = sw.getAttribute("data-on") !== "1";
      sw.setAttribute("data-on", next ? "1" : "0");
      sw.setAttribute("data-hint", (next ? onText : offText) || (next ? "已开" : "已关"));
      onChange(next);
    };
    row.appendChild(sw);
    return row;
  }

  function segRow(title, sub, defs, active, pick) {
    var row = document.createElement("div");
    row.className = "row";
    var tx = document.createElement("div");
    tx.className = "tx";
    tx.innerHTML = "<b></b><span></span>";
    tx.querySelector("b").textContent = title;
    tx.querySelector("span").textContent = sub || "";
    row.appendChild(tx);
    var seg = document.createElement("div");
    seg.className = "seg2";
    defs.forEach(function (d) {
      var b = document.createElement("button");
      b.textContent = d.n;
      b.className = d.k === active ? "on" : "";
      b.onclick = function () { pick(d.k); };
      seg.appendChild(b);
    });
    row.appendChild(seg);
    return row;
  }

  function infoRow(title, sub, rightHtml) {
    var row = document.createElement("div");
    row.className = "row";
    var tx = document.createElement("div");
    tx.className = "tx";
    tx.innerHTML = "<b></b><span></span>";
    tx.querySelector("b").textContent = title;
    tx.querySelector("span").textContent = sub || "";
    row.appendChild(tx);
    if (rightHtml) {
      var rt = document.createElement("div");
      rt.innerHTML = rightHtml;
      var first = rt.firstElementChild;
      if (first) row.appendChild(first);
    }
    return row;
  }

  function actRow(title, sub, btnText, danger, onClick) {
    var row = document.createElement("div");
    row.className = "row";
    var tx = document.createElement("div");
    tx.className = "tx";
    tx.innerHTML = "<b></b><span></span>";
    tx.querySelector("b").textContent = title;
    tx.querySelector("span").textContent = sub || "";
    row.appendChild(tx);
    var b = document.createElement("button");
    b.className = "act" + (danger ? " danger" : "");
    b.textContent = btnText;
    b.onclick = onClick;
    row.appendChild(b);
    return row;
  }

  function grpBox(head) {
    var g = document.createElement("div");
    g.className = "grp";
    var h = document.createElement("div");
    h.className = "grp-h";
    h.textContent = head;
    g.appendChild(h);
    return g;
  }

  /* 版本块：版本号 + build + 有没有新版 + 两枚并排按钮 */
  var VER = { local: "", build: "", remote: "", remoteUrl: "", at: 0, busy: false };

  function verCmp(a, b) {
    var pa = String(a || "").split("."), pb = String(b || "").split(".");
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var x = parseInt(pa[i] || "0", 10) || 0, y = parseInt(pb[i] || "0", 10) || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  function paintVer() {
    var blk = $("#verBlk");
    if (!blk) return;
    var newer = VER.remote && VER.local && verCmp(VER.remote, VER.local) > 0;
    var tip, tipCls;
    if (VER.busy) { tip = "检查中…"; tipCls = "vtip"; }
    else if (newer) { tip = "发现新版本 v" + VER.remote; tipCls = "vtip new"; }
    else if (VER.at) { tip = "已是最新"; tipCls = "vtip"; }
    else { tip = "还没检查过"; tipCls = "vtip"; }
    blk.innerHTML =
      '<div class="vl"><b></b><span></span></div>' +
      '<div class="vr"><span class="' + tipCls + '"></span>' +
      '<button class="vb2" id="verCheck">重新检查</button>' +
      '<button class="vb2 pri" id="verDl">打开下载页</button></div>';
    var b = blk.querySelector(".vl b");
    b.textContent = VER.local ? "v" + VER.local : "—";
    var lv = document.createElement("span");
    lv.className = "lvt";
    lv.textContent = "本机版本";
    b.appendChild(lv);
    blk.querySelector(".vl span").textContent = VER.build ? VER.build : "build —";
    blk.querySelector(".vtip").textContent = tip;
    var dl = blk.querySelector("#verDl");
    dl.onclick = function () {
      var u = VER.remoteUrl || "https://github.com/guhang42-jpg/hongguo-desktop-skin/releases/latest";
      try { if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(JSON.stringify({ action: "openUrl", url: u })); else window.open(u, "_blank"); toast("下载页交给浏览器"); } catch (e) { toast("下载页：" + u); }
    };
    blk.querySelector("#verCheck").onclick = function () { checkVer(true); };
  }

  function checkVer(manual) {
    if (VER.busy) return;
    VER.busy = true;
    if (manual) paintVer();
    var done = false;
    function finish(ok, remote, url, notes) {
      if (done) return;
      done = true;
      VER.busy = false;
      if (ok) {
        VER.remote = remote; VER.remoteUrl = url; VER.at = Date.now();
        if (verCmp(remote, VER.local) > 0) {
          toastUpd(remote, url || "", manual);
        } else if (manual) toast("已经是最新版 v" + (VER.local || "?"));
      } else if (manual) {
        toast("连不上，网络或代理的问题");
      }
      paintVer();
    }
    var timer = setTimeout(function () { finish(false); }, 9000);
    fetch("https://raw.githubusercontent.com/guhang42-jpg/hongguo-desktop-skin/main/version.json", { cache: "no-store" })
      .then(function (r) { clearTimeout(timer); return r.ok ? r.json() : finish(false); })
      .then(function (j) {
        if (!j) return;
        finish(true, String(j.version || ""), String(j.url || ""), String(j.notes || ""));
      })
      .catch(function () { clearTimeout(timer); finish(false); });
  }

  function renderSet() {
    var body = $("#setBody");
    if (!body) return;
    body.innerHTML = "";
    var t = $("#setTitle");
    if (t) t.textContent = SETGRP[SETTAB] || "界面";

    [].forEach.call($("#setNav").children, function (b) {
      b.classList.toggle("on", b.dataset.k === SETTAB);
    });

    if (SETTAB === "ui") {
      var g1 = grpBox("外观");
      g1.appendChild(selRow("详情页封面糊底", "拿当前这部剧的封面当详情面板底色，跟随剧换色", "已开", "已关",
        setFlag("glow"), function (on) {
          putFlag("glow", on);
          if (!on && $("#sGlow")) $("#sGlow").classList.remove("on");
          else if (on && S.active && $("#sGlow") && sheet.classList.contains("on")) $("#sGlow").classList.add("on");
        }));
      g1.appendChild(selRow("热播榜默认收起", "进首页先收起榜单，想看再点标题右边那颗钮", "已收起", "已展开",
        !!S.collapsed.rank, function (on) {
        S.collapsed.rank = !on;
        applyFold();
      }));
      body.appendChild(g1);

      var g2 = grpBox("布局");
      g2.appendChild(infoRow("左侧栏", "固定 68px 图标条，鼠标压到哪一项才浮出名字", '<span class="mono">68px · 常驻图标</span>'));
      g2.appendChild(infoRow("详情面板", "右侧滑入，选集 8 列铺满", '<span class="mono">700px · 8 列</span>'));
      body.appendChild(g2);
    } else if (SETTAB === "play") {
      var p1 = grpBox("播放");
      p1.appendChild(selRow("进播放页直接全屏", "关掉就停在剧场面板，自己点全屏", "全屏", "剧场",
        AUTO_FS, function (on) {
          AUTO_FS = on;
          LS.set("hg_auto_fs_v2", on ? 1 : 0);
          toast(on ? "下次播放直接全屏" : "下次播放停在剧场面板");
        }));
      p1.appendChild(segRow("画面铺满", "默认按哪种方式铺（原比例最稳）", [
        { k: "contain", n: "原比例" }, { k: "cover", n: "铺满" }
      ], S.fit === "cover" ? "cover" : "contain", function (k) {
        S.fit = k; S.fitManual = true;
        applyFit();
        LS.set("hg_fit_v1", k);
        renderSet();
        toast(k === "cover" ? "已切成铺满，画面不留黑边" : "已切成适应，整幅画面都看得见");
      }));
      body.appendChild(p1);

      var p2 = grpBox("取流线路");
      p2.appendChild(segRow("默认线路", "换源时优先走哪条", [
        { k: "0", n: "最优·1080P" }, { k: "2", n: "高清·720P" },
        { k: "3", n: "标清·540P" }, { k: "5", n: "省流·360P" }
      ], String(LS.get(SRCKEY, 0) || 0), function (k) {
        var i = Number(k) || 0;
        LS.set(SRCKEY, i);
        S.src = makeSrc(i);
        renderSet();
        toast("默认线路已记下，下一集起生效");
      }));
      p2.appendChild(infoRow("换源策略", "出画失败会按线路表依次往下试，记住能出画那条", '<span class="mono">6 条 · 自动</span>'));
      body.appendChild(p2);

      var p3 = grpBox("快捷键");
      p3.appendChild(infoRow("暂停 / 继续", "", '<div class="kbds"><kbd>Space</kbd></div>'));
      p3.appendChild(infoRow("上一集 / 下一集", "", '<div class="kbds"><kbd>←</kbd><kbd>→</kbd></div>'));
      p3.appendChild(infoRow("全屏切换", "", '<div class="kbds"><kbd>F</kbd></div>'));
      p3.appendChild(infoRow("弹幕开关", "", '<div class="kbds"><kbd>D</kbd></div>'));
      p3.appendChild(infoRow("倍速循环", "1x → 1.25 → 1.5 → 2x", '<div class="kbds"><kbd>R</kbd></div>'));
      p3.appendChild(infoRow("静音", "", '<div class="kbds"><kbd>M</kbd></div>'));
      p3.appendChild(infoRow("退出播放 / 关面板", "", '<div class="kbds"><kbd>Esc</kbd></div>'));
      p3.appendChild(infoRow("一键摸鱼", "窗口当场变成一张 Excel 台账", '<div class="kbds"><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>M</kbd></div>'));
      body.appendChild(p3);
    } else if (SETTAB === "local") {
      /* v1.028 语义检索体检：一行说清模型在不在、指纹对不对、跑多快 */
      var semSt = (window.HONGUO_SEM && window.HONGUO_SEM.stat()) || {};
      var l0 = grpBox("语义检索");
      var sTxt = "未加载", sCls = "";
      if (semSt.loading) { sTxt = "加载中" + (semSt.stage ? " · " + semSt.stage : ""); }
      else if (semSt.on) { sTxt = "就绪"; sCls = "ok"; }
      else if (semSt.missing) { sTxt = "本机版没装模型"; }
      else if (semSt.err) { sTxt = String(semSt.err).slice(0, 16); sCls = "bad"; }
      if (semSt.gate) sCls = sCls || "warn";
      var sLine = [
        "模型 " + (semSt.mb ? (semSt.mb / 1048576).toFixed(1) + "MB" : "—"),
        "指纹 " + (semSt.fp || "—"),
        "线程 " + (semSt.threads || 1),
        "加载 " + (semSt.loadMs ? (semSt.loadMs / 1000).toFixed(1) + "s" : "—"),
        "单句 " + (semSt.encMs ? semSt.encMs + "ms" : "—"),
        "库内 " + (semSt.n || 0) + " 部"
      ].join(" · ");
      l0.appendChild(infoRow("模型状态", semSt.gate || "bge-small-zh int8 · 句子只在这台机器上算", '<span class="spill ' + sCls + '">' + sTxt + '</span>'));
      l0.appendChild(infoRow("体检", "指纹对不上就不加载；单句超过 " + ((semSt.toMs ? semSt.toMs : 8000) / 1000) + " 秒没算完就退回关键词找",
        '<span class="mono wide">' + sLine + '</span>'));
      /* 进这一页就把模型顺手点着：别等用户跟小果聊一句才发现它没加载 */
      if (window.HONGUO_SEM && !semSt.on && !semSt.loading && !semSt.err && !semSt.missing) {
        window.HONGUO_SEM.boot().then(function () {
          if ($("#setWrap") && $("#setWrap").classList.contains("on") && SETTAB === "local") renderSet();
        });
      }
      /* 还在读的时候，这一页自己刷新一遍，别让状态卡在「加载中 · 读模型」 */
      clearTimeout(setTick);
      if (semSt.loading) setTick = setTimeout(function () {
        if ($("#setWrap") && $("#setWrap").classList.contains("on") && SETTAB === "local") renderSet();
      }, 1200);
      if (semSt.toCnt) l0.appendChild(infoRow("超时次数", "本次运行里推理超时的累计次数", '<span class="mono">' + semSt.toCnt + ' 次</span>'));
      l0.appendChild(actRow("重新加载模型", "怀疑文件坏了或刚换过模型时，重读一遍并重新核对指纹", "重载", false, function () {
        toast("正在重新加载模型…");
        window.HONGUO_SEM.reset().then(function (s) {
          renderSet();
          if (s && s.on) toast("模型已重新加载");
          else if (s && s.missing) toast("这个版本没带模型");
          else toast("没加载起来：" + String((s && s.err) || "").slice(0, 22));
        });
      }));

      var l1 = grpBox("数据");
      l1.appendChild(infoRow("数据目录", "剧库、收藏、观看进度、小果的记忆", '<span class="mono">%APPDATA%\\HonggoDesktop</span>'));
      l1.appendChild(infoRow("本地接口", "core 只在本机监听，不出这台机器", '<span class="mono">127.0.0.1:18797</span>'));
      l1.appendChild(infoRow("看过的集", "记在本地，用来给选集格画进度线", '<span class="mono" id="setResumeCnt">—</span>'));
      body.appendChild(l1);
      body.appendChild(l0);   /* 语义检索排在「数据」后面：先看清数据在哪，再看模型状态 */
      var cnt = $("#setResumeCnt");
      if (cnt) {
        var total = Object.keys(RESUME).length, seen = 0, fin = 0;
        Object.keys(RESUME).forEach(function (k) {
          var r = RESUME[k]; if (!r || !r.t || r.t < 5) return;
          seen++; if (r.d && r.t > r.d - 6) fin++;
        });
        cnt.textContent = seen + " 集 · 看完 " + fin;
      }

      var l2 = grpBox("清理");
      l2.appendChild(actRow("清空观看记录", "把每集的续播点和集格进度线一起清掉，收藏不动", "清空", true, function () {
        if (!window.confirm("清空全部观看记录？续播点和集格底下的进度线都会没了。")) return;
        RESUME = {};
        LS.set("hg_resume_v1", RESUME);
        renderEpisodeGrid(S.epTotal || 0, S.epSeg || 0);
        toast("观看记录已清空");
        renderSet();
      }));
      l2.appendChild(actRow("小果的记忆", "说「忘了吧」比这儿更彻底，连对话里的偏好一起忘", "去小果说", false, function () {
        closeSet();
        if (window.HONGUO_AI && $("#aiball")) $("#aiball").click();
      }));
      body.appendChild(l2);
    } else {
      var a1 = grpBox("更新");
      a1.appendChild(infoRow("检查方式", "起界面 12 秒后读一次版本文件，静默失败不打扰", '<span class="mono">version.json</span>'));
      a1.appendChild(infoRow("上次检查", VER.at ? new Date(VER.at).toLocaleString("zh-CN") : "本次还没查到", '<span class="mono">单次请求</span>'));
      a1.appendChild(actRow("现在检查一次", "版本号比本机高就在顶部提示，并给下载页", "检查", false, function () {
        VER.at = 0; paintVer(); checkVer(true);
      }));
      body.appendChild(a1);

      var a2 = grpBox("程序");
      a2.appendChild(infoRow("外壳", "C# + WebView2，只管窗口、托盘、摸鱼和小窗", '<span class="mono">红果短剧.exe</span>'));
      a2.appendChild(infoRow("界面", "纯前端，换皮都在这四个文件里", '<span class="mono">ui\\index.html · app.js</span>'));
      a2.appendChild(infoRow("播放内核", "本地 core，取流和接口都走它", '<span class="mono">core\\hongguo-tv-core.exe</span>'));
      a2.appendChild(infoRow("联网情况", "小果不联网、不调模型、不截屏；只有版本检查会读一次版本文件", '<span class="mono">一次请求</span>'));
      body.appendChild(a2);
    }

    paintVer();
  }

  function openSet(tab) {
    SETTAB = tab || SETTAB || "ui";
    if (sheet && sheet.classList.contains("on")) closeDetail();
    renderSet();
    $("#setMask").classList.add("on");
    SETW.classList.add("on");
  }
  function closeSet() {
    SETW.classList.remove("on");
    $("#setMask").classList.remove("on");
  }

  (function () {
    var nav = $("#setNav");
    if (!nav) return;
    var icon = {
      ui: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.4" y="4.2" width="17.2" height="15.6" rx="2.6"/><path d="M3.4 8.6h17.2"/><circle cx="6.4" cy="6.4" r=".9" fill="currentColor"/></svg>',
      play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.4"/><path d="M10.1 8.6l5.4 3.4-5.4 3.4z"/></svg>',
      local: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6.6" rx="7.4" ry="2.8"/><path d="M4.6 6.6v10.8c0 1.5 3.3 2.8 7.4 2.8s7.4-1.3 7.4-2.8V6.6"/><path d="M4.6 12c0 1.5 3.3 2.8 7.4 2.8s7.4-1.3 7.4-2.8"/></svg>',
      adv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17.6l5-5.2 3.4 3.2 6.6-7.2"/><path d="M15.6 8.4h3.6v3.6"/></svg>'
    };
    Object.keys(SETGRP).forEach(function (k) {
      var b = document.createElement("button");
      b.dataset.k = k;
      b.innerHTML = (icon[k] || "") + "<span>" + SETGRP[k] + "</span>";
      b.onclick = function () { SETTAB = k; renderSet(); };
      nav.appendChild(b);
    });
    $("#setClose").onclick = closeSet;
    $("#setMask").onclick = closeSet;
    if ($("#setBtn")) $("#setBtn").onclick = function () { openSet("ui"); };
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (SETW.classList.contains("on")) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        closeSet();
      }
    }, true);
    fetch("version.txt", { cache: "no-store" }).then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (t) { VER.local = (t || "").trim(); paintVer(); })
      .catch(function () { });
    fetch("build.txt", { cache: "no-store" }).then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (t) { VER.build = (t || "").trim(); paintVer(); })
      .catch(function () { });
  })();
  function openViewer() {
    var d = S.detail || S.active;
    viewer.classList.add("on");
    if (!S.mini && !S.fs) {
      document.body.classList.add("theater");
      if (window.GRO) GRO.mode("theater");
    }
    closeDetail();
    if (typeof AMB !== "undefined" && AMB) AMB.play(true);
    paintVTitle(d); renderVQueue();
    var cov = coverOf(d);
    $("#vPoster").style.backgroundImage = cov ? 'url("' + cov + '")' : "none";
    $("#vbg").style.backgroundImage = cov ? 'url("' + cov + '")' : "none";
    $("#pCover").src = cov;
    $("#pTitle").textContent = d.title || "";
    try { if (window.DBG) window.chrome.webview.postMessage(JSON.stringify({ action: "log", text: "play fit=" + S.fit + " autoFs=" + (AUTO_FS ? 1 : 0) })); } catch (e) { }
    loadStream();
    wake();
    /* 默认直接进真·全屏自动播放（退出全屏就是剧场面板） */
    if (AUTO_FS && !S.mini && !S.fs && !qs.get("mini") && !qs.get("moyu")) {
      setTimeout(function () {
        if (viewer.classList.contains("on") && !S.mini && !S.fs) setFs(true);
      }, 220);
    }
  }

  var lastStreamVid = null;

  /* ---------- 取流：前端缓存 + 并发去重 + 预取 ---------- */
  var STREAM_CACHE = {}, STREAM_PEND = {}, STREAM_MAX = 75000;   /* 实测最慢的一集 56 秒，给到 75 秒封顶 */
  var SLOW_TEST = qs.get("slow") ? 12000 : 0;   /* 自检用：?slow=1 人为把取流拖慢 12 秒，用来核对等待提示 */

  /* ---------- 换源：一条线路 = 画质 × 完整/分段 × 备用接口 ----------
     core 没公开"多线"参数，但 quality / mode / fallback 的不同组合在它内部是
     几条独立的取流路径（实测每种组合生成不同的 proxy 文件、走不同的上游请求）。
     因此"换源"就按线路表依次换，哪条出画就记住哪条。 */
  /* 线路记忆键换成 v2：v1 存的索引是按"720P 打头"那张表算的，
     表顺序改成 1080P 优先后旧索引会指错档，干脆另起一个键 */
  var SRCKEY = "hg_src_v2";
  /* 线路表：第一条就是最清楚的（1080P 优先），往下才是降级。
     用户没手动挑过线路时，从头开始试，拿到的最好画质就是默认画质。 */
  var SRC_PLAN = [
    { q: "1080P", mode: "full", tag: "超清·完整" },
    { q: "1080P", mode: "range", tag: "超清·分段" },
    { q: "720P", mode: "full", tag: "高清·完整" },
    { q: "540P", mode: "full", tag: "标清·完整" },
    { q: "480P", mode: "full", tag: "流畅·完整" },
    { q: "360P", mode: "full", tag: "省流·完整" }
  ];
  function makeSrc(i) {
    var s = SRC_PLAN[i] || SRC_PLAN[0];
    return { q: s.q, mode: s.mode };
  }
  function srcIndex() {
    var v = S.src;
    if (!v) return -1;
    for (var i = 0; i < SRC_PLAN.length; i++) {
      if (SRC_PLAN[i].q === v.q && SRC_PLAN[i].mode === v.mode) return i;
    }
    return -1;
  }
  function paintSrc() {
    var b = $("#vSrc"); if (!b) return;
    var i = srcIndex();
    var s = SRC_PLAN[i];
    b.textContent = "⇄ " + (i >= 0 ? (i + 1) : "自") + "/" + SRC_PLAN.length;
    b.title = "当前线路：" + (s ? s.tag : ((S.src && S.src.q) || "自动")) + " · 点一下换下一条";
  }
  function rememberSrc(i) {
    if (i >= 0) LS.set(SRCKEY, i);
  }
  function streamKey(d, vid, epIndex, qual, mode) {
    return (d && d.series_id ? d.series_id : "?") + "|" + vid + "|" + epIndex + "|" + (qual || "") + "|" + (mode || "full");
  }
  function streamParams(d, vid, epIndex, qual, mode) {
    return "series_id=" + encodeURIComponent(d.series_id) +
      "&vid=" + encodeURIComponent(vid) +
      "&episode=" + (epIndex + 1) +
      (d.content_type ? "&content_type=" + encodeURIComponent(d.content_type) : "") +
      (qual ? "&quality=" + encodeURIComponent(qual) : "") +
      "&mode=" + encodeURIComponent(mode || "full") +
      "&fallback=1";   /* 让 core 走它的备用上游接口，这是"另一条线路"的实质 */
  }
  function getPlayInfo(d, vid, epIndex, qual, mode) {
    if (qs.get("fail")) return Promise.reject(new Error("自检：这条线路不通"));   /* 自检：核失败态与换源按钮 */
    var key = streamKey(d, vid, epIndex, qual, mode);
    if (STREAM_CACHE[key]) {
      dbgLog("stream cache hit ep" + (epIndex + 1) + " " + (mode || "full"));
      return Promise.resolve(STREAM_CACHE[key]);
    }
    if (STREAM_PEND[key]) return STREAM_PEND[key];
    var t0 = Date.now();
    var p = api("/api/v1/play/info?" + streamParams(d, vid, epIndex, qual, mode), null, STREAM_MAX)
      .then(function (data) {
        delete STREAM_PEND[key];
        if (data) STREAM_CACHE[key] = data;
        dbgLog("stream req ep" + (epIndex + 1) + " " + (Date.now() - t0) + "ms path=" + ((data && data.path) || "-"));
        return data;
      }, function (e) {
        delete STREAM_PEND[key];
        dbgLog("stream req FAIL ep" + (epIndex + 1) + " " + (Date.now() - t0) + "ms " + (e && e.message));
        throw e;
      });
    STREAM_PEND[key] = p;
    if (SLOW_TEST) {
      p = p.then(function (d) { return new Promise(function (res) { setTimeout(function () { res(d); }, SLOW_TEST); }); });
      STREAM_PEND[key] = p;
    }
    return p;
  }
  function dbgLog(t) {
    if (!qs.get("dbg") || !(window.chrome && window.chrome.webview)) return;
    try { window.chrome.webview.postMessage(JSON.stringify({ action: "log", text: t })); } catch (e) { }
  }

  /* 预取：用户还在看简介 / 翻合集的时候，就把这一集（默认第 1 集）先拉上来。
     core 那边缓存好了，等他真按播放基本就是秒开。排队串行，不一次打十几枪。 */
  var prefQ = [], prefBusy = false;
  function prefetchStream(d, epIndex) {
    if (!d || !d.series_id) return;
    var vids = d.vid_list || [];
    var vid = vids[epIndex];
    if (!vid) return;
    if (prefQ.length >= 3) prefQ.shift();
    prefQ.push({ d: d, vid: vid, ep: epIndex });
    if (!prefBusy) pumpPrefetch();
  }
  function pumpPrefetch() {
    var job = prefQ.shift();
    if (!job) { prefBusy = false; return; }
    prefBusy = true;
    var cur = S.src || makeSrc(0);
    getPlayInfo(job.d, job.vid, job.ep, cur.q, cur.mode).catch(function () { }).then(function () {
      prefBusy = false;
      setTimeout(pumpPrefetch, 200);
    });
  }

  /* 加载提示分阶段升级：先说是"正在解析"，等久了告诉他是首开慢，别让他以为死机 */
  var loadStageT = null;
  function stopLoadStage() { if (loadStageT) { clearInterval(loadStageT); loadStageT = null; } }
  function startLoadStage() {
    stopLoadStage();
    var t0 = Date.now();
    var paint = function () {
      var box = $("#vLoadMsg");
      if (!box) return;
      var s = (Date.now() - t0) / 1000;
      if (s < 4) box.innerHTML = "正在解析播放源…";
      else if (s < 14) box.innerHTML = "正在解析播放源…<br><i>这部剧没缓存过，官方要把片源现拉一遍，通常十几秒</i>";
      else if (s < 40) box.innerHTML = "还在解析，第一次打开确实慢<br><i>拉过一次就缓存住了，同一集下次是秒开；也可以点「重试」</i>";
      else box.innerHTML = "解析已经超过 40 秒<br><i>多半是官方片源侧慢，点「重试」再来一次，或退回列表重新点开</i>";
    };
    paint();
    loadStageT = setInterval(paint, 1000);
  }
  function showLoad(on) {
    $("#vLoad").classList.remove("err");
    if (on) {
      $("#vLoadMsg").innerHTML = "";
      $("#vLoad").classList.remove("hide");
      $("#vOfficial").classList.add("hide");
      $("#vPause").classList.add("hide");   /* 那颗大暂停键会正好压在转圈和文案上，等的时候收起来 */
      startLoadStage();
    } else {
      $("#vLoad").classList.add("hide");
      stopLoadStage();
    }
  }
  function showLoadError(text) {
    stopLoadStage();
    $("#vLoad").classList.remove("hide");
    $("#vLoad").classList.add("err");
    $("#vLoadMsg").innerHTML = text;
  }

  /* core 的取流错误码翻成人话：这些码是 core 内部 stage 名，直接甩给用户等于没说 */
  var PLAY_ERR = {
    VIDEO_MODEL_EMPTY: "官方片源这次返回了空内容",
    VIDEO_MODEL_LIST_EMPTY: "官方片源列表是空的",
    VIDEO_MODEL_HTTP: "取片源的请求没通",
    VIDEO_MODEL_READ: "取片源的响应读到一半断了",
    VIDEO_MODEL_JSON: "取片源的响应看不懂（格式变了）",
    VIDEO_MODEL_SIGN: "片源签名校验没过",
    VIDEO_TAB_EMPTY: "这一集的播放信息是空的",
    DEVICE_REGISTER_FAILED: "设备注册没过，官方认不出这台机器",
    MEDIA_DECRYPT_FAILED: "片源解密失败",
    MEDIA_CACHE_WRITE_FAILED: "片源缓存写不进磁盘",
    FALLBACK_API_HTTP: "备用取流接口没通",
    FALLBACK_API_READ: "备用取流接口读取失败",
    no_public_source: "官网也没公开这一集的片源"
  };
  function playErrText(raw) {
    var m = String(raw || "");
    for (var k in PLAY_ERR) if (m.indexOf(k) >= 0) return PLAY_ERR[k] + "（" + k + "）";
    if (/Failed to fetch|NetworkError|load failed/i.test(m)) return "内置服务没响应（core 可能已经掉了）";
    return m;
  }

  /* 官网页的公开片源：core 走的那套 App 取流接口这几天对所有剧、所有画质都回空包，
     但官网页还给普通访问者留了一条兜底（接口由外壳 App.cs 代理，见 playWeb）。
     那条 SEO 页的 /video/public/<vid>/360p.mp4 只有 10 秒预告，别拿它当正片。 */
  var WPORT = qs.get("wport") || "";
  var WEBURL = {};        /* vid -> {url, expire}，官方给的是带签名的临时 CDN 地址，会过期 */
  var webSaid = 0;
  /* core 返空是这段时间的常态，刚碰过一次就别再让每一集都干等它 4 秒：8 分钟内直接走官网兜底 */
  var webUntil = 0;

  function loadStream(qual, seamless, force) {
    var d = S.active;
    var vid = S.vids[S.epIndex];
    if (!vid) {
      /* 以前这里静默 return，点集数就是"没反应"；现在把原因说出来 */
      showLoadError("这一集还没拿到视频号（分集数据不全）<br>" +
        "<i>退回列表重新点开这部剧，让它把分集取全再来；如果只有前几集能播，那是官方按集数锁的。</i>");
      $("#vPlay").textContent = "▶";
      toast("这一集缺分集数据，关掉重开详情再试");
      return;
    }
    /* 线路状态：第一次播放就用上次成功过的线路，没有就用第一条 */
    if (!S.src) S.src = makeSrc(LS.get(SRCKEY, 0) || 0);
    if (qual) S.src.q = qual;
    var q = S.src.q, mode = S.src.mode;
    /* 刚确认过 core 在返空，8 分钟内不再等它，直接走官网兜底 */
    if (Date.now() < webUntil) { playWeb(vid, "VIDEO_MODEL_EMPTY"); return; }
    var myIdx = srcIndex();   /* 这条请求属于哪条线路，回来时按它记账（中途换源也不串） */
    if (force) {
      /* 重试：把这一集这条线路的缓存标记清掉，重新问一次 core（core 那边若已缓存会秒回） */
      delete STREAM_CACHE[streamKey(d, vid, S.epIndex, q, mode)];
      delete STREAM_CACHE[streamKey(d, vid, S.epIndex, "", mode)];
    }
    paintSrc();
    if (seamless) {
      /* 无缝接集：不弹海报/不弹 loading，直接用同一个视频面切源 */
      showLoad(false);
      $("#vPoster").classList.add("hide");
    } else {
      showLoad(true);
      $("#vPoster").classList.remove("hide");
    }
    getPlayInfo(d, vid, S.epIndex, q, mode).then(function (data) {
      S.playInfo = data;
      S.quality = data.quality || "";
      renderQuality(data);
      rememberSrc(myIdx);   /* 这条线路真出流了，记住它，下次开局直接用 */
      if (!data.path) throw new Error("这条视频暂时没有可用播放源");
      /* 同一集重取流（换清晰度/重试）续当前位置；换集默认从头，除非用户是主动点回这一集（有续播点） */
      var sameEp = (lastStreamVid === vid);
      var keep = sameEp ? (video.currentTime || 0) : (S.resumeAt || 0);
      var wasResume = !sameEp && keep > 4;
      S.resumeAt = 0;
      lastStreamVid = vid;
      if (!sameEp) {
        /* 换集：先把旧源卸干净，否则 WebView2 有时会沿用上一集的播放位置/缓冲 */
        try { video.pause(); } catch (e) { }
        video.removeAttribute("src");
        try { video.load(); } catch (e) { }
        $("#vPoster").classList.add("hide");
        if (!seamless) showLoad(true);
      }
      video.src = BASE + data.path + (sameEp ? "" : "#ep" + (S.epIndex + 1));
      if (!sameEp) {
        /* 一次到位：先归零，再（若需要）跳回续播点，避免两个 once 监听互相抢 */
        video.addEventListener("loadedmetadata", function once3() {
          video.removeEventListener("loadedmetadata", once3);
          try { video.currentTime = keep > 0.5 ? keep : 0; } catch (e) { }
          if (wasResume) toast("已续播到 " + fmt(keep));
          if (qs.get("dbg") && window.chrome && window.chrome.webview) {
            var seekLog = function () {
              video.removeEventListener("seeked", seekLog);
              window.chrome.webview.postMessage(JSON.stringify({ action: "log", text: "ep" + (S.epIndex + 1) + " seeked=" + (video.currentTime || 0).toFixed(2) }));
            };
            video.addEventListener("seeked", seekLog);
          }
        });
      }
      if (sameEp && keep > 1) {
        video.addEventListener("loadedmetadata", function once() {
          video.removeEventListener("loadedmetadata", once);
          try { video.currentTime = keep; } catch (e) { }
        });
      }
      var p = video.play();
      if (p && p.catch) p.catch(function () { });
      /* 换集瞬间浏览器会补发一次 pause（切源重置引起），会误亮中间的暂停键；延迟兜底收掉 */
      setTimeout(function () { if (!video.paused) $("#vPause").classList.add("hide"); }, 300);
      if (FFTEST) {
        video.addEventListener("loadedmetadata", function ffonce() {
          video.removeEventListener("loadedmetadata", ffonce);
          try { video.currentTime = Math.max(0, (video.duration || 60) - 1.2); } catch (e) { }
        });
      }
      $("#vPlay").textContent = "❚❚";
      $("#vPause").classList.add("hide");
      $("#pSub").textContent = epLabel(S.epIndex) + (data.quality ? " · " + data.quality : "") +
        (S.src && S.src.mode === "range" ? " · 分段" : "");
      loadDanmaku(vid);
      saveProgress();
      /* 播起来了就顺手把下一集拉上来：这样播完自动接集不用再等（串行排队，只拉一集） */
      setTimeout(function () {
        var dd = S.detail || S.active;
        if (dd && viewer.classList.contains("on")) prefetchStream(dd, S.epIndex + 1);
      }, 4000);
      if (qs.get("dbg") && window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify({ action: "log", text: "ep" + (S.epIndex + 1) + " vid=" + vid + " t0=" + (video.currentTime || 0).toFixed(2) + " seamless=" + !!seamless }));
      }
    }).catch(function (e) {
      var raw = (e && e.message ? e.message : "未知原因");
      /* 上游返空（VIDEO_MODEL_EMPTY 那一族）不是线路问题，六条线路全打在同一台挂掉的上游，
         换源只是多等几轮同样的空包 —— 直接退到官网公开片源 */
      if (/VIDEO_MODEL_|VIDEO_TAB_|FALLBACK_API_|DEVICE_REGISTER/i.test(raw)) {
        webUntil = Date.now() + 8 * 60 * 1000;
        if (!webSaid) {
          webSaid = 1;
          toast("core 的取流接口返空，已改走官网页公开片源（360P）");
        }
        playWeb(vid, raw);
        return;
      }
      var waited = /等太久了|超时|timed out|aborted|abort/i.test(raw);   /* 秒错可以自动换源，等满 75 秒的自己点 */
      var idx = srcIndex(); if (idx < 0) idx = 0;
      var left = SRC_PLAN.length - (idx + 1);
      if (!waited && left > 0) {
        S.src = makeSrc(idx + 1); paintSrc();
        toast("这条线路没出流，自动换到 " + SRC_PLAN[idx + 1].tag + "（新线路要重新取一次流）");
        loadStream(null, false, true);
        return;
      }
      var msg = playErrText(raw);
      $("#vOfficial").classList.add("hide");
      showLoadError("取不到播放源：<i>" + msg + "</i><br>" +
        "<i>现在是第 " + (idx + 1) + "/" + SRC_PLAN.length + " 路（" + SRC_PLAN[idx].tag + "）。" +
        "点<span style=\"white-space:nowrap\">「换个源」</span>走另一条取流路径，或" +
        "<span style=\"white-space:nowrap\">「重试」</span>再要一次。</i>");
      $("#vPlay").textContent = "▶";
      toast("取流失败：" + msg);
    });
  }

  /* core 返空时的兜底：走官网页那条公开兜底接口，拿一支完整的 360P 明文 MP4（H.264 + AAC）。
     注意别拿 SEO 页里那支 /video/public/<vid>/360p.mp4 —— 那支只有 10 秒，是预告不是正片。
     官网页不给跨域读，所以由外壳 App.cs 在 127.0.0.1 上开一个小代理（它补了 CORS 头），
     本页只负责 fetch 一下拿地址，再把地址交给 video。 */
  function webPlayFetch(vid) {
    return new Promise(function (res, rej) {
      var c = WEBURL[vid], now = Math.floor(Date.now() / 1000);
      if (c && c.url && (!c.expire || c.expire - 30 > now)) { res(c.url); return; }
      if (!WPORT) { rej(new Error("外壳的片源代理没开")); return; }
      fetch("http://127.0.0.1:" + WPORT + "/webplay?vid=" + encodeURIComponent(vid))
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || !j.ok || !j.url) throw new Error((j && j.error) || "no_source");
          WEBURL[vid] = { url: j.url, expire: j.expire || 0 };
          res(j.url);
        })
        .catch(function (e) { rej(e); });
    });
  }

  function playWeb(vid, raw) {
    var url = "";
    var sameEp = (lastStreamVid === vid);
    var keep = sameEp ? (video.currentTime || 0) : (S.resumeAt || 0);
    var wasResume = !sameEp && keep > 4;
    var settled = false, guard = null;

    function cleanup() {
      settled = true;
      if (guard) { clearTimeout(guard); guard = null; }
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("error", onErr);
    }
    function giveUp(why) {
      if (settled) return;
      cleanup();
      lastStreamVid = null;
      webUntil = 0;      /* 官网这条也不通，就别再拦着 core 了，下次老老实实先问 core */
      $("#vOfficial").classList.remove("hide");
      var lockNote = (S.locked && S.locked[S.epIndex])
        ? " 官方把这集锁着" + (S.freeN ? "（这部剧本机免费到第 " + S.freeN + " 集）" : "") + "，本机拿不到公开片源。"
        : "";
      showLoadError("取不到播放源：<i>" + playErrText(raw) + "</i><br>" +
        "<i>core 的取流接口对所有剧都返空，官网页那条兜底接口也没给出这一集的片源（" + why + "）。" +
        lockNote + "换一集，或点<span style=\"white-space:nowrap\">「打开官方网页」</span>去官方看。</i>");
      $("#vPlay").textContent = "▶";
      toast("这一集拿不到片源");
    }
    function onErr() { giveUp("媒体加载失败"); }
    function onMeta() {
      if (settled) return;
      cleanup();
      if (!video.duration || video.duration < 2) { giveUp("拿到的不是完整视频"); return; }
      try { video.currentTime = keep > 0.5 ? keep : 0; } catch (e) { }
      S.resumeAt = 0;
      lastStreamVid = vid;
      S.playInfo = { path: url, quality: "360P·官网", qualities: ["360P·官网"], web: true };
      S.quality = "360P·官网";
      var box = $("#vQual"); box.innerHTML = "";
      var b = document.createElement("button");
      b.className = "vq on";
      b.textContent = "360P·官网";
      b.title = "core 取流返空，这是官网页兜底接口给的完整片源；点一下重新问一次 core";
      b.onclick = function () { loadStream(null, false, true); };
      box.appendChild(b);
      $("#pSub").textContent = epLabel(S.epIndex) + " · 360P·官网";
      showLoad(false);
      $("#vPoster").classList.add("hide");
      $("#vPlay").textContent = "❚❚";
      $("#vPause").classList.add("hide");
      if (wasResume) toast("已续播到 " + fmt(keep));
      dbgLog("web fallback OK ep" + (S.epIndex + 1) + " dur=" + (video.duration || 0).toFixed(2) + "s");
      loadDanmaku(vid);
      saveProgress();
      setTimeout(function () {
        var dd = S.detail || S.active;
        if (dd && viewer.classList.contains("on")) prefetchStream(dd, S.epIndex + 1);
      }, 4000);
    }

    /* 换集/重取先把旧源卸干净，否则 WebView2 会沿用上一集的位置 */
    try { video.pause(); } catch (e) { }
    video.removeAttribute("src");
    try { video.load(); } catch (e) { }
    showLoad(true);
    $("#vPoster").classList.remove("hide");

    webPlayFetch(vid).then(function (u) {
      /* 等这一下的工夫用户可能已经换集了，串台就丢掉 */
      if (settled || String(S.vids[S.epIndex]) !== String(vid)) return;
      /* 那台 CDN 只认官网的 Referer，浏览器直连会 403，所以媒体也走外壳的本地转发 */
      url = "http://127.0.0.1:" + WPORT + "/media?u=" + encodeURIComponent(u);
      video.addEventListener("loadedmetadata", onMeta);
      video.addEventListener("error", onErr);
      guard = setTimeout(function () { giveUp("等了两分钟没动静"); }, 120000);
      video.src = url;
      var p = video.play();
      if (p && p.catch) p.catch(function () { });
      dbgLog("web fallback ep" + (S.epIndex + 1) + " vid=" + vid + " src=" + String(u).slice(0, 48));
    }, function (e) {
      giveUp((e && e.message) || "代理没响应");
    });
  }

  /* 换到线路表的下一路（走到末尾绕回第一条） */
  function nextSource(silent) {
    var i = srcIndex();
    var n = i < 0 ? 0 : (i + 1) % SRC_PLAN.length;
    S.src = makeSrc(n);
    paintSrc();
    if (!silent) toast("换到线路 " + (n + 1) + "/" + SRC_PLAN.length + "：" + SRC_PLAN[n].tag +
      " · 这条要重新取一次流，可能还得等十几秒");
    loadStream(null, false, true);
  }

  function renderQuality(data) {
    var box = $("#vQual"); box.innerHTML = "";
    var list = data.qualities && data.qualities.length ? data.qualities : [data.quality].filter(Boolean);
    list.forEach(function (q) {
      var b = document.createElement("button");
      b.className = "vq" + (q === S.quality ? " on" : "");
      b.textContent = q;
      b.onclick = function () {
        loadStream(q);
        if (/1080/i.test(q) && window.GRO) GRO.flag("hd");
      };
      box.appendChild(b);
    });
  }

  function loadDanmaku(vid) {
    S.danmaku = []; S.dmIdx = 0;
    api("/api/v1/danmaku?series_id=" + encodeURIComponent(S.active.series_id) + "&vid=" + encodeURIComponent(vid))
      .then(function (data) {
        var items = (data && data.items) || [];
        items = items.filter(function (x) { return x && x.text; })
          .sort(function (a, b) { return (a.offset_ms || 0) - (b.offset_ms || 0); });
        S.danmaku = items; S.dmIdx = 0;
      }).catch(function () { S.danmaku = []; });
  }

  function spawnDm(text, mine) {
    var layer = $("#dmLayer"), box = layer.getBoundingClientRect();
    if (!box.width) return;
    var cap = document.body.classList.contains("mini") ? 6 : 18;
    if (!mine && layer.children.length >= cap) return;
    var el = document.createElement("div");
    el.className = "dm" + (mine ? " mine" : "");
    el.textContent = text;
    var lanes = document.body.classList.contains("mini") ? 4 : 9;
    var lane = Math.floor(Math.random() * lanes);
    el.style.top = (12 + lane * Math.floor((box.height - 70) / (lanes + 1))) + "px";
    el.style.left = "100%";
    layer.appendChild(el);
    var w = el.offsetWidth, dur = 8 + Math.random() * 4;
    el.animate([{ transform: "translateX(0)" }, { transform: "translateX(-" + (box.width + w + 30) + "px)" }],
      { duration: dur * 1000, easing: "linear", fill: "forwards" });
    setTimeout(function () { el.remove(); }, dur * 1000 + 120);
  }

  function tickDanmaku() {
    if (!S.dmOn || video.paused) return;
    var t = (video.currentTime || 0) * 1000;
    while (S.dmIdx < S.danmaku.length && (S.danmaku[S.dmIdx].offset_ms || 0) <= t) {
      spawnDm(S.danmaku[S.dmIdx].text);
      S.dmIdx++;
    }
  }

  var lastResumeSave = 0;
  video.addEventListener("timeupdate", function () {
    var d = video.duration || 0, t = video.currentTime || 0;
    $("#vCur").textContent = fmt(t); $("#vDur").textContent = fmt(d);
    $("#vFill").style.width = (d ? t / d * 100 : 0) + "%";
    $("#pCur").textContent = fmt(t); $("#pDur").textContent = fmt(d);
    $("#pFill").style.width = (d ? t / d * 100 : 0) + "%";
    tickDanmaku();
    /* 每 4 秒落一次续播点，够细也不会太吵 */
    var now = Date.now();
    if (!video.paused && t > 3 && now - lastResumeSave > 4000) { lastResumeSave = now; saveResume(); }
    /* 有声无画的兜底：解码器缺了时音频照常推进，但 videoWidth 一直是 0 */
    if (!video.paused && t > 2 && video.videoWidth === 0) warnNoPicture();
  });
  video.addEventListener("loadeddata", function () { showLoad(false); $("#vPoster").classList.add("hide"); });
  video.addEventListener("playing", function () { showLoad(false); $("#vPause").classList.add("hide"); });
  video.addEventListener("waiting", function () {
    /* 缓冲等数据时也给一句话，别让人对着空画面发呆 */
    if ($("#vLoad").classList.contains("err")) return;
    $("#vLoad").classList.remove("hide");
    if (!$("#vLoadMsg").innerHTML) $("#vLoadMsg").innerHTML = "画面缓冲中…";
  });
  video.addEventListener("error", function () {
    showLoad(false);
    if (NOHEVC) { warnNoPicture(); return; }
    toast("播放源打不开，点击⟳重试或换一集");
  });
  video.addEventListener("play", function () { userPause = false; $("#vPlay").textContent = "❚❚"; $("#pPlay").textContent = "❚❚"; $("#vPause").classList.add("hide"); });
  /* 只有用户自己按的暂停才亮中间那颗暂停键；切源/换集时浏览器补发的 pause 不算 */
  video.addEventListener("pause", function () {
    if (switching || !userPause) return;
    $("#vPlay").textContent = "▶"; $("#pPlay").textContent = "▶"; $("#vPause").classList.remove("hide");
  });
  /* 播完直接无缝接下一集：不读秒、不重建播放器外壳，避免画面跳变 */
  var nextTimer = null;
  var switching = false;
  var userPause = false;
  function clearNextCue() { if (nextTimer) { clearInterval(nextTimer); nextTimer = null; } }

  function nextEp() {
    if (S.epIndex >= S.vids.length - 1) { $("#vPlay").textContent = "▶"; toast("已经是最后一集了"); return; }
    /* 自动接集永远从头播，不继承上一集的续播点 */
    S.resumeAt = 0;
    S.epIndex += 1;
    var d = S.detail || S.active || {};
    paintVTitle(d); renderVQueue();
    if (S.epTotal) renderEpisodeGrid(S.epTotal, Math.floor(S.epIndex / EP_SEG));
    else [...$("#sEps").children].forEach(function (b) { b.classList.toggle("on", Number(b.dataset.i) === S.epIndex); });
    if (window.GRO && S.active) GRO.episode(S.active.series_id, S.epIndex, S.quality, S.active.tags);
    switching = true;         /* 切源期间的 pause 事件不算"用户暂停" */
    setTimeout(function () { switching = false; }, 900);
    loadStream(null, true);   /* seamless：沿用当前播放面，不闪海报/不重排控制条 */
    toast("正在播放 第 " + (S.epIndex + 1) + " 集");
  }

  video.addEventListener("ended", function () {
    if (window.GRO) GRO.finish();
    if (S.epIndex < S.vids.length - 1) nextEp();
    else { $("#vPlay").textContent = "▶"; toast("已经是最后一集了"); }
  });

  $("#vBack").onclick = function () { exitFs(); closeViewer(); };

  /* 全屏/小窗是两种互斥的窗口形态：切之前先把另一种收掉，否则窗口尺寸和画面会打架 */
  function clearFsQuiet() {
    if (!S.fs) return;
    S.fs = false;
    document.body.classList.remove("fs");
    $("#vFull").textContent = "⛶";
    if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(JSON.stringify({ action: "fs", on: false }));
  }

  function setFs(on) {
    if (on) S.fsFromMini = !!S.mini;             /* 记住是不是从小窗切过来的 */
    if (on && S.mini) setMini(false);            /* 小窗 → 全屏：先退出小窗形态 */
    S.fs = on;
    if (on) {
      S.wasTheater = document.body.classList.contains("theater");
      document.body.classList.remove("theater");
      if (window.GRO) GRO.mode("fs");
      /* 全屏也不再偷改画面模式：用户选的原比例（或铺满）就是全屏里的样子，
         要换自己在播放条上点 ▤/▭，别一边说着"优先原比例"一边进全屏就裁 */
    } else if (S.wasTheater && viewer.classList.contains("on") && !S.mini) {
      document.body.classList.add("theater");
      if (S.prevFitFs) { S.fit = S.prevFitFs; applyFit(); }
    }
    document.body.classList.toggle("fs", on);
    $("#vFull").textContent = on ? "⤡" : "⛶";
    if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(JSON.stringify({ action: "fs", on: on }));
    if (!on && S.fsFromMini) {                    /* 从小窗切来的全屏，退出就回小窗，别乱跳成大窗 */
      S.fsFromMini = false;
      setTimeout(function () { setMini(true); }, 60);
    }
  }
  function exitFs() { if (S.fs) setFs(false); }
  window.exitFs = exitFs;
  $("#vFull").onclick = function (e) { e.stopPropagation(); setFs(!S.fs); };
  document.querySelectorAll(".vstage, #video, #vPause").forEach(function (el) {
    el.addEventListener("dblclick", function (e) { e.preventDefault(); setFs(!S.fs); });
  });
  function togglePlay() {
    if (video.paused) { userPause = false; video.play(); $("#vPause").classList.add("hide"); }
    else { userPause = true; video.pause(); }
  }
  $("#vPause").onclick = togglePlay;
  $("#vPlay").onclick = togglePlay;
  $("#vPrev").onclick = function () { if (S.epIndex > 0) playEpisode(S.epIndex - 1); else toast("已经是第 1 集"); };
  $("#vNext").onclick = function () { if (S.epIndex < S.vids.length - 1) playEpisode(S.epIndex + 1); else toast("已经是最后一集"); };
  $("#vRetry").onclick = function () { loadStream(null, false, true); };
  $("#vSrc").onclick = function () { nextSource(false); };
  $("#vSrcGo").onclick = function () { nextSource(false); };
  $("#vRetry2").onclick = function () { loadStream(null, false, true); };
  /* 官方片源抽空时的兜底：用系统浏览器打开红果官方站，至少能看 */
  $("#vOfficial").onclick = function () {
    var u = "https://hongguoduanju.com/";
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(JSON.stringify({ action: "openUrl", url: u }));
      toast("已在浏览器打开官方站");
    } else {
      window.open(u, "_blank");
    }
  };
  $("#vEps").onclick = function () { exitFs(); closeViewer(); if (S.active) openDetail(S.active, S.epIndex); };
  $("#vBar").onclick = function (e) {
    var r = e.currentTarget.getBoundingClientRect();
    var p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (video.duration) video.currentTime = video.duration * p;
  };
  $("#pBar").onclick = $("#vBar").onclick;
  /* ---------- 倍速 + 音量（都记住上次的选择） ---------- */
  var RATES = [1, 1.25, 1.5, 2, 0.75];
  function applyRate(r) {
    if (RATES.indexOf(r) < 0) r = 1;
    S.rate = r;
    video.playbackRate = r;
    var btn = $("#vRate");
    if (btn) {
      btn.textContent = (r === 1 ? "1.0" : String(r)) + "×";
      btn.classList.toggle("on", r !== 1);
    }
    LS.set("hg_rate_v1", r);
  }
  function applyVol(v, mute) {
    S.vol = Math.min(1, Math.max(0, v));
    video.volume = S.vol;
    video.muted = !!mute;
    var btn = $("#vVol"), rng = $("#volRange"), rt = $("#volMute"), pop = $("#volPop");
    if (btn) btn.textContent = (video.muted || S.vol === 0) ? "🔇" : (S.vol < 0.5 ? "🔉" : "🔊");
    if (rng) {
      var pct = Math.round(S.vol * 100);
      rng.value = pct;
      rng.style.setProperty("--vp", pct + "%");
    }
    if (rt) rt.classList.toggle("on", !!video.muted);
    if (pop) pop.classList.toggle("muted", !!video.muted);
    LS.set("hg_vol_v1", { v: S.vol, m: !!mute });
  }
  var rateCycle = function () { var i = RATES.indexOf(S.rate); var nx = RATES[(i + 1) % RATES.length]; applyRate(nx); toast("倍速 " + nx + "×"); };
  $("#vRate").onclick = rateCycle;
  /* 音量：点图标开/关滑条，滑条直接拖；右边"静音"按钮一键切 */
  $("#vVol").onclick = function (e) {
    e.stopPropagation();
    var pop = $("#volPop");
    if (pop) pop.classList.toggle("on");
  };
  $("#volRange").addEventListener("input", function (e) {
    applyVol(Number(e.target.value) / 100, false);
  });
  $("#volMute").onclick = function (e) {
    e.stopPropagation();
    applyVol(S.vol || 0.8, !video.muted);
    toast(video.muted ? "已静音（点滑条恢复）" : "音量 " + Math.round(S.vol * 100) + "%");
  };
  document.addEventListener("click", function (e) {
    var pop = $("#volPop");
    if (!pop || !pop.classList.contains("on")) return;
    if (e.target.closest(".volwrap")) return;
    pop.classList.remove("on");
  });
  /* 画面里滚轮调音量，不占控制条 */
  var volMsgAt = 0;
  $(".vstage").addEventListener("wheel", function (e) {
    if (!viewer.classList.contains("on")) return;
    e.preventDefault();
    applyVol(S.vol + (e.deltaY < 0 ? 0.05 : -0.05), false);
    var now = Date.now();
    if (now - volMsgAt > 400) { volMsgAt = now; toast("音量 " + Math.round(S.vol * 100) + "%"); }
  }, { passive: false });
  var iv = LS.get("hg_vol_v1", null);
  applyVol(iv && typeof iv.v === "number" ? iv.v : 1, !!(iv && iv.m));
  applyRate(LS.get("hg_rate_v1", 1));
  video.addEventListener("volumechange", function () {
    var btn = $("#vVol");
    if (btn) btn.textContent = (video.muted || video.volume === 0) ? "🔇" : (video.volume < 0.5 ? "🔉" : "🔊");
    var rt = $("#volMute");
    if (rt) rt.classList.toggle("on", !!video.muted);
  });

  /* 弹幕开关不再占控制条，改键盘 D 切换（顶部那条"弹幕 开/关"碍眼已拿掉） */
  function toggleDanmaku() {
    S.dmOn = !S.dmOn;
    if (!S.dmOn) $("#dmLayer").innerHTML = "";
    toast(S.dmOn ? "弹幕：开" : "弹幕：关（按 D 再开）");
  }
  $("#dmSend").onclick = sendDanmaku;
  $("#dmText").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); sendDanmaku(); } });
  function sendDanmaku() {
    var input = $("#dmText"), text = input.value.trim();
    if (!text) return;
    spawnDm(text, true);
    input.value = "";
    if (window.GRO) GRO.dm();
    api("/api/v1/player/action", { json: { action: "danmaku", series_id: S.active.series_id, vid: S.vids[S.epIndex], episode: S.epIndex + 1, position_ms: Math.round((video.currentTime || 0) * 1000), text: text } })
      .then(function () { toast("弹幕已发送"); })
      .catch(function () { toast("弹幕已在本机显示（发送没成功）"); });
  }

  /* ---------- 迷你播放条 ---------- */
  $("#pPlay").onclick = function () { if (viewer.classList.contains("on")) { video.paused ? video.play() : video.pause(); return; } if (S.active) playEpisode(S.epIndex); else toast("先挑一部剧"); };
  $("#pOpen").onclick = function () { if (S.active && S.vids.length) openViewer(); else if (S.active) openDetail(S.active, S.epIndex); else toast("先挑一部剧"); };
  $("#pEps").onclick = $("#vEps").onclick;
  $("#pPrev").onclick = $("#vPrev").onclick;
  $("#pNext").onclick = $("#vNext").onclick;

  /* ---------- 收藏 / 追更 / 进度 ---------- */
  function dramaOf(item) {
    var out = {};
    ["series_id", "title", "cover", "cover_fallback", "intro", "score", "episode_count", "tags",
      "content_type", "video_category_type", "season_index", "is_multi_season", "series_status",
      "following_update", "followed"].forEach(function (k) { if (item[k] !== undefined) out[k] = item[k]; });
    if (typeof out.intro === "string") out.intro = out.intro.slice(0, 1000);
    return out;
  }
  function libEntry(id) {
    var lib = S.library; if (!lib || !lib.entries) return null;
    return lib.entries.filter(function (e) { return (e.drama && e.drama.series_id === id) || e.series_id === id; })[0] || null;
  }
  function isFavorite(item) { var e = libEntry(item && item.series_id); return !!(e && e.favorite_at); }

  function changeLibrary(change) {
    if (!S.library) S.library = { entries: [] };
    change.owner_id = S.library.owner_id || "";
    return api("/api/v1/library", { json: change }).then(function (data) {
      if (data) S.library = data;
      return data;
    });
  }

  function toggleFavorite(item) {
    if (!item) return;
    var faved = isFavorite(item);
    changeLibrary({ action: "favorite", drama: dramaOf(item), value: !faved }).then(function () {
      var sb = $("#sFav").querySelector("b"), si = $("#sFav").querySelector("i");
      if (sb) sb.textContent = faved ? "收藏" : "已藏";
      if (si) si.textContent = faved ? "♡" : "♥";
      toast(faved ? "已取消收藏" : "已收藏");
      if (!faved && window.GRO) GRO.fav(item.series_id);
    }).catch(function (e) { toast("收藏没保存成功：" + e.message); });
  }

  function toggleFollow(item) {
    if (!item) return;
    var on = !(item.following_update || item.followed);
    api("/api/v1/follow", { json: { series_id: item.series_id, enabled: on } }).then(function () {
      item.following_update = on; item.followed = on;
      $("#heroFollow").textContent = on ? "🔔 已追更" : "♡ 追更";
      $("#sFollow").querySelector("b").textContent = on ? "已追" : "追更";
      toast(on ? "已加入追更" : "已取消追更");
      if (on && window.GRO) GRO.follow(item.series_id);
    }).catch(function (e) { toast("追更没成功：" + e.message); });
  }

  var lastProgress = 0;
  function saveProgress() {
    if (!S.active || !S.vids.length) return;
    var now = Date.now();
    if (now - lastProgress < 8000) return;
    lastProgress = now;
    changeLibrary({
      action: "progress", drama: dramaOf(S.active), episode: S.epIndex + 1,
      video_id: S.vids[S.epIndex], position: video.currentTime || 0,
      duration: isFinite(video.duration) ? video.duration : 0, completed: false
    }).catch(function () { });
  }
  setInterval(function () { if (viewer.classList.contains("on") && !video.paused) saveProgress(); }, 10000);

  /* ---------- 我的：追剧 / 收藏 ---------- */
  var MINEKEY = "hg_mine_v1";
  var MINE = LS.get(MINEKEY, {}) || {};
  if (!MINE.hidden) MINE.hidden = [];
  if (MINE.view !== "list") MINE.view = "grid";
  function mineSave() { LS.set(MINEKEY, MINE); }
  var mineQT = null;   /* 搜索输入的防抖定时器 */
  function sidOf(e) {
    return String((e && e.drama && e.drama.series_id) || (e && e.series_id) || "");
  }
  function mineHidden(id) { return MINE.hidden.indexOf(String(id)) >= 0; }
  /* 「已看完」只用真数据判：条目自己说 completed 就听它；有 position/duration 就按 96%；
     都没有就退到"看到最后一集"。三种都是实际记录，不猜。 */
  function entryDone(e) {
    if (!e) return false;
    if (e.completed) return true;
    var d = Number(e.duration || 0), p = Number(e.position || 0);
    if (d > 0 && p / d >= 0.96) return true;
    var ec = Number((e.drama && e.drama.episode_count) || e.episode_count || 0);
    if (ec > 0 && Number(e.episode || 0) >= ec) return true;
    return false;
  }

  var MG_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.6" y="3.6" width="7" height="7" rx="2"/><rect x="13.4" y="3.6" width="7" height="7" rx="2"/><rect x="3.6" y="13.4" width="7" height="7" rx="2"/><rect x="13.4" y="13.4" width="7" height="7" rx="2"/></svg>';
  var ML_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 7.2h16M4 12h16M4 17h10"/></svg>';
  var FIND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.6" cy="10.6" r="6.4"/><path d="M15.4 15.4 20 20"/></svg>';

  function mineToggleSel(id) {
    if (!S.mineSel) S.mineSel = [];
    var i = S.mineSel.indexOf(String(id));
    if (i >= 0) S.mineSel.splice(i, 1); else S.mineSel.push(String(id));
    renderMine(true);
  }

  /* 管理里点「取消收藏 / 从本机隐藏」：前者回写 core，后者只动这台机器的列表 */
  function mineAct(tab) {
    var sel = (S.mineSel || []).slice();
    if (!sel.length) return;
    if (tab === "fav") {
      var entries = ((S.library && S.library.entries) || []);
      var hits = entries.filter(function (e) { return sel.indexOf(sidOf(e)) >= 0; });
      if (!hits.length) return;
      hits.forEach(function (e) {
        changeLibrary({ action: "favorite", drama: dramaOf(e.drama || e), value: false }).catch(function () { });
      });
      S.mineSel = [];
      toast("已取消收藏 " + hits.length + " 部");
      loadLibrary();
      setTimeout(function () { renderMine(); }, 260);
      return;
    }
    sel.forEach(function (id) { if (!mineHidden(id)) MINE.hidden.push(String(id)); });
    mineSave();
    S.mineSel = [];
    toast("已从这台机器隐藏 " + sel.length + " 部（云端记录还在）");
    renderMine();
  }

  function renderMine(keepScroll) {
    var lib = S.library || { entries: [] };
    var entries = (lib.entries || []).slice();
    entries.sort(function (a, b) { return (b.last_played_at || b.favorite_at || 0) - (a.last_played_at || a.favorite_at || 0); });
    var hist = entries.filter(function (e) { return e.last_played_at && !mineHidden(sidOf(e)); });
    var favs = entries.filter(function (e) { return e.favorite_at && !mineHidden(sidOf(e)); });

    var tab = S.mineTab === "fav" ? "fav" : "hist";
    if (S.mineFilter !== "done" && S.mineFilter !== "todo") S.mineFilter = "all";   /* 默认永远是「全部」，别记住上次的筛选 */
    var filt = S.mineFilter;
    var all = tab === "fav" ? favs : hist;
    var doneN = all.filter(entryDone).length;
    /* 本页搜索：只按剧名在本地过滤，不打接口，也不去动全局搜索 */
    var q = (S.mineQ || "").trim();
    if (q) {
      all = all.filter(function (e) {
        return String((e.drama && e.drama.title) || e.title || "").indexOf(q) >= 0;
      });
      doneN = all.filter(entryDone).length;
    }
    var list = all;
    if (tab === "hist" && filt !== "all") {
      list = all.filter(function (e) { return filt === "done" ? entryDone(e) : !entryDone(e); });
    }
    var limit = Math.max(20, Number(S.mineLimit || 40));   /* 一千部剧一次全铺会把首屏拖死，分页放 */
    if (!S.mineSel) S.mineSel = [];

    var wrap = document.createElement("div");
    wrap.style.gridColumn = "1 / -1";

    /* 第一行：追剧 / 收藏 */
    var head = document.createElement("div");
    head.className = "mhead";
    var tabs = document.createElement("div");
    tabs.className = "mtabs";
    [["hist", "追剧"], ["fav", "收藏"]].forEach(function (t) {
      var b = document.createElement("button");
      b.className = "mtab" + (tab === t[0] ? " on" : "");
      b.textContent = t[1];
      b.onclick = function () {
        if (S.mineTab === t[0]) return;
          S.mineTab = t[0]; S.mineFilter = "all"; S.mineManage = false; S.mineSel = []; S.mineLimit = 40;
        renderMine();
      };
      tabs.appendChild(b);
    });
    head.appendChild(tabs);

    /* tab 行右端的圆形小钮：开/收本页搜索（和官方那颗放大镜同位置、同分寸） */
    var sbtn = document.createElement("button");
    sbtn.className = "mfindb" + (S.mineFind ? " on" : "");
    sbtn.title = S.mineFind ? "收起搜索" : "在我的记录里搜剧名";
    sbtn.innerHTML = FIND_ICON;
    sbtn.onclick = function () {
      S.mineFind = !S.mineFind;
      if (!S.mineFind) S.mineQ = "";
      renderMine(true);
    };
    head.appendChild(sbtn);

    /* 第二行：筛选胶囊 + 右侧（计数 / 视图切换 / 管理） */
    var bar = document.createElement("div");
    bar.className = "mbar2";
    var chips = document.createElement("div");
    chips.className = "mchips";
    if (tab === "hist") {
      [["all", "全部", all.length], ["done", "已看完", doneN], ["todo", "未看完", all.length - doneN]].forEach(function (c) {
        var b = document.createElement("button");
        b.className = "mchip" + (filt === c[0] ? " on" : "");
        b.textContent = c[1];
        b.onclick = function () {
          if (S.mineFilter === c[0]) return;
          S.mineFilter = c[0]; S.mineManage = false; S.mineSel = []; S.mineLimit = 40;
          renderMine();
        };
        chips.appendChild(b);
      });
    } else {
      var fc = document.createElement("button");
      fc.className = "mchip on";
      fc.textContent = "全部收藏";
      fc.onclick = function () { S.mineManage = false; S.mineSel = []; renderMine(); };
      chips.appendChild(fc);
    }
    bar.appendChild(chips);

    var ctrl = document.createElement("div");
    ctrl.className = "mctrl";
    var cnt = document.createElement("span");
    cnt.className = "mcnt";
    cnt.textContent = (tab === "fav" ? "收藏" : (filt === "done" ? "已看完" : (filt === "todo" ? "未看完" : "共"))) + " " + list.length + " 部";
    ctrl.appendChild(cnt);

    if (MINE.hidden.length) {
      var rst = document.createElement("button");
      rst.className = "mrest";
      rst.textContent = "恢复 " + MINE.hidden.length;
      rst.title = "把从这台机器隐藏的记录放回来";
      rst.onclick = function () { MINE.hidden = []; mineSave(); toast("已恢复隐藏的记录"); renderMine(); };
      ctrl.appendChild(rst);
    }

    var vg = document.createElement("button");
    vg.className = "mvc" + (MINE.view === "grid" ? " on" : "");
    vg.title = "网格视图";
    vg.innerHTML = MG_ICON;
    vg.onclick = function () { MINE.view = "grid"; mineSave(); renderMine(true); };
    ctrl.appendChild(vg);

    var vl = document.createElement("button");
    vl.className = "mvc" + (MINE.view === "list" ? " on" : "");
    vl.title = "列表视图";
    vl.innerHTML = ML_ICON;
    vl.onclick = function () { MINE.view = "list"; mineSave(); renderMine(true); };
    ctrl.appendChild(vl);

    var sep = document.createElement("i");
    sep.className = "msep";
    ctrl.appendChild(sep);

    var mgr = document.createElement("button");
    mgr.className = "mmgr" + (S.mineManage ? " on" : "");
    mgr.textContent = S.mineManage ? "完成" : "管理";
    mgr.onclick = function () {
      S.mineManage = !S.mineManage; S.mineSel = [];
      renderMine(true);
    };
    ctrl.appendChild(mgr);
    bar.appendChild(ctrl);
    head.appendChild(bar);
    wrap.appendChild(head);

    if (S.mineFind) {
      var fs = document.createElement("div");
      fs.className = "mfind";
      fs.innerHTML = FIND_ICON + '<input class="mfindi" placeholder="搜我追过的剧名，边打边筛">';
      var qi = fs.querySelector(".mfindi");
      qi.value = S.mineQ || "";
      qi.oninput = function () {
        S.mineQ = qi.value;
        if (mineQT) clearTimeout(mineQT);
        mineQT = setTimeout(function () { renderMine(true); }, 320);
      };
      qi.onkeydown = function (e) {
        if (e.key === "Escape") { S.mineQ = ""; S.mineFind = false; renderMine(true); }
      };
      wrap.appendChild(fs);
    }

    /* 正文：空 / 网格 / 列表 */
    var body = document.createElement("div");
    if (!list.length) {
      if (!all.length) {
        wrap.appendChild(tab === "fav"
          ? emptyBox({ icon: "heart", text: "还没收藏任何剧", sub: "详情页左边那颗 ♡ 点一下就在这里", btn: "去找剧", onClick: function () { switchView("category"); } })
          : emptyBox({ icon: "play", text: "还没有观看记录", sub: "看一集就会出现在这里，进度也会记住", btn: "去发现", onClick: function () { switchView("home"); } }));
      } else {
        wrap.appendChild(emptyBox({
          icon: "filter", text: filt === "done" ? "这一栏还没有已看完的" : "这一栏还没有没看完的",
          sub: filt === "done" ? "看完一集（或看到最后一集）就会归到这里" : "全部 " + all.length + " 部都看完了，翻到「已看完」看看",
          btn: "看全部", onClick: function () { S.mineFilter = "all"; renderMine(); }
        }));
      }
    } else if (MINE.view === "list") {
      body.className = "mlist";
      list.slice(0, limit).forEach(function (e) {
        var drama = e.drama || e;
        var sid = sidOf(e);
        var on = S.mineSel.indexOf(sid) >= 0;
        var row = document.createElement("div");
        row.className = "mrow" + (on ? " sel" : "");
        var cov = coverOf({ cover: drama.cover || e.cover, cover_fallback: drama.cover_fallback || e.cover_fallback });
        var done = entryDone(e);
        var meta = (e.episode ? "看到第 " + e.episode + " 集" : (e.favorite_at ? "已收藏" : "未开播"))
          + ((drama.episode_count || e.episode_count) ? " · 共 " + (drama.episode_count || e.episode_count) + " 集" : "");
        row.innerHTML =
          '<div class="mcv">' + (cov ? '<img src="' + cov + '" loading="lazy" referrerpolicy="no-referrer" alt="">' : "") + '</div>' +
          '<div class="mtx"><b></b><span></span></div>' +
          '<span class="mtag' + (done ? " done" : "") + '">' + (done ? "已看完" : "未看完") + '</span>';
        row.querySelector("b").textContent = drama.title || e.title || "未命名";
        row.querySelector("span.mtx span").textContent = meta;
        if (S.mineManage) {
          var ck = document.createElement("i");
          ck.className = "mck inline" + (on ? " on" : "");
          row.insertBefore(ck, row.firstChild);
        }
        row.onclick = function () {
          if (S.mineManage) { mineToggleSel(sid); return; }
          openDetail(e.drama || e, 0);
        };
        body.appendChild(row);
      });
    } else {
      body.className = "mgrid";
      list.slice(0, limit).forEach(function (e, i) {
        var drama = e.drama || e;
        var sid = sidOf(e);
        var item = {
          series_id: drama.series_id || e.series_id, title: drama.title || e.title,
          cover: drama.cover || e.cover, cover_fallback: drama.cover_fallback || e.cover_fallback,
          episode_count: drama.episode_count || e.episode_count, tags: drama.tags || e.tags,
          score: drama.score || e.score, intro: drama.intro || e.intro, content_type: drama.content_type || e.content_type
        };
        var card = cardEl(item, i);
        var sub0 = card.querySelector("p");
        if (sub0) {
          var txt = e.episode ? "看到第 " + e.episode + " 集" : (e.favorite_at ? "已收藏" : "");
          var done = entryDone(e);
          if (txt) txt += done ? " · 已看完" : " · 未看完";
          else txt = done ? "已看完" : "";
          if (txt) sub0.textContent = txt;
        }
        if (S.mineManage) {
          var on2 = S.mineSel.indexOf(sid) >= 0;
          card.classList.add("selcard");
          var ck2 = document.createElement("i");
          ck2.className = "mck" + (on2 ? " on" : "");
          card.appendChild(ck2);
          card.onclick = function () { mineToggleSel(sid); };
        }
        body.appendChild(card);
      });
    }
    wrap.appendChild(body);

    /* 还有没铺出来的：给一颗「再看 N 部」，别让 1000 部一次全渲染 */
    if (list.length > limit) {
      var more = document.createElement("button");
      more.className = "mlb";
      more.textContent = "再看 " + Math.min(40, list.length - limit) + " 部（还剩 " + (list.length - limit) + " 部）";
      more.onclick = function () { S.mineLimit = limit + 40; renderMine(true); };
      wrap.appendChild(more);
    }

    /* 管理模式底部条 */
    if (S.mineManage) {
      var fbar2 = document.createElement("div");
      fbar2.className = "mfoot";
      var n = S.mineSel.length;
      fbar2.innerHTML = "<b>已选 <em>" + n + "</em> 部</b>";
      var bs = document.createElement("div");
      bs.className = "mfootb";
      var bAll = document.createElement("button");
      bAll.className = "mchip";
      bAll.textContent = n === list.length && n > 0 ? "取消全选" : "全选";
      bAll.onclick = function () {
        S.mineSel = (n === list.length && n > 0) ? [] : list.map(sidOf);
        renderMine(true);
      };
      var bGo = document.createElement("button");
      bGo.className = "mchip on";
      bGo.textContent = tab === "fav" ? "取消收藏" : "从本机隐藏";
      bGo.disabled = n === 0;
      bGo.style.opacity = n === 0 ? ".45" : "";
      bGo.onclick = function () { mineAct(tab); };
      bs.appendChild(bAll); bs.appendChild(bGo);
      fbar2.appendChild(bs);
      wrap.appendChild(fbar2);
    }

    var main = $("#main"), prevTop = main ? main.scrollTop : 0;
    $("#grid").innerHTML = "";
    if (window.GRO) {
      $("#grid").appendChild(GRO.card());
      GRO.render();
    }
    $("#grid").appendChild(wrap);
    $("#secTitle").textContent = S.account && S.account.logged_in ? "已登录" : "本机记录";
    $("#secCount").textContent = "";
    foot("");
    if (main) main.scrollTop = keepScroll ? prevTop : 0;
    setTimeout(function () {
      var m = $("#main");
      if (m) m.scrollTop = keepScroll ? prevTop : 0;
      var i2 = $(".mfindi");
      if (i2 && S.mineFind) { try { i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length); } catch (e) { } }
    }, 600);
    if (!S.library) {
      api("/api/v1/library").then(function (d) { S.library = d || { entries: [] }; renderMine(); }).catch(function () { });
    }
  }

  /* ---------- 账号 ---------- */
  var acct = $("#acct"), qrTimer = null, qrId = "", acctMode = "qr";

  function refreshAccount() {
    var MASK = !!qs.get("mask");   /* 截图 / 演示用：账号昵称打码，别把个人信息发出去 */
    api("/api/v1/account").then(function (d) {
      S.account = d || {};
      var logged = !!d.logged_in;
      if (logged && window.GRO) GRO.flag("sync");
      $("#acctState").textContent = logged
        ? "已登录红果账号 · 追更 / 收藏 / 进度会同步到云端"
        : "未登录 · 登录后可同步追更、收藏和播放进度";
      $("#acctLogged").style.display = logged ? "block" : "none";
      $("#acctQr").style.display = logged ? "none" : "block";
      $("#acctPhone").style.display = "none";
      $("#acctSeg").style.display = logged ? "none" : "flex";
      if (logged && d.profile) {
        $("#acctUid").textContent = MASK
          ? "账号：已隐藏（截图用）"
          : "账号：" + (d.profile.nickname || d.profile.name || d.profile.uid) +
          (d.sync ? " · 同步状态：" + d.sync.state + (d.sync.pending ? "（待同步 " + d.sync.pending + "）" : "") : "");
      }
      var who = $("#sideWho");
      who.classList.toggle("off", !logged);
      var nickRaw = logged && d.profile ? (d.profile.nickname || d.profile.name || ("用户" + d.profile.uid)) : "未登录";
      var nick = MASK ? (logged ? "用户****" : "未登录") : nickRaw;
      $("#sideName").textContent = String(nick).slice(0, 12);
      $("#sideAv").textContent = logged ? String(nick).slice(0, 1) : "我";
      $("#sideSync").textContent = logged
        ? (d.sync ? (d.sync.state === "synced" ? "已同步" : "同步中…") : "在线")
        : "点此登录同步";
    }).catch(function () { });
  }

  function openAccount() { acct.classList.add("on"); refreshAccount(); if (acctMode === "qr") startQR(); }
  $("#accountBtn").onclick = openAccount;
  $("#acctClose").onclick = function () { acct.classList.remove("on"); stopQR(); };

  $("#acctSeg").onclick = function (e) {
    var b = e.target.closest("button"); if (!b) return;
    acctMode = b.dataset.m;
    [].forEach.call($("#acctSeg").children, function (x) { x.classList.toggle("on", x === b); });
    $("#acctQr").style.display = acctMode === "qr" ? "block" : "none";
    $("#acctPhone").style.display = acctMode === "phone" ? "block" : "none";
    if (acctMode === "qr") startQR(); else stopQR();
  };

  function stopQR() { if (qrTimer) { clearInterval(qrTimer); qrTimer = null; } }

  function startQR() {
    stopQR();
    $("#qrBox").innerHTML = '<span class="spin"></span>';
    api("/api/v1/account/qr/start", { json: {} }).then(function (d) {
      qrId = d.qr_login && d.qr_login.id;
      if (d.qr_login && d.qr_login.image) showQR(d.qr_login.image);
      if (qrId) {
        qrTimer = setInterval(function () {
          api("/api/v1/account/qr/status?id=" + encodeURIComponent(qrId)).then(function (s) {
            if (s.qr_login && s.qr_login.image) showQR(s.qr_login.image);
            if (s.logged_in) { stopQR(); S.account = s; msg("登录成功", true); refreshAccount(); loadLibrary(); }
          }).catch(function () { });
        }, 1600);
      }
    }).catch(function (e) { $("#qrBox").innerHTML = '<div class="empty" style="padding:0">二维码生成失败：' + e.message + "</div>"; });
  }
  function showQR(image) {
    var box = $("#qrBox");
    if (box.dataset.same === image) return;
    box.dataset.same = image;
    box.innerHTML = '<img src="' + image + '" alt="扫码登录">';
  }
  $("#qrRefresh").onclick = startQR;
  $("#qrCancel").onclick = function () {
    stopQR();
    api("/api/v1/account/qr/cancel", { json: { id: qrId } }).catch(function () { });
    $("#qrBox").innerHTML = '<div class="empty" style="padding:0">已取消，点「重新生成」继续</div>';
  };

  $("#sendCode").onclick = function () {
    var phone = $("#acctNo").value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) { msg("请输入 11 位手机号"); return; }
    api("/api/v1/account/send-code", { json: { phone: phone, country_code: "86" } })
      .then(function () { msg("验证码已发送", true); $("#acctCode").focus(); })
      .catch(function (e) { msg("发送失败：" + e.message); });
  };
  $("#doLogin").onclick = function () {
    var phone = $("#acctNo").value.trim(), code = $("#acctCode").value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) { msg("请输入 11 位手机号"); return; }
    if (!/^\d{4,8}$/.test(code)) { msg("请输入短信验证码"); return; }
    api("/api/v1/account/login", { json: { phone: phone, country_code: "86", code: code } })
      .then(function (d) {
        S.account = d; msg(d.logged_in ? "登录成功" : "还需要下一步验证", true);
        refreshAccount(); loadLibrary();
      }).catch(function (e) { msg("登录失败：" + e.message); });
  };
  $("#doSync").onclick = function () {
    api("/api/v1/account/sync", { json: {} }).then(function () { msg("已触发同步", true); refreshAccount(); loadLibrary(); })
      .catch(function (e) { msg("同步失败：" + e.message); });
  };
  $("#doLogout").onclick = function () {
    api("/api/v1/account/logout", { json: {} }).then(function () { msg("已退出登录", true); refreshAccount(); })
      .catch(function (e) { msg("退出失败：" + e.message); });
  };
  function msg(text, ok) {
    var m = $("#acctMsg"); m.textContent = text || ""; m.classList.toggle("ok", !!ok);
  }

  function loadLibrary() {
    api("/api/v1/library").then(function (d) {
      S.library = d || { entries: [] };
      if (window.GRO && GRO.seed) GRO.seed(S.library);
      if (S.view === "mine") renderMine();
      else if (S.view === "home" && !S.q) renderContinue();
    }).catch(function () { });
  }

  /* ---------- 顶栏交互 ---------- */
  var searchTimer;
  $("#q").addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      var k = $("#q").value.trim();
      if (!k) { switchView("home"); return; }
      if (window.GRO) GRO.flag("search");
      S.q = k; setTitle('搜索「' + k + '」'); S.offset = 0; S.items = []; load("search", true);
    }, 420);
  });
  $("#q").addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      clearTimeout(searchTimer);
      var k = this.value.trim();
      if (k) { S.q = k; setTitle('搜索「' + k + '」'); S.offset = 0; S.items = []; load("search", true); }
    }
  });
  $("#refresh").onclick = function () {
    if (S.q) { S.offset = 0; S.items = []; load("search", true); }
    else switchView(S.view === "search" ? "home" : S.view);
  };
  $("#secMore").onclick = function () { S.offset = 0; S.items = []; load(S.view === "search" ? "search" : S.view, true); };
  $("#rankMore").onclick = function () { switchView("rank"); };
  $("#sideWho").onclick = openAccount;

  document.querySelectorAll("nav.rail button").forEach(function (b) {
    b.onclick = function () { $("#q").value = ""; S.q = ""; switchView(b.dataset.view); };
  });

  $("#main").addEventListener("scroll", function (e) {
    var el = e.currentTarget;
    if (S.loading || !S.hasMore || S.view === "mine") return;
    if (S.view === "home" && !S.gridOpen) return;   /* 首页折叠时不再无限加载，避免页面越滚越长 */
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 300) load(S.view, false);
  }, { passive: true });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (S.mini) { setMini(false); return; }
      if (S.fs) { exitFs(); return; }
      if (viewer.classList.contains("on")) { closeViewer(); }
      else if (acct.classList.contains("on")) { acct.classList.remove("on"); stopQR(); }
      else closeDetail();
    }
    if ((e.key === "f" || e.key === "F") && viewer.classList.contains("on")) { e.preventDefault(); setFs(!S.fs); return; }
    if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if ((e.key === "d" || e.key === "D") && viewer.classList.contains("on")) { e.preventDefault(); toggleDanmaku(); return; }
    if ((e.key === "r" || e.key === "R") && viewer.classList.contains("on")) { e.preventDefault(); rateCycle(); return; }
    if ((e.key === "m" || e.key === "M") && viewer.classList.contains("on")) { e.preventDefault(); $("#volMute").click(); return; }
    if (e.key === " " && viewer.classList.contains("on")) { e.preventDefault(); $("#vPlay").click(); }
    if (e.key === "ArrowRight" && viewer.classList.contains("on")) $("#vNext").click();
    if (e.key === "ArrowLeft" && viewer.classList.contains("on")) $("#vPrev").click();
    if (e.key === "/") { e.preventDefault(); $("#q").focus(); }
  });

  /* 窗口条（打包版） */
  if (window.chrome && window.chrome.webview) {
    $("#winbar").classList.add("show");
    var post = function (m) { window.chrome.webview.postMessage(JSON.stringify(m)); };
    $("#wbMin").onclick = function () { post({ action: "min" }); };
    $("#wbMax").onclick = function () { post({ action: "max" }); };
    $("#wbClose").onclick = function () { post({ action: "close" }); };
    $("#winbar").addEventListener("pointerdown", function (e) {
      if (e.target.closest(".wb")) return;
      post({ action: "drag" });
    });
  }

  /* ---------- 交互手感 ---------- */
  $("#main").addEventListener("mousemove", function (e) {
    var cov = e.target.closest(".cov");
    if (!cov) return;
    var r = cov.getBoundingClientRect();
    cov.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100).toFixed(1) + "%");
    cov.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100).toFixed(1) + "%");
  }, { passive: true });

  document.addEventListener("pointerdown", function (e) {
    var el = e.target.closest(".btn, .pill, .ic, .vbtn, .tab");
    if (!el) return;
    if (el.dataset.noRipple) return;
    var r = el.getBoundingClientRect();
    var sp = document.createElement("span");
    sp.className = "ripple";
    sp.style.left = (e.clientX - r.left) + "px";
    sp.style.top = (e.clientY - r.top) + "px";
    el.appendChild(sp);
    setTimeout(function () { sp.remove(); }, 560);
  }, { passive: true });

  $("#main").addEventListener("dblclick", function (e) {
    var cov = e.target.closest(".cov");
    if (!cov) return;
    var card = cov.closest(".card");
    if (card) { var idx = Array.prototype.indexOf.call($("#grid").children, card); if (idx >= 0) { var it = S.items[idx]; if (it) { playEpisodeFor(it); } } }
  });
  function playEpisodeFor(item) {
    S.active = item;
    openDetail(item, 0);
    setTimeout(function () { playEpisode(0); }, 500);
  }

  var prevFit = "contain";
  function setMini(on) {
    S.mini = on;
    document.body.classList.toggle("mini", on);
    $("#miniExit").style.display = on ? "" : "none";
    if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(JSON.stringify({ action: "mini", on: on }));
    if (on) {
      prevFit = S.fit;
      S.fit = "cover"; applyFit();
      clearFsQuiet();
      /* 小窗是独立形态：把剧场那套左右留白的主界面布局类摘掉，否则播放区被挤成竖缝 */
      document.body.classList.remove("theater");
      /* 先把上次的窗口比例用上，片源 metadata 到了再校正，免得一进小窗先是条竖缝 */
      var lastSz = LS.get("hg_mini_size", null);
      if (window.chrome && window.chrome.webview) {
        if (video.videoWidth) sendMiniSize();
        else if (lastSz) window.chrome.webview.postMessage(JSON.stringify({ action: "miniSize", w: lastSz.w, h: lastSz.h }));
      }
      if (!viewer.classList.contains("on")) miniResume();
      wake();
      if (window.GRO) GRO.mode("mini");
      setTimeout(function () { if (window.chrome && window.chrome.webview) sendAlpha(alpha || 94); }, 500);
      /* 自检：小窗下真实视口多宽，决定画面和控制条怎么排 */
      if (window.DBG) setTimeout(function () {
        try {
          if (window.chrome && window.chrome.webview) {
            var st = $(".vstage"), r = st ? st.getBoundingClientRect() : { width: 0, height: 0 };
            window.chrome.webview.postMessage(JSON.stringify({ action: "log", text:
              "mini vw=" + innerWidth + "x" + innerHeight + " dpr=" + (devicePixelRatio || 1) +
              " stage=" + Math.round(r.width) + "x" + Math.round(r.height) +
              " video=" + video.videoWidth + "x" + video.videoHeight + " fit=" + S.fit }));
          }
        } catch (e) { }
      }, 900);
    } else {
      document.body.classList.remove("idle");
      S.fit = prevFit || "contain"; applyFit();
    }
  }
  function miniResume() {
    var entries = (S.library && S.library.entries) || [];
    var e = entries.filter(function (x) { return x.last_played_at && (x.drama || x).series_id; })
      .sort(function (a, b) { return (b.last_played_at || 0) - (a.last_played_at || 0); })[0];
    if (e) {
      var drama = e.drama || e;
      var ep = Math.max(1, Number(e.episode) || 1);
      S.active = drama; openDetail(drama, ep - 1);
      var tries = 0, iv = setInterval(function () {
        tries++;
        if (S.vids.length) { clearInterval(iv); playEpisode(ep - 1); }
        else if (tries > 14) { clearInterval(iv); }
      }, 250);
      return;
    }
    if (S.items.length) { playEpisodeFor(S.items[0]); return; }
    toast("先选一部剧再看");
  }
  $("#miniExit").onclick = function () { setMini(false); };
  $("#wbMini").onclick = function () { setMini(!S.mini); };

  /* ---------- 一键摸鱼（Ctrl+Shift+M，全局热键由外壳注册） ----------
     按一下：暂停 + 静音 + 整个窗口盖成一张财务台账，标题也换成 "Microsoft Excel - ...";
     再按一下：原样恢复（音量、播放、之前的小窗/全屏形态）。 */
  var MO_ROWS = [
    ["2026-11-02", "记-0182", "支付潞州区办公用品采购款", "办公费", "1,280.00", "", "综合部", "张伟"],
    ["2026-11-03", "记-0183", "预缴本月增值税", "应交税费", "", "8,640.00", "财务部", "李静"],
    ["2026-11-05", "记-0185", "收到机动车检测服务费", "主营收入", "", "26,500.00", "业务部", "王强"],
    ["2026-11-06", "记-0187", "支付11月房屋租金", "管理费用", "6,200.00", "", "综合部", "张伟"],
    ["2026-11-08", "记-0189", "报销差旅费（太原往返）", "差旅费", "860.00", "", "业务部", "刘敏"],
    ["2026-11-09", "记-0191", "计提11月职工工资", "应付职工薪酬", "42,800.00", "", "人事部", "陈芳"],
    ["2026-11-10", "记-0192", "缴纳社保及公积金", "应付职工薪酬", "11,340.00", "", "人事部", "陈芳"],
    ["2026-11-11", "记-0194", "采购检测设备配件", "低值易耗品", "2,340.00", "", "技术部", "赵鹏"],
    ["2026-11-12", "记-0196", "支付11月电费", "水电费", "1,876.40", "", "后勤部", "孙丽"],
    ["2026-11-13", "记-0198", "客户回款—某交运集团", "应收账款", "", "38,000.00", "业务部", "王强"],
    ["2026-11-15", "记-0201", "支付物业费", "物业费", "2,150.00", "", "后勤部", "孙丽"],
    ["2026-11-16", "记-0203", "办公软件年度订阅", "软件服务费", "3,600.00", "", "综合部", "张伟"],
    ["2026-11-17", "记-0205", "报销业务招待费", "业务招待费", "1,240.00", "", "业务部", "刘敏"],
    ["2026-11-18", "记-0207", "支付检测样品运输费", "运输费", "780.00", "", "后勤部", "孙丽"],
    ["2026-11-19", "记-0209", "收到检测服务预收款", "预收账款", "", "15,000.00", "业务部", "王强"],
    ["2026-11-20", "记-0211", "计提本月固定资产折旧", "累计折旧", "5,320.00", "", "财务部", "李静"],
    ["2026-11-21", "记-0213", "支付银行账户手续费", "财务费用", "126.00", "", "财务部", "李静"],
    ["2026-11-22", "记-0215", "采购车间防护用品", "劳保用品", "890.00", "", "后勤部", "孙丽"],
    ["2026-11-23", "记-0217", "支付线上推广费用", "销售费用", "4,500.00", "", "市场部", "周涛"],
    ["2026-11-24", "记-0219", "收到稳岗补贴", "其他收益", "", "6,000.00", "财务部", "李静"],
    ["2026-11-25", "记-0221", "支付11月水费", "水电费", "620.00", "", "后勤部", "孙丽"],
    ["2026-11-26", "记-0223", "结转本月检测成本", "主营业务成本", "18,600.00", "", "财务部", "李静"]
  ];
  var MO_HEAD = ["#", "日期", "凭证号", "摘要", "科目", "借方", "贷方", "部门", "经办人", "备注"];
  var moBuilt = false, moPrev = null, moTipT = null;
  function moMoney(s) { return Number(String(s).replace(/,/g, "")) || 0; }
  function buildMoyu() {
    if (moBuilt) return;
    moBuilt = true;
    var grid = $("#moGrid");
    if (!grid) return;
    var out = [];
    MO_HEAD.forEach(function (h) { out.push('<div class="mo-ch">' + h + "</div>"); });
    var sum = 0;
    MO_ROWS.forEach(function (row, i) {
      out.push('<div class="mo-rh">' + (i + 1) + "</div>");
      row.forEach(function (v, j) {
        var cls = "mo-c" + (j === 4 || j === 5 ? " num" : "") +
          (i === 5 && j === 4 ? " sel" : "") +      /* 选中 E6：正好是那笔大额工资，看着像在核对 */
          (i === 3 && j === 3 ? " edit" : "");      /* 有一格在"正在输入"，光标在闪 */
        out.push('<div class="' + cls + '">' + v + "</div>");
        if (j === 4) sum += moMoney(v);
      });
      out.push('<div class="mo-c"></div>');          /* 备注列留空 */
    });
    /* 补空白行把版面填满：真实 Excel 不会在数据后面突然断成一片白 */
    for (var r = MO_ROWS.length + 1; r <= 38; r++) {
      out.push('<div class="mo-rh">' + r + "</div>");
      for (var c = 0; c < 9; c++) out.push('<div class="mo-c"></div>');
    }
    grid.innerHTML = out.join("");
    var sumEl = $("#moSum");
    if (sumEl) sumEl.textContent = "计数 " + MO_ROWS.length + "　求和 " + sum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function setMoyu(on) {
    var body = document.body;
    if (on === body.classList.contains("moyu-on")) return;
    buildMoyu();
    if (on) {
      moPrev = { playing: !video.paused, vol: video.volume, muted: video.muted, fs: S.fs, mini: S.mini };
      try { video.pause(); } catch (e) { }
      video.muted = true;
      if (S.fs) setFs(false);
      if (S.mini) setMini(false);
      body.classList.add("moyu-on");
      var tip = $("#moTip");
      if (tip) {
        tip.classList.add("on");
        clearTimeout(moTipT);
        moTipT = setTimeout(function () { tip.classList.remove("on"); }, 4200);
      }
      post2host({ action: "moyu", on: true });
    } else {
      body.classList.remove("moyu-on");
      if (moPrev) {
        video.muted = moPrev.muted; video.volume = moPrev.vol;
        if (moPrev.playing && viewer.classList.contains("on")) { try { video.play(); } catch (e) { } }
      }
      post2host({ action: "moyu", on: false });
      if (moPrev && moPrev.mini) setTimeout(function () { setMini(true); }, 70);
      if (moPrev && moPrev.fs) setTimeout(function () { setFs(true); }, 120);
      moPrev = null;
    }
  }
  function post2host(o) {
    try { if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(JSON.stringify(o)); } catch (e) { }
  }
  $("#wbMo").onclick = function () { setMoyu(!document.body.classList.contains("moyu-on")); };
  /* 伪装窗口自己的标题栏：能拖、最小化/最大化/关掉都照宿主来 */
  var moTitle = $(".mo-title");
  if (moTitle) {
    moTitle.addEventListener("mousedown", function (e) {
      if (e.target.closest && e.target.closest(".mo-wb")) return;
      post2host({ action: "drag" });
    });
  }
  document.querySelectorAll(".mo-wb").forEach(function (b) {
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      post2host({ action: b.dataset.host });
    });
  });
  if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener("message", function (e) {
      var d = e.data || {};
      if (d.action === "moyuT") setMoyu(!document.body.classList.contains("moyu-on"));
      if (d.action === "update") toastUpd(d.v || "?", d.url || "", !!d.manual);
    });
  }

  /* 小窗透明：鼠标进入变清晰，离开回到半透明 */
  var alpha = 94;
  function sendAlpha(v) {
    if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(JSON.stringify({ action: "alpha", value: v }));
  }
  $("#tnBtn").onclick = function () {
    alpha = alpha >= 90 ? 66 : 94;
    sendAlpha(alpha);
    this.textContent = alpha >= 90 ? "透明" : "不透明";
  };
  if (window.chrome && window.chrome.webview) {
    document.addEventListener("pointerenter", function () { if (S.mini) sendAlpha(100); });
    document.addEventListener("pointerleave", function () { if (S.mini) sendAlpha(alpha); });
  }

  /* 画面铺满方式：原比例 → 铺满 → 拉伸 */
  function applyFit() {
    document.body.classList.remove("mode-cover", "mode-fill", "mode-contain");
    document.body.classList.add("mode-" + S.fit);
    /* v1.024：底栏只留图标，当前是哪一种交给自绘提示说 */
    var fb = $("#fitBtn");
    if (fb) {
      fb.textContent = S.fit === "contain" ? "▭" : (S.fit === "fill" ? "⤢" : "▤");
      fb.setAttribute("data-hint", "画面：" + (S.fit === "contain" ? "原比例（完整显示）"
        : (S.fit === "fill" ? "拉伸铺满" : "铺满裁剪")) + " · 点一下换一种");
    }
    if (S.mini) sendMiniSize();
  }
  /* 默认画面模式是原比例（整幅画面完整显示）：脚本在 body 末尾跑，这里先把 body 的模式类放上，
     否则第一集出画前 video 没有 object-fit，会被 CSS 默认值框成别的样子 */
  applyFit();
  function sendMiniSize() {
    if (!S.mini || !video.videoWidth || !window.chrome || !window.chrome.webview) return;
    /* 小窗的窗口比例跟着片源走，横屏就矮、竖屏就高，这样 cover 铺满也裁不到人 */
    var vw = video.videoWidth, vh = video.videoHeight;
    var W = vw >= vh ? 560 : 430;                                /* 横屏给宽点，竖屏按手机比例 */
    var H = Math.round(W * vh / vw);
    if (H > 820) { H = 820; W = Math.round(H * vw / vh); }      /* 竖屏别超出屏幕 */
    if (H < 240) { H = 240; W = Math.round(H * vw / vh); }      /* 太矮的控制条会挤，给个下限 */
    LS.set("hg_mini_size", { w: W, h: H });
    window.chrome.webview.postMessage(JSON.stringify({ action: "miniSize", w: W, h: H }));
  }
  $("#fitBtn").onclick = function () { cycleFit(); };
  function cycleFit() {
    S.fitManual = true;              /* 用户自己挑过画面模式，之后全屏不再强塞铺满 */
    S.fit = S.fit === "cover" ? "fill" : (S.fit === "fill" ? "contain" : "cover");
    applyFit();
    if (window.GRO && S.fit !== "contain") GRO.flag("fit");
    if (window.GRO) GRO.flag(S.fit === "cover" ? "fitC" : (S.fit === "fill" ? "fitF" : "fitS"));
    toast("画面：" + (S.fit === "contain" ? "原比例（完整显示）" : (S.fit === "fill" ? "拉伸铺满" : "铺满裁剪")));
  }
  initFit();
  function initFit() {
    applyFit();
  }

  /* 小窗沉浸：鼠标停 2.6 秒后收起控件 */
  var idleT = null;
  function wake() {
    document.body.classList.remove("idle");
    clearTimeout(idleT);
    if (DEMO) return;
    idleT = setTimeout(function () {
      if (viewer.classList.contains("on") && !video.paused) document.body.classList.add("idle");
    }, 2600);
  }
  document.addEventListener("pointermove", function () {
    if (S.mini || viewer.classList.contains("on")) wake();
  }, { passive: true });
  $("#viewer").addEventListener("pointerleave", function () { if (viewer.classList.contains("on")) document.body.classList.add("idle"); });
  $("#vPause").addEventListener("click", function () { document.body.classList.remove("idle"); });

  /* ---------- 幽光 · 星空 · 流星：按剧的类型换色，播放时更热闹 ---------- */
  var AMB = (function () {
    var canvas = $("#sky"), amb = $("#ambient");
    var ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
    if (!ctx) return { theme: function () { }, play: function () { }, resize: function () { } };

    var dpr = 1, W = 0, H = 0, stars = [], dust = [], meteors = [];
    var cA = [255, 140, 110], cB = [120, 170, 255];
    var energy = 0.35, playing = false, last = 0;

    function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",1)"; }
    function colA(a) { return "rgba(" + cA[0] + "," + cA[1] + "," + cA[2] + "," + a + ")"; }
    function colB(a) { return "rgba(" + cB[0] + "," + cB[1] + "," + cB[2] + "," + a + ")"; }
    function colM(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

    function resize() {
      if (!canvas) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    }

    function build() {
      var n = Math.min(190, Math.max(64, Math.round(W * H / 9000)));
      stars = [];
      for (var i = 0; i < n; i++) stars.push({
        x: Math.random() * W, y: Math.random() * H,
        r: Math.random() * 1.4 + .32, a: Math.random() * .5 + .18,
        sp: Math.random() * 2 + .5, ph: Math.random() * 6.28, big: Math.random() < .12
      });
      dust = [];
      for (var j = 0; j < 30; j++) dust.push({
        x: Math.random() * W, y: Math.random() * H,
        r: Math.random() * 2.4 + 1, vy: -(Math.random() * .22 + .06),
        vx: (Math.random() - .5) * .2, a: Math.random() * .3 + .1
      });
    }

    function spawnMeteor() {
      var left = Math.random() < .55;
      var speed = Math.random() * 240 + 200;
      meteors.push({
        x: left ? Math.random() * W * .55 - 30 : W * .45 + Math.random() * W * .55,
        y: -30 + Math.random() * H * .34,
        vx: (left ? 1 : .62) * speed * .78,
        vy: speed * .6,
        len: Math.random() * 90 + 90,
        life: 1, w: Math.random() * 1.1 + .9,
        hue: Math.random() < .5 ? cA : cB
      });
    }

    function frame(now) {
      requestAnimationFrame(frame);
      if (!W || document.hidden) { last = now; return; }
      var dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
      var t = now / 1000;
      ctx.clearRect(0, 0, W, H);

      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        var tw = .6 + .4 * Math.sin(t * s.sp + s.ph);
        ctx.beginPath();
        ctx.fillStyle = "rgba(255,255,255," + (s.a * tw * (.7 + energy * .6)) + ")";
        ctx.arc(s.x, s.y, s.r * (s.big ? 1.4 : 1), 0, 6.284);
        ctx.fill();
        if (s.big) {
          var sg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 9);
          sg.addColorStop(0, "rgba(255,255,255," + (.16 * tw) + ")");
          sg.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = sg;
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 9, 0, 6.284); ctx.fill();
        }
        if (s.big && tw > .86) {
          ctx.strokeStyle = "rgba(214,236,255,.34)"; ctx.lineWidth = .7;
          ctx.beginPath();
          ctx.moveTo(s.x - 4.5, s.y); ctx.lineTo(s.x + 4.5, s.y);
          ctx.moveTo(s.x, s.y - 4.5); ctx.lineTo(s.x, s.y + 4.5);
          ctx.stroke();
        }
      }

      for (var j = 0; j < dust.length; j++) {
        var d = dust[j];
        d.x += d.vx; d.y += d.vy;
        if (d.y < -12) { d.y = H + 12; d.x = Math.random() * W; }
        if (d.x < -12) d.x = W + 12; else if (d.x > W + 12) d.x = -12;
        var g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r * 4);
        g.addColorStop(0, colA(d.a)); g.addColorStop(1, colA(0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r * 4, 0, 6.284); ctx.fill();
      }

      if (Math.random() < (playing ? .05 : .02) + energy * .05) spawnMeteor();
      for (var k = meteors.length - 1; k >= 0; k--) {
        var m = meteors[k];
        m.x += m.vx * dt; m.y += m.vy * dt;
        m.life -= dt * (playing ? .5 : .75);
        if (m.life <= 0 || m.x > W + 220 || m.y > H + 220) { meteors.splice(k, 1); continue; }
        var tail = Math.min(m.len, Math.max(26, m.len * m.life));
        var dx = -m.vx, dy = -m.vy, mag = Math.sqrt(dx * dx + dy * dy) || 1;
        var ex = m.x + dx / mag * tail, ey = m.y + dy / mag * tail;
        var lg = ctx.createLinearGradient(m.x, m.y, ex, ey);
        lg.addColorStop(0, colM(m.hue, .9 * m.life));
        lg.addColorStop(.45, colM(m.hue, .34 * m.life));
        lg.addColorStop(1, colM(m.hue, 0));
        ctx.strokeStyle = lg; ctx.lineWidth = m.w * 1.7;
        ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(ex, ey); ctx.stroke();
        var hg = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 7);
        hg.addColorStop(0, colM(m.hue, .9 * m.life)); hg.addColorStop(1, colM(m.hue, 0));
        ctx.fillStyle = hg;
        ctx.beginPath(); ctx.arc(m.x, m.y, 7, 0, 6.284); ctx.fill();
      }
    }

    /* 按类型给主题色：玄幻冷青、悬疑蓝紫、甜宠粉、年代暖橙 */
    function theme(item) {
      var key = ((item && item.title) || "") + " " + (((item && item.tags) || []).join(" "));
      var p;
      if (/玄幻|仙侠|修仙|系统|宗门|灵|丹药|神|魔/.test(key)) p = [[120, 235, 225], [130, 150, 255], [200, 240, 255]];
      else if (/悬疑|罪|案|诡|惊|尸|血|秘密/.test(key)) p = [[96, 150, 255], [170, 110, 255], [200, 220, 255]];
      else if (/甜|宠|恋|婚|妻|夫|娇|萌|夫人/.test(key)) p = [[255, 130, 170], [255, 180, 150], [255, 220, 236]];
      else if (/年代|重生|创业|乡村|家|逆袭|巨头|首富/.test(key)) p = [[255, 168, 92], [255, 120, 80], [255, 208, 150]];
      else p = [[255, 140, 110], [120, 170, 255], [255, 205, 160]];
      cA = p[0]; cB = p[1];
      var root = document.documentElement.style;
      root.setProperty("--aura1", "rgba(" + p[0].join(",") + ",.34)");
      root.setProperty("--aura2", "rgba(" + p[1].join(",") + ",.28)");
      root.setProperty("--aura3", "rgba(" + p[2].join(",") + ",.2)");
      root.setProperty("--glow1", "rgba(" + p[0].join(",") + ",.6)");
    }

    function play(on) { playing = !!on; energy = on ? .85 : .35; }

    var rt = null;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(resize, 180);
    });

    /* 鼠标轻微视差：光团和封面跟着动，有"活着"的感觉 */
    var mvx = 0, mvy = 0, mt = null;
    window.addEventListener("pointermove", function (e) {
      var x = (e.clientX / window.innerWidth - .5) * 2, y = (e.clientY / window.innerHeight - .5) * 2;
      if (Math.abs(x - mvx) < .02 && Math.abs(y - mvy) < .02) return;
      mvx = x; mvy = y;
      clearTimeout(mt);
      mt = setTimeout(function () {
        var st = document.documentElement.style;
        st.setProperty("--mx", x.toFixed(2));
        st.setProperty("--my", y.toFixed(2));
      }, 60);
    }, { passive: true });

    resize();
    requestAnimationFrame(frame);

    return { theme: theme, play: play, resize: resize };
  })();

  /* ---------- 成长系统：等级 / 经验 / 成就 ---------- */
  var GRO = (function () {
    var KEY = "hg_growth_v3";
    var D = {
      exp: 0, min: 0, eps: 0, dramas: [], favs: [], follows: [], dm: 0,
      streak: 0, days: 0, last: "", flags: [], ach: {}, seen: [],
      theaterCnt: 0, miniCnt: 0, fsCnt: 0, seeded: false,
      fin: 0, back: 0, binge: 0, tags: [], lastSeries: "", lastEpIdx: -1, lastEpAt: 0, conRun: 0
    };
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        for (var k in D) if (o[k] !== undefined) D[k] = o[k];
      }
    } catch (e) { }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { } }

    /* 等级曲线：前期轻快，越往后越吃经验（1→10 级约 5600 经验，10→20 级约 3.3 万） */
    function need(lv) { return 120 + 80 * (lv - 1) + 8 * (lv - 1) * (lv - 1); }
    function levelOf(exp) {
      var lv = 1, left = exp || 0;
      while (left >= need(lv) && lv < 60) { left -= need(lv); lv++; }
      return { lv: lv, cur: left, need: need(lv) };
    }
    var TITLES = [
      [1, "新片观众"], [3, "尝鲜观众"], [5, "普通剧迷"], [7, "资深剧迷"],
      [10, "追剧达人"], [13, "剧荒终结者"], [16, "短剧猎人"], [19, "殿堂观众"], [25, "红果仙尊"]
    ];
    function titleOf(lv) {
      var t = TITLES[0][1];
      TITLES.forEach(function (x) { if (lv >= x[0]) t = x[1]; });
      return t;
    }

    var ACH = [
      /* 累计类 */
      { id: "first", ic: "🎬", n: "初来乍到", d: "看完第一集", t: function () { return D.eps >= 1; } },
      { id: "ep3", ic: "🪑", n: "开机仪式", d: "累计 3 集", t: function () { return D.eps >= 3; } },
      { id: "ep50", ic: "🔥", n: "连刷五十", d: "累计 50 集", t: function () { return D.eps >= 50; } },
      { id: "ep200", ic: "⚔️", n: "两百集斩", d: "累计 200 集", t: function () { return D.eps >= 200; } },
      { id: "ep500", ic: "🗡", n: "五百集宗", d: "累计 500 集", t: function () { return D.eps >= 500; } },
      { id: "m60", ic: "⏱", n: "一小时入坑", d: "累计观看 60 分钟", t: function () { return D.min >= 60; } },
      { id: "m600", ic: "🛋", n: "十小时铁杆", d: "累计观看 600 分钟", t: function () { return D.min >= 600; } },
      { id: "m3000", ic: "⏳", n: "五十小时老友", d: "累计观看 3000 分钟", t: function () { return D.min >= 3000; } },
      /* 完播类：真的放到最后一秒 */
      { id: "fin5", ic: "🎯", n: "整集收割", d: "完整看完 5 集", t: function () { return D.fin >= 5; } },
      { id: "fin30", ic: "🏁", n: "三十次完播", d: "完整看完 30 集", t: function () { return D.fin >= 30; } },
      /* 连刷节奏类 */
      { id: "binge5", ic: "🍿", n: "一口气五集", d: "一次连刷 5 集", t: function () { return D.binge >= 5; } },
      { id: "binge8", ic: "🚀", n: "连刷不止", d: "一次连刷 8 集", t: function () { return D.binge >= 8; } },
      /* 考古 / 回看类 */
      { id: "back5", ic: "🕰", n: "考古学家", d: "回头重看旧集 5 次", t: function () { return D.back >= 5; } },
      { id: "back20", ic: "🧱", n: "二刷执念", d: "重看旧集 20 次", t: function () { return D.back >= 20; } },
      /* 剧库广度 */
      { id: "d3", ic: "🗂", n: "换剧如流", d: "看过 3 部不同的剧", t: function () { return D.dramas.length >= 3; } },
      { id: "d10", ic: "🧭", n: "剧海寻珍", d: "看过 10 部不同的剧", t: function () { return D.dramas.length >= 10; } },
      { id: "d30", ic: "🌊", n: "三十部海王", d: "看过 30 部不同的剧", t: function () { return D.dramas.length >= 30; } },
      /* 类型杂食 */
      { id: "tag4", ic: "🧬", n: "杂食动物", d: "看过 4 种不同题材", t: function () { return D.tags.length >= 4; } },
      { id: "tag7", ic: "🎨", n: "类型百科", d: "看过 7 种不同题材", t: function () { return D.tags.length >= 7; } },
      /* 收藏 / 追更 */
      { id: "fav5", ic: "♥", n: "收藏夹满员", d: "收藏 5 部", t: function () { return D.favs.length >= 5; } },
      { id: "fav20", ic: "📚", n: "囤剧狂魔", d: "收藏 20 部", t: function () { return D.favs.length >= 20; } },
      { id: "fav50", ic: "🗃", n: "私人片库", d: "收藏 50 部", t: function () { return D.favs.length >= 50; } },
      { id: "fo3", ic: "🔔", n: "追更三连", d: "追更 3 部", t: function () { return D.follows.length >= 3; } },
      { id: "fo10", ic: "📮", n: "等更十部", d: "追更 10 部", t: function () { return D.follows.length >= 10; } },
      /* 弹幕 / 互动 */
      { id: "dm1", ic: "💬", n: "弹幕首秀", d: "发出 1 条弹幕", t: function () { return D.dm >= 1; } },
      { id: "dm50", ic: "📣", n: "弹幕大师", d: "发出 50 条弹幕", t: function () { return D.dm >= 50; } },
      { id: "dm200", ic: "💥", n: "弹幕狂人", d: "发出 200 条弹幕", t: function () { return D.dm >= 200; } },
      /* 打卡 / 时段 */
      { id: "s3", ic: "📅", n: "三日不断", d: "连续 3 天看剧", t: function () { return D.streak >= 3; } },
      { id: "s7", ic: "🗓", n: "一周不落", d: "连续 7 天看剧", t: function () { return D.streak >= 7; } },
      { id: "s30", ic: "🕯", n: "三十天不离", d: "连续 30 天看剧", t: function () { return D.streak >= 30; } },
      { id: "night", ic: "🌙", n: "夜猫子", d: "23 点后还在追剧", t: function () { return has("night"); } },
      { id: "deep", ic: "🌌", n: "凌晨三点党", d: "0–5 点还在看剧", t: function () { return has("deep"); } },
      { id: "dawn", ic: "🌅", n: "清晨开机", d: "5–9 点看剧", t: function () { return has("dawn"); } },
      { id: "noon", ic: "🍚", n: "午休档", d: "12–14 点看剧", t: function () { return has("noon"); } },
      /* 玩法 / 模式类 */
      { id: "mini", ic: "🪟", n: "小窗党", d: "用小窗模式看过剧", t: function () { return D.miniCnt >= 1; } },
      { id: "mini5", ic: "📌", n: "小窗五连", d: "小窗模式打开 5 次", t: function () { return D.miniCnt >= 5; } },
      { id: "theater", ic: "🎭", n: "剧场常客", d: "在剧场面板看满 3 次", t: function () { return D.theaterCnt >= 3; } },
      { id: "fs", ic: "🖥", n: "全屏派", d: "用过真·全屏", t: function () { return D.fsCnt >= 1; } },
      { id: "fs5", ic: "🔭", n: "巨幕爱好者", d: "真·全屏用过 5 次", t: function () { return D.fsCnt >= 5; } },
      { id: "fit", ic: "🪄", n: "铺满党", d: "试过铺满 / 拉伸画面", t: function () { return has("fit"); } },
      { id: "fit3", ic: "🎛", n: "三档全测", d: "三种画面模式都试过", t: function () { return has("fitC") && has("fitF") && has("fitS"); } },
      { id: "hd", ic: "✨", n: "高清党", d: "用 1080P 看过", t: function () { return has("hd"); } },
      { id: "search", ic: "🔍", n: "寻剧雷达", d: "用过搜索找剧", t: function () { return has("search"); } },
      { id: "rank", ic: "🏆", n: "榜单侦探", d: "打开过热播榜", t: function () { return has("rank"); } },
      { id: "sync", ic: "☁️", n: "云端旅人", d: "账号云同步成功过", t: function () { return has("sync"); } }
    ];
    function has(f) { return D.flags.indexOf(f) >= 0; }
    function uniq(arr, v) { if (v && arr.indexOf(v) < 0) arr.push(v); return arr; }

    var q = [], showing = false;
    function pop(o) { q.push(o); pump(); }
    function pump() {
      if (showing || !q.length) return;
      var box = $("#gtoast");
      if (!box) { q.length = 0; return; }
      var o = q.shift();
      showing = true;
      box.className = "gtoast on" + (o.kind === "lv" ? " lv" : "");
      box.innerHTML = '<div class="gi">' + o.ic + '</div><div class="gt"><b>' + o.t + "</b><small>" + o.s + "</small></div>";
      setTimeout(function () {
        box.classList.remove("on");
        setTimeout(function () { showing = false; pump(); }, 300);
      }, o.kind === "lv" ? 2600 : 1900);
    }

    /* 加经验，处理升级 */
    function addExp(n, silent) {
      D.exp += n;
      var before = levelOf(D.exp - n).lv, after = levelOf(D.exp).lv;
      save();
      if (after > before) {
        for (var lv = before + 1; lv <= after; lv++) {
          pop({ kind: "lv", ic: "⬆️", t: "升级！Lv " + lv + " · " + titleOf(lv), s: "继续保持，经验 " + Math.round(D.exp) });
        }
      }
      checkAch();
      render();
      if (!silent) { }
    }

    var checking = false;
    function checkAch() {
      if (checking) return; checking = true;
      ACH.forEach(function (a) {
        if (!D.ach[a.id] && a.t()) {
          D.ach[a.id] = Date.now();
          D.exp += 30;
          pop({ kind: "ach", ic: a.ic, t: "成就解锁 · " + a.n, s: a.d + "　+30 经验" });
        }
      });
      checking = false;
      save();
    }

    /* 观看计时：按秒累加 */
    var pend = 0;
    function tick(sec) {
      if (!sec || sec <= 0 || sec > 4) return;
      pend += sec;
      while (pend >= 60) {
        pend -= 60;
        D.min += 1;
        D.exp += 4;
        if (D.min % 30 === 0) save();
      }
      var h = new Date().getHours();
      if (h >= 23 || h < 5) { if (!has("night")) D.flags.push("night"); if (!has("deep") && h < 5) D.flags.push("deep"); }
      if (h >= 5 && h < 9 && !has("dawn")) D.flags.push("dawn");
      if (h >= 12 && h < 14 && !has("noon")) D.flags.push("noon");
      checkAch();
      saveThrottled();
    }
    var saveT = null;
    function saveThrottled() {
      clearTimeout(saveT);
      saveT = setTimeout(save, 6000);
    }

    function today() {
      var d = new Date();
      return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
    }
    function touchDay() {
      var t = today();
      if (D.last === t) return;
      var y = new Date(Date.now() - 86400000);
      var ys = y.getFullYear() + "-" + (y.getMonth() + 1) + "-" + y.getDate();
      D.streak = (D.last === ys) ? D.streak + 1 : 1;
      D.last = t;
      D.days += 1;
      D.exp += 30 + Math.min(D.streak, 10) * 5;
      save();
      if (D.streak > 1) toast("连续追剧第 " + D.streak + " 天 · 连更奖励 +" + (30 + Math.min(D.streak, 10) * 5) + " 经验");
    }

    function episode(seriesId, epIndex, quality, tags) {
      touchDay();
      if (seriesId) uniq(D.dramas, String(seriesId));
      if (/1080/i.test(quality || "")) { if (!has("hd")) D.flags.push("hd"); }
      /* 题材：收集不同标签，供"杂食动物"类成就用 */
      if (tags) {
        var arr = Array.isArray(tags) ? tags : String(tags).split(/[,，\/|、]/);
        arr.forEach(function (t) {
          var s = String(t || "").trim();
          if (s && s.length <= 8 && D.tags.length < 40) uniq(D.tags, s);
        });
      }
      var key = seriesId + ":" + epIndex;
      if (D.seen.indexOf(key) < 0) {
        D.seen.push(key);
        if (D.seen.length > 4000) D.seen.shift();
        D.eps += 1;
        D.exp += 8;
        /* 连刷：同一部剧接着上一集、且 8 分钟内，累计最大连刷数 */
        var now = Date.now();
        if (String(seriesId) === D.lastSeries && epIndex === D.lastEpIdx + 1 && now - D.lastEpAt < 8 * 60000) {
          D.conRun = (D.conRun || 0) + 1;
          if (D.conRun > D.binge) D.binge = D.conRun;
        } else {
          D.conRun = 1;
        }
        D.lastSeries = String(seriesId); D.lastEpIdx = epIndex; D.lastEpAt = now;
      } else {
        D.back += 1; /* 回看已看过的集 */
      }
      addExp(0);
    }
    /* 播到最后一秒：整集完播 */
    function finish() { D.fin += 1; D.exp += 2; addExp(0); }

    function fav(seriesId) {
      if (!seriesId) return;
      if (D.favs.indexOf(String(seriesId)) < 0) { D.favs.push(String(seriesId)); D.exp += 15; addExp(0); }
    }
    function follow(seriesId) {
      if (!seriesId) return;
      if (D.follows.indexOf(String(seriesId)) < 0) { D.follows.push(String(seriesId)); D.exp += 15; addExp(0); }
    }
    function dm() { D.dm += 1; D.exp += 4; addExp(0); }
    function flag(f) {
      if (has(f)) return;
      D.flags.push(f); D.exp += 8; addExp(0);
    }
    function mode(kind) {
      if (kind === "theater") { D.theaterCnt += 1; if (D.theaterCnt === 1) D.exp += 10; }
      else if (kind === "mini") { D.miniCnt += 1; if (D.miniCnt === 1) D.exp += 10; }
      else if (kind === "fs") { D.fsCnt += 1; if (D.fsCnt === 1) D.exp += 10; }
      addExp(0);
    }

    /* 首次启动：把已有追剧记录折算成起步经验（最多算 40 部，别把等级灌满） */
    function seed(lib) {
      if (D.seeded) return;
      D.seeded = true;
      var entries = (lib && lib.entries) || [];
      entries.slice(0, 40).forEach(function (e) {
        var drama = e.drama || e;
        var id = drama.series_id || e.series_id;
        if (!id) return;
        uniq(D.dramas, String(id));
        if (e.favorite_at) uniq(D.favs, String(id));
        var ep = Math.max(1, Number(e.episode) || 1);
        D.eps += Math.min(ep, 3);
      });
      if (D.dramas.length) {
        D.exp += Math.min(D.eps * 8 + D.favs.length * 15, 360);
        D.last = today();
        D.streak = 1;
      }
      save();
      addExp(0);
    }

    /* ---- 渲染 ---- */
    function render() {
      var i = levelOf(D.exp);
      if (DEMO) devLog("GRO exp=" + Math.round(D.exp) + " lv=" + i.lv + " eps=" + D.eps + " min=" + D.min + " dramas=" + D.dramas.length + " seen=" + D.seen.length + " ach=" + Object.keys(D.ach).length);
      var sideLv = $("#sideLv"), sideExp = $("#sideExp");
      if (sideLv) sideLv.textContent = "Lv " + i.lv;
      if (sideExp) {
        var p = Math.round(i.cur / i.need * 100);
        sideExp.style.width = Math.max(6, p) + "%";
      }
      var num = $("#lvNum");
      if (num) {
        num.textContent = i.lv;
        $("#lvTitle").textContent = titleOf(i.lv);
        $("#lvExpTxt").textContent = "经验 " + i.cur + " / " + i.need;
        $("#lvFill").style.width = Math.round(i.cur / i.need * 100) + "%";
        $("#lvNeed").textContent = Math.max(0, i.need - i.cur);
        $("#lvNext").textContent = "Lv " + (i.lv + 1);
        $("#ring").style.setProperty("--p", Math.round(i.cur / i.need * 100));
        var st = [
          ["观看", D.min + " 分钟"], ["看过", D.eps + " 集"], ["追过", D.dramas.length + " 部"],
          ["收藏", D.favs.length + " 部"], ["弹幕", D.dm + " 条"], ["连续", D.streak + " 天"]
        ];
        $("#lvStats").innerHTML = st.map(function (x) {
          return '<span class="lstat"><small>' + x[0] + "</small><b>" + x[1] + "</b></span>";
        }).join("");
        var got = 0, ag = $("#achGrid");
        if (!ag) return;   /* 首页/其它视图里没有成就墙，别在这里抛错把后面的启动代码一起带走 */
        paintAch();
      }
    }

    function card() {
      var el = document.createElement("div");
      el.className = "lvwrap";
      el.innerHTML =
        '<div class="lvcard">' +
          '<div class="ring" id="ring" style="--p:0"><div class="ringin"><span id="lvNum">1</span><small>LV</small></div></div>' +
          '<div class="lvmain">' +
            '<div class="lvh"><b id="lvTitle">新片观众</b><span id="lvExpTxt">经验 0 / 100</span></div>' +
            '<div class="lvbar"><i id="lvFill"></i></div>' +
            '<div class="lvsub">再攒 <b id="lvNeed">100</b> 经验升到 <b id="lvNext">Lv 2</b>　·　看 1 分钟 +4，看 1 集 +8，收藏 / 追更 +15，成就 +30</div>' +
            '<div class="lstats" id="lvStats"></div>' +
          "</div>" +
        "</div>" +
        '<div class="sec" style="margin:18px 0 10px"><h2 style="font-size:18px">成就墙</h2>' +
        '<span class="cnt" id="achCnt">0 / ' + ACH.length + '</span><div class="rule"></div>' +
        '<button class="tb" id="achFold" data-dir="down" data-hint="展开全部 ' + ACH.length + ' 项">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 14.6 12 9.1l5.5 5.5"/></svg>' +
        "</button></div>" +
        '<div class="achgrid fold" id="achGrid"></div>';
      var af = el.querySelector("#achFold");
      if (af) af.onclick = function () {
        var g = $("#achGrid");
        if (!g) return;
        g.classList.toggle("fold");
        paintAch();
      };
      return el;
    }

    /* v1.027：折叠态只摆「已解锁 + 3 个最接近的」，展开才铺全部
       没有"还差几次"的进度数据，未解锁就按定义顺序（从易到难）取前 3 个 */
    function paintAch() {
      var g = $("#achGrid"), cnt = $("#achCnt");
      if (!g) return;
      var gotList = ACH.filter(function (a) { return !!D.ach[a.id]; })
        .sort(function (x, y) { return (D.ach[y.id] || 0) - (D.ach[x.id] || 0); });
      var restList = ACH.filter(function (a) { return !D.ach[a.id]; });
      var folded = g.classList.contains("fold");
      var list = folded ? gotList.concat(restList.slice(0, 3)) : gotList.concat(restList);
      g.innerHTML = list.map(function (a) {
        var on = !!D.ach[a.id];
        return '<div class="ach' + (on ? " on" : "") + '" data-hint="' + a.d + '"><i>' + a.ic +
          '</i><div class="tx"><b>' + a.n + "</b><small>" + a.d + "</small></div></div>";
      }).join("");
      if (cnt) {
        cnt.textContent = gotList.length + " / " + ACH.length +
          (folded && restList.length > 0 ? "　还有 " + restList.length + " 项未解锁" : "");
      }
      syncAchFold(folded);
    }

    /* 折叠状态跟着图标方向走（上=收起，下=展开），文字只留气泡里 */
    function syncAchFold(folded) {
      var b = $("#achFold");
      if (!b) return;
      if (typeof folded !== "boolean") {
        var g = $("#achGrid");
        folded = !!(g && g.classList.contains("fold"));
      }
      b.setAttribute("data-dir", folded ? "down" : "up");
      b.setAttribute("data-hint", folded ? "展开全部 " + ACH.length + " 项" : "收起，只留已解锁");
    }

    return {
      episode: episode, fav: fav, follow: follow, dm: dm, flag: flag, mode: mode, tick: tick, seed: seed,
      finish: finish, card: card, render: render, data: D, check: checkAch
    };
  })();
  window.GRO = GRO;

  /* ---------- 小果：本机剧库助理（L1 规则 + 模板，零模型、零常驻定时器） ---------- */
  var AI = (function () {
    var pop, ball, body, chips, input;
    var opened = false, seeded = false, busy = false;
    var CHIPS = ["看到哪了", "找部短的", "我收藏了啥", "能干啥"];

    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
        return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
      });
    }

    /* ============ 记忆 · 陪伴 · 情感 ============
       参照 Miru 的三件事（记得你 / 自己决定开口 / 有情绪），但这里一个都不靠大模型：
       · 记忆是结构化的本地事实，你一打开就能看见她记了什么、也能让她忘掉
       · 开口不用定时器：只在「你打开面板」这一下算一次，算完就睡，不轮询、不截屏、不联网
       · 情绪是几个数字（亲密度 / 精力）驱动的语气档位，不是生成出来的 */
    var MKEY = "xg.mem.v1";
    var MO = null;

    function moLoad() {
      var d = { v: 1, bond: 0, seenN: 0, seenLast: 0, seenFirst: 0,
                talkN: 0, talkLast: 0, talkDay: "", talkToday: 0,
                playsN: 0, playLast: 0, facts: [], asked: [],
                saidDay: "", said: [] };
      try {
        var raw = localStorage.getItem(MKEY);
        if (raw) {
          var p = JSON.parse(raw);
          for (var k in d) if (p[k] !== undefined) d[k] = p[k];
        }
      } catch (e) { }
      return d;
    }
    function moSave() {
      if (!MO) return;
      if (MO.facts.length > 24) MO.facts = MO.facts.slice(-24);
      if (MO.asked.length > 24) MO.asked = MO.asked.slice(-24);
      try { localStorage.setItem(MKEY, JSON.stringify(MO)); } catch (e) { }
      moSync();
    }

    /* --- 记忆落成可打开的文件：localStorage 说了算，文件是给人核对与备份用的 --- */
    function renderMD(m) {
      var L = [], t = function (ts) { return ts ? new Date(ts).toLocaleString("zh-CN") : ""; };
      L.push("# 小果记得的事");
      L.push("");
      L.push("> 这台机器上的本地记忆。不联网、不上传、不调模型。");
      L.push("> 这份是给你看的快照——想让它忘干净，在小果面板里说一句「忘了吧」，比手改这个文件可靠。");
      L.push("");
      L.push("- 更新于：" + new Date().toLocaleString("zh-CN"));
      L.push("- 见过：" + (m.seenN || 0) + " 回　聊过 " + (m.talkN || 0) + " 次" + (m.talkToday ? "（今天 " + m.talkToday + " 次）" : ""));
      L.push("- 亲密度：" + (m.bond || 0) + " / 100");
      if (m.seenFirst) L.push("- 第一次来：" + t(m.seenFirst));
      if (m.playLast) L.push("- 最近点开一部剧：" + t(m.playLast));
      L.push("");
      L.push("## 你自己说过的偏好");
      L.push("");
      var fs = m.facts || [];
      if (fs.length) {
        fs.forEach(function (f) {
          L.push("- **" + f.t + "**　·　" + t(f.at) + (f.n > 1 ? "　·　提过 " + f.n + " 次" : ""));
        });
      } else {
        L.push("- （还没有。跟她说一句「我爱看修仙的」，她就记下来。）");
      }
      L.push("");
      L.push("## 最近问过的");
      L.push("");
      var as = (m.asked || []).slice(-12).reverse();
      if (as.length) {
        as.forEach(function (a) { L.push("- 「" + a.q + "」　·　" + t(a.at)); });
      } else {
        L.push("- （还没有）");
      }
      L.push("");
      return L.join("\r\n");
    }

    var moT = null;
    function b64(s) {
      /* 走 base64 过宿主：省得在 C# 里跟 JSON 转义较劲 */
      try { return btoa(unescape(encodeURIComponent(s))); } catch (e) { return ""; }
    }
    function moSync() {
      if (moT) clearTimeout(moT);
      moT = setTimeout(function () {
        moT = null;
        try {
          if (!window.chrome || !window.chrome.webview) return;
          window.chrome.webview.postMessage(JSON.stringify({
            action: "mem", j: b64(JSON.stringify(MO)), m: b64(renderMD(MO))
          }));
        } catch (e) { }
      }, 1200);
    }

    function moRestore(json) {
      /* 只在本地存储是空的时候才拿文件兜底，绝不覆盖你正在用的记忆 */
      try {
        if (localStorage.getItem(MKEY)) return false;
        var p = JSON.parse(json), d = moLoad();
        for (var k in d) if (p[k] !== undefined) d[k] = p[k];
        MO = d;
        localStorage.setItem(MKEY, JSON.stringify(MO));
        try { if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(JSON.stringify({ action: "log", text: "记忆文件兜底恢复成功：" + (MO.facts || []).length + " 条偏好 · 见过 " + MO.seenN })); } catch (e2) { }
        return true;
      } catch (e) { return false; }
    }
    function dayOf(ts) {
      var d = new Date(ts || Date.now());
      return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
    }
    function dayGap(a, b) { return Math.floor(b / 864e5) - Math.floor(a / 864e5); }

    /* --- 记什么：只记你亲口说的偏好，或者你真点开过的剧；从不自己编 --- */
    var LIKERE = /(我|咱)(?:比较|特别|很|最)?(喜欢|爱看|爱追|想看|只看|不看|讨厌|受不了|不喜欢)([^。！？!?，,]{1,16})/;
    var NOPERE = /(别|不要|不用)(?:给我|再)?(推荐|推|发)([^。！？!?，,]{1,14})/;

    function learn(text) {
      if (!MO) MO = moLoad();
      var m = LIKERE.exec(text), s = null, tpc = "", no = false;
      if (m) {
        s = m[2] + (m[3] || "").trim();
        tpc = (m[3] || "").trim().replace(/的$/, "").trim();       /* 只留"修仙""太长的"这种实物词，供下次直接拿去找剧 */
        no = /不看|讨厌|受不了|不喜欢/.test(m[2]);
      }
      if (!s) {
        var n = NOPERE.exec(text);
        if (n && n[3]) { s = "不喜欢" + n[3].replace(/的$/, "").trim(); tpc = n[3].replace(/的$/, "").trim(); no = true; }
      }
      if (!s || s.length < 2) return null;
      for (var i = 0; i < MO.facts.length; i++) {
        if (MO.facts[i].t === s) {
          MO.facts[i].n++; MO.facts[i].at = Date.now();
          if (tpc) MO.facts[i].topic = tpc;
          moSave(); return s;
        }
      }
      MO.facts.push({ t: s, topic: tpc, at: Date.now(), n: 1, no: no });
      moSave();
      return s;
    }

    /* --- 从记下的偏好里挑一条最该用的 --- */
    function isNoFact(f) { return !!f.no || /^(不喜欢|不看|讨厌|受不了)/.test(String(f.t || "")); }
    function prefTopic(f) {
      if (f.topic) return f.topic;
      return String(f.t || "").replace(/^(我|咱)/, "")
        .replace(/(比较|特别|很|最)?(喜欢|爱看|爱追|想看|只看|不爱看|不看|讨厌|受不了|不喜欢)/, "")
        .replace(/的$/, "").trim();
    }
    function prefTop() {
      /* 次数多、最近说过的优先；否定的偏好不当搜索种子 */
      var best = null, bs = -1;
      for (var i = 0; i < (MO.facts || []).length; i++) {
        var f = MO.facts[i];
        if (isNoFact(f)) continue;
        if (prefTopic(f).length < 2) continue;
        var age = (Date.now() - (f.at || 0)) / 864e5;
        var sc = (f.n || 1) * 2 + Math.max(0, 3 - age) + (f.topic ? 0.5 : 0);
        if (sc > bs) { bs = sc; best = f; }
      }
      return best;
    }
    function noLong() {
      /* 记过"不喜欢太长的"就真的挑短的 —— 记了就得用上，不然等于骗人 */
      var fs = MO.facts || [];
      for (var i = 0; i < fs.length; i++) {
        if (!isNoFact(fs[i])) continue;
        if (/太长|长的|集数多|费时间/.test(String(fs[i].t || "") + " " + String(fs[i].topic || ""))) return true;
      }
      return false;
    }

    function recall(topic) {
      /* 找一条跟你这句话最沾边的旧记忆，沾不上就不硬凑 */
      if (!topic) return null;
      var best = null, bl = 0;
      for (var i = 0; i < MO.facts.length; i++) {
        var f = MO.facts[i];
        for (var k = 0; k + 2 <= f.t.length; k++) {
          var seg = f.t.substr(k, 2);
          if (topic.indexOf(seg) >= 0 || f.t.indexOf(topic) >= 0) {
            if (f.t.length > bl) { bl = f.t.length; best = f; }
            break;
          }
        }
      }
      return best;
    }

    /* --- 亲密度：见面 +1，说话 +2，真点开卡片 +3；隔一天不来掉 1 --- */
    function touch(kind) {
      if (!MO) MO = moLoad();
      var now = Date.now(), today = dayOf(now), gap = MO.seenLast ? dayGap(MO.seenLast, now) : 0;
      if (gap > 0) MO.bond = Math.max(0, MO.bond - Math.min(4, gap));
      if (MO.talkDay !== today) { MO.talkDay = today; MO.talkToday = 0; }
      if (kind === "open") {
        MO.seenN++; MO.seenLast = now;
        if (!MO.seenFirst) MO.seenFirst = now;
        MO.bond = Math.min(100, MO.bond + 1);
      } else if (kind === "talk") {
        MO.talkN++; MO.talkLast = now; MO.talkToday++;
        MO.bond = Math.min(100, MO.bond + 2);
      } else if (kind === "play") {
        MO.playsN++; MO.playLast = now;
        MO.bond = Math.min(100, MO.bond + 3);
      }
      moSave();
      paintBond();
    }

    function bondBand() { return MO.bond >= 60 ? 3 : (MO.bond >= 25 ? 2 : 1); }
    function paintBond() {
      if (!MO) return;
      var b = String(bondBand());
      if (pop) pop.setAttribute("data-bond", b);
      if (ball) ball.setAttribute("data-bond", b);
    }

    /* --- 说什么：一天一种话只说一次，说过的当天不再重复 --- */
    function opener() {
      if (!MO) MO = moLoad();
      var now = Date.now(), today = dayOf(now), hr = new Date(now).getHours();
      if (MO.saidDay !== today) { MO.saidDay = today; MO.said = []; }
      function once(k) {
        if (MO.said.indexOf(k) >= 0) return false;
        MO.said.push(k); moSave(); return true;
      }
      if (MO.seenN <= 1) return { k: "first", t: "我是小果 · 本机剧库助理。" };
      if (MO.talkToday >= 5) return { k: "quiet", t: "又来了。" };
      var gap = dayGap(MO.seenLast, now);
      if (gap >= 7 && once("miss")) return { k: "miss", t: "你有 " + gap + " 天没来了。" };
      if (gap >= 3 && once("miss3")) return { k: "miss", t: "三天没见着你了。" };
      if (hr < 6 && once("late")) return { k: "late", t: "这个点还没睡。" };
      if (hr >= 23 && once("late2")) return { k: "late", t: "又是这个点。" };
      if (hr < 11 && once("morning")) return { k: "morning", t: "早。" };
      if (MO.bond >= 60 && once("warm")) return { k: "warm", t: "你来了。" };
      return { k: "plain", t: "我是小果 · 本机剧库助理。" };
    }
    function tagText(x) {
      var t = x && x.tags;
      if (!t) return "";
      var arr = Array.isArray(t) ? t : String(t).split(/[,，、\/|;；]+/);
      return arr.map(function (s) { return String(s).trim(); }).filter(Boolean).slice(0, 2).join(" / ");
    }
    function down() { if (body) body.scrollTop = body.scrollHeight; }
    /* 气泡里提到的剧名做成可点的锚点：点一下直接进那部剧，定位到说的那一集。
       不给"知道是哪部剧却只能自己再去搜一遍"这种事。 */
    function jumpTo(sid, epi) {
      if (!sid) return;
      close();
      lib(function (l) {
        var entries = (l && l.entries) || [], it = null, i, dr;
        for (i = 0; i < entries.length; i++) {
          dr = entries[i].drama || entries[i];
          if (dr && String(dr.series_id) === String(sid)) { it = dr; break; }
        }
        if (!it) { toast("库里没找到这部剧"); return; }
        touch("play");
        openDetail(it, isNaN(epi) ? 0 : Math.max(0, epi - 1));
      });
    }
    function bindJump(box) {
      box.addEventListener("click", function (ev) {
        var a = ev.target && ev.target.closest ? ev.target.closest("a.jp") : null;
        if (a) {
          ev.preventDefault();
          ev.stopPropagation();
          jumpTo(a.getAttribute("data-sid"), parseInt(a.getAttribute("data-ep"), 10));
          return;
        }
        /* 老消息（旧版本存下来的、没带锚点的）里也有《剧名》，
           点它同样要能进那部剧：按书名号里的字回库里认一次。 */
        var el = ev.target;
        if (el && el.nodeType === 3) el = el.parentNode;
        if (!el || !el.closest || !el.closest(".am")) return;
        var b = el.closest(".bb b");
        if (!b) return;
        var m = String(b.textContent || "").match(/《([^》]{1,40})》/);
        if (!m) return;
        var name = m[1], keep = ev;
        keep.preventDefault();
        keep.stopPropagation();
        lib(function (l) {
          var es = (l && l.entries) || [], it = null, ep = 0, i, dr;
          for (i = 0; i < es.length; i++) {
            dr = es[i].drama || es[i];
            if (dr && String(dr.title || "") === name) { it = dr; ep = es[i].episode || 0; break; }
          }
          if (!it) return;
          close();
          touch("play");
          openDetail(it, ep > 0 ? ep - 1 : 0);
        });
      });
    }
    /* 剧名 + 集号拼成一个可点片段，各处共用同一套写法 */
    function jp(dr, ep, txt) {
      return '<b><a class="jp" data-sid="' + esc(dr.series_id) + '" data-ep="' + (ep || "") + '">' +
        (txt || ("《" + esc(dr.title || "那部剧") + "》")) + '</a></b>';
    }
    function msg(html, me) {
      var d = document.createElement("div");
      d.className = "am" + (me ? " me" : "");
      d.innerHTML = (me ? "" : '<i class="amv">✦</i>') + '<div class="bb">' + html + "</div>";
      bindJump(d);
      body.appendChild(d); down();
      if (opened) setTimeout(place, 70);
      return d;
    }
    function typing() {
      var d = document.createElement("div");
      d.className = "am tp";
      d.innerHTML = '<i class="amv">✦</i><div class="bb"><i></i><i></i><i></i></div>';
      body.appendChild(d); down();
      return d;
    }
    function card(item, goText) {
      var it = (item && item.drama) || item || {};
      var d = document.createElement("div");
      d.className = "ami";
      var cov = coverOf(it), eps = Number(it.episode_count) || 0;
      d.innerHTML = (cov ? '<img src="' + esc(cov) + '" loading="lazy" alt="">' : '<div class="ph"></div>') +
        '<div class="tx"><b>' + esc(it.title || "未命名") + "</b><span>" +
        (eps ? eps + " 集" : "") + (it.score ? " · ★" + esc(it.score) : "") +
        (item && item._why ? " · " + esc(item._why) : "") +
        '</span></div><div class="go">' + (goText || "看看") + "</div>";
      d.onclick = function () { touch("play"); close(); openDetail(it, 0); };
      body.appendChild(d); down();
      if (opened) setTimeout(place, 70);
    }
    var pendNote = "";      /* 这一问里刚记下的偏好，答完正事补在气泡底下 */
    function reply(html, tp) {
      if (tp) tp.remove();
      if (pendNote) { html += "<span class='semnote'>" + pendNote + "</span>"; pendNote = ""; }
      msg(html);
      busy = false;
    }

    /* --- 本地数据（全部来自 core，没有一次外网请求） --- */
    function lib(cb) {
      if (S.library && S.library.entries) return cb(S.library);
      api("/api/v1/library").then(function (d) {
        S.library = d || { entries: [] };
        if (window.GRO && GRO.seed) GRO.seed(S.library);
        cb(S.library);
      }).catch(function () { cb({ entries: [] }); });
    }
    function dOf(e) { return (e && e.drama) || e || {}; }
    function hist(l) {
      return (l.entries || []).filter(function (e) { return e.last_played_at; })
        .sort(function (a, b) { return b.last_played_at - a.last_played_at; });
    }
    function favs(l) {
      return (l.entries || []).filter(function (e) { return e.favorite_at; })
        .sort(function (a, b) { return b.favorite_at - a.favorite_at; });
    }
    function rec(n, cb) {
      api("/api/v1/lists/recommend?offset=0&count=" + (n || 12)).then(function (d) { cb((d && d.items) || []); })
        .catch(function () { cb([]); });
    }
    function find(q, cb) {
      api("/api/v1/lists/search?q=" + encodeURIComponent(q) + "&offset=0&count=9").then(function (d) { cb((d && d.items) || []); })
        .catch(function () { cb([]); });
    }

    /* ---------- 语义检索：bge-small-zh-v1.5 int8 + onnxruntime-web，模型和向量都在本机 ----------
       v1.028 补上四样工程约束（照 ImageToolbox 的 AI 模块路子）：门槛、指纹、超时、体检 */
    var SEM = (function () {
      var PREFIX = "为这个句子生成表示以用于检索相关文章：";
      var BASE = "ai/";
      var st = {
        on: false, loading: false, err: null, loadMs: 0, encMs: 0, n: 0, it: false,
        missing: false, gate: "", fp: "", toMs: 0, toCnt: 0, mb: 0, mem: 0, threads: 1, stage: "",
        errAt: 0
      };
      var sess = null, tk = null, VEC = null, IDX = null, pending = null, MAN = null;
      var lock = Promise.resolve();   /* 推理串行锁：同一时刻只允许一条 run */
      var IP = null, MU = null, ILAB = null;   /* 意图原型（已中心化）、中心化用的均值、标签 */

      function log(t) {
        try {
          if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(JSON.stringify({ action: "log", text: "[sem] " + t }));
        } catch (e) { }
      }
      function loadScript(src) {
        return new Promise(function (res, rej) {
          var s = document.createElement("script");
          s.src = src;
          s.onload = function () { res(); };
          s.onerror = function () { rej(new Error("脚本没加载上 " + src)); };
          document.head.appendChild(s);
        });
      }
      function getBuf(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.arrayBuffer(); }); }
      function getText(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.text(); }); }
      function getJson(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }); }

      /* 指纹：模型文件的 SHA-256，和 ai/manifest.json 对上才敢加载 —— 半截的 onnx 不报错，只会静默出 NaN */
      function sha256(buf) {
        if (!window.crypto || !crypto.subtle) return Promise.resolve("");
        return crypto.subtle.digest("SHA-256", buf).then(function (d) {
          var a = new Uint8Array(d), s = "", i, h;
          for (i = 0; i < a.length; i++) { h = a[i].toString(16); s += h.length < 2 ? "0" + h : h; }
          return s;
        }).catch(function () { return ""; });
      }

      /* 超时：哪一步卡住都不许无限挂着，超时当成失败，回头走关键词兜底 */
      function within(p, ms, tag) {
        return new Promise(function (res, rej) {
          var done = false;
          var t = setTimeout(function () {
            if (done) return; done = true;
            var e = new Error(tag + "超时 " + (ms >= 1000 ? (ms / 1000).toFixed(ms % 1000 ? 1 : 0) + "s" : ms + "ms"));
            e.timeout = true; rej(e);
          }, ms);
          p.then(function (v) { if (done) return; done = true; clearTimeout(t); res(v); },
            function (e) { if (done) return; done = true; clearTimeout(t); rej(e); });
        });
      }
      function mb(n) { return n ? (n / 1048576).toFixed(1) + " MB" : "—"; }

      /* float16 → float32，库向量一次性摊平，之后就是纯点积 */
      function half(buf) {
        var u = new Uint16Array(buf), out = new Float32Array(u.length);
        for (var i = 0; i < u.length; i++) {
          var h = u[i], sg = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
          if (e === 0) out[i] = sg * f * 5.960464477539063e-8;
          else if (e === 31) out[i] = f ? NaN : sg * Infinity;
          else out[i] = sg * (1 + f / 1024) * Math.pow(2, e - 15);
        }
        return out;
      }

      function boot() {
        if (st.on) return Promise.resolve(st);
        if (pending) return pending;
        /* 刚失败过就先别重试：连着搜几次会把 22MB 模型反复读一遍 */
        if (st.errAt && Date.now() - st.errAt < 30000) return Promise.resolve(st);
        st.loading = true; st.err = null; st.errAt = 0; st.stage = "读清单";
        st.fp = ""; st.missing = false; st.it = false; st.encMs = 0;
        var t0 = Date.now();
        /* 门槛：内存不到 4GB 的机器降级跑 —— 单句超时收紧，不硬拦也不让它卡得难受 */
        var mem = navigator.deviceMemory || 0;
        st.mem = mem;
        st.gate = mem && mem < 4 ? "低内存 · 已降级" : "";
        st.toMs = st.gate ? 5000 : 8000;
        /* 先探一眼 ai/index.json：轻量包没有 ai 目录就直接收手，不报错、不吭声 */
        var chain = fetch(BASE + "index.json").then(function (r) {
          if (r.status === 404) { var e = new Error("no ai"); e.silent = true; throw e; }
          if (!r.ok) throw new Error("index.json " + r.status);
          return r.json();
        }).then(function (idx) {
          IDX = idx;
          st.n = IDX.length;
          st.stage = "读数据";
          return Promise.all([
            getText(BASE + "vocab.txt"), getBuf(BASE + "vectors.bin"), loadScript(BASE + "ort.min.js"),
            getText(BASE + "intents.json").catch(function () { return null; }),
            getBuf(BASE + "intents.bin").catch(function () { return null; }),
            within(getJson(BASE + "manifest.json"), 4000, "清单").catch(function () { return null; })
          ]);
        }).then(function (r) {
          MAN = r[5];
          tk = window.BgeTok.create(r[0]);
          VEC = half(r[1]);
          if (r[3] && r[4]) {
            try {
              var meta = JSON.parse(r[3]);
              ILAB = meta.labels;
              MU = meta.mu;                    /* 512 个 float，中心化用的均值 */
              IP = half(r[4]);
              if (MU && MU.length === 512 && IP.length === 512 * ILAB.length) st.it = true;
            } catch (e) { st.it = false; }
          }
          ort.env.wasm.wasmPaths = {
            mjs: new URL(BASE + "ort-wasm-simd-threaded.mjs", location.href).href,
            wasm: new URL(BASE + "ort-wasm-simd-threaded.wasm", location.href).href
          };
          st.threads = 1;
          ort.env.wasm.numThreads = 1;
          ort.env.wasm.simd = true;
          st.stage = "读模型";
          return within(getBuf(BASE + "model.onnx"), 15000, "读模型");
        }).then(function (buf) {
          st.mb = buf.byteLength;
          st.stage = "校验指纹";
          /* 清单里有指纹就必须对上：坏文件不报错，只会在推理里静默出 NaN */
          var want = (MAN && MAN.files && MAN.files["model.onnx"] && MAN.files["model.onnx"].sha256) || "";
          if (!want) { st.fp = "无清单"; return buf; }
          return sha256(buf).then(function (got) {
            if (got && got !== want) {
              st.fp = "不符";
              throw new Error("模型指纹不符 " + got.slice(0, 8) + "≠" + want.slice(0, 8));
            }
            st.fp = got ? "一致" : "跳过";
            return buf;
          });
        }).then(function (buf) {
          st.stage = "建会话";
          return within(ort.InferenceSession.create(buf, { executionProviders: ["wasm"], graphOptimizationLevel: "all" }), 12000, "建会话");
        }).then(function (s) {
          sess = s;
          st.on = true; st.loading = false; st.loadMs = Date.now() - t0; st.stage = "";
          log("ready " + st.loadMs + "ms n=" + st.n + " fp=" + st.fp + " mb=" + mb(st.mb) + (st.gate ? " gate=" + st.gate : ""));
          return st;
        }).catch(function (e) {
          st.loading = false; pending = null; st.stage = "";
          st.errAt = Date.now();
          if (e && e.silent) { st.missing = true; return st; }
          if (e && e.timeout) st.toCnt++;
          st.err = String((e && e.message) || e);
          log("fail " + st.err);
          return st;
        });
        /* 整条链再兜一层，22 秒还没好就当加载失败，别让界面一直转圈 */
        pending = within(chain, 22000, "加载").catch(function (e) {
          st.loading = false; pending = null; st.stage = "";
          st.errAt = Date.now();
          if (e && e.timeout) { st.toCnt++; st.err = String(e.message); }
          log("fail " + (st.err || "超时"));
          return st;
        });
        return pending;
      }

      function enc(text) {
        var ids = tk.encode(text, 192), n = ids.length;
        var a = new BigInt64Array(n), m = new BigInt64Array(n), t = new BigInt64Array(n);
        for (var i = 0; i < n; i++) { a[i] = BigInt(ids[i]); m[i] = 1n; }
        return sess.run({
          input_ids: new ort.Tensor("int64", a, [1, n]),
          attention_mask: new ort.Tensor("int64", m, [1, n]),
          token_type_ids: new ort.Tensor("int64", t, [1, n])
        }).then(function (o) {
          var h = o.last_hidden_state.data, v = new Float32Array(512), sq = 0;
          for (var k = 0; k < 512; k++) { v[k] = h[k]; sq += v[k] * v[k]; }
          sq = Math.sqrt(sq) || 1;
          for (var j = 0; j < 512; j++) v[j] /= sq;
          return v;
        });
      }

      /* 排队：搜索框连着敲、意图判定和检索撞在一起时，同一会话不许并发 run */
      function encQ(text) {
        var run = lock.then(function () { return enc(text); });
        lock = run.catch(function () { });
        return run;
      }

      function top(text, k) {
        return boot().then(function () {
          if (!st.on) return [];
          var t0 = Date.now();
          return within(encQ(PREFIX + text), st.toMs, "推理").then(function (qv) {
            st.encMs = Date.now() - t0;
            var n = st.n, dim = 512, arr = [];
            for (var i = 0; i < n; i++) {
              var off = i * dim, s = 0;
              for (var j = 0; j < dim; j++) s += VEC[off + j] * qv[j];
              arr.push([s, i]);
            }
            arr.sort(function (x, y) { return y[0] - x[0]; });
            return arr.slice(0, k || 6).map(function (x) {
              return { sid: IDX[x[1]].sid, title: IDX[x[1]].title, ep: IDX[x[1]].ep, score: x[0] };
            });
          }).catch(function (e) {
            if (e && e.timeout) { st.toCnt++; log("timeout " + e.message + " 「" + text + "」"); }
            return [];
          });
        });
      }

      /* 意图判定：最近邻。122 条例句向量都留着，不取均值 —— 均值会把不同说法平均掉，召回掉一半。
         query 先中心化（减掉例句全体均值）再归一化，然后跟每条例句点积，按类取最高。
         中心化是必须的：不中心化时各类余弦全在 0.75~0.88，谁都像谁；中心化后落到 -0.4~0.17，才分得开 */
      function intent(text) {
        return boot().then(function () {
          if (!st.on || !st.it) return null;
          return within(encQ(PREFIX + text), st.toMs, "推理").then(function (v) {
            var c = new Float32Array(512), nn = 0;
            for (var i = 0; i < 512; i++) { c[i] = v[i] - MU[i]; nn += c[i] * c[i]; }
            nn = Math.sqrt(nn);
            if (!nn) return null;
            var cls = {}, k, lb, off, s, j;
            for (k = 0; k < ILAB.length; k++) {
              off = k * 512; s = 0;
              for (j = 0; j < 512; j++) s += IP[off + j] * c[j];
              s /= nn;
              lb = ILAB[k];
              if (cls[lb] === undefined || s > cls[lb]) cls[lb] = s;
            }
            var arr = [];
            for (lb in cls) arr.push([lb, cls[lb]]);
            arr.sort(function (a, b) { return b[1] - a[1]; });
            var r = { label: arr[0][0], score: arr[0][1], margin: arr[0][1] - (arr[1] ? arr[1][1] : -9) };
            log("intent " + r.label + " " + r.score.toFixed(3) + "/" + r.margin.toFixed(3) + " 「" + text + "」");
            return r;
          }).catch(function (e) {
            if (e && e.timeout) { st.toCnt++; log("timeout " + e.message + " 「" + text + "」"); }
            return null;
          });
        });
      }
      /* 重载：怀疑文件坏了、换过模型、或者上一次超时了，从头再走一遍包含指纹校验 */
      function reset() {
        try { if (sess && sess.release) sess.release(); } catch (e) { }
        sess = null; pending = null; MAN = null;
        lock = Promise.resolve();   /* 旧队列丢掉，别让卡住的那条 run 把新推理挡在后面 */
        st.on = false; st.loading = false; st.err = null; st.fp = ""; st.stage = "";
        st.errAt = 0; st.missing = false; st.it = false; st.encMs = 0;
        st.mb = 0; st.loadMs = 0;
        return boot();
      }
      return {
        boot: boot, top: top, intent: intent, reset: reset, stat: function () { return st; }
      };
    })();
    window.HONGUO_SEM = SEM;

    /* 按意思找剧：语义结果回头去 library 里取完整的 drama 对象，才能出封面和跳详情 */
    function findSem(q, cb) {
      SEM.top(q, 8).then(function (rs) {
        if (!rs.length) return cb([]);
        lib(function (l) {
          var by = {};
          (l.entries || []).forEach(function (e) {
            var d = dOf(e), sid = String(e.series_id || (d && d.series_id) || "");
            if (sid && !by[sid]) by[sid] = e;
          });
          var items = [];
          rs.forEach(function (r) {
            var e = by[String(r.sid)];
            if (e) { if (!e._why) e._why = "像"; items.push(e); }
          });
          cb(items, rs);
        });
      }).catch(function () { cb([]); });
    }

    /* --- 从一句话里剥出"能拿去搜的词" --- */
    function pick(text) {
      var q = text.replace(/[？?。！!，,、~～""'']/g, " ")
        .replace(/(有没有什么|有没有|有木有|帮我|给我|麻烦|请问|推荐|搜索|搜一下|搜搜|搜|查找|找|一部|几部|一部部|部|一些|那种|这种|类型|的短剧|短剧|小短剧|短的|真人剧|漫剧|电视剧|电影|剧集|看点什么|看点啥|能看|想看|要看|看看|可以看|关于|讲什么|讲的什么|讲的是|介绍|简介|是什么|内容)/g, " ")
        .replace(/\s+/g, " ").trim();
      for (var i = 0; i < 3; i++) q = q.replace(/[的吧呢啊吗了呀嘛]+$/, "").replace(/的$/, "").trim();
      return q;
    }

    function handle(text) {
      if (!body || busy) return;
      busy = true;
      if (chips && chips.style.display !== "none") chips.style.display = "none";   /* 说上话之后就把快捷句收掉，把高度让给对话 */
      touch("talk");
      var learned = learn(text);      /* 你亲口说的偏好，边聊边记 */
      var q = String(text).slice(0, 40);
      MO.asked = (MO.asked || []).filter(function (x) { return x.q !== q; });   /* 同一句只留最近一次，别在“最近问过的”里刷屏 */
      MO.asked.push({ q: q, at: Date.now() });
      moSave();
      msg(esc(text), true);
      var tp = typing();
      setTimeout(function () { route(text, tp, learned); }, 300);
    }

    function route(text, tp, learned) {
      var t = String(text).replace(/[\s，。！？、]/g, ""), q = pick(text);
      if (learned) pendNote = "记下了：" + esc(learned);

      if (/(你记得|记得什么|记得我啥|还记得我|记了什么|你记了啥)/.test(t)) return doMemory(tp);
      if (/(忘了|忘掉|清空记忆|别记了|忘了我|重新记)/.test(t)) return doForget(tp);
      if (/(看到哪|追到哪|上次看|继续看|没看完|接着看|看到第几|进度|上次那部|上次那个)/.test(t)) return doResume(tp);
      if (/(收藏|我的列表|收藏夹)/.test(t)) return doFav(tp);
      if (/(看了多少|看了几部|总共看|花了多少时间|我的记录|多少集|追了几部)/.test(t)) return doStats(tp);
      if (/(能干什么|能干啥|会什么|会啥|你是谁|你叫什么|怎么用|帮助|你会|能帮我什么|有啥用|什么用|做什么的)/.test(t)) return doHelp(tp);
      if (/(讲什么|讲的什么|剧情|介绍|讲的是)/.test(t) && q) return doDetail(q, tp);
      if (/(短的|一晚上|一口气|刷完|集数少|没时间|不要太长|不长的|短一点|短些)/.test(t) && q.length < 2) return doShort(tp);
      if (/^(看|播|打开|放)/.test(t) && q.length >= 2) return doPlay(q, tp);
      if (/(推荐|看点啥|看点什么|有什么好看|无聊|没意思|随便|来一部|来部|换一部|片荒|有剧吗|给我一部)/.test(t)) return doRecommend(tp, q);

      /* 上面一条都没接住 —— 让模型看一眼"这句话到底像哪件事"，别再把「我一共追了几天」这种当成剧名去搜。
         阈值 0.40 / 间隔 0.10 是实测扫出来的：这组档位下 12 条陌生找剧话零误判，13 条陌生强意图话说中 10 条。
         只认这 6 类；search / play / detail 判出来也不派发 —— 找剧本来就是默认出口，不需要模型来判断"是不是找剧" */
      return SEM.intent(text).then(function (it) {
        var strong = it && it.score >= 0.40 && it.margin >= 0.10;
        if (strong) {
          if (it.label === "resume") return doResume(tp);
          if (it.label === "fav") return doFav(tp);
          if (it.label === "stats") return doStats(tp);
          if (it.label === "help") return doHelp(tp);
          if (it.label === "short") return doShort(tp);
          if (it.label === "recommend") return doRecommend(tp, q);
        }
        if (q.length >= 2) return doSearch(q, tp);
        return reply("这句我没接住。我只会剧库那点事——<br>「我上次看到哪了」·「有没有修仙的」·「推荐 20 集以内的」<br>也可以直接说「看《XX》」。", tp);
      }).catch(function () {
        if (q.length >= 2) return doSearch(q, tp);
        return reply("这句我没接住。我只会剧库那点事——<br>「我上次看到哪了」·「有没有修仙的」·「推荐 20 集以内的」<br>也可以直接说「看《XX》」。", tp);
      });
    }

    function ago(ts) {
      var d = Date.now() - (ts || 0), m = Math.floor(d / 6e4), h = Math.floor(d / 36e5), dy = Math.floor(d / 864e5);
      if (dy >= 1) return dy + " 天前";
      if (h >= 1) return h + " 小时前";
      if (m >= 1) return m + " 分钟前";
      return "刚才";
    }

    function doMemory(tp) {
      lib(function () {
        var out = [];
        if (MO.facts.length) {
          out.push("<b>你自己说过的</b>");
          MO.facts.slice(-6).forEach(function (f) {
            out.push("· " + esc(f.t) + "<b class='mnote'>" + ago(f.at) + (f.n > 1 ? " · 提过 " + f.n + " 次" : "") + "</b>");
          });
        }
        if (MO.asked.length) {
          out.push("<b>最近问过的</b>");
          out.push("· " + MO.asked.slice(-5).map(function (a) { return esc(a.q); }).join("　"));
        }
        if (!out.length) return reply("我还什么都没记。你跟我说「我爱看修仙的」这种话，我就记下来。", tp);
        out.push("<span class='semnote'>" + MO.facts.length + " 条偏好 · 聊过 " + MO.talkN + " 次 · 见过 " + MO.seenN +
          " 回 · 不联网、不调模型，说「忘了吧」就清空<br>另存了一份给你核对：%APPDATA%\\HonggoDesktop\\xiaoguo-memory.md</span>");
        reply(out.join("<br>"), tp);
      });
    }

    function doForget(tp) {
      MO.facts = []; MO.asked = [];
      MO.bond = 0; MO.talkN = 0; MO.talkToday = 0; MO.playsN = 0;
      MO.seenN = 0; MO.seenFirst = 0; MO.seenLast = 0; MO.playLast = 0;
      MO.said = []; MO.saidDay = "";
      moSave(); paintBond();
      reply("忘了。刚才那些都没了。<br><span class='semnote'>下次你说什么，我重新记。</span>", tp);
    }

    function doResume(tp) {
      lib(function (l) {
        var h = hist(l);
        if (!h.length) return reply("本机还没有观看记录。随便看一集，我就记住了。", tp);
        var e = h[0], d = dOf(e), ep = Number(e.episode) || 1;
        var total = Number(d.episode_count) || 0;
        var dur = Number(e.duration) || 0, pos = Number(e.position) || 0;
        var pct = (dur > 0 && pos > 0) ? "，这一集看到 " + Math.min(99, Math.round(pos / dur * 100)) + "%" : "";
        var left = total ? "（全 " + total + " 集，前面 " + Math.max(0, ep - 1) + " 集看过了）" : "";
        var when = ago(e.last_played_at);
        reply("你上次停在 " + jp(d, ep) + "第 " + ep + " 集" + pct +
          (when ? "，是 " + when : "") + "。" + left + "<br>点剧名或下面这张卡都能接着看。", tp);
        e._why = "第 " + ep + " 集";
        card(e, "接着看");
      });
    }

    function doFav(tp) {
      lib(function (l) {
        var f = favs(l);
        if (!f.length) return reply("收藏夹是空的。详情页点一下「收藏」，我就记得了。", tp);
        reply("收藏夹里 <b>" + f.length + " 部</b>，最近这几部：", tp);
        f.slice(0, 2).forEach(function (e) { card(dOf(e), "看看"); });
      });
    }

    function ago(ts) {
      var t = Number(ts) || 0;
      if (t > 0 && t < 1e11) t *= 1000;   /* 有的记录是秒，有的是毫秒 */
      if (!t) return "";
      var s = Math.max(0, Math.round((Date.now() - t) / 1000));
      if (s < 90) return "刚刚";
      if (s < 3600) return Math.round(s / 60) + " 分钟前";
      if (s < 86400) return Math.round(s / 3600) + " 小时前";
      if (s < 86400 * 30) return Math.round(s / 86400) + " 天前";
      return Math.round(s / 86400 / 30) + " 个月前";
    }

    function doStats(tp) {
      lib(function (l) {
        var h = hist(l), f = favs(l);
        /* 别把 position 相加当"观看时长"：它只是"这一集的续播点"，
           1124 部能加出"19686 集 / 11 小时"这种一眼假的数。只报能对上的。 */
        var live = h.filter(function (e) { return (Number(e.position) || 0) > 0; });
        var line = "追剧记录 <b>" + h.length + " 部</b>" + (f.length ? "，收藏 " + f.length + " 部" : "") + "。";
        if (live.length) {
          line += "<br>有续播点、随时能接着看的是 <b>" + live.length + " 部</b>" +
            (h[0] ? "，最近一次看是 " + ago(h[0].last_played_at) : "") + "。";
        } else {
          line += "<br>这台机器上还没有续播点。";
        }
        reply(line, tp);
      });
    }

    function doShort(tp) {
      rec(24, function (items) {
        if (!items.length) return reply("推荐接口这次没回数据，等下再问我一次。", tp);
        var pool = items.filter(function (x) { var n = Number(x.episode_count) || 0; return n > 0 && n <= 24; });
        pool.sort(function (a, b) { return (Number(a.episode_count) || 999) - (Number(b.episode_count) || 999); });
        if (pool.length) {
          reply("这几部短，一晚上能刷完：", tp);
          pool.slice(0, 2).forEach(function (x) { x._why = (Number(x.episode_count) || 0) + " 集"; card(x, "看看"); });
          return;
        }
        pool = items.slice().sort(function (a, b) { return (Number(a.episode_count) || 999) - (Number(b.episode_count) || 999); });
        var n = Number(pool[0] && pool[0].episode_count) || 0;
        reply("这批里没有 20 集以内的。最短的是 <b>" + n + " 集的《" + esc(pool[0].title) + "》</b>——红果多数剧都 60 集往上。", tp);
        pool.slice(0, 2).forEach(function (x, i) {
          x._why = (Number(x.episode_count) || 0) + " 集" + (i ? "" : " · 这批里最短");
          card(x, "看看");
        });
      });
    }

    /* 泛请求：剥掉"推荐 / 来一部 / 随便"这些空话之后什么都不剩 —— 这种时候正该拿你记过的偏好去顶上 */
    var VAGUE = /推荐|来部|来一|来点|看点|看什么|什么|随便|一部|片子|短剧|电视剧|好看|点啥|吧|呀|呢|的|个|些|下|有|没/g;
    function vagueQ(q) { return String(q || "").replace(VAGUE, "").length < 2; }

    function doByPref(f, tp) {
      var topic = prefTopic(f), short = noLong();
      findSem(topic, function (sem) {
        var st = SEM.stat();
        find(topic, function (items) {
          var bySem = !!(sem && sem.length);
          var pool = bySem ? sem.slice() : items.slice();
          if (!pool.length) return reply("我记着你说过「" + esc(f.t) + "」，但这批剧里没找到对得上的。换个说法我再找，或者直接报剧名。", tp);
          if (short) pool.sort(function (a, b) {
            var da = dOf(a) || {}, db = dOf(b) || {};
            return (Number(da.episode_count) || 999) - (Number(db.episode_count) || 999);
          });
          pool.slice(0, 3).forEach(function (x) { x._why = short ? "短的" : "你爱的"; });
          reply("你跟我说过「" + esc(f.t) + "」，" + (short ? "就照记的挑短一点的" : "从这儿挑的") + "：" +
            "<span class='semnote'>按记忆找的 · " + (bySem ? "本机语义 · " : "") + "库内 " + st.n + " 部</span>", tp);
          pool.slice(0, 3).forEach(function (x) { card(x, "看看"); });
        });
      });
    }

    function doRecommend(tp, q) {
      if (q && q.length >= 2 && !vagueQ(q)) return doSearch(q, tp, "按「" + esc(q) + "」找了这几部：");
      var pf = prefTop();
      if (pf) return doByPref(pf, tp);      /* 你说过的偏好优先于泛泛推荐 */
      rec(12, function (items) {
        if (!items.length) return reply("推荐接口这次没回数据，等下再问我。", tp);
        var seen = {};
        hist(S.library || { entries: [] }).forEach(function (e) {
          var d = dOf(e); seen[String(d.series_id || e.series_id)] = 1;
        });
        var out = items.filter(function (x) { return !seen[String(x.series_id)]; }).slice(0, 2);
        if (!out.length) out = items.slice(0, 2);
        reply("这次推这几部，都不在你追剧记录里：", tp);
        out.forEach(function (x) { card(x, "看看"); });
      });
    }

    /* 字面严格命中：剧名里有 query 里连续 3 个字以上的片段（2 字太松，会把「翻身」这种词误判） */
    function litHit(title, q) {
      var t = String(title || "").toLowerCase(), s = String(q || "").toLowerCase();
      if (!t || !s) return false;
      if (s.length >= 2 && t.indexOf(s) >= 0) return true;
      for (var i = 0; i + 3 <= s.length; i++) {
        if (t.indexOf(s.substr(i, 3)) >= 0) return true;
      }
      return false;
    }
    function doSearch(q, tp, head) {
      findSem(q, function (sem) {
        var s = SEM.stat();
        find(q, function (items) {
          var lit = items.filter(function (e) { var d = dOf(e); return litHit(d && d.title, q); });
          if (lit.length) {
            reply(head || ("「" + esc(q) + "」这么几部："), tp);
            lit.slice(0, 2).forEach(function (x) { card(x, "看看"); });
            return;
          }
          if (sem.length) {
            reply((head || ("「" + esc(q) + "」字面上对不上，按意思挑的：")) +
              "<span class='semnote'>本机语义 · 单句 " + (s.encMs || 0) + " ms · 库内 " + s.n + " 部</span>", tp);
            sem.slice(0, 3).forEach(function (x) { card(x, "看看"); });
            return;
          }
          reply("剧库里没搜到「" + esc(q) + "」。" + (s.err ? "<br><span class='semnote'>语义引擎没起来：" + esc(s.err) + "</span>" : "换个说法试试——剧名里的两个字，或者「修仙」「重生」这类标签词。"), tp);
        });
      });
    }

    function doDetail(q, tp) {
      find(q, function (items) {
        if (!items.length) return reply("剧库里没有「" + esc(q) + "」这部，名字再确认一下？", tp);
        var x = items[0] || {};
        var intro = String(x.intro || "").replace(/\s+/g, " ").trim();
        var cut = intro.length > 92 ? intro.slice(0, 92) + "…" : intro;
        var meta = [];
        if (x.episode_count) meta.push(Number(x.episode_count) + " 集");
        if (x.score) meta.push("★" + x.score);
        if (tagText(x)) meta.push(tagText(x));
        reply("<b>《" + esc(x.title) + "》</b>" + (meta.length ? " · " + esc(meta.join(" · ")) : "") + "<br>" +
          (cut ? esc(cut) : ("这部没写简介" + (tagText(x) ? "，看标签是 " + esc(tagText(x)) + " 这类" : "") + "，点开看第一集最快。")), tp);
        card(x, "看第一集");
      });
    }

    function doPlay(q, tp) {
      find(q, function (items) {
        if (!items.length) return reply("没找到「" + esc(q) + "」。剧名对不上？换个关键词我再搜。", tp);
        var x = items[0];
        reply("开 <b>《" + esc(x.title) + "》</b>第 1 集。", tp);
        setTimeout(function () { close(); playEpisodeFor(x); }, 800);
      });
    }

    function doHelp(tp) {
      reply("我只认这部剧库：<br>· 你看到哪了、还剩几集<br>· 按集数或关键词找剧（装语义版还能按意思找）<br>· 收藏夹、本机统计<br>· 说「看《XX》」直接给你放<br>· 你说过的偏好我记着；说「推荐一部」这种空话时，我按记过的偏好去挑<br>· 说「你记得什么」能看，记忆另存一份可读的 md 文件<br>" +
        "<span style='color:rgba(238,242,250,.55)'>不联网、不调模型、不截屏。记忆只在这台机器上，说「忘了吧」就清空。</span>", tp);
    }

    /* --- 打开 / 收起 --- */
    function needH() {
      /* 内容少的时候别留一片空白：按实际内容估高，超过 512 才封顶 */
      if (!body || !pop) return 512;
      var fixed = pop.offsetHeight - body.getBoundingClientRect().height;   /* 头部 + 短语行 + 输入区，按真实排版量，不猜 */
      var n = 0, k = body.children, i;
      for (i = 0; i < k.length; i++) n += k[i].offsetHeight;
      n += 12;
      if (body.scrollHeight > body.clientHeight + 2) n = Math.max(n, body.scrollHeight);   /* 挤到溢出时以内容全高为准 */
      return Math.max(184, n + fixed);
    }
    function place() {
      var b = ball.getBoundingClientRect();
      var bottom = Math.max(10, window.innerHeight - b.top + 10);
      var avail = window.innerHeight - bottom - 12;   /* 不留这层限制，气泡头部会被窗口上边裁掉 */
      pop.style.bottom = bottom + "px";
      pop.style.height = Math.max(184, Math.min(512, avail, needH())) + "px";
      /* 侧栏收窄后球贴近左边，气泡若还按球左侧起会压住整条侧栏，改为从球右侧起 */
      var lft = Math.min(b.right + 8, Math.max(6, window.innerWidth - 352));
      pop.style.left = Math.max(6, lft) + "px";
    }
    function seed(o) {
      o = o || opener();
      var d = msg(o.t);
      lib(function (l) {
        var extra = [];
        /* 记忆：只提一条，而且一天最多提一次，不啰嗦 */
        if (MO.facts.length) {
          var said = MO.saidDay === dayOf() && MO.said.indexOf("mem") >= 0;
          if (!said) {
            var f = MO.facts[MO.facts.length - 1];
            extra.push("我记得你说过「" + esc(f.t) + "」。");
            if (MO.saidDay !== dayOf()) { MO.saidDay = dayOf(); MO.said = []; }
            MO.said.push("mem"); moSave();
          }
        }
        var h = hist(l);
        if (h.length) {
          var e = h[0], dr = dOf(e), ep = Number(e.episode) || 1, eps = Number(dr.episode_count) || 0;
          extra.push("你上次停在 " + jp(dr, ep) + "第 " + ep + " 集" +
            (eps && ep < eps ? "，还剩 " + (eps - ep) + " 集" : "") + "。");
        }
        if (!extra.length) return;
        var bb = d.querySelector(".bb");
        if (bb) { bb.innerHTML += "<br>" + extra.join("<br>"); down(); }
      });
    }
    function open() {
      if (!pop || opened) return;
      if (document.body.classList.contains("mini") || document.body.classList.contains("fs")) return;   /* 全屏/小窗下侧栏本来就不在，别让气泡浮在画面上 */
      opened = true;
      var o = opener();          /* 先算开场白，再 touch —— 不然 touch 会把 seenLast 刷成"刚刚"，她就说不出"三天没见"了 */
      touch("open");
      place();
      pop.classList.add("on"); ball.classList.add("on");
      if (!seeded) { seeded = true; seed(o); }
      setTimeout(function () { if (input) input.focus(); }, 320);
      SEM.boot();   /* 开着面板的时候悄悄把模型热起来，第一次问就不用等 */
    }
    function close() {
      if (!opened) return;
      opened = false;
      pop.classList.remove("on"); ball.classList.remove("on");
    }
    function send() {
      var v = (input.value || "").trim();
      if (!v) return;
      input.value = "";
      handle(v);
    }
    function boot() {
      pop = $("#aiPop"); ball = $("#aiBall"); body = $("#aiBody"); chips = $("#aiChips"); input = $("#aiInput");
      if (!pop || !ball) return;
      /* 联调：?jump=<series_id>~<集号>[~play]，验证"点剧名直接跳到那一集"这条链路。
         库里没这部剧时（新剧、还没追过）就现查一次详情，不再只是静默什么都不发生。 */
      var jv = (function () { try { return new URLSearchParams(location.search).get("jump"); } catch (e) { return null; } })();
      if (jv) setTimeout(function () {
        var a2 = String(jv).split("~");
        var sid = a2[0], epi = parseInt(a2[1], 10), auto = a2[2] === "play", pick = a2[2] === "pick";
        if (!sid) return;
        var go = function (it) {
          if (!it) return;
          touch("play");
          openDetail(it, isNaN(epi) ? 0 : Math.max(0, epi - 1));
          if (auto) setTimeout(function () { playEpisode(isNaN(epi) ? 0 : Math.max(0, epi - 1)); }, 1400);
          /* 联调 ~pick：不走 playEpisode 直调，而是真的去点分集格子，
             验证"格子 → click 委托 → 开播"这条 DOM 链（用户报的就是这里没反应） */
          if (pick) setTimeout(function () {
            var n = isNaN(epi) ? 0 : Math.max(0, epi - 1);
            var b = document.querySelector('#sEps .ep[data-i="' + n + '"]');
            if (!b) { toast("联调：没找到第 " + (n + 1) + " 集的格子"); return; }
            b.click();
          }, 2600);
        };
        lib(function (l) {
          var es = (l && l.entries) || [], hit = null, i, dr;
          for (i = 0; i < es.length; i++) {
            dr = es[i].drama || es[i];
            if (dr && String(dr.series_id) === String(sid)) { hit = dr; break; }
          }
          if (hit) { go(hit); return; }
          api("/api/v1/series/detail?series_id=" + encodeURIComponent(sid))
            .then(function (d) { go(d); }).catch(function () { });
        });
      }, 1600);
      /* 联调：把浏览器存储里的记忆清掉，逼它只靠文件兜底，验证"文件能当真备份" */
      if (/[?&]memfile=1/.test(location.search)) { try { localStorage.removeItem(MKEY); } catch (e) { } }
      MO = moLoad();
      if (/[?&]mem=old/.test(location.search)) {
        /* 联调用：装作"三天没来、已经很熟"，验收开场白和亲密度档位，真机不触发 */
        MO.seenN = 6; MO.seenLast = Date.now() - 3 * 864e5; MO.seenFirst = Date.now() - 20 * 864e5;
        MO.talkN = 8; MO.talkDay = dayOf(); MO.talkToday = 1; MO.bond = 72; MO.saidDay = ""; MO.said = [];
        MO.asked = [];
        MO.facts = [{ t: "爱看修仙的", topic: "修仙", at: Date.now() - 864e5, n: 3, no: false },
                    { t: "不喜欢太长的", topic: "太长", at: Date.now() - 7200e3, n: 1, no: true }];
        moSave();
      }
      /* 宿主发来的指令：托盘主动出声时点一下就把面板打开；记忆文件兜底恢复 */
      if (window.chrome && window.chrome.webview) {
        window.chrome.webview.addEventListener("message", function (e) {
          var d = e.data || {};
          if (d.action === "memRestore" && d.j) {
            var raw = ""; try { raw = decodeURIComponent(escape(atob(d.j))); } catch (e2) { }
            if (raw && moRestore(raw)) { paintBond(); if (opened) place(); }
          }
          if (d.action === "aiOpen") { if (!opened) open(); }
          if (d.action === "aiAsk" && d.text) setTimeout(function () { if (!opened) open(); handle(String(d.text)); }, 260);
        });
      }
      paintBond();
      chips.innerHTML = "";
      CHIPS.forEach(function (c) {
        var b = document.createElement("button");
        b.textContent = c;
        b.onclick = function () { handle(c); };
        chips.appendChild(b);
      });
      ball.onclick = function () { opened ? close() : open(); };
      $("#aiClose").onclick = close;
      $("#aiSend").onclick = send;
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); send(); }
        if (e.key === "Escape") { e.stopPropagation(); close(); }
      });
      window.addEventListener("resize", function () { if (opened) place(); });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && opened) close();
      });
    }
    return { boot: boot, open: open, close: close, ask: handle };
  })();
  window.HONGUO_AI = AI;

  /* ---------- v1.024：系统 title 全换成自绘提示（快、可换行、跟光标走） ---------- */
  (function () {
    var tip = $("#hint");
    if (!tip) return;
    var cur = null;
    function place(x, y) {
      var w = tip.offsetWidth, h = tip.offsetHeight;
      /* 小节标题行上那颗圆钮，气泡优先往上弹：下面紧接着就是内容卡，往下会压住它 */
      var above = !!(cur && cur.classList && cur.classList.contains("tb"));
      var l = x + 14, t = above ? y - h - 16 : y + 18;
      if (t < 10) t = y + 18;
      if (l + w > window.innerWidth - 10) l = x - w - 14;
      if (t + h > window.innerHeight - 10) t = y - h - 18;
      if (l < 10) l = 10;
      if (t < 10) t = 10;
      tip.style.left = Math.round(l) + "px";
      tip.style.top = Math.round(t) + "px";
    }
    function adopt(root) {
      var all = (root || document).querySelectorAll("[title]");
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        var t = el.getAttribute("title");
        if (!t) continue;
        el.setAttribute("data-hint", t);
        el.removeAttribute("title");
      }
    }
    adopt();
    /* 左条自己会弹浮标签，别让自绘提示再叠一层同样的话 */
    document.querySelectorAll(".side .nav button,.side .brand,.side .who,.side .aiball").forEach(function (e) {
      e.setAttribute("data-nohint", "1");
    });
    window.HINT = { adopt: adopt, hide: function () { cur = null; tip.style.display = "none"; } };
    document.addEventListener("mousedown", function () { window.HINT.hide(); }, true);
    document.addEventListener("wheel", function () { window.HINT.hide(); }, { passive: true, capture: true });
    document.addEventListener("mousemove", function (e) {
      var t = e.target;
      var el = (t && t.closest) ? t.closest("[data-hint]") : null;
      if (el === cur) { if (cur) place(e.clientX, e.clientY); return; }
      cur = el;
      if (!el) { tip.style.display = "none"; return; }
      /* 鼠标正压着的元素如果自己弹了浮标签（左条、集数），就别再叠一层文字 */
      if (el.hasAttribute("data-nohint") || (el.classList && (el.classList.contains("vb") ||
          el.classList.contains("sr") || el.classList.contains("ep")))) { tip.style.display = "none"; return; }
      tip.textContent = el.getAttribute("data-hint") || "";
      if (!tip.textContent) { tip.style.display = "none"; return; }
      tip.style.display = "block";
      place(e.clientX, e.clientY);
    });
  })();

  /* ---------- v1.024：首屏骨架，库还没回来就摆一排灰卡 ---------- */
  function paintSkel() {
    var g = $("#grid");
    if (!g || g.children.length) return;
    var h = "";
    for (var i = 0; i < 6; i++) h += '<div class="skel"><i></i><b></b><s></s></div>';
    g.innerHTML = h;
  }
  /* 启动 */
  window.DBG = new URLSearchParams(location.search).get("dbg") === "1";
  switchView("home");
  if (window.GRO) GRO.render();
  bindHevcBar();
  AI.boot();
  /* 自检用：?ai=1 打开小果气泡并自动问一句；?a=xxx 指定问什么（多个问题用 | 隔开，依次问） */
  if (qs.get("ai") || qs.get("a")) setTimeout(function () {
    AI.open();
    var asks = (qs.get("a") || (qs.get("noa") ? "" : "我上次看到哪了")).split("|").filter(Boolean);
    if (qs.get("a") || qs.get("ai") === "1") asks.forEach(function (t, i) {
      setTimeout(function () { AI.ask(t); }, 800 + i * 1800);
    });
  }, 2200);
  if (window.DBG) { try { if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(JSON.stringify({ action: "log", text: "hevc=" + (NOHEVC ? "missing" : "ok") })); } catch (e) { } }
  refreshAccount();
  loadLibrary();
  if (qs.get("ach")) setTimeout(function () {
    switchView("mine");
    setTimeout(function () {
      var f = $("#achFold") || $("#achGrid"); if (f && f.scrollIntoView) f.scrollIntoView({ block: "center" });
    }, 1200);
  }, 1600);
  if (qs.get("mine")) setTimeout(function () { switchView("mine"); }, 1600);
  /* 自检用：?tip=1 弹一条常驻提示（不自动消失），方便截图核灵动岛样式 */
  if (qs.get("tip")) setTimeout(function () {
    var t = $("#toast"), s = $("#toastTxt");
    if (s) s.textContent = "已收藏《轮椅绝尘》，追更通知已开启";
    t.classList.add("on"); t.classList.add("pop");
  }, 2600);
  /* 自检用：?moyu=1 启动两秒后自动进摸鱼态，方便截图核对伪装效果 */
  if (qs.get("moyu")) setTimeout(function () { setMoyu(true); }, 2200);
  /* 自检用：?view=cat|rank 直接切页，不播放 */
  var vParam = qs.get("view");
  if (vParam) setTimeout(function () { switchView(vParam === "cat" ? "category" : "rank"); }, 2000);
  /* 线路：默认用上次成功的，开机自检可用 ?src=2 指定第 2 路 */
  var srcParam = parseInt(qs.get("src"), 10);
  S.src = makeSrc(isNaN(srcParam) ? (LS.get(SRCKEY, 0) || 0) : Math.max(0, srcParam - 1));
  paintSrc();
  /* 自检用：?sheet=1 直接打开第一部的详情，并停在长剧的中段，验证"选集按 10 集分段" */
  if (qs.get("sheet")) {
    var sw = setInterval(function () {
      if (!S.items.length) return;
      clearInterval(sw);
      var big = qs.get("fixed")
        ? { series_id: "7701328280862854168", title: "固定测试剧（装穷提亲）", content_type: 1, episode_count: 80 }
        : (S.items.slice().sort(function (a, b) { return (Number(b.episode_count) || 0) - (Number(a.episode_count) || 0); })[0] || S.items[0]);
      openDetail(big, qs.get("fixed") ? 0 : 45);
    }, 1500);
  }
  if (qs.get("dbg")) setTimeout(function () {
    var lv = document.querySelector(".lvwrap"), ag = $("#achGrid");
    window.chrome.webview.postMessage(JSON.stringify({ action: "log", text: "diag view=" + S.view +
      " gro=" + (typeof window.GRO) + " gridKids=" + ($("#grid") ? $("#grid").children.length : -1) +
      " lvwrap=" + !!lv + " achGrid=" + !!ag + " achFold=" + !!$("#achFold") +
      " mainTop=" + ($("#main") ? $("#main").scrollTop : -1) }));
  }, 4000);
  if (qs.get("dbg")) setTimeout(function () {
    var m = $("#main"), c = $(".content");
    window.chrome.webview.postMessage(JSON.stringify({ action: "log", text: "vw=" + window.innerWidth + "x" + window.innerHeight +
      " dpr=" + (window.devicePixelRatio || 1) + " main=" + m.clientWidth + " content=" + (c ? c.clientWidth : 0) +
      " bodyScroll=" + document.body.scrollWidth + " grid=" + $("#grid").scrollWidth }));
    if (qs.get("vol")) $("#volPop").classList.add("on");
  }, 3500);

  /* 自检用：?demo=1 自动打开第一部剧并播放第 1 集；?fixed=1 锁定同一部剧，便于验证续播跨启动是否生效 */
  var demo = new URLSearchParams(location.search).get("demo");
  var DEMO = !!demo;
  if (demo) {
    document.body.classList.add("vtopshow");   /* 自检截图用：全屏下把左侧竖栏强制露出 */
    var wait = setInterval(function () {
      if (!S.items.length) return;
      clearInterval(wait);
      var target = qs.get("fixed")
        ? { series_id: "7701328280862854168", title: "固定测试剧（装穷提亲）", content_type: 1, episode_count: 80 }
        : S.items[0];
      openDetail(target, 0);
      var tries = 0;
      var kick = setInterval(function () {
        var epBtn = $("#sEps") ? $("#sEps").querySelector("button[data-i]") : null;
        tries++;
        if (epBtn) {
          clearInterval(kick);
          epBtn.click();
          /* 自检是靠脚本点的，不算用户手势，WebView2 会拒 autoplay；静音就一定能播起来（只影响自检） */
          video.muted = true;
          video.addEventListener("loadedmetadata", function () {
            var p = video.play();
            if (p && p.catch) p.catch(function (err) {
              if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(JSON.stringify({ action: "log", text: "autoplay blocked: " + err.message }));
            });
          }, { once: true });
          if (new URLSearchParams(location.search).get("mini")) setTimeout(function () { setMini(true); }, 4600);
          if (new URLSearchParams(location.search).get("fs")) setTimeout(function () { setFs(true); }, 3000);
          /* 自检用：?seq=1 依次 小窗 → 全屏 → 退出全屏 → 退出小窗，验证形态互切 */
          if (new URLSearchParams(location.search).get("seq")) {
            setTimeout(function () { setMini(true); }, 3000);
            setTimeout(function () { setFs(true); }, 7000);
            setTimeout(function () { setFs(false); }, 11000);
            setTimeout(function () { setMini(false); }, 15000);
          }
          /* 自检用：?view=cat|rank 自动切到找剧页 / 榜单页（不必先播放） */
        } else if (tries > 40) clearInterval(kick);
      }, 300);
    }, 200);
  }
})();
