# LAC · Prediction terminal

LAC 是一個預測市場網站：客戶可以瀏覽 Polymarket 的全部市場、看 LAC 的量化訊號，並直接在網站下單。收入有三種：下單的 builder 手續費、訊號產品的訂閱費、購買 USDT 的轉介。

這份 README 是給**工程師與 AI** 的完整說明：怎麼把整套跑起來、資料表長什麼樣、畫面與商業規則。給所有人看的白話說明在 Notion：[web交接](https://app.notion.com/p/4001fe6c244f80f5a8cff15aed0169ae)。

這個 repository 有兩個部分：

| 目錄                   | 是什麼                                                                                    | 誰負責          |
| ---------------------- | ----------------------------------------------------------------------------------------- | --------------- |
| [lac_data/](lac_data/) | Polymarket 全市場資料程式：抓議題、市場、報價與歷史價格，寫進 PostgreSQL                  | B 組（Remy）    |
| [lac_web/](lac_web/)   | 網站範例（Demo）：前台全部畫面、員工後台、Demo／Live 兩種資料；A 組照著做，可以沿用或重寫 | 範例由 B 組提供 |

[分工與狀態](#1分工與狀態) · [從零開始跑起來](#2從零開始跑起來) · [專案結構](#3專案結構) · [資料表](#4資料表) · [畫面](#5畫面) · [LAC 訊號](#6lac-訊號telegram) · [商業規則](#7商業規則) · [後台](#8後台) · [開發與檢查](#9開發與檢查) · [常見問題](#10常見問題) · [待確認](#11待確認) · [附錄](#附錄之後才做)

## 1｜分工與狀態

- **A 組（外包）：** 網站與 app 本身，以及會員系統：註冊登入、付費方案、權益與到期、推薦分潤與提領、後台。購買 USDT 的合作網站與金流也由 A 組提供。
- **B 組（Remy）：** 背後的引擎：Polymarket 市場資料（本 repo 的 `lac_data`）、LAC 訊號、下單引擎（送出交易、確認成交、計算回佣）。
- **交界：** A 組讀 B 組的資料表（§4）、讀 B 組發到 Telegram 群組的訊號（§6）、呼叫 B 組的下單引擎（§7.5）。

| 功能              | A 組                             | B 組                                      | 狀態       |
| ----------------- | -------------------------------- | ----------------------------------------- | ---------- |
| 1. 看市場         | 照 Demo 做畫面，接上 Live 資料表 | 資料程式已經在跑（本 repo），之後還會調整 | 可以開工   |
| 2. 訊號           | 照 Demo 做畫面，先用假資料       | 訊號系統還在做；格式草稿見 §6             | 先做畫面   |
| 3. 下單           | 頁面上已有按鈕，先看懂           | 下單引擎；還在等 Polymarket builder 金鑰  | 先看懂就好 |
| 4. 會員與付費方案 | **最主要外包的部分**             | 提供產品內容與上架規則（§7.1）            | 可以開工   |
| 5. 推薦分潤與提領 | 做在會員系統裡                   | 提供分潤規則（§7.3）                      | 可以開工   |
| 6. 購買 USDT      | 提供合作網站與金流               | 只提供畫面範例                            | 可以開工   |
| 7. 後台           | 參考 Demo，怎麼改、加或刪都可以  | 只提供範例                                | 可以開工   |

股票、全球體育賠率分析之後才做，見[附錄](#附錄之後才做)。

## 2｜從零開始跑起來

目標：clone 下來之後，先讓資料程式抓 Polymarket 資料進資料庫，再打開網站，在 Live 模式看到真實行情。只想看畫面的話，跳到第 6 步，Demo 模式不需要資料庫有資料。

### 需要的環境

| 工具       | 要求                                                                                 |
| ---------- | ------------------------------------------------------------------------------------ |
| 作業系統   | Linux、macOS，或 Windows 的 WSL；已在 Ubuntu 24.04 驗證                              |
| PostgreSQL | **16**，連接埠 **5432**（程式會檢查主版本與連接埠）                                  |
| Python     | 3.12 以上，用 [uv](https://docs.astral.sh/uv/) 管理                                  |
| Node.js    | 20 以上（已用 22、24 驗證），含 npm                                                  |
| 網路       | 要連得到 `gamma-api.polymarket.com`、`clob.polymarket.com`；所在地區連不到時先開 VPN |

Ubuntu 安裝範例：

```bash
sudo apt install -y postgresql-16 git curl
curl -LsSf https://astral.sh/uv/install.sh | sh     # 裝完重開終端機，讓 uv 進 PATH
# Node.js 20 以上：用 nvm、fnm 或 NodeSource 安裝
```

### 1. 取得程式碼

```bash
git clone https://github.com/LightingArb/lac.git
cd lac
```

這是私人 repository，需要 Remy 開權限。

### 2. 環境檔 `.env`

根目錄的 `.env` 是資料程式與網站共用的唯一一份設定，已經放在 repo 裡：

```dotenv
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=lac_data
DB_USER=admin
DB_PASSWORD=admin
```

這是本機開發用的預設值，只連本機資料庫。`DB_NAME` 必須是 `lac_data`、`DB_PORT` 必須是 `5432`，程式會檢查；帳號密碼可以改成你自己的。網站的 `DB_*` 只在伺服器端使用，不會傳到瀏覽器。

### 3. 建立資料庫帳號

照 `.env` 建一個可以登入、可以建立資料庫的帳號（資料庫 `lac_data` 由下一步自動建立）：

```bash
sudo -u postgres psql -c "CREATE ROLE admin LOGIN PASSWORD 'admin' CREATEDB;"
```

macOS（Homebrew）：`brew install postgresql@16 && brew services start postgresql@16`，再用 `psql postgres -c "CREATE ROLE admin LOGIN PASSWORD 'admin' CREATEDB;"`。

### 4. 安裝套件、建立資料表

```bash
cd lac_data/python
uv sync --locked
uv run --env-file ../../.env python -m m_live.all_setup
uv run --env-file ../../.env python -m m_historical.all_setup
```

看到這兩行就成功：

```text
SETUP_OK m_live tables=4
SETUP_OK m_historical tables=2
```

setup 可以重跑：缺的表會補上，已經存在的表會檢查欄位，不一致就報錯（不會自動遷移）。

### 5. 啟動資料程式（終端機一）

```bash
cd lac_data/python
uv run --env-file ../../.env python -m m_live.all_runtime
```

- 會開兩個進程：`gamma`（議題、市場、結果）與 `clob`（最新報價），各自每 600 秒跑一輪；一輪跑超過 600 秒，就在跑完後立刻開始下一輪。
- 空資料庫第一次：gamma 要先發布完整名單，clob 才有東西可以報價，第一批價格可能要等到 clob 的下一輪。
- 輸出是一行一個 JSON。`round_finished` 的 `result` 是 `complete` 才算成功。
- 只跑一輪就結束：加 `--once`。只跑其中一個：加 `--unit gamma` 或 `--unit clob`。
- 停止：`Ctrl+C`，會等目前的工作做完再結束。

**選用：歷史價格（走勢圖用）。** 歷史是手動跑的單次工作，不會跟著上面的程式自動更新。預設抓 24 小時成交量前 500 個進行中議題的全部結果，固定抓最近 3 天：

```bash
cd lac_data/python
uv run --env-file ../../.env python -m m_historical.all_runtime --once --days 3 --top-events 500
```

中途中斷想續跑，要用同一個結束時間，已完成的會跳過：

```bash
LAC_HISTORY_END=$(date -u +%Y-%m-%dT%H:%M:00Z)
uv run --env-file ../../.env python -m m_historical.all_runtime --once --days 3 --top-events 500 --end "$LAC_HISTORY_END"
```

### 6. 啟動網站（終端機二）

```bash
cd lac_web
npm ci
npm run dev
```

打開 <http://127.0.0.1:5173/prediction>。左上角 Logo 旁邊切換 **Demo／Live**：

- **Demo**：內建的範例資料，不需要資料庫有資料，也不需要資料程式在跑。
- **Live**：從資料庫讀真實行情（只讀）。畫面每 30 秒重新讀表；資料本身由資料程式每 600 秒更新。

其他指令：`npm run build:static` 會產生單一檔案 `lac_web/dist-static/index.html`，不用伺服器就能打開，適合傳給別人看（只有 Demo）。

### 7. 確認有資料

```bash
psql "postgresql://admin:admin@127.0.0.1:5432/lac_data" -c \
  "SELECT (SELECT count(*) FROM m_live.m01_gamma_event) AS events,
          (SELECT count(*) FROM m_live.m02_clob_price) AS prices;"
```

兩個數字都大於 0，Live 模式就會有東西。

## 3｜專案結構

```mermaid
flowchart LR
    G["Polymarket Gamma API"] --> M["m_live：議題、市場、結果"]
    C["Polymarket CLOB API"] --> Q["m_live：最新報價"]
    H["Polymarket 歷史 API"] --> P["m_historical：分鐘價格"]
    M --> V["網站伺服器（唯讀）"]
    Q --> V
    P --> V
    V --> L["Live 畫面"]
    D["內建範例資料"] --> R["Demo 畫面"]
```

```text
.
├── README.md                  # 本文件
├── AGENTS.md                  # AI 協作入口
├── .env                       # 資料程式與網站共用的設定
├── lac_data/python/
│   ├── h_shared/              # 共用：資料庫連線、排程、HTTP 重試與限流
│   ├── m_live/                # 議題、市場、結果（gamma）與最新報價（clob）
│   │   ├── all_setup.py       # 建表
│   │   ├── all_runtime.py     # 常駐執行
│   │   ├── sql/               # 資料表定義
│   │   └── src/               # m01_gamma、m02_clob
│   └── m_historical/          # 歷史分鐘價格（手動單次）
└── lac_web/
    ├── server/live.ts         # 網站伺服器的唯讀資料庫查詢（/api/live/*）
    ├── src/                   # 前台、後台、共用元件、範例資料、中英文文案
    ├── tests/                 # 資料對應與商業規則測試
    └── README.md              # 前端開發導覽
```

命名規則：`m_<模組>/` 是一個模組，裡面的 `mNN_<名稱>` 是步驟；`h_shared/` 是不含業務規則的共用工具；每個模組都有 `all_setup.py`（建表）與 `all_runtime.py`（執行）。

## 4｜資料表

- 資料程式從 Polymarket 公開 API 抓資料、清洗後寫進 PostgreSQL 資料庫 `lac_data`。**A 組只讀不寫**，不用再清洗。
- **更新頻率：** 議題與市場每 600 秒一輪；報價每 600 秒一輪；歷史是一分鐘一筆，手動回補。
- **層級：** 議題（event）→ 市場（market，畫面上的一個選項列）→ 結果（outcome，例如 Yes 與 No，各有自己的 `asset_id` 與價格）。
- **價格怎麼讀：**
  - 價格介於 0 到 1，畫面顯示成 ¢：0.86 就是 86¢，代表市場認為有 86% 的機率發生。結算時猜對的一邊每份拿回 1 美元。
  - Chance 用 `midpoint`；倍數 = 1 ÷ `midpoint`。
  - 「Buy Yes」「Buy No」按鈕用各自結果的 `best_ask`（立即買入價）；`best_bid` 是立即賣出價。
  - 沒有人掛單時 `best_bid`／`best_ask` 是 null，畫面顯示「—」。
- **時間：** 全部是 UTC，畫面上再轉成使用者的時區。
- **議題網址：** `https://polymarket.com/event/{slug}`。
- **進行中：** 議題與市場都要 `in_current_scan AND active AND NOT closed AND NOT archived`。同一個議題底下可能有已關閉的市場，要逐一判斷。
- **歷史：** 只有來源真的有資料的分鐘才有一筆，可能有缺口；畫面上斷線就好，不要補點。

**常用查詢：**

```sql
-- 進行中的議題，照 24 小時成交量排序
SELECT event_id, title, slug, icon_url, end_at, volume_24h, volume_total, tags
FROM m_live.m01_gamma_event
WHERE in_current_scan AND active AND NOT closed AND NOT archived
ORDER BY volume_24h DESC NULLS LAST, event_id
LIMIT 50;

-- 一個議題底下的選項與最新價格
SELECT m.market_id, m.group_title, m.question, o.label, o.asset_id,
       p.midpoint, p.best_bid, p.best_ask, m.liquidity, m.volume_total
FROM m_live.m01_gamma_market AS m
JOIN m_live.m01_gamma_outcome AS o ON o.market_id = m.market_id
LEFT JOIN m_live.m02_clob_price AS p ON p.asset_id = o.asset_id
WHERE m.event_id = $1 AND m.in_current_scan AND m.active AND NOT m.closed AND NOT m.archived
ORDER BY m.sort_order, o.outcome_index;
```

完整定義在 [m_live/sql](lac_data/python/m_live/sql/) 與 [m_historical/sql](lac_data/python/m_historical/sql/)；網站的實際查詢在 [server/live.ts](lac_web/server/live.ts)。

**`m_live.m01_gamma_event`**：一列＝一個議題；主鍵 `event_id`。

| 欄位                           | 型別         | 意思                                         |
| ------------------------------ | ------------ | -------------------------------------------- |
| event_id                       | text         | 議題編號                                     |
| slug                           | text         | 官方網址的短名                               |
| title                          | text         | 英文標題                                     |
| description、resolution_source | text?        | 規則說明原文、結算依據                       |
| image_url、icon_url            | text?        | 圖片與圖示網址                               |
| start_at、end_at               | timestamptz? | 開始與預定結束時間；結束時間到了不代表已結算 |
| active、closed、archived       | boolean      | 狀態                                         |
| volume_total、volume_24h       | numeric?     | 累計與近 24 小時成交額（美元）               |
| liquidity                      | numeric?     | 流動性，不是成交量                           |
| tags                           | jsonb        | 標籤陣列（id、label、slug），分類用          |
| source_updated_at              | timestamptz? | Polymarket 最後修改時間                      |
| in_current_scan                | boolean      | 是否出現在最新一次完整掃描                   |
| observed_at                    | timestamptz  | 資料程式抓到這筆的時間                       |

**`m_live.m01_gamma_market`**：一列＝一個市場（畫面上的一個選項列）；主鍵 `market_id`。

| 欄位                                            | 型別         | 意思                                                       |
| ----------------------------------------------- | ------------ | ---------------------------------------------------------- |
| market_id、event_id                             | text         | 市場編號、所屬議題                                         |
| sort_order                                      | integer      | Polymarket 的排列順序                                      |
| condition_id                                    | text?        | 鏈上條件編號，下單會用到                                   |
| protocol_version                                | text         | v1 或 v2                                                   |
| slug、question                                  | text         | 市場短名與完整英文問題                                     |
| group_title                                     | text?        | 選項短名，例如「25 bps decrease」；卡片與選項表顯示這個    |
| description、resolution_source                  | text?        | 這個市場的規則與結算依據                                   |
| image_url、icon_url                             | text?        | 圖片與圖示                                                 |
| start_at、end_at                                | timestamptz? | 開始與預定結束時間                                         |
| active、closed、archived                        | boolean      | 狀態                                                       |
| accepting_orders、enable_order_book             | boolean?     | 現在是否接受下單、是否有訂單簿                             |
| volume_total、volume_24h、liquidity             | numeric?     | 累計與 24 小時成交額、流動性（「隱藏低流動性市場」用這欄） |
| source_updated_at、in_current_scan、observed_at |              | 同議題表                                                   |

**`m_live.m01_gamma_outcome`**：一列＝一個結果；主鍵 `market_id`＋`outcome_index`。

| 欄位          | 型別    | 意思                                    |
| ------------- | ------- | --------------------------------------- |
| market_id     | text    | 所屬市場                                |
| outcome_index | integer | 結果順序；不一定 0 就是 Yes，請看 label |
| label         | text    | 結果名稱：Yes、No、Up、Down 等          |
| token_id      | text?   | v1 市場的 token 編號                    |
| position_id   | text?   | v2 市場的 position 編號                 |
| asset_id      | text?   | 查價格、下單用的編號（唯一）            |

**`m_live.m02_clob_price`**：一列＝一個結果的最新價格；主鍵 `asset_id`。

| 欄位                                                 | 型別            | 意思                                        |
| ---------------------------------------------------- | --------------- | ------------------------------------------- |
| asset_id                                             | text            | 哪一個結果                                  |
| best_bid、best_ask                                   | numeric?        | 立即賣出、立即買入的價格；沒人掛單時是 null |
| midpoint                                             | numeric?        | 中間價，畫面的 Chance                       |
| last_trade_price、last_trade_side                    | numeric?、text? | 最近一筆成交價與方向（BUY／SELL）           |
| quote_observed_at、mid_observed_at、last_observed_at | timestamptz?    | 資料程式抓到各個價格的時間，不是成交時間    |

**`m_historical.m01_polymarket_price`**：一列＝一個結果在一分鐘的價格；主鍵 `asset_id`＋`minute_at`。走勢圖用。

| 欄位               | 型別        | 意思                  |
| ------------------ | ----------- | --------------------- |
| asset_id           | text        | 哪一個結果            |
| minute_at          | timestamptz | 哪一分鐘              |
| source_at          | timestamptz | Polymarket 的實際時間 |
| price              | numeric     | 價格                  |
| resolution_seconds | integer     | 間隔，一般是 60       |

**`m_historical.m01_polymarket_coverage`**：一列＝一個結果的歷史抓取狀態；主鍵 `asset_id`。用來分辨「沒有歷史資料」與「還沒抓」。

| 欄位                           | 型別        | 意思                                   |
| ------------------------------ | ----------- | -------------------------------------- |
| asset_id                       | text        | 哪一個結果                             |
| requested_start、requested_end | timestamptz | 已抓的時間範圍                         |
| checked_at                     | timestamptz | 抓完的時間                             |
| status                         | text        | success 或 error                       |
| point_count                    | integer?    | 有幾分鐘的資料；0 代表這段時間沒有資料 |
| error_reason                   | text?       | 失敗原因                               |

**Live 畫面目前的讀法（範例網站）：**

- Trending：進行中議題依 24 小時成交量取前 100 個，每頁 50 個；大型議題的市場也每頁 50 個。
- 分類：Trending、Politics、Sports、Finance、Crypto、Esports、Geopolitics、Weather；後面七個各對應同名的 Polymarket 標籤 slug。
- 隱藏低流動性：隱藏 liquidity 小於 25,000 或未知的市場；被選中的訊號那一列一定保留。

## 5｜畫面

範例網站就是畫面規格：`npm run dev` 打開後每一頁都可以點。參考網站：[polym.trade](https://polym.trade/)。

```txt
┌──────────┬────────────────────┬────────────────────┬──────────┐
│ 左左      │ 左中                │ 右中                │ 右右      │
│ 選單      │ 議題列表            │ 議題詳情            │ 訊號欄    │
│ 可摺疊    │                    │                    │ 可摺疊    │
└──────────┴────────────────────┴────────────────────┴──────────┘
```

| 欄             | 內容                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 左左（可摺疊） | 上方入口，一行一項：Prediction、Signal、Buy USDT、Stocks、Products、Referral rewards。中間是目前入口的分類，每項顯示議題數。最下方是 Settings、登入、語言切換（EN／繁中）                         |
| 左中           | 議題卡片列表。上方是麵包屑、篩選、搜尋。每張卡片：圖示與標題、結束時間、前三個選項的價格（¢）與倍數（×）；比賽類顯示比分與雙方機率                                                                |
| 右中           | 議題詳情：標題、標籤、開始與結束時間、24 小時與總成交量；走勢圖（1H／6H／1D／1W／1M／All，每個選項一條線）；Markets 選項表，每列顯示 Chance 與 Yes／No 買入按鈕，可隱藏低流動性市場               |
| 右右（可摺疊） | 只在 Signal 出現。分類分頁（只顯示客戶有權益的）、排序（Latest／EV／ROI／Depth／Expiry）。每張卡片：分類 · 標的、選項、YES／NO、EV、Entry、Fair（差距 %）、Avg. Cost（depth）、更新時間、剩餘時間 |

**入口：**

- **Prediction：** Polymarket 全部議題，沒有訊號欄。
- **Signal：** LAC 有在算的議題。分類最上面是 Trending（現在有訊號的議題），下面是 Weather、Crypto、Forex、Future、Sport；客戶沒有權益、或那一類現在沒有訊號，就不顯示。中間兩欄跟 Prediction 完全一樣，多了右右的訊號欄。
- **Buy USDT：** 一行，黑色粗體。點開是合作網站清單（名稱、付款方式、手續費、最低金額、支援的鏈、外連按鈕），規則見 §7.6。
- **Stocks：** 先留位置，不啟動。
- **Products：** 方案卡片與月／季／年切換，每張訊號方案顯示「包含：…」（來自目前上架的版本，§7.1）；底部有兌換碼。
- **Referral rewards：** 推薦連結與代碼、可提領餘額與「提領」按鈕、統計、My agents（可改直屬代理的比例）、每 100 元怎麼分的示意條、Referred traders、提領紀錄。
- **Settings：** 個人資料、推薦碼（不限次數修改，只能英數字，最多 16 字）、Polymarket 交易（連接錢包 → 啟用交易，§7.5）、綁定 Telegram、語言與主題、法律聲明；最下面有後台入口（只在 Demo）。

**互動：**

- 左左選分類 → 左中列出議題 → 點議題 → 右中顯示詳情。
- 在 Signal 點右右的一張訊號 → 左中跳到那個議題，右中捲到那個選項，**對應的 Yes 或 No 按鈕變黃底黃框**，那一列淡黃底。訊號靠 Polymarket 編號對到市場（§6）。

**語言：** 繁體中文與英文都要，左下角或 Settings 切換。Polymarket 的內容（議題標題、選項名稱、標籤）維持原文不翻；我們自己的東西（分類、產品、項目名稱）兩種語言都要有。範例的文案集中在 [lac_web/src/i18n/](lac_web/src/i18n/)。

**尺寸：** 寬螢幕為主，範例已支援手機寬度：低於 768px 選單變抽屜，低於 1200px 訊號欄變抽屜。

## 6｜LAC 訊號（Telegram）

- B 組的 bot 把訊號發到與 A 組共用的 Telegram 群組，A 組的 bot 讀取後顯示在網站上。
- **A 組的 bot 要先設定**才收得到別的 bot 的訊息：在 @BotFather 開啟 Bot-to-Bot Communication Mode、在群組裡設為管理員、在 @BotFather 關閉 Group Privacy Mode。
- 只發 Polymarket 市場的訊號，而且只發 EV 為正的。
- 訊號出現或內容有變時才發；在到期前失效時發一筆 `status = withdrawn`。過了 `valid_until` 就從畫面拿掉。
- **訊息格式（草稿）：** 一則訊息是一段 JSON，可以包含多筆訊號。

```json
{
  "type": "lac_signals",
  "sent_at": "2026-10-21T12:00:00Z",
  "signals": [
    {
      "signal_id": "weather-34512-1",
      "status": "active",
      "product": "weather",
      "classification_path": [
        { "kind": "country", "code": "GB", "display": "United Kingdom" },
        { "kind": "metric", "code": "daily_high", "display": "Daily high" },
        { "kind": "city", "code": "london", "display": "London" },
        { "kind": "icao", "code": "EGLC", "display": "EGLC" }
      ],
      "event_id": "34512",
      "market_id": "567890",
      "asset_id": "6025…9740",
      "side": "YES",
      "entry": 0.42,
      "fair": 0.54,
      "ev": 0.12,
      "avg_cost": 0.47,
      "depth": 2400,
      "evaluated_at": "2026-10-21T11:59:30Z",
      "valid_until": "2026-10-21T23:59:00Z"
    }
  ]
}
```

| 欄位                          | 意思                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| signal_id                     | 訊號編號；同一個編號的新訊息蓋掉舊的                                                 |
| status                        | active（有效）或 withdrawn（失效，從畫面拿掉）                                       |
| product                       | weather、crypto、forex、future、sport；決定 Signal 的分類與權益                      |
| classification_path           | 分類路徑，由上到下；`code` 固定不變、可以比對，`display` 只用來顯示                  |
| event_id、market_id、asset_id | 對到 §4 的議題、市場、結果；點訊號時靠這三個找到要標黃的那一格                       |
| side                          | YES 或 NO（Up／Down 類市場一樣用 YES＝第一個結果、NO＝第二個結果，以 asset_id 為準） |
| entry                         | 現在的買入價                                                                         |
| fair                          | LAC 算出的合理價                                                                     |
| ev                            | fair － entry                                                                        |
| avg_cost                      | 從現在的掛單一路買到 fair 為止的平均成本                                             |
| depth                         | 在 fair 以下可以買到的份數                                                           |
| evaluated_at、valid_until     | 算出這筆的時間、有效到幾點                                                           |

**新項目怎麼進後台（建議，待確認）：** 用 `classification_path` 的某一層當「項目」：天氣是城市、加密貨幣是幣種加週期、外匯是貨幣對、期貨是商品代號、體育是運動種類。後台第一次看到某個產品底下沒見過的 `code`，就把它放進「待審核的新項目」（§7.1）。

## 7｜商業規則

### 7.1 產品與上架閘門

- **產品：** Weather、Crypto、Forex、Future、Sport 各一個訊號產品，加上 All signals（全包）。Prediction 免費。
- **項目：** 一個產品由好幾個項目組成，例如 Sport 包含足球、籃球。
- **閘門：** 訊號系統開始提供新項目（例如美式足球）時，它只會出現在後台的「待審核」，**不會自動上架**。員工核准、放進產品的新版本、訂好價格，按下發布才會上架。B 組那邊多了什麼，網站不能直接跟著變。
- **版本：** 產品發布後內容就固定。要加或拿掉項目，就發布下一版（v2、v3…），上一版自動從商店下架。價格跟著版本走。
- **已經買的人：** 買到哪一版就一直是那一版，直到到期，什麼都不用動。舊客戶想要新項目，可以再買一次，或由員工在後台把他升級到新版、自己決定到期日。
- **手動開通與兌換碼：** 都給「當下上架」的版本。
- 範例的規則與測試：[lac_web/src/data/products.ts](lac_web/src/data/products.ts)、[backend.ts](lac_web/src/data/backend.ts)。

### 7.2 會員與付費方案

- 註冊、登入、帳號狀態（正常／停權）由 A 組做；登入方式待確認。
- **權益：** 一筆權益＝一個會員 × 一個產品版本 × 一段期間（開始、到期），來源是購買、員工開通或兌換碼。客戶有哪些權益，Signal 就只顯示那些分類與訊號，Telegram 通知也一樣。
- 計費週期：月、季、年；價格待確認。
- **退款：** 退款時，那筆付款開通的權益一起撤銷。
- **停權：** 不能登入；他的提領只能駁回。

### 7.3 推薦分潤

- **兩本帳分開算：** 下單的 builder 手續費一本、訊號訂閱費一本，比例暫時一樣。
- **結構：** 所有人都在官方底下。官方先拿 20%，剩下 80% 往下一層一層分。
- 每一層只能設定**直屬下一層**的比例，不能超過自己的比例；自己拿到的＝自己的比例－給下一層的比例。
- **例子：** 官方給 B 80%，B 給 C 55%。C 這條線產生 100 美元 → 官方 20、B 25、C 55。
- **一般調整（每一層都可以）：** 只能多給下面，不能少給。例如官方原本自己拿 20%，之後只能調成 19%、18%…，不能超過 20%。任何調整**隔天才生效**，畫面上要寫清楚。
- **按比例縮減（只有官方可以）：** 把整條線的比例按同一個比例一起砍，砍下來的全部回到官方。例：上面的例子砍 50% → C 從 55% 變 27.5%、B 從 25% 變 12.5%、官方從 20% 變 60%。之後官方可以再決定多給某條線（回到一般調整，只能加）。
- 推薦碼在 Settings 隨時可改，不限次數；推薦連結跟著換。
- 範例的分成計算：[lac_web/src/data/referral.ts](lac_web/src/data/referral.ts)、[admin.ts](lac_web/src/data/admin.ts)（代理樹）。

### 7.4 提領

- 推薦收入進到可提領餘額後，會員可以申請提領；這是網站唯一的出款，網站不收儲值。
- **流程：** 會員申請（金額、收款鏈、錢包地址）→ 員工審核：核准或駁回（要寫原因，會員看得到）→ 員工從金庫錢包手動轉帳 → 貼上交易 hash，標記已出款。駁回的金額回到可提領餘額。
- 審核中與已核准的金額會凍結，不能重複提領。
- 範例的收款方式：USDT · TRC20、USDC · Polygon；最低 $50；手續費誰付、幾天內處理、收入何時進到可提領，都待確認。
- 範例的流程與餘額計算：[lac_web/src/data/withdrawals.ts](lac_web/src/data/withdrawals.ts)。

### 7.5 下單（Polymarket builder）

- 客戶在 LAC 下單時，訂單的 `builder` 欄位帶 LAC 的 builder code，成交量與手續費記在 LAC 名下。builder code 是訂單內容的一部分，要在簽名前放進去。
- 每筆訂單由客戶的錢包簽名，再用客戶的 Polymarket API 憑證送出。API 憑證（key、secret、passphrase 三件一組）是**錢包簽一次名**產生的，客戶不用自己去找、也不用貼；私鑰永遠不離開錢包。Settings 的流程是「連接錢包 → 啟用交易」。
- **分工：** 頁面上的按鈕由 A 組做。按下去之後的下單引擎由 B 組做：送出交易、確認成交、從 builder 紀錄算回佣金。介面怎麼接待確認；B 組還在等 builder 金鑰，A 組先看懂就好。
- 參考：[Order attribution](https://docs.polymarket.com/trading/orders/attribution)、[Builder client](https://docs.polymarket.com/trading/clients/builder)、[Authentication](https://docs.polymarket.com/api-reference/authentication)。

### 7.6 購買 USDT

- 只轉介：客戶點「前往網站」到合作網站，在那邊付款、做 KYC、收 USDT。LAC 不經手款項、不保管資金。
- 合作網站與金流由 A 組提供；清單底部註明是外部網站、款項由該服務商處理。
- 清單內容（順序、是否顯示）由後台維護。

## 8｜後台

範例在網站的 `/admin`（Settings 最下面的「開啟後台」）。**這只是參考，A 組要怎麼改、加或刪都可以**；正式版應是獨立網站、員工另外登入。

| 頁面 | 做什麼                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| 待辦 | 所有等人處理的事：待審提領、TG 新項目、7 天內到期的權益、付款失敗；點一行就到處理它的地方                                         |
| 會員 | 列表 → 會員詳情：權益（產品版本、包含項目、期間、來源）、手動開通、改到期日、升級到新版、撤銷、付款與退款、提領、代理線、操作紀錄 |
| 產品 | 每個產品目前上架的版本與歷史版本、建立並發布新版、審核新項目、兌換碼                                                              |
| 出金 | 提領審核：核准、駁回、貼交易 hash 標記已出款                                                                                      |
| 財務 | 報表、付款（含退款）、代理分潤樹                                                                                                  |
| 系統 | 網站內容（購買 USDT 清單、公告、法律頁面）、員工帳號與角色權限、操作紀錄（不能改也不能刪）                                        |

範例裡已經做好的連動（正式版也要有）：退款會撤銷權益；停權會擋住核准與出款；發布新版會讓舊版下架；每個員工動作都留紀錄。範例的「後端」是一個 reducer：[lac_web/src/data/backend.ts](lac_web/src/data/backend.ts)，測試在 [lac_web/tests/](lac_web/tests/)。

## 9｜開發與檢查

```bash
# 前端
cd lac_web
npm test          # 資料對應、分成、提領、產品版本與權益、中英文鍵值
npm run build     # TypeScript 檢查與正式輸出 dist/

# 資料程式
cd lac_data/python
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

前端的元件、路由與檔案導覽見 [lac_web/README.md](lac_web/README.md)。

## 10｜常見問題

- **範例沒有真實交易：** 登入、訂閱、兌換、Telegram 綁定、Yes／No 下單按鈕都還沒接服務；Live 不計算 LAC 的 fair／EV，也沒有真實訊號。
- **範例的資料重新整理就重設：** 推薦碼、代理比例、提領申請、後台操作都存在頁面記憶體；只有語言選擇記在瀏覽器。
- **錢包與交易是展示：** 「連接錢包」「啟用交易」只切換畫面狀態，不簽名、不儲存任何憑證。
- **`npm run preview` 或直接開 `dist/` 看不到 Live：** Live 的資料庫查詢只在 `npm run dev` 的伺服器裡。
- **網站起不來或 Live 連不到：** 檢查 `.env` 五個欄位、PostgreSQL 16 有在 5432 跑、兩個 setup 都成功；網站固定用 5173，被占用會直接報錯。
- **資料程式出現 `provider_error`：** `status: 0` 是連不到 Polymarket（網路或地區封鎖，開 VPN）；401／403 會讓那個單位暫停，處理好再重開。
- **Live 價格或歷史沒更新：** 讀表成功不代表來源已刷新，看資料程式的 `published`／`round_finished` 紀錄；歷史要另外手動回補。

## 11｜待確認

1. 正式環境的資料表放哪台主機、A 組怎麼連。
2. Telegram 訊息格式（§6 是草稿）與「項目」取 `classification_path` 的哪一層。
3. 下單：A 組畫面呼叫 B 組下單引擎的介面。
4. 各產品價格、付款方式、登入方式。
5. 提領規則：最低金額、手續費誰付、幾天內處理、收入何時可提領。
6. 分潤：比例出現小數怎麼處理、「隔天生效」以哪個時區為準。
7. 購買 USDT 的合作網站名單。
8. 手機版的時程。

## 附錄｜之後才做

- **股票：** 台股、美股個股分析。
- **全球體育賠率分析。**
- 這兩項在網站上先留位置，這個階段不啟動。
