/* 世界經濟 3D 地圖 — 介面與狀態 */
(function () {
  'use strict';
  var WE = window.WE, GS = window.GlobeScene;
  var $ = function (id) { return document.getElementById(id); };
  var PREF_KEY = 'worldEconPrefs';
  var mqReduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DEFAULTS = {
    indicator: 'gdp', year: 2024, view: 'globe', autoRotate: true, rotateSpeed: 0.6, arcs: true,
    labels: 16, heightScale: 1, scale: 'sqrt', currency: 'USD', theme: 'auto', reduce: !!mqReduce
  };
  var prefs = loadPrefs();
  var state = { ind: prefs.indicator, year: prefs.year, region: 'all', sel: null, tab: 'rank', showAll: false, tour: -1, playing: null };
  var mapNoData = false;

  function loadPrefs() {
    var p = {};
    try { p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) {}
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = p[k] == null ? DEFAULTS[k] : p[k]; });
    if (!WE.INDICATORS[out.indicator]) out.indicator = DEFAULTS.indicator;
    if (WE.YEARS.indexOf(+out.year) < 0) out.year = DEFAULTS.year;
    out.year = +out.year; out.labels = +out.labels;
    return out;
  }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {} }

  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.style.display = 'block';
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.style.display = 'none'; }, 2200);
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(ind, v, year) { return WE.format(ind, v, year || state.year, prefs.currency); }
  function isDark() {
    if (prefs.theme === 'dark') return true;
    if (prefs.theme === 'light') return false;
    return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function applyTheme() {
    if (prefs.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', prefs.theme);
    GS.setOpts({ dark: isDark() });
  }
  function regionOk(c) { return state.region === 'all' || c.region === state.region; }

  /* ---------- 地圖上色、長條、弧線、標籤 ---------- */
  var maxCache = {};
  function maxAbs(ind) {
    if (maxCache[ind]) return maxCache[ind];
    var m = 0;
    WE.COUNTRIES.forEach(function (c) { WE.YEARS.forEach(function (y) { m = Math.max(m, Math.abs(c.v[y][ind])); }); });
    return (maxCache[ind] = m || 1);
  }
  function paintMap() {
    if (!GS.ready) return;
    var dark = isDark();
    var sel = state.sel && WE.BY_ISO[state.sel];
    GS.paint(function (f) {
      var c = WE.BY_NUM[f.num];
      if (!c) return { fill: dark ? '#2b3756' : '#dfe5ee' };
      return { fill: WE.colorFor(state.ind, WE.value(c, state.ind, state.year)), alpha: regionOk(c) ? 1 : 0.28 };
    }, {
      ocean: dark ? '#10294f' : '#a8d4ef', grid: dark ? 'rgba(140,180,255,.16)' : 'rgba(255,255,255,.45)',
      border: dark ? 'rgba(5,11,26,.9)' : 'rgba(255,255,255,.95)', selected: sel ? sel.num : null, selColor: '#f2a900'
    });
  }
  function updateBars() {
    var mx = maxAbs(state.ind);
    GS.setBars(WE.COUNTRIES.map(function (c) {
      var v = WE.value(c, state.ind, state.year), r = Math.abs(v) / mx;
      return { iso: c.iso, lon: c.lon, lat: c.lat, h: prefs.scale === 'linear' ? r : Math.sqrt(r), color: WE.colorFor(state.ind, v), dim: !regionOk(c) };
    }));
  }
  function updateArcs() {
    var list = [];
    if (state.sel) {
      var c = WE.BY_ISO[state.sel], seen = {};
      c.partners.forEach(function (p) { var o = WE.BY_ISO[p]; if (o) { seen[p] = 1; list.push({ a: c, b: o, strong: true, color: 0xffb703 }); } });
      WE.COUNTRIES.forEach(function (o) {
        if (!seen[o.iso] && o.partners.indexOf(c.iso) >= 0 && list.length < 10) list.push({ a: o, b: c, color: 0x7fd3ff });
      });
    } else if (prefs.arcs) {
      WE.CORRIDORS.forEach(function (p) { list.push({ a: WE.BY_ISO[p[0]], b: WE.BY_ISO[p[1]], color: 0xffd166 }); });
    }
    GS.setArcs(list);
  }
  function updateLabels() {
    var n = prefs.labels, list = [];
    if (n > 0) {
      var rk = WE.ranking(state.ind, state.year, state.region).slice(0, n);
      rk.forEach(function (r, i) { list.push({ iso: r.c.iso, text: r.c.name, sub: fmt(state.ind, r.v), pri: 100 - i }); });
    }
    [state.sel, 'TWN'].forEach(function (iso) {
      if (!iso || list.some(function (l) { return l.iso === iso; })) return;
      var c = WE.BY_ISO[iso];
      if (iso === 'TWN' && (n === 0 || !regionOk(c))) return;
      list.push({ iso: iso, text: c.name, sub: fmt(state.ind, WE.value(c, state.ind, state.year)), pri: iso === 'TWN' ? 99 : 200 });
    });
    GS.setLabels(list);
  }
  function refreshScene() { paintMap(); updateBars(); updateArcs(); updateLabels(); GS.setSelected(state.sel); }

  /* ---------- 控制列 ---------- */
  function buildControls() {
    $('inds').innerHTML = WE.IND_ORDER.map(function (k) {
      return '<button class="ind" type="button" data-ind="' + k + '" title="' + esc(WE.INDICATORS[k].desc) + '">' + esc(WE.INDICATORS[k].name) + '</button>';
    }).join('');
    $('inds').addEventListener('click', function (e) { var b = e.target.closest('[data-ind]'); if (b) setIndicator(b.dataset.ind); });
    $('yearBtns').innerHTML = WE.YEARS.map(function (y) { return '<button type="button" data-year="' + y + '">' + y + '</button>'; }).join('');
    $('yearBtns').addEventListener('click', function (e) { var b = e.target.closest('[data-year]'); if (b) { stopPlay(); setYear(+b.dataset.year); } });
    $('yearRange').addEventListener('input', function () { stopPlay(); setYear(WE.YEARS[+this.value]); });
    $('playBtn').addEventListener('click', function () { state.playing ? stopPlay() : startPlay(); });
    var rs = $('regionSel');
    rs.innerHTML = '<option value="all">🌐 全部區域</option>' + Object.keys(WE.REGIONS).map(function (k) { return '<option value="' + k + '">' + esc(WE.REGIONS[k].name) + '</option>'; }).join('');
    rs.addEventListener('change', function () { state.region = this.value; state.showAll = false; refreshScene(); renderPanel(); });
    document.querySelectorAll('[data-view]').forEach(function (b) { b.addEventListener('click', function () { setView(b.dataset.view); }); });
    $('resetCam').addEventListener('click', function () { GS.resetCamera(); });
  }
  function syncControls() {
    document.querySelectorAll('.ind').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.ind === state.ind); });
    document.querySelectorAll('#yearBtns button').forEach(function (b) { b.setAttribute('aria-pressed', +b.dataset.year === state.year); });
    $('yearRange').value = WE.YEARS.indexOf(state.year);
    var v = GS.ready ? GS.getView() : prefs.view;
    document.querySelectorAll('[data-view]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.view === v); });
    $('playBtn').textContent = state.playing ? '❚❚' : '▶';
    $('regionSel').value = state.region;
  }
  function setIndicator(ind) {
    if (!WE.INDICATORS[ind]) return;
    state.ind = ind; refreshScene(); renderLegend(); renderPanel(); syncControls();
    var act = document.querySelector('.ind[data-ind="' + ind + '"]');
    if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function setYear(y) {
    if (WE.YEARS.indexOf(y) < 0) return;
    state.year = y; refreshScene(); renderLegend(); renderPanel(); syncControls();
  }
  function setView(v) {
    var c = state.sel && WE.BY_ISO[state.sel];
    GS.setView(v, c ? { lon: c.lon, lat: c.lat } : null);
    syncControls();
  }
  function startPlay() {
    state.playing = setInterval(function () {
      var i = (WE.YEARS.indexOf(state.year) + 1) % WE.YEARS.length; setYear(WE.YEARS[i]);
    }, 2200);
    var i0 = (WE.YEARS.indexOf(state.year) + 1) % WE.YEARS.length; setYear(WE.YEARS[i0]);
  }
  function stopPlay() { if (state.playing) { clearInterval(state.playing); state.playing = null; syncControls(); } }

  /* ---------- 圖例 ---------- */
  var legendMin = innerWidth <= 760;
  function renderLegend() {
    var d = WE.INDICATORS[state.ind], b = d.bins, labs = [];
    function bl(v) {
      if (d.unit === '%') return v + '%';
      if (state.ind === 'pop') return v >= 100 ? (v / 100) + ' 億' : (v * 100) + ' 萬';
      if (state.ind === 'gdppc') return prefs.currency === 'TWD' ? Math.round(v * WE.TWD[state.year] / 10000) + ' 萬元' : (v / 1000) + 'k 美元';
      if (prefs.currency === 'TWD') { var yi = v * WE.TWD[state.year] * 10; return yi >= 10000 ? (Math.round(yi / 1000) / 10) + ' 兆' : Math.round(yi / 100) * 100 + ' 億'; }
      return v >= 1000 ? (v / 1000) + ' 兆' : (v * 10) + ' 億';
    }
    labs.push('&lt; ' + bl(b[0]));
    for (var i = 0; i < b.length - 1; i++) labs.push(bl(b[i]) + '–' + bl(b[i + 1]));
    labs.push('≥ ' + bl(b[b.length - 1]));
    var w = WE.WORLD[state.year][state.ind];
    $('legend').className = 'card' + (legendMin ? ' min' : '');
    $('legend').innerHTML = '<h3>' + esc(d.name) + '・' + state.year + ' <button class="lgtog" id="lgTog" type="button">' + (legendMin ? '展開 ▴' : '收合 ▾') + '</button></h3>' +
      '<p>' + esc(d.desc) + (w != null ? '　全球' + (d.kind === 'total' || d.kind === 'people' ? '合計' : '平均') + '約 <b>' + esc(fmt(state.ind, w)) + '</b>' : '') + '</p>' +
      (d.money ? '<p style="margin-bottom:4px">單位：' + (prefs.currency === 'TWD' ? '新台幣' : '美元') + '</p>' : '') + '<div class="lg">' + d.pal.map(function (c, i) { return '<span><i style="background:' + c + '"></i>' + labs[i] + '</span>'; }).join('') +
      (mapNoData ? '' : '<span><i style="background:' + (isDark() ? '#2b3756' : '#dfe5ee') + '"></i>未收錄</span>') + '</div>';
    $('lgTog').onclick = function () { legendMin = !legendMin; renderLegend(); };
  }

  /* ---------- 右側面板 ---------- */
  function setTab(t) {
    state.tab = t;
    $('tabRank').setAttribute('aria-selected', t === 'rank');
    $('tabCountry').setAttribute('aria-selected', t === 'country');
    renderPanel();
  }
  function renderPanel() { if (state.tab === 'country') renderCard(); else renderRanking(); }
  function rowHtml(r, i, mx) {
    var c = r.c, wpct = Math.max(2, Math.abs(r.v) / mx * 100);
    return '<li class="rrow' + (c.iso === 'TWN' ? ' tw' : '') + (c.iso === state.sel ? ' sel' : '') + '" tabindex="0" data-iso="' + c.iso + '">' +
      '<span class="no">' + (i + 1) + '</span><span class="nm">' + esc(c.name) + '</span><span class="vl">' + esc(fmt(state.ind, r.v)) + '</span>' +
      '<span class="mb"><i style="width:' + wpct.toFixed(1) + '%;background:' + WE.colorFor(state.ind, r.v) + '"></i></span></li>';
  }
  function renderRanking() {
    var d = WE.INDICATORS[state.ind], rk = WE.ranking(state.ind, state.year, state.region);
    var mx = rk.reduce(function (m, r) { return Math.max(m, Math.abs(r.v)); }, 0) || 1;
    var lim = state.showAll ? rk.length : 15, html = '';
    html += '<p class="rhead"><b>' + esc(d.name) + '</b>・' + state.year + '・' + (state.region === 'all' ? '全部 ' : esc(WE.REGIONS[state.region].name) + ' ') + rk.length + ' 個經濟體<br>由高到低：' + esc(d.higher) + '</p>';
    html += '<ol class="rlist">' + rk.slice(0, lim).map(function (r, i) { return rowHtml(r, i, mx); }).join('');
    var twIdx = -1;
    rk.forEach(function (r, i) { if (r.c.iso === 'TWN') twIdx = i; });
    if (twIdx >= lim) html += '<li class="rsep">⋯</li>' + rowHtml(rk[twIdx], twIdx, mx);
    html += '</ol>';
    if (rk.length > 15) html += '<button class="linkbtn" id="moreBtn" type="button">' + (state.showAll ? '只看前 15 名 ▴' : '顯示全部 ' + rk.length + ' 個 ▾') + '</button>';
    html += '<p class="note">點任一列、地圖上的國家或立體柱，可看該國詳細資料與貿易夥伴。數值為依 IMF、世界銀行公開資料整理的近似參考值。</p>';
    $('pbody').innerHTML = html;
    if ($('moreBtn')) $('moreBtn').onclick = function () { state.showAll = !state.showAll; renderRanking(); };
  }
  function explain(c, ind, y) {
    var v = WE.value(c, ind, y), w = WE.WORLD[y], tw = WE.BY_ISO.TWN, rank = WE.rankOf(c.iso, ind, y), N = WE.COUNTRIES.length;
    var nm = c.name, s;
    function x(a, b) { var r = a / b; return r >= 10 ? Math.round(r) + '' : r >= 1 ? r.toFixed(1) : r.toFixed(2); }
    switch (ind) {
      case 'gdp':
        s = nm + ' ' + y + ' 年經濟規模約 ' + fmt(ind, v, y) + '，約占全球 ' + (v / w.gdp * 100).toFixed(1) + '%，在 ' + N + ' 個經濟體中排第 ' + rank + '。';
        if (c.iso !== 'TWN') s += '大約是台灣的 ' + x(v, tw.v[y].gdp) + ' 倍。';
        return s;
      case 'gdppc':
        return '平均每人一年約創造 ' + fmt(ind, v, y) + '，是全球平均（約 ' + fmt(ind, w.gdppc, y) + '）的 ' + x(v, w.gdppc) + ' 倍' + (c.iso !== 'TWN' ? '，台灣的 ' + x(v, tw.v[y].gdppc) + ' 倍' : '') + '。人均高通常代表薪資與生活水準較高，但仍要考慮物價與貧富差距。';
      case 'growth':
        if (v < 0) return nm + ' ' + y + ' 年經濟衰退 ' + Math.abs(v).toFixed(1) + '%：這一年生產的東西比前一年少，常伴隨企業減薪、裁員。全球同年約 ' + fmt(ind, w.growth, y) + '。';
        return nm + ' ' + y + ' 年經濟' + (v >= 5 ? '高速' : v >= 2 ? '穩定' : '小幅') + '成長 ' + v.toFixed(1) + '%' + (v >= w.growth ? '，高於' : '，低於') + '全球的 ' + fmt(ind, w.growth, y) + '。一般來說，越成熟的經濟體成長率越低。';
      case 'pop':
        return nm + '人口約 ' + fmt(ind, v, y) + '，約占全球 ' + (v / w.pop * 100).toFixed(1) + '%。人口多代表市場大、勞動力多，但平均每人能創造多少價值同樣重要（可切換「人均 GDP」比較）。';
      case 'infl':
        if (v < 0) return nm + ' ' + y + ' 年物價下跌 ' + Math.abs(v).toFixed(1) + '%（通貨緊縮）：東西變便宜聽起來不錯，但常代表需求疲弱、大家延後消費。';
        return '物價一年上漲 ' + v.toFixed(1) + '%：年初的 100 元，到年底只買得到約 ' + Math.round(10000 / (100 + v)) + ' 元的東西。' + (v > 10 ? '這屬於高通膨，存款與薪水的購買力縮水得很快。' : v <= 3 ? '屬於溫和範圍，多數央行以 2% 左右為目標。' : '略高於多數央行約 2% 的目標。');
      case 'exports':
        return nm + '一年賣到國外約 ' + fmt(ind, v, y) + '，約占全球出口 ' + (v / w.exports * 100).toFixed(1) + '%，排第 ' + rank + '。';
      case 'expShare':
        return '出口約等於 GDP 的 ' + v.toFixed(0) + '%：' + (v > 100 ? '大量轉口貿易（進口再出口），是典型的貿易樞紐。' : v > 55 ? '經濟非常依賴國際貿易，全球景氣與供應鏈變化影響很大。' : v > 25 ? '貿易占經濟相當比重，內需與外需並重。' : '經濟主要靠國內消費與投資撐起來。');
      case 'unemp':
        return '每 100 個想工作的人，約有 ' + v.toFixed(1) + ' 人找不到工作' + (v > 10 ? '，屬於偏高水準，年輕人失業通常更嚴重。' : v < 4 ? '，接近「充分就業」，企業常反映缺工。' : '。') ;
    }
    return '';
  }
  function renderCard() {
    var c = state.sel && WE.BY_ISO[state.sel];
    if (!c) {
      $('pbody').innerHTML = '<div class="hint">👆 點地圖上的國家、立體柱或排行榜任一列，這裡會顯示：<br>・目前指標的數值、全球排名與三個年度變化<br>・一句白話說明「這代表什麼」<br>・八項指標總覽與台灣比較<br>・主要貿易夥伴（地圖上會畫出金色弧線）</div>';
      return;
    }
    var d = WE.INDICATORS[state.ind], v = WE.value(c, state.ind, state.year), rg = WE.REGIONS[c.region], N = WE.COUNTRIES.length;
    var html = '<div class="chead"><div><h2>' + esc(c.name) + '</h2><div class="meta"><span class="rchip" style="background:' + rg.color + '">' + esc(rg.name) + '</span>　' + c.iso + '</div></div><button class="xbtn" id="cClose" type="button" aria-label="取消選取">✕</button></div>';
    html += '<div class="big">' + esc(fmt(state.ind, v)) + '<small>' + esc(d.name) + '・第 ' + WE.rankOf(c.iso, state.ind, state.year) + ' / ' + N + ' 名</small></div>';
    var vals = WE.YEARS.map(function (y) { return WE.value(c, state.ind, y); });
    var vm = Math.max.apply(null, vals.map(Math.abs)) || 1;
    html += '<div class="trend">' + WE.YEARS.map(function (y, i) {
      return '<button type="button" data-y="' + y + '" aria-pressed="' + (y === state.year) + '"><span>' + esc(fmt(state.ind, vals[i], y)) + '</span><i style="height:' + Math.max(4, Math.abs(vals[i]) / vm * 44).toFixed(0) + 'px;background:' + WE.colorFor(state.ind, vals[i]) + '"></i><span>' + y + '</span></button>';
    }).join('') + '</div>';
    html += '<div class="explain">' + esc(explain(c, state.ind, state.year)) + '</div>';
    html += '<div class="sect">八項指標（' + state.year + '，點一列切換）</div><table class="ctable"><tbody>' + WE.IND_ORDER.map(function (k) {
      return '<tr data-k="' + k + '" class="' + (k === state.ind ? 'on' : '') + '"><td>' + esc(WE.INDICATORS[k].name) + '</td><td class="r">' + esc(fmt(k, WE.value(c, k, state.year))) + '</td><td class="k">第 ' + WE.rankOf(c.iso, k, state.year) + ' 名</td></tr>';
    }).join('') + '</tbody></table>';
    if (c.iso !== 'TWN') {
      var t = WE.BY_ISO.TWN.v[state.year], cv = c.v[state.year];
      var ratio = function (a, b) { var r = a / b; return (r >= 10 ? Math.round(r) : r >= 1 ? r.toFixed(1) : r.toFixed(2)) + ' 倍'; };
      html += '<div class="sect">和台灣比（' + state.year + '）</div><div class="cmp"><div>經濟規模<b>' + ratio(cv.gdp, t.gdp) + '</b></div><div>人均 GDP<b>' + ratio(cv.gdppc, t.gdppc) + '</b></div><div>人口<b>' + ratio(cv.pop, t.pop) + '</b></div></div>';
    }
    html += '<div class="sect">主要貿易夥伴（金色弧線）</div><div class="chips">' + c.partners.map(function (p) {
      var o = WE.BY_ISO[p]; return o ? '<button type="button" data-iso="' + p + '">' + esc(o.name) + ' →</button>' : '';
    }).join('') + '</div>';
    var fans = WE.COUNTRIES.filter(function (o) { return o.partners.indexOf(c.iso) >= 0; }).map(function (o) { return o.name; });
    if (fans.length) html += '<p class="note">把' + esc(c.name) + '列為前三大貿易夥伴的經濟體（藍色弧線）：' + esc(fans.join('、')) + '</p>';
    if (c.iso === 'SGP' || c.iso === 'HKG') html += '<p class="note">' + esc(c.name) + '面積太小，在世界地圖上沒有輪廓，以立體柱表示。</p>';
    $('pbody').innerHTML = html;
    $('cClose').onclick = function () { select(null); };
  }
  function bindPanel() {
    $('tabRank').onclick = function () { setTab('rank'); };
    $('tabCountry').onclick = function () { setTab('country'); };
    $('pbody').addEventListener('click', function (e) {
      var r = e.target.closest('[data-iso]'); if (r) { select(r.dataset.iso, true); return; }
      var tr = e.target.closest('tr[data-k]'); if (tr) { setIndicator(tr.dataset.k); return; }
      var yb = e.target.closest('[data-y]'); if (yb) { stopPlay(); setYear(+yb.dataset.y); }
    });
    $('pbody').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var r = e.target.closest('[data-iso]'); if (r) select(r.dataset.iso, true); }
    });
    $('drawerBtn').onclick = function () { setDrawer(!$('panel').classList.contains('collapsed')); };
  }
  function setDrawer(collapsed) {
    $('panel').classList.toggle('collapsed', collapsed);
    document.body.classList.toggle('drawer-collapsed', collapsed);
    $('drawerBtn').textContent = collapsed ? '展開 ▴' : '收合 ▾';
    $('drawerBtn').setAttribute('aria-expanded', !collapsed);
    layout();
  }

  function select(iso, fly) {
    state.sel = iso && WE.BY_ISO[iso] ? iso : null;
    refreshScene();
    if (state.sel) {
      var c = WE.BY_ISO[state.sel];
      if (fly !== false) GS.flyTo(c.lon, c.lat, true);
      if (isMobile() && $('panel').classList.contains('collapsed')) setDrawer(false);
      setTab('country');
    } else setTab(state.tab);
  }

  /* ---------- 導覽 ---------- */
  function runTour(i) {
    if (i < 0 || i >= WE.TOURS.length) { endTour(); return; }
    stopPlay();
    state.tour = i;
    var t = WE.TOURS[i];
    state.ind = t.ind; state.year = t.year; state.region = 'all';
    if (GS.ready && GS.getView() !== t.view) {
      var fc = WE.BY_ISO[t.focus];
      GS.setView(t.view, { lon: fc.lon, lat: fc.lat });
    }
    var f = WE.BY_ISO[t.focus];
    state.sel = t.select || t.focus;
    refreshScene(); renderLegend(); setTab('country'); syncControls();
    if (GS.ready) setTimeout(function () { GS.flyTo(f.lon, f.lat, false); }, GS.getView() === t.view ? 0 : 1450);
    $('tour').classList.add('show');
    $('legend').style.visibility = 'hidden';
    $('tourStep').textContent = '看懂世界經濟 ' + (i + 1) + ' / ' + WE.TOURS.length;
    $('tourTitle').textContent = t.title;
    $('tourText').textContent = t.text;
    $('tourDots').innerHTML = WE.TOURS.map(function (_, k) { return '<i class="' + (k === i ? 'on' : '') + '"></i>'; }).join('');
    $('tourPrev').disabled = i === 0;
    $('tourNext').textContent = i === WE.TOURS.length - 1 ? '完成' : '下一步';
  }
  function endTour() {
    state.tour = -1;
    $('tour').classList.remove('show');
    $('legend').style.visibility = '';
  }

  /* ---------- 常用設定 ---------- */
  function fillSettings() {
    $('sInd').innerHTML = WE.IND_ORDER.map(function (k) { return '<option value="' + k + '">' + esc(WE.INDICATORS[k].name) + '</option>'; }).join('');
    $('sYear').innerHTML = WE.YEARS.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join('');
  }
  function syncSettings() {
    $('sInd').value = prefs.indicator; $('sYear').value = prefs.year;
    document.querySelectorAll('input[name=sView]').forEach(function (r) { r.checked = r.value === prefs.view; });
    $('sRot').checked = prefs.autoRotate; $('sRotSpd').value = prefs.rotateSpeed; $('sRotOut').textContent = (+prefs.rotateSpeed).toFixed(1) + '×';
    $('sRotSpd').disabled = !prefs.autoRotate;
    $('sArcs').checked = prefs.arcs; $('sLabels').value = prefs.labels;
    $('sHeight').value = prefs.heightScale; $('sHeightOut').textContent = (+prefs.heightScale).toFixed(1) + '×';
    $('sScale').value = prefs.scale; $('sCur').value = prefs.currency; $('sTheme').value = prefs.theme; $('sReduce').checked = prefs.reduce;
  }
  function applyPrefs(changed) {
    GS.setOpts({ autoRotate: prefs.autoRotate, rotateSpeed: prefs.rotateSpeed, arcs: prefs.arcs, heightScale: prefs.heightScale, reduce: prefs.reduce });
    if (changed === 'theme') { applyTheme(); renderLegend(); paintMap(); }
    if (changed === 'indicator') setIndicator(prefs.indicator);
    if (changed === 'year') setYear(prefs.year);
    if (changed === 'view') setView(prefs.view);
    if (changed === 'arcs') updateArcs();
    if (changed === 'labels' || changed === 'currency') { updateLabels(); renderLegend(); renderPanel(); }
    if (changed === 'scale') updateBars();
    savePrefs(); syncSettings();
    $('setMsg').textContent = '✓ 已儲存';
    clearTimeout(applyPrefs._t); applyPrefs._t = setTimeout(function () { $('setMsg').textContent = ''; }, 1500);
  }
  function bindSettings() {
    function on(id, ev, key, conv) { $(id).addEventListener(ev, function () { prefs[key] = conv(this); applyPrefs(key); }); }
    on('sInd', 'change', 'indicator', function (e) { return e.value; });
    on('sYear', 'change', 'year', function (e) { return +e.value; });
    document.querySelectorAll('input[name=sView]').forEach(function (r) { r.addEventListener('change', function () { prefs.view = this.value; applyPrefs('view'); }); });
    on('sRot', 'change', 'autoRotate', function (e) { return e.checked; });
    on('sRotSpd', 'input', 'rotateSpeed', function (e) { return +e.value; });
    on('sArcs', 'change', 'arcs', function (e) { return e.checked; });
    on('sLabels', 'change', 'labels', function (e) { return +e.value; });
    on('sHeight', 'input', 'heightScale', function (e) { return +e.value; });
    on('sScale', 'change', 'scale', function (e) { return e.value; });
    on('sCur', 'change', 'currency', function (e) { return e.value; });
    on('sTheme', 'change', 'theme', function (e) { return e.value; });
    on('sReduce', 'change', 'reduce', function (e) { return e.checked; });
    $('settingsBtn').onclick = openSettings;
    $('setClose').onclick = $('setDone').onclick = closeSettings;
    $('settings').addEventListener('click', function (e) { if (e.target === this) closeSettings(); });
    $('setReset').onclick = function () {
      prefs = JSON.parse(JSON.stringify(DEFAULTS));
      applyTheme();
      state.ind = prefs.indicator; state.year = prefs.year;
      if (GS.ready && GS.getView() !== prefs.view) setView(prefs.view);
      applyPrefs('labels'); refreshScene(); renderLegend(); syncControls();
      toast('已恢復預設設定');
    };
  }
  function openSettings() { syncSettings(); $('settings').classList.add('show'); $('sInd').focus(); }
  function closeSettings() { $('settings').classList.remove('show'); $('settingsBtn').focus(); }

  /* ---------- 版面 ---------- */
  function isMobile() { return innerWidth <= 760; }
  function layout() {
    var top = $('top').offsetHeight + 4;
    document.documentElement.style.setProperty('--top', top + 'px');
    if (!GS.ready) return;
    var mq = document.body.classList.contains('has-marquee') ? 30 : 0;
    if (isMobile()) GS.setInset(0, ($('panel').classList.contains('collapsed') ? 52 : $('panel').offsetHeight) - top - mq);
    else GS.setInset($('panel').offsetWidth + 16, -(top + mq) * 0.6);
  }

  /* ---------- 懸停提示 ---------- */
  function onHover(info, pt) {
    var tip = $('tip');
    if (!info || !pt) { tip.style.display = 'none'; return; }
    var c = info.iso ? WE.BY_ISO[info.iso] : WE.BY_NUM[info.num];
    if (!c && !info.name) { tip.style.display = 'none'; return; }
    tip.innerHTML = c ? '<b>' + esc(c.name) + '</b>' + esc(WE.INDICATORS[state.ind].short) + '：' + esc(fmt(state.ind, WE.value(c, state.ind, state.year))) + '　（點一下看詳細）'
      : '<b>' + esc(info.name) + '</b>未收錄在本資料集';
    tip.style.display = 'block';
    var x = Math.min(pt.x + 14, innerWidth - tip.offsetWidth - 8), y = Math.min(pt.y + 14, innerHeight - tip.offsetHeight - 8);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }

  /* ---------- 啟動 ---------- */
  function init() {
    buildControls(); fillSettings(); bindPanel(); bindSettings();
    if (prefs.theme !== 'auto') document.documentElement.setAttribute('data-theme', prefs.theme);
    syncControls(); renderLegend(); renderPanel(); layout();
    $('tourBtn').onclick = function () { runTour(0); };
    $('tourPrev').onclick = function () { runTour(state.tour - 1); };
    $('tourNext').onclick = function () { runTour(state.tour + 1); };
    $('tourClose').onclick = endTour;
    document.addEventListener('keydown', function (e) {
      if (e.target.matches && e.target.matches('input,select,textarea')) return;
      if (e.key === 'Escape') {
        if ($('settings').classList.contains('show')) closeSettings();
        else if (state.tour >= 0) endTour();
        else if (state.sel) select(null);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if ($('settings').classList.contains('show')) return;
        var i = WE.YEARS.indexOf(state.year) + (e.key === 'ArrowRight' ? 1 : -1);
        if (i >= 0 && i < WE.YEARS.length) { stopPlay(); setYear(WE.YEARS[i]); }
      }
    });
    addEventListener('resize', layout);
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (prefs.theme === 'auto') { applyTheme(); paintMap(); renderLegend(); } });
    if (isMobile()) setDrawer(false);

    GS.on('pick', function (info) {
      if (!info) { if (state.sel) select(null); return; }
      var c = info.iso ? WE.BY_ISO[info.iso] : WE.BY_NUM[info.num];
      if (c) select(c.iso, true);
      else if (info.name) toast(info.name + '：未收錄在本資料集');
    });
    GS.on('hover', onHover);
    GS.init({ host: $('gl'), labels: $('labels'), view: prefs.view, opts: {
      autoRotate: prefs.autoRotate, rotateSpeed: prefs.rotateSpeed, arcs: prefs.arcs, heightScale: prefs.heightScale, reduce: prefs.reduce, dark: isDark()
    } }).then(function () {
      $('loading').style.display = 'none';
      applyTheme(); layout(); refreshScene(); syncControls();
    }).catch(function (err) {
      console.error(err);
      mapNoData = true;
      $('loading').classList.add('err');
      $('loadingText').textContent = '3D 地圖載入失敗（需要網路與 WebGL）；右側排行榜與國家資料仍可使用。';
    });
  }

  window.__worldEcon = {
    state: state, prefs: function () { return prefs; },
    setIndicator: setIndicator, setYear: setYear, setView: setView, setRegion: function (r) { $('regionSel').value = r; $('regionSel').dispatchEvent(new Event('change')); },
    selectCountry: function (iso) { select(iso, true); }, runTour: runTour, endTour: endTour,
    openSettings: openSettings, closeSettings: closeSettings, scene: GS
  };
  init();
})();
