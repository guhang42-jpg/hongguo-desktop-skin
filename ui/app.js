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
    resumeAt: 0, epTotal: 0, epSeg: 0, rate: 1, vol: 1
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

  function api(path, opts) {
    opts = opts || {};
    if (opts.json) {
      opts.method = opts.method || "POST";
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(opts.json);
      delete opts.json;
    }
    opts.cache = "no-store";
    return fetch(BASE + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var payload = null;
        try { payload = JSON.parse(t); } catch (e) { payload = null; }
        if (!r.ok || (payload && payload.ok === false)) {
          throw new Error((payload && payload.error) ? String(payload.error) : ("HTTP " + r.status));
        }
        return payload ? payload.data : null;
      });
    });
  }

  var fmt = function (s) {
    s = Math.max(0, Math.floor(s || 0));
    var m = Math.floor(s / 60), x = s % 60;
    return (m < 10 ? "0" : "") + m + ":" + (x < 10 ? "0" : "") + x;
  };
  var toastT;
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.classList.add("on");
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("on"); }, 1600);
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
    return el;
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
      $("#grid").innerHTML = '<div class="empty">' + (S.items.length ? "这个筛选条件下暂时没有剧<br>换一个题材或集数试试" : "这里暂时没有内容<br>换个关键词或分类试试") + "</div>";
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
      b.textContent = S.collapsed[k] ? "展开 ▾" : "收起 ▴";
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
  function closeDetail() { mask.classList.remove("on"); sheet.classList.remove("on"); }

  /* 选集按每 10 集一段折叠：96 集的剧不再铺 96 个按钮 */
  var EP_SEG = 10;
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
          c.onclick = (function (k) { return function () { renderEpisodeGrid(total, k); }; })(s);
          bar.appendChild(c);
        }
      } else {
        bar.classList.add("hide");
      }
    }
    var eps = $("#sEps");
    eps.innerHTML = "";
    var from = cur * EP_SEG, to = Math.min(total, from + EP_SEG);
    for (var i = from; i < to; i++) {
      var b = document.createElement("button");
      b.className = "ep" + (i === S.epIndex ? " on" : "");
      b.textContent = String(i + 1);
      b.title = "第 " + (i + 1) + " 集" + (resumeOf(S.active && S.active.series_id, i) > 4 ? "（上次看到 " + fmt(resumeOf(S.active.series_id, i)) + "）" : "");
      b.dataset.i = i;
      var rv = resumeOf(S.active && S.active.series_id, i);
      if (rv > 4) b.classList.add("seen");
      b.onclick = (function (n) { return function () { playEpisode(n); }; })(i);
      eps.appendChild(b);
    }
    if (!total) eps.innerHTML = '<div class="foot" style="padding:16px 0">暂时取不到分集</div>';
  }

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
    S.active = item; S.epIndex = idx || 0;
    if (typeof AMB !== "undefined" && AMB) AMB.theme(item);
    $("#sCover").src = coverOf(item);
    $("#sTitle").textContent = item.title || "";
    $("#sSub").textContent = [
      item.episode_count ? "全 " + item.episode_count + " 集" : "",
      item.score ? "★ " + item.score : "",
      (item.tags || []).slice(0, 4).join(" / ")
    ].filter(Boolean).join(" · ");
    $("#sDesc").textContent = item.intro || "";
    $("#sEps").innerHTML = '<div class="foot" style="padding:16px 0"><span class="spin"></span><span>正在取分集…</span></div>';
    $("#sEpCount").textContent = "";
    $("#sFav").textContent = isFavorite(item) ? "♥ 已收藏" : "♡ 收藏";
    $("#sFollow").textContent = item.following_update || item.followed ? "🔔 已追更" : "🔔 追更";
    var rv0 = resumeOf(item.series_id, S.epIndex);
    $("#sPlay").textContent = rv0 > 4 ? "▶ 继续看 " + fmt(rv0) : "▶ 从头播放";
    mask.classList.add("on"); sheet.classList.add("on");
    loadSeasons(item);

    api("/api/v1/series/detail?series_id=" + encodeURIComponent(item.series_id) +
      (item.content_type ? "&content_type=" + encodeURIComponent(item.content_type) : ""))
      .then(function (d) {
        if (!d) throw new Error("详情为空");
        S.detail = d;
        S.vids = d.vid_list || [];
        $("#sTitle").textContent = d.title || item.title || "";
        $("#sDesc").textContent = d.intro || item.intro || "";
        $("#sEpCount").textContent = "共 " + (d.episode_count || S.vids.length) + " 集";
        var total = S.vids.length || (d.episode_count || 0);
        renderEpisodeGrid(total, Math.floor(S.epIndex / EP_SEG));
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

  function playEpisode(i) {
    clearNextCue();
    if (!S.vids.length) { if (S.active) openDetail(S.active, 0); return; }
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

  var AUTO_FS = true;   /* 打开播放默认进真全屏；想回剧场面板方式，把它改成 false */
  var FFTEST = /[?&]ff=1/.test(location.search);   /* 联调用：每集自动跳到末尾 1.2 秒，快速验证自动接集 */
  function openViewer() {
    var d = S.detail || S.active;
    viewer.classList.add("on");
    if (!S.mini) {
      document.body.classList.add("theater");
      if (window.GRO) GRO.mode("theater");
    }
    closeDetail();
    if (typeof AMB !== "undefined" && AMB) AMB.play(true);
    $("#vTitle").innerHTML = (d.title || "") + " <span>" + epLabel(S.epIndex) + "</span>";
    var cov = coverOf(d);
    $("#vPoster").style.backgroundImage = cov ? 'url("' + cov + '")' : "none";
    $("#vbg").style.backgroundImage = cov ? 'url("' + cov + '")' : "none";
    $("#pCover").src = cov;
    $("#pTitle").textContent = d.title || "";
    loadStream();
    wake();
    /* 默认直接进真·全屏自动播放（退出全屏就是剧场面板） */
    if (AUTO_FS && !S.mini && !S.fs) {
      setTimeout(function () {
        if (viewer.classList.contains("on") && !S.mini && !S.fs) setFs(true);
      }, 220);
    }
  }

  var lastStreamVid = null;
  function loadStream(qual, seamless) {
    var d = S.active;
    var vid = S.vids[S.epIndex];
    if (!vid) return;
    if (seamless) {
      /* 无缝接集：不弹海报/不弹 loading，直接用同一个视频面切源 */
      $("#vLoad").classList.add("hide");
      $("#vPoster").classList.add("hide");
    } else {
      $("#vLoad").classList.remove("hide");
      $("#vPoster").classList.remove("hide");
    }
    var params = "series_id=" + encodeURIComponent(d.series_id) +
      "&vid=" + encodeURIComponent(vid) +
      "&episode=" + (S.epIndex + 1) +
      (d.content_type ? "&content_type=" + encodeURIComponent(d.content_type) : "") +
      (qual ? "&quality=" + encodeURIComponent(qual) : "") +
      "&mode=full";
    api("/api/v1/play/info?" + params).then(function (data) {
      S.playInfo = data;
      S.quality = data.quality || "";
      renderQuality(data);
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
        if (!seamless) $("#vLoad").classList.remove("hide");
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
      $("#pSub").textContent = epLabel(S.epIndex) + (data.quality ? " · " + data.quality : "");
      loadDanmaku(vid);
      saveProgress();
      if (qs.get("dbg") && window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify({ action: "log", text: "ep" + (S.epIndex + 1) + " vid=" + vid + " t0=" + (video.currentTime || 0).toFixed(2) + " seamless=" + !!seamless }));
      }
    }).catch(function (e) {
      $("#vLoad").classList.add("hide");
      toast("取流失败：" + e.message);
    });
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
  video.addEventListener("loadeddata", function () { $("#vLoad").classList.add("hide"); $("#vPoster").classList.add("hide"); });
  video.addEventListener("playing", function () { $("#vLoad").classList.add("hide"); $("#vPause").classList.add("hide"); });
  video.addEventListener("waiting", function () { $("#vLoad").classList.remove("hide"); });
  video.addEventListener("error", function () {
    $("#vLoad").classList.add("hide");
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
    $("#vTitle").innerHTML = (d.title || "") + " <span>" + epLabel(S.epIndex) + "</span>";
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
      if (!S.fitManual && S.fit !== "cover") {   /* 真全屏默认铺满，才谈得上沉浸 */
        S.prevFitFs = S.fit; S.fit = "cover"; applyFit();
      }
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
  $("#vRetry").onclick = function () { loadStream(S.quality); };
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
      $("#sFav").textContent = faved ? "♡ 收藏" : "♥ 已收藏";
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
      $("#sFollow").textContent = on ? "🔔 已追更" : "🔔 追更";
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

  /* ---------- 我的 / 收藏 / 历史 ---------- */
  function renderMine() {
    var lib = S.library || { entries: [] };
    var entries = (lib.entries || []).slice();
    entries.sort(function (a, b) { return (b.last_played_at || b.favorite_at || 0) - (a.last_played_at || a.favorite_at || 0); });
    var favs = entries.filter(function (e) { return e.favorite_at; });
    var hist = entries.filter(function (e) { return e.last_played_at; });

    var wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gridTemplateColumns = "repeat(auto-fill,minmax(240px,1fr))";
    wrap.style.gap = "30px 26px";

    function addRow(title, list, emptyText) {
      var sec = document.createElement("div");
      sec.style.gridColumn = "1 / -1";
      sec.className = "sec";
      sec.style.margin = "10px 0 0";
      sec.innerHTML = '<h2 style="font-size:22px">' + title + '</h2><span class="cnt">' + list.length + ' 部</span><div class="rule"></div>';
      wrap.appendChild(sec);
      if (!list.length) {
        var empty = document.createElement("div");
        empty.className = "empty"; empty.style.gridColumn = "1 / -1";
        empty.textContent = emptyText;
        wrap.appendChild(empty);
        return;
      }
      list.slice(0, 24).forEach(function (e, i) {
        var drama = e.drama || e;
        var card = cardEl({
          series_id: drama.series_id || e.series_id, title: drama.title || e.title,
          cover: drama.cover || e.cover, cover_fallback: drama.cover_fallback || e.cover_fallback,
          episode_count: drama.episode_count || e.episode_count, tags: drama.tags || e.tags,
          score: drama.score || e.score, intro: drama.intro || e.intro, content_type: drama.content_type || e.content_type
        }, i);
        if (e.last_played_at && e.episode) {
          var tag = document.createElement("p");
          tag.textContent = "看到 " + e.episode + " 集";
          card.appendChild(tag);
        }
        wrap.appendChild(card);
      });
    }

    $("#grid").innerHTML = "";
    if (window.GRO) {
      $("#grid").appendChild(GRO.card());
      GRO.render();
    }
    addRow("我的追剧记录", hist, "还没有观看记录，看一集就会出现在这里");
    addRow("我的收藏", favs, "还没收藏任何剧，详情页点「收藏」即可");
    $("#grid").appendChild(wrap);
    $("#secTitle").textContent = S.account && S.account.logged_in ? "已登录" : "本机记录";
    $("#secCount").textContent = "";
    foot("");
    $("#main").scrollTop = 0;
    setTimeout(function () { var m = $("#main"); if (m) m.scrollTop = 0; }, 600);
    if (!S.library) {
      api("/api/v1/library").then(function (d) { S.library = d || { entries: [] }; renderMine(); }).catch(function () { });
    }
  }

  /* ---------- 账号 ---------- */
  var acct = $("#acct"), qrTimer = null, qrId = "", acctMode = "qr";

  function refreshAccount() {
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
        $("#acctUid").textContent = "账号：" + (d.profile.nickname || d.profile.name || d.profile.uid) +
          (d.sync ? " · 同步状态：" + d.sync.state + (d.sync.pending ? "（待同步 " + d.sync.pending + "）" : "") : "");
      }
      var who = $("#sideWho");
      who.classList.toggle("off", !logged);
      var nick = logged && d.profile ? (d.profile.nickname || d.profile.name || ("用户" + d.profile.uid)) : "未登录";
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
      if (!viewer.classList.contains("on")) miniResume();
      wake();
      if (window.GRO) GRO.mode("mini");
      setTimeout(function () { if (window.chrome && window.chrome.webview) sendAlpha(alpha || 94); }, 500);
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
    $("#fitBtn").textContent = S.fit === "contain" ? "原比例" : (S.fit === "fill" ? "拉伸" : "铺满");
    if (S.mini) sendMiniSize();
  }
  function sendMiniSize() {
    if (!S.mini || !video.videoWidth || !window.chrome || !window.chrome.webview) return;
    var h = S.fit === "contain" ? Math.round(430 * (video.videoHeight / video.videoWidth)) : 780;
    window.chrome.webview.postMessage(JSON.stringify({ action: "miniSize", h: h }));
  }
  $("#fitBtn").onclick = function () { cycleFit(); };
  function cycleFit() {
    S.fitManual = true;              /* 用户自己挑过画面模式，之后全屏不再强塞铺满 */
    S.fit = S.fit === "cover" ? "fill" : (S.fit === "fill" ? "contain" : "cover");
    applyFit();
    var btn = $("#fitBtn");
    if (btn) {
      btn.textContent = S.fit === "contain" ? "▭" : (S.fit === "fill" ? "⤢" : "▣");
      btn.title = "画面铺满方式：" + (S.fit === "contain" ? "原比例" : (S.fit === "fill" ? "拉伸铺满" : "铺满裁剪"));
    }
    if (window.GRO && S.fit !== "contain") GRO.flag("fit");
    if (window.GRO) GRO.flag(S.fit === "cover" ? "fitC" : (S.fit === "fill" ? "fitF" : "fitS"));
    toast("画面：" + (S.fit === "contain" ? "原比例（完整显示）" : (S.fit === "fill" ? "拉伸铺满" : "铺满裁剪")));
  }
  initFit();
  function initFit() {
    applyFit();
    var btn = $("#fitBtn");
    if (btn) btn.textContent = S.fit === "contain" ? "▭" : (S.fit === "fill" ? "⤢" : "▣");
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
        var got = 0;
        $("#achGrid").innerHTML = ACH.map(function (a) {
          var on = !!D.ach[a.id]; if (on) got++;
          return '<div class="ach' + (on ? " on" : "") + '" title="' + a.d + '"><i>' + a.ic + "</i><b>" + a.n + "</b><small>" + a.d + "</small></div>";
        }).join("");
        $("#achCnt").textContent = got + " / " + ACH.length;
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
        '<div class="sec" style="margin:26px 0 14px"><h2 style="font-size:20px">成就墙</h2>' +
        '<span class="cnt" id="achCnt">0 / ' + ACH.length + '</span><div class="rule"></div></div>' +
        '<div class="achgrid" id="achGrid"></div>';
      return el;
    }

    return {
      episode: episode, fav: fav, follow: follow, dm: dm, flag: flag, mode: mode, tick: tick, seed: seed,
      finish: finish, card: card, render: render, data: D, check: checkAch
    };
  })();
  window.GRO = GRO;

  /* 启动 */
  window.DBG = new URLSearchParams(location.search).get("dbg") === "1";
  switchView("home");
  if (window.GRO) GRO.render();
  bindHevcBar();
  if (window.DBG) { try { if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(JSON.stringify({ action: "log", text: "hevc=" + (NOHEVC ? "missing" : "ok") })); } catch (e) { } }
  refreshAccount();
  loadLibrary();
  if (qs.get("mine")) setTimeout(function () { switchView("mine"); }, 1600);
  /* 自检用：?view=cat|rank 直接切页，不播放 */
  var vParam = qs.get("view");
  if (vParam) setTimeout(function () { switchView(vParam === "cat" ? "category" : "rank"); }, 2000);
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
          if (new URLSearchParams(location.search).get("mini")) setTimeout(function () { setMini(true); }, 2600);
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
