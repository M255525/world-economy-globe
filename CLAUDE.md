# CLAUDE.md — world-economy-globe（世界經濟 3D 地圖）

用 3D 地球／平面世界地圖看懂世界經濟：61 個主要經濟體 × 8 項指標（GDP、人均 GDP、成長率、人口、通膨、出口、出口依存度、失業率）× 2015–2024 逐年（2026-10-31 由三個年度擴充為十年）。國家依指標分級上色、首都長出立體柱、金色弧線為主要貿易夥伴；右側排行榜／國家卡（白話解說、八項指標、和台灣比、貿易夥伴）；「🧭 看懂導覽」6 個主題故事。無框架、無建置。2026-10-29 建立。

## 檔案
- `data.js`：`window.WE`。`RAW` 每國 `[iso3, 地圖數字代碼, 中文名, 區域, 首都緯度, 經度, 十個年度[GDP十億美元, 人口百萬, 成長%, 通膨%, 出口十億美元, 失業%], 前三大貿易夥伴]`；`gdppc`、`expShare` 由程式算。`INDICATORS` 的 `bins` 是**固定**分級門檻（跨年度可比）。2015／2020／2024 是手寫錨點，中間 7 年用世界銀行 WDI 序列補齊並對齊錨點（金額類依錨點比例對數內插校正；比率類只在錨點差距 ≤2 個百分點時加位移，否則直接用 WDI）；台灣、PAK 通膨（會計年度）、PHL／MAR 失業、NGA 出口、ARG 2016–17 通膨、UKR 2022–23 失業是手補。`TOURS` 文字裡的數字是手寫的，**改資料要同步檢查導覽文案**。數值是近似參考值，頁面／manual 都有警語。
- `scene.js`：`window.GlobeScene`。Three.js 0.160（importmap → jsdelivr）；**地球與平面共用同一張 PlaneGeometry，在 vertex shader 用 `uMorph` 變形**，長條／弧線／標籤用 CPU 端 `posAt(lon,lat,h,morph)` 跟著變形。國家上色畫在 2D canvas（等距圓柱投影）當貼圖；點選用射線打球面／平面算經緯度再做 point-in-polygon（不靠 Three raycast 打變形後的網格）。
- `app.js`：介面狀態；測試 hook `window.__worldEcon`（`state/prefs/setIndicator/setYear/setView/setRegion/selectCountry/runTour/endTour/openSettings/scene`），`GlobeScene.stats()` 看長條／弧線／標籤數。
- `vendor/countries-110m.json`（world-atlas@2.0.2，ISC／Natural Earth 公有領域）＋`vendor/topojson-client.min.js`（3.1.0）放本地，PWA 離線也有國界。新加坡、香港在 110m 沒有輪廓，只有立體柱。

## 踩坑
- 俄羅斯、斐濟的環跨 180° 經線：畫 canvas 時要先把經度展開成連續值再在 ±360° 各畫一份，否則會出現橫跨整張地圖的色帶；南極洲環繞極點，照原樣畫（`bbox[1] < -80` 判斷）。
- 畫面中心避開右側面板／頂部列／手機抽屜是用 `camera.setViewOffset`（`GlobeScene.setInset(right, bottom)`，bottom 可為負值）。
- 標籤寬度快取 `_w` 要在文字變更時歸零，否則避讓用到舊寬度。

## 配套
- ✅ 頂部跑馬燈（共用 Apps Script 端點、滑鼠移入暫停、`worldEconMarquee`）
- ✅ ⚙ 常用設定（localStorage `worldEconPrefs`）：預設指標／年份／檢視、自動旋轉＋速度、貿易弧線、標籤數量、長條高度、高度刻度（平方根／線性）、幣別（美元／新台幣依當年匯率）、外觀（系統／亮／暗）、減少動畫、恢復預設
- ✅ 標準五件套（使用者 2026-10-29 指定為每個工具的常規配備）：📖 操作手冊 `manual.html`、⚠ 使用警語＋👤 創作者資訊（「ℹ 關於」彈窗 `#about`，**首次造訪自動跳出**，看過記 `worldEconWarnSeen`）、📲 加入主畫面、訪客計數器——頂列、面板底部、⚙ 常用設定底部「關於本工具」三處都有入口
- ✅ RWD（≤760px 面板改底部抽屜，375px 無橫向捲動）、`prefers-reduced-motion`
- ✅ PWA（`manifest.json`＋`service-worker.js` network-first＋`icons/` PIL 自畫）；改 js／json 記得把 `CACHE_NAME` 版號 +1
- ✅ 訪客計數器（visitor-badge `page_id=m255525.worldeconomyglobe`，面板底部）
- ✅ GitHub Pages（2026-10-29 上線）：公開 repo <https://github.com/M255525/world-economy-globe>，網址 <https://m255525.github.io/world-economy-globe/>，`master`＋`.github/workflows/deploy-pages.yml`；程式牆與 github-dashboard 的 REPO_META 已登記
- ❌ 序號授權（不需要）

## Port／測試
- port **8837**（`.claude/launch.json` 的 `world-economy-globe`）
- 驗證：Playwright 開 `http://127.0.0.1:8837/`，`__worldEcon.selectCountry('TWN')`、`setView('flat')`、`runTour(3)`；console 無錯誤；375px `scrollWidth===clientWidth`。
