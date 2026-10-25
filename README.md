# LAC · Prediction terminal

LAC 是一個預測市場網站：客戶可以瀏覽 Polymarket 的全部市場、看 LAC 的量化訊號，並直接在網站下單。收入有三種：下單的 builder 手續費、訊號產品的訂閱費、購買 USDT 的轉介。

這份 README 是給**工程師與 AI** 的完整說明：怎麼把整套跑起來、資料表長什麼樣、畫面與商業規則。給所有人看的白話說明在 Notion：[web交接](https://app.notion.com/p/4001fe6c244f80f5a8cff15aed0169ae)。

這個 repository 有兩個部分：

| 目錄                                                   | 是什麼                                                                                                                                                                                                                | 誰負責          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| [python/](python/)                                     | 現有 `m_live`、`m_historical` 抓 Polymarket 議題、市場、報價與歷史價格，寫進 PostgreSQL；規劃中的 `m_product` 收各產品訊號、體育全球賠率、股票分析（後兩種格式未定），`m_api` 提供唯讀對外 HTTP；後兩個模組都還沒實作 | B 組（Remy）    |
| [typescript/web_page_demo/](typescript/web_page_demo/) | 頁面原型（Demo）：前台全部畫面、員工後台、Demo／Live 兩種資料；A 組照著做，可以沿用或重寫                                                                                                                             | 範例由 B 組提供 |

[分工與狀態](#1分工與狀態) · [從零開始跑起來](#2從零開始跑起來) · [專案結構](#3專案結構) · [資料表](#4資料表) · [畫面](#5畫面) · [對外 HTTP 介面](#6對外-http-介面m_api) · [商業規則](#7商業規則) · [後台](#8後台) · [開發與檢查](#9開發與檢查) · [常見問題](#10常見問題) · [待確認](#11待確認) · [附錄](#附錄之後才做)

## 1｜分工與狀態

- **A 組（合作夥伴）：** 網站與 app 本身，以及會員系統：註冊登入、付費方案、權益與到期、推薦分潤與提領、後台。購買 USDT 的合作網站與金流也由 A 組提供；下單、平倉與 TP／SL 由 A 組在自己的伺服器上執行。
- **B 組（Remy）：** Polymarket 市場資料（本 repo 的 `python/`）、各產品的訊號、體育全球賠率與股票分析；由規劃中的 `m_product` 收集產品資料，再透過唯讀 `m_api` 提供，兩個模組都還沒實作。B 組不做下單引擎；客服由 B 組負責，一律走 Telegram。
- **資料交界：** A 組只透過 `m_api`（§6）取得 Polymarket 與產品資料，不直接連資料庫；體育全球賠率與股票分析的格式還沒定。
- **下單交界：** A 組在自己的伺服器上執行下單、平倉與 TP／SL，每張單帶 LAC 的 builder code（§7.5）。

| 功能              | A 組                                                                | B 組                                                   | 狀態               |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------------------------ | ------------------ |
| 1. 看市場         | 照 Demo 做畫面，正式資料接 `m_api`                                  | 資料程式已經在跑；`m_api` 還沒實作，格式草稿見 §6      | 可以開工           |
| 2. 訊號           | 照 Demo 做畫面，先用假資料                                          | 訊號系統、`m_product` 與 `m_api` 還沒好，格式草稿見 §6 | 先做畫面           |
| 3. 下單           | 在自己的伺服器執行下單、平倉與 TP／SL，每張單帶 LAC 的 builder code | 提供 LAC 的 builder code 與相關憑證，不做下單引擎      | 憑證交付方式待確認 |
| 4. 會員與付費方案 | **合作夥伴的主要工作**                                              | 提供產品內容與上架規則（§7.1）                         | 可以開工           |
| 5. 推薦分潤與提領 | 做在會員系統裡                                                      | 提供分潤規則（§7.3）                                   | 可以開工           |
| 6. 購買 USDT      | 提供合作網站與金流                                                  | 只提供畫面範例                                         | 可以開工           |
| 7. 後台           | 參考 Demo，怎麼改、加或刪都可以                                     | 只提供範例                                             | 可以開工           |

股票、全球體育賠率分析之後才做，見[附錄](#附錄之後才做)。

## 2｜從零開始跑起來

目標：clone 下來之後，先讓資料程式抓 Polymarket 資料進資料庫，再打開網站，在 Live 模式看到真實行情。只想看畫面的話，跳到第 6 步，Demo 模式不需要資料庫有資料。

第 4～6 步含 `cd` 的指令區塊都從 repository 根目錄開始執行；不同終端機各自切到根目錄。

### 需要的環境

| 工具       | 要求                                                                                 |
| ---------- | ------------------------------------------------------------------------------------ |
| 作業系統   | Linux、macOS，或 Windows 的 WSL；已在 Ubuntu 24.04 驗證                              |
| PostgreSQL | **16**，連接埠 **5432**（程式會檢查主版本與連接埠）                                  |
| Python     | 3.12 以上，用 [uv](https://docs.astral.sh/uv/) 管理                                  |
| Node.js    | 20 以上（已用 22、24 驗證），含 npm                                                  |
| 網路       | 要連得到 `gamma-api.polymarket.com`、`clob.polymarket.com`、`data-api.polymarket.com`；所在地區連不到時先開 VPN |

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

### 2. 環境檔 `.env`

根目錄的 `.env` 是資料程式與網站共用的唯一一份設定，已經放在 repo 裡：

```dotenv
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=lac_data
DB_USER=admin
DB_PASSWORD=admin
OUTBOUND_IPS=[]
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
cd python
uv sync --locked
uv run --env-file ../.env python -m m_live.all_setup
uv run --env-file ../.env python -m m_historical.all_setup
```

看到這兩行就成功：

```text
SETUP_OK m_live tables=6
SETUP_OK m_historical tables=1
```

setup 可以重跑：缺的表會補上，已經存在的表會檢查欄位，不一致就報錯（不會自動遷移）。

### 5. 啟動資料程式（終端機一）

```bash
cd python
uv run --env-file ../.env python -m m_live.all_runtime
```

- 會開五個進程：`recent` 每 60 秒掃新市場與關閉、追蹤結算；`full` 每 600 秒全掃；`demand` 每 60 秒發布需求；`clob` 抓到期報價、`book` 抓到期掛單簿。後兩者有 pending 就立即續跑，完成後休息 0.5 秒；預設掛單簿間隔 300 秒。
- 空資料庫第一次：市場與需求資料發布後 clob、book 才有標的；第一批價格與掛單簿在各自下一輪開始取得。recent 的三條掃描各自最多 20 頁，空表回看 1 小時；達上限會發布已取得資料並記 warning。
- 輸出是一行一個 JSON。`round_finished` 的 `result` 是 `complete` 才算成功。
- 只跑一輪就結束：加 `--once`。只跑其中一個：加 `--unit recent`、`--unit full`、`--unit demand` 、`--unit clob` 或 `--unit book`。
- 停止：`Ctrl+C`，會等目前的工作做完再結束。

排程與 HTTP 設定在各模組的 `all_runtime.py`，每個 `h_process` 呼叫對應一個 runtime。`period_s` 從每輪開始起算；`rest_s`／`rest_ms` 從每輪結束起算，三者只能選一個。`not_updated` 在這兩種模式依宣告的週期／休息時間等待；`pending` 立即續跑。一般失敗等待依序為基準的 1、2、4、8 倍，成功後恢復；401／403 只暫停該 runtime 到重啟，期間持續記錯誤。

四個對外請求 runtime 都使用主機預設出口加上 `OUTBOUND_IPS` 的額外 IP（JSON array）；空陣列只有預設出口。不宣告 `ips` 或設成 `default` 也只有預設出口。額外 IP 必須存在於本機網卡，否則服務啟動失敗；額外 IP 的請求會綁定來源位址。每個 IP 的 clob 最多 16 個在途請求，book、recent、full 各最多 4 個，額度按 endpoint 分開；所有槽位忙或額度用完就等待。429 只冷卻該 IP 的該 endpoint，全部出口都被擋才回報 runtime 限流；優先依 `Retry-After`，沒有時等待 60 秒。每個請求逾時 30 秒、最多重試 2 次、回應上限 64 MiB，所有數值都列在入口。執行入口只排程與讀寫業務資料，資料表請先用上面的 setup 指令建立。

**歷史價格（另一個資料終端機）。** `runtime_history` 常駐補最近 7 個完整 UTC 日，且不早於入口的 `first_day=2026-10-23`。每市場每天保存第一個結果的分鐘價格；昨天在 00:10 UTC 後才抓，最舊的天優先。Normal 只處理沒有列的 pending；成功、空日與 error 都不會自動重抓，範圍外既有列永久保留。

```bash
cd python
uv run --env-file ../.env python -m m_historical.all_runtime
```

可加 `--once` 執行至目前待處理工作完成後結束；仍有 pending 時會立即續輪。每輪最多 10,000 個市場日，沒有待抓工作時休息 60 秒；中斷後直接重啟，依資料庫重新挑未抓的市場日。SIGTERM／Ctrl+C 會完成當輪再退出。

歷史與 m_live 共用主機預設出口及 `OUTBOUND_IPS`，每 IP 在途 16，Data API `/v2/prices-history` 每 10 秒最多 200 次。每輪重用一條 autocommit 連線，HTTP 與寫入分開，待寫入最多 8 批（含正在寫的一批）。請求在共用層重試用完後仍失敗，或回應不合法，就寫入 error；401／403 與限流沿用共用排程規則，pending 不寫 error。

**歷史錯誤維護。** 由操作人員先停止 Normal，再執行 `uv run --env-file ../.env python -m m_historical.all_runtime --errors-only`。模式啟動時用 PostgreSQL `WITH HOLD` cursor 凍結目前日期及市場範圍的 error identity，以每批最多 10,000 筆讀取；沒有跨 HTTP 的 transaction，也不建立工作表。每筆只處理一次，沿用 Normal 的取得、解析與寫入流程；成功覆寫為 success／no_data，失敗保留 error 並將累計失敗次數加 1。遇到 401／403／限流時，本次維護以非零碼結束，未完成的 error 保持原狀。兩種模式的入口全程持有同一個 advisory lock，重疊啟動會拒絕；完成維護後由操作人員啟動 Normal。

**WSL 背景歷史服務。** 服務設定在 [m_historical/deploy](python/m_historical/deploy/)，使用 `/home/admin/web/python` 與根目錄 `.env`。以 `systemctl --user enable --now lac_data-m-historical.service` 啟用，`loginctl enable-linger admin` 讓 user manager 在無登入時也能執行。服務不自動重啟；`systemctl --user stop` 等當輪完成後退出。關閉終端機後會繼續跑，但 Windows／WSL 必須維持運行，VPN 必須可用；enable 會在 WSL 啟動時帶起服務，不會自行啟動 Windows 或 WSL。

歷史服務常用指令（在 WSL；更新程式需先停止，更新與 setup 成功後再啟動）：

```bash
systemctl --user status lac_data-m-historical.service
journalctl --user -u lac_data-m-historical.service -f --all
systemctl --user stop lac_data-m-historical.service
systemctl --user start lac_data-m-historical.service
systemctl --user restart lac_data-m-historical.service
```


### 6. 啟動網站（終端機二）

```bash
cd typescript/web_page_demo
npm ci
npm run dev
```

打開 <http://127.0.0.1:5173/prediction>。左上角 Logo 旁邊切換 **Demo／Live**：

- **Demo**：內建的範例資料，不需要資料庫有資料，也不需要資料程式在跑。
- **Live**：可用，由範例網站伺服器唯讀本機 `lac_data` 的正式市場表；議題、報價、走勢圖與體育比分顯示資料庫已有的資料。資料服務停用時仍可讀取，但內容不會更新；不需要為了查看既有資料啟動資料服務或 VPN。

其他指令：`npm run build:static` 會產生單一檔案 `typescript/web_page_demo/dist-static/index.html`，不用伺服器就能打開，適合傳給別人看（只有 Demo）。

### 7. 確認有資料

```bash
psql "postgresql://admin:admin@127.0.0.1:5432/lac_data" -c \
  "SELECT (SELECT count(*) FROM m_live.m01_event) AS events,
          (SELECT count(*) FROM m_live.m02_clob_price) AS prices,
          (SELECT count(*) FROM m_live.m03_clob_book) AS books,
          (SELECT count(*) FROM m_historical.m01_price_day) AS history_days,
          (SELECT count(*) FROM m_historical.m01_price_day WHERE status = 'no_data') AS history_empty_days,
          (SELECT count(*) FROM m_historical.m01_price_day WHERE status = 'error') AS history_error_days;"
```

這些數字確認表內已有發布資料；歷史缺列代表尚未成功抓取，有列但 prices 為 null 代表該日沒有可存的分鐘點。數量不代表涵蓋完整或報價新鮮度，請同時查看 requested_at、來源時間與執行紀錄。前端 Live 接線狀態見上方。

## 3｜專案結構

```mermaid
flowchart LR
    G["Polymarket Gamma API"] --> M["m_live：議題、市場、結果"]
    C["Polymarket CLOB API"] --> Q["m_live：最新報價"]
    C --> B["m_live.m03_book：整本掛單簿"]
    H["Polymarket 歷史 API"] --> P["m_historical：分鐘價格"]
    M --> V["範例網站伺服器（唯讀）"]
    Q --> V
    P --> V
    V --> L["Live 畫面"]
    D["內建範例資料"] --> R["Demo 畫面"]
    E["各產品 m_ev 的 Public Table"] --> S["m_product：收集產品資料（還沒實作）"]
    X["體育全球賠率、股票分析（格式未定）"] --> S
    S --> T["m_product 資料表（還沒實作）"]
    M --> A["m_api：對外 HTTP（還沒實作）"]
    Q --> A
    B --> A
    P --> A
    T --> A
    A --> U["A 組：網站與 app"]
```

```text
.
├── README.md                  # 本文件
├── AGENTS.md                  # AI 協作入口
├── .env                       # 資料程式與網站共用的設定
├── .gitignore                 # 忽略依賴、快取與建置輸出
├── python/
│   ├── h_shared/              # 共用：資料庫連線、排程、HTTP 重試與限流
│   ├── m_live/                # 議題、市場、結果、最新報價與掛單簿
│   │   ├── all_setup.py       # 建表
│   │   ├── all_runtime.py     # 常駐執行
│   │   ├── sql/               # 資料表定義
│   │   └── src/
│   │       ├── m01_market/
│   │       │   ├── runtime_gamma_recent.py  # 新市場、關閉、未定案追蹤
│   │       │   ├── runtime_gamma_full.py    # 完整議題掃描
│   │       │   └── runtime_demand.py        # 合併產品需求
│   │       ├── m02_price/runtime_clob.py    # 依需求到期時間抓最佳買賣價
│   │       └── m03_book/runtime_book.py     # 抓第一結果的整本掛單簿
│   └── m_historical/          # 歷史分鐘價格（UTC 日陣列、常駐）
└── typescript/
    └── web_page_demo/
        ├── server/live.ts     # 網站伺服器的唯讀資料庫查詢（/api/live/*）
        ├── src/               # 前台、後台、共用元件、範例資料、中英文文案
        ├── tests/             # 資料對應與商業規則測試
        └── README.md          # 前端開發導覽
```

命名規則：`m_<模組>/` 是一個模組，裡面的 `mNN_<名稱>` 是步驟；`h_shared/` 是不含業務規則的共用工具；每個模組都有 `all_setup.py`（建表）與 `all_runtime.py`（執行）。

## 4｜資料表

- 資料程式從 Polymarket 公開 API 抓資料、清洗後寫進 PostgreSQL 資料庫 `lac_data`。這些表是 `m_api` 的資料來源；**A 組不直接連資料庫**，只透過 §6 的 HTTP 介面取得資料。`m_api` 回傳的 JSON 欄位與這裡同名、同義，不用再清洗。
- **更新頻率：** 新市場、近期關閉、未定案追蹤與需求每 60 秒；進行中議題全掃每 600 秒。報價依需求表的 10／60 秒或產品指定間隔挑選到期市場；容量不足時延後，不能把要求間隔當成新鮮度保證；整本掛單簿預設每 300 秒，產品要求深度時依需求間隔；歷史每分鐘一格、每日一列，常駐補最近 7 個完整 UTC 日。
- **Gamma 掃描：** 明列 v1、v2 與每次唯一的 query 參數（避開快取的實測做法，官方未承諾）。新市場分開掃開放／關閉，另掃 closedTime；各以下界最新資料時間減 120 秒重疊，該時間為空時從本輪開始前 1 小時掃起，每條最多 20 頁。達上限記 warning、發布已取得資料；已知但未在全掃內的開放市場與 closed 未定案者，每輪最多 1,000 個、每批 100 個輪替追蹤，輪替位置只留記憶體。議題標籤每批最多 100 個補查；體育議題缺少完整比賽欄位時共用這次查詢，只有已附完整標籤與市場清單、卻缺比賽欄位的體育議題才另外加入補查。體育比賽另有獨立的追蹤集合與記憶體游標，每輪最多 500 個議題，不佔一般市場追蹤的 1,000 個名額。條件是 sports 議題、ended 不是 true、底下至少一個已關閉市場；用最早的 closed_time 限定 24 小時內，無可用 closed_time 就不納入。每個議題只選 market_id 最小的已關閉市場，每批 100 個呼叫 /markets，直接讀附帶議題的比賽欄位，不查 /events、不更新 teams 或 sport。ended=true 或最早關閉已超過 24 小時就停止。參數 game_follow_hours=24 與 game_follow_max=500 在 all_runtime。
- **同時寫入：** 兩個 Gamma runtime 只接受不比既有 source_updated_at 舊的回應；市場與 outcomes 同一 transaction 發布。完整掃描只撤下未出現在掃描結果、且掃描開始前已存在的現況列，保留掃描期間 recent 發布的新增列。identity 與結算永久保留。
- **結算：** resolution_status 原樣存 v1 的 umaResolutionStatus 或 v2 的 resolutionStatus；只有 resolved 才寫各 outcome 的 resolved_price，包含 0.5／0.5。closed 或 1／0 價格本身不代表定案。resolved_seen_at 是 Web 首次看到 resolved 的時間，只寫一次；這是 Gamma 回報的結算，沒有宣稱鏈上付款已驗證。
- **體育比賽資料：** 以議題的 `sports` 標籤辨識，full 與 recent 都按 Polymarket 原值保存。比賽中的比分跟隨 600 秒全掃；比賽／市場關閉後由 recent 在上述追蹤窗口內補到來源回報的結束狀態，資料永久保留。比賽結束後 Polymarket 再改的 period（例如 End Q4 → VFT）與球隊戰績不再由這條補追更新；比分與 ended 以追到的那次為準，超過窗口仍缺 ended 時不能宣稱已取得最終比分。比分倒退也照存，不修正、不推論勝負；缺少或 JSON null 存 SQL null，文字空字串保留，缺省布林不當 false。非體育議題及其市場的體育欄位是 null。`ended` 缺省代表來源未提供，不宣稱已取得最終比分；不另存無可靠來源的原訂開賽時間。
- **Gamma IP 額度：** 每 IP 在途 4；recent 的 markets 300／10 秒、events 100／10 秒，full 的 events 400／10 秒；keyset 算在同名列表額度內。來源：[Polymarket Rate Limits](https://docs.polymarket.com/api-reference/rate-limits)。demand 沒有 HTTP 額度，也不能發出 HTTP。
- **層級：** 議題（event）→ 市場（market，畫面上的一個選項列）→ 結果（outcome，例如 Yes 與 No，各有自己的 `asset_id` 與價格）。
- **價格怎麼讀：**
  - 價格介於 0 到 1，畫面顯示成 ¢：0.86 就是 86¢，代表市場認為有 86% 的機率發生。結算時猜對的一邊每份拿回 1 美元。
  - Chance 用買賣價算出的中間價 `midpoint = (best_bid + best_ask) / 2`；任一邊是 null，中間價與 Chance 也是 null。倍數 = 1 ÷ `midpoint`，中間價缺少或為 0 時不顯示倍數。
  - 「Buy Yes」「Buy No」按鈕用各自結果的 `best_ask`（立即買入價）；`best_bid` 是立即賣出價。
  - 沒有人掛單時 `best_bid`／`best_ask` 是 null，畫面顯示「—」。
- **時間：** 全部是 UTC，畫面上再轉成使用者的時區。
- **議題網址：** `https://polymarket.com/event/{slug}`。
- **進行中：** 議題與市場都要 `in_current_scan AND active AND NOT closed AND NOT archived`。同一個議題底下可能有已關閉的市場，要逐一判斷。
- **歷史：** 只存來源 resolution_seconds=60 的點；陣列 null 格代表分鐘缺口，畫面斷線，不補點。只抓第一結果，第二結果以 1 減第一結果推導；結算資訊讀 m_live 的 m01。

完整定義在 [m_live/sql](python/m_live/sql/) 與 [m_historical/sql](python/m_historical/sql/)；網站的實際查詢在 [server/live.ts](typescript/web_page_demo/server/live.ts)。

**`m_live.m01_event`**：一列＝一個議題；主鍵 `event_id`。

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
| in_current_scan                | boolean      | 是否屬於目前掃描範圍（含 recent 新增）                   |
| m_live_updated_at                    | timestamptz  | 此筆現況資料發布的時間                       |
| game_id | text? | Gamma gameId；保留來源編號，不當成 event_id |
| game_start_at | timestamptz? | startTime，目前排定開賽時間；不是 start_at／end_at |
| game_date | date? | eventDate，比賽日期原值 |
| score、period、elapsed | text? | 比分、節次／階段、比賽時鐘；不解析或修正字串 |
| live、ended | boolean? | 來源回報的進行中／已結束；null 表示未提供 |
| game_finished_at | timestamptz? | finishedTimestamp，來源回報實際結束時間 |
| teams | jsonb? | 兩隊或球員的資料陣列，保留原順序；不假定左邊是主隊 |
| sport | jsonb? | 聯盟／運動資料物件原值 |

**`m_live.m01_market`**：一列＝一個市場（畫面上的一個選項列）；主鍵 `market_id`。

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
| created_at                                      | timestamptz? | Gamma 市場 createdAt |
| closed_time                                     | timestamptz? | Gamma closedTime 的原時間，轉存 UTC；不是鏈上付款時間 |
| resolution_status                               | text? | 依版本選取的原始結算狀態；缺值就是 null |
| resolved_seen_at                                | timestamptz? | Web 第一次看到 resolved；之後不改 |
| sports_market_type | text? | sportsMarketType，勝負／讓分／大小分等來源盤型 |
| line | numeric? | 來源盤口線；允許負值，不四捨五入 |
| uma_resolution_statuses | jsonb? | umaResolutionStatuses 的 JSON 字串解析成陣列；原順序保留，空陣列與 null 不同；不是完整爭議事件時間線 |
| source_updated_at、in_current_scan、m_live_updated_at |              | 同議題表                                                   |

**`m_live.m01_outcome`**：一列＝一個結果；主鍵 `market_id`＋`outcome_index`。

| 欄位          | 型別    | 意思                                    |
| ------------- | ------- | --------------------------------------- |
| market_id     | text    | 所屬市場                                |
| outcome_index | integer | 結果順序；不一定 0 就是 Yes，請看 label |
| label         | text    | 結果名稱：Yes、No、Up、Down 等          |
| token_id      | text?   | v1 市場的 token 編號                    |
| position_id   | text?   | v2 市場的 position 編號                 |
| asset_id      | text?   | 查價格、下單用的編號（唯一）            |
| resolved_price | numeric? | 0～1；只有市場 resolution_status=resolved 時有值，依 outcomePrices 同索引；其他狀態為 null |

**`m_live.m01_demand_market`**：一列＝一個進行中的市場；主鍵與外鍵都是 `market_id`，參照 `m01_market`。

| 欄位 | 型別 | 意思 |
| --- | --- | --- |
| market_id | text | 市場編號 |
| refresh_seconds | integer | 大於 0；要求的更新間隔（秒） |
| book_levels | integer? | 0＝最佳買賣價；正整數＝每邊檔數；null＝整本 |

產品清單在 `all_runtime.py`，目前為空。配置產品時，使用 `<PRODUCT>_DB_*` 唯讀該產品的 `m_live.m01_polymarket_demand`（condition_id、refresh_seconds、book_levels）；有要求時只在產品要求中取最短間隔、最大檔數（null 最大）。沒有要求時，議題 tags 含 slug=sports 用 60 秒，其他 10 秒，book_levels=0。某產品讀不到會記錯誤、其他產品照算；本輪需求以一個 transaction 替換，不在進行中範圍的市場移除。需求表是排程輸入，不代表已達到該新鮮度。

**`m_live.m02_clob_price`**：一列＝一個市場第一個結果的最新最佳買賣價；主鍵 `market_id`，參照 `m01_market`。

| 欄位 | 型別 | 意思 |
| --- | --- | --- |
| market_id | text | 市場編號、主鍵與外鍵 |
| asset_id | text | outcome_index=0 的第一個結果之 asset |
| best_bid、best_ask | numeric? | 第一個結果的最佳買價／賣價；沒有掛單的那一邊是 null |
| requested_at | timestamptz | 該批請求送出前的時間，作為可得時間與到期計算基準 |
| m_live_updated_at | timestamptz | 該列寫入時間 |

只抓需求表中恰好兩個結果、兩個結果都有 asset 的市場。第二個結果的 `best_bid = 1 - 第一個 best_ask`、`best_ask = 1 - 第一個 best_bid`；被減的值是 null，對應結果也維持 null。中間價不存表，由讀取端以 `(best_bid + best_ask) / 2` 計算，缺任一邊時為 null。

`runtime_clob` 每輪優先選沒有價格列的市場，其次按 `requested_at + refresh_seconds` 最早到期排序，market_id 打破同時間的平手；最多 50,000 個。一個 `POST /prices` 請求包含 250 個市場第一個結果的 BUY／SELL，實測 BUY 對應 bid、SELL 對應 ask；API 的 bid=0、ask=1 空邊界值記為 null。每批回應立即發布，發布前重讀需求與第一結果 identity，較舊的請求不覆寫較新的列。不在需求表的市場刪除價格列；仍在需求表的舊價格保留原 requested_at，由讀取端判斷能否使用。

所有請求經 IP 池，每 IP 在途 16、`/prices` 500 次／10 秒；還有到期的市場就回報 pending 立即再跑，完成後休息 0.5 秒。

**`m_live.m03_clob_book`**：一列＝一個市場第一個結果的最新整本掛單簿；主鍵 `market_id`，參照 `m01_market`。

| 欄位 | 型別 | 意思 |
| --- | --- | --- |
| market_id | text | 市場編號、主鍵與外鍵 |
| asset_id | text | outcome_index=0 的第一個結果之 asset |
| bids、asks | jsonb? | 每檔為兩個 JSON 數字 `[價格, 數量]`；買單價格由高至低、賣單由低至高；價格 0～1、數量 >0 |
| source_timestamp | timestamptz? | Polymarket timestamp（epoch 毫秒）轉為 UTC，保留來源時間 |
| source_hash | text? | Polymarket 原始 hash；不作內部比對或防重複 |
| tick_size、min_order_size | numeric? | 來源價格最小跳動與最小下單量，保留精確數值；來源最小下單量可以是 0，各檔掛單數量仍須大於 0 |
| requested_at | timestamptz | 該批送出請求前的時間，到期計算基準 |
| m_live_updated_at | timestamptz | 該列寫入時間 |

只抓需求表中恰好兩個結果、都有 asset 的市場，保留全部價層。合法空邊為 `[]`；provider 沒回 token 時 bids、asks 與來源 metadata 都是 SQL null，與空簿區分。錯誤的價層、重複 requested token 或不合法 metadata 使該批失敗，不發布可疑資料；未要求的 token 忽略。第二個結果的買單可用第一個的賣單價格做 `1 - price`、數量相同推導，賣單同理；這是鏡像推導，非第二本獨立 snapshot（實測完整深度有少數差異）。價格表仍由 `/prices` 獨立更新。

`runtime_book` 優先選沒有列的市場，其次按到期時間、market_id 排序。`book_levels=0` 用入口的 `book_seconds=300` 秒；`book_levels>0` 或 null 用需求表 `refresh_seconds`，但都抓整本。每輪最多 50,000 市場、每個 `POST /books` 最多 500 個 token；每 IP 在途 4、500 次／10 秒。每輪重用一條寫入連線，HTTP 與寫入分開，待寫入最多 8 批（含正在寫的一批），額外抓取受 IP 池在途上限約束。

每批寫入重新確認需求及第一結果 identity，舊 requested_at 不蓋新列；每輪先刪除需求外的掛單簿。還有到期市場回 pending，完成後休息 0.5 秒。requested_at 與來源 timestamp 不相互替代；資料可用性與新鮮度由讀取端判斷。

**`m_historical.m01_price_day`**：一列＝一個市場一個 UTC 日；主鍵 `(market_id, day)`。market_id 外鍵參照 m_live.m01_market。只存第一個結果，永久保留。

| 欄位 | 型別 | 意思 |
| --- | --- | --- |
| market_id | text | 市場編號 |
| asset_id | text | 第一個結果的 asset |
| day | date | UTC 日期 |
| prices | numeric[]? | 恰好 1,440 格，第 1 格是 00:00；缺分鐘為 null，無可存分鐘時整欄 null |
| status | text | success（有分鐘點）、no_data（沒有可存分鐘點）、error；沒列是 pending |
| error_reason | text? | 最新失敗原因；只在 error 有值 |
| error_http_status | integer? | 最新失敗的 provider HTTP 狀態碼，沒有收到則 null；非法 HTTP 200 回應記 200 |
| error_count | integer | 累計失敗的取得次數；單次取得內的 HTTP 重試不另加，成功後保留累計 |
| requested_at | timestamptz | 送出請求前的 UTC 時間 |
| m_historical_updated_at | timestamptz | 實際發布時間 |

選取條件：created_at 早於該日結束，且尚未關閉或 closed_time 晚於該日開始；已關閉但 closed_time 不明的不抓。只處理恰好兩個結果且都有 asset 的市場。範圍是今天往前 7 個完整 UTC 日與 `day >= first_day` 的交集；00:10 前略過昨天，不把最舊日延伸成第 8 天。排序為 day、market_id；Normal 不選已有列，errors-only 只選啟動時範圍內的 error。

每市場日一個公開 GET /v2/prices-history：token_id、start、end、bucket_seconds=60、limit=10000；若需要翻頁則視為該市場日回應不合法。只保留當日半開區間 [00:00, 隔日 00:00) 的 resolution_seconds=60 點，排除 resolution_seconds=0 尾點，同分鐘取 timestamp 較新的點。

Normal 插入使用 `ON CONFLICT (market_id, day) DO NOTHING`。只有 success 的 prices 有值；no_data 與 error 都是整欄 null，必須由 status 區分。error 的 requested_at 是該次取得開始時間，m_historical_updated_at 是寫入時間。errors-only 只可覆寫仍為 error 的列；success 與 no_data 不覆寫。資料有列不代表 1,440 分鐘都有觀測；API 本身可能稀疏。每個結果一天最多 1,440 個可存分鐘，沒有補值、插值或尾點替換。


**Live 畫面目前的讀法（範例網站）：**

- 議題、市場、結果讀 `m_live.m01_event`、`m01_market`、`m01_outcome`；議題與市場都必須 `in_current_scan AND active AND NOT closed AND NOT archived`，現況發布時間使用 `m_live_updated_at`。
- Trending：進行中議題依 24 小時成交量取前 100 個，每頁 50 個；大型議題的市場也每頁 50 個，兩者都用穩定排序與游標翻頁。分類與搜尋維持相同規則。
- 分類：Trending、Politics、Sports、Finance、Crypto、Esports、Geopolitics、Weather；後面七個各對應同名的 Polymarket 標籤 slug。
- 價格依 `market_id` 讀 `m02_clob_price` 的第一結果。第二結果買價＝1−第一結果賣價，賣價＝1−第一結果買價；中間價＝（買價＋賣價）÷2。SQL 以 numeric 計算，任何來源空值都保留空值，沒有價格列時兩個結果都顯示「—」；價格時間為 `requested_at`。
- 走勢圖依市場讀 `m_historical.m01_price_day` 的 success 日陣列，第 1 格為 00:00 UTC，每格一分鐘；只讀完整 UTC 日。null、no_data、error 與未抓取日期都是缺口，不補點、不連線。Yes 按 label 對到 outcome_index；第二結果以 1 減第一結果推導，不把最新報價接上歷史線。
- 1H／6H／1D／1W／1M／All 的終點是所選市場最後有資料的一分鐘；一次最多 50 個市場，每條線最多 1,440 點。超過一天在伺服器分成等寬時間桶，每桶取最後一個非 null 值，全空桶保留缺口；圖下標示選取資料區間的 UTC 起訖。
- 體育議題的 teams 剛好兩隊才顯示比賽版型，依陣列順序顯示 name 與大寫 abbreviation，不標主客、不推論勝負。score 整串原樣顯示；live=true 顯示 LIVE、period 與 elapsed，否則 ended=true 顯示已結束，其餘顯示 game_start_at 的開賽時間。
- 雙方機率只在整個議題有且僅有一個進行中的 moneyline 市場、它的兩個結果 label 各自對到一隊時顯示：一隊的 name 或 alias 等於 label 就算對到，每隊要剛好對到一個結果，兩隊對到不同的結果；用各自中間價並按隊伍順序對應。大學美式足球的 label 是 alias（例如隊名 `Ragin' Cajuns`、alias `Louisiana`，moneyline 的 label 是 `Louisiana`）。對不到時卡片顯示一般議題的前三個選項。這項判斷獨立於市場分頁。
- 隱藏低流動性：隱藏 liquidity 小於 25,000 或未知的市場；被選中的訊號那一列一定保留。
- Sports 頁只讀 `m01_event`、`m01_market`、`m01_outcome`、`m02_clob_price`：
  - 賽事：議題 `in_current_scan AND active AND NOT closed AND NOT archived`，而且 `teams` 剛好兩隊。聯賽是議題 `sport` 的 `sport`（代碼）與 `name`；沒有的歸「其他」。運動由頁面程式的固定對照表決定（§5）。
  - 排序：`live=true` 第一組、`ended=true` 最後一組、其他在中間；同一組照 `game_start_at`（null 排最後），再照 `event_id`。每頁 50 場，用（組別、開賽時間、event_id）游標翻頁。搜尋比對標題與兩隊的 name，搜尋時不限聯賽。
  - 市場：議題底下進行中的市場（同上條件）。列表只讀 `sports_market_type` 是 moneyline、spreads、totals 的；詳情讀全部。
  - 買進價在 SQL 用 numeric 算：第一個結果是 `best_ask`，第二個結果是 `1 − best_bid`；沒有價格列或那一邊是 null，買進價就是 null，畫面顯示「—」。賠率由瀏覽器換算（§5）。
  - 讓分、大小分的主線：liquidity 最大的那條，一樣大照 `sort_order`、再照 `market_id`；liquidity 是 null 的排最後。
  - 端點：`/api/live/sports/leagues`（聯賽與場數）、`/api/live/sports/events?league=&q=&cursor=`（列表；`league` 可以重複，沒有聯賽的議題用空字串）、`/api/live/sports/event?id=`（詳情）。
- 表不存在或查詢失敗時顯示錯誤。Live 的 Signal 資料尚未提供，交易終端只有 Demo；掛單簿畫面與 m_api 不屬於此範例讀取範圍。

## 5｜畫面

Chance 顯示最佳買賣價平均值的百分比，由 `m_api` 計算 `midpoint = (best_bid + best_ask) / 2`；任一邊沒有掛單時顯示「—」。

範例網站就是畫面規格：`npm run dev` 打開後每一頁都可以點。參考網站：[polym.trade](https://polym.trade/)。

```txt
┌──────────┬────────────────────┬────────────────────┬──────────┬──────────┐
│ 左左      │ 左中                │ 右中                │ 右右      │ 交易終端  │
│ 選單      │ 議題列表            │ 議題詳情            │ 訊號欄    │ 客戶帳戶  │
│ 可摺疊    │                    │                    │ 可摺疊    │ 可摺疊    │
└──────────┴────────────────────┴────────────────────┴──────────┴──────────┘
```

| 欄                 | 內容                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 左左（可摺疊）     | 上方入口，一行一項：Prediction、Signal、Sports、Buy USDT、Stocks、Products、Referral rewards。中間是目前入口的分類，每項顯示議題數（Sports 是運動 → 聯賽與場數）。最下方是 Settings、登入、語言切換（EN／繁中） |
| 左中               | 議題卡片列表。上方是麵包屑、篩選、搜尋。每張卡片：圖示與標題、結束時間、前三個選項的價格（¢）與倍數（×）；比賽類顯示比分與雙方機率                                                                |
| 右中               | 議題詳情：標題、標籤、開始與結束時間、24 小時與總成交量；走勢圖（1H／6H／1D／1W／1M／All，每個選項一條線）；Markets 選項表，每列顯示 Chance 與 Yes／No 買入按鈕，可隱藏低流動性市場               |
| 右右（可摺疊）     | 只在 Signal 出現。分類分頁（只顯示客戶有權益的）、排序（Latest／EV／ROI／Depth／Expiry）。每張卡片：分類 · 標的、選項、YES／NO、EV、Entry、Fair（差距 %）、Avg. Cost（depth）、更新時間、剩餘時間 |
| 交易終端（可摺疊） | 只在 Signal 出現，在右右的右邊。客戶的錢包、帳戶摘要，以及持倉／訂單／交易三個分頁，見下面「交易終端」                                                                                            |

**交易終端（Signal 最右邊一欄）：** 參考 MT5 手機 app 的「交易」與「歷史」頁。範例只有 Demo 假資料（[src/data/terminal.ts](typescript/web_page_demo/src/data/terminal.ts)），Live 的 Signal 沒有這一欄；正式版接上客人真的錢包，LAC 只請錢包簽名，不拿私鑰。

- **位置：** Signal 頁右右的右邊，跟訊號欄一樣可以摺疊；螢幕寬度低於 1600px 變成抽屜，從上方列的「終端」按鈕打開。Prediction 與 Sports 沒有這一欄。
- **錢包列：** 已連線錢包的縮短地址（例如 `0x12ab…89cd`）、「Demo」標籤、鎖住的「中斷連線」。
- **帳戶摘要**（一行一項，名稱靠左、數字靠右，中間點線）：結餘＝錢包裡的 USDC；淨值＝結餘＋全部持倉現值；可用＝結餘－掛著的買單佔用（每張買單：掛單價 × 還沒成交的份數；賣單不佔用現金）；未實現損益＝全部持倉損益加總，賺綠賠紅。金額到小數點後 2 位。
- **持倉：** 議題標題與選項、Yes／No（照結果的 label，例如 Up、Celtics）、份數、平均成本、現價、現值、損益（金額與百分比，賺綠賠紅）。現值＝份數 × 現價；損益＝現值－份數 × 平均成本；損益百分比＝損益 ÷（份數 × 平均成本）。現價是那個結果現在的 Yes／No 價格；已經結算的部位用結算價（贏 100¢、輸 0¢），贏的標「可贖回」。點一列 → 左中、右中跳到那個議題，對應的 Yes 或 No 按鈕變黃，跟點訊號一樣。
- **訂單：** 議題與選項、買或賣、Yes／No、掛單價、份數、已成交份數、掛單時間。
- **交易：** 由新到舊；時間、類型（買入、賣出、贖回、入金、出金）、議題與選項、Yes／No、價格、份數、金額（入帳綠、出帳紅）。
- **沒有資料：** 中間一個空盒圖示加一行字（沒有持倉、沒有掛單、還沒有交易紀錄）。
- **鎖住的按鈕：** 中斷連線、平倉、TP／SL（付費服務）、贖回（只在可贖回的持倉）、取消掛單。看得到、按不了，滑過去或點了顯示「之後開放」。平倉是一筆帶 builder code 的下單（§7.5）。
- 價格用 ¢，跟其他畫面一樣。

**入口：**

- **Prediction：** Polymarket 全部議題，沒有訊號欄。
- **Signal：** LAC 有在算的議題。分類最上面是 Trending（現在有訊號的議題），下面是 Weather、Crypto、Forex、Future、Sport；客戶沒有權益、或那一類現在沒有訊號，就不顯示。中間兩欄跟 Prediction 完全一樣，多了右右的訊號欄；最右邊有交易終端。
- **Sports：** Polymarket 的體育賽事與賠率，照運動 → 聯賽分類，見下面「Sports 頁」。不放訊號、不算 EV，沒有訊號欄與交易終端。
- **Buy USDT：** 一行，黑色粗體。點開是合作網站清單（名稱、付款方式、手續費、最低金額、支援的鏈、外連按鈕），規則見 §7.6。
- **Stocks：** 先留位置，不啟動。
- **Products：** 方案卡片與月／季／年切換，每張訊號方案顯示「包含：…」（來自目前上架的版本，§7.1）；底部有兌換碼。
- **Referral rewards：** 推薦連結與代碼、可提領餘額與「提領」按鈕、統計、My agents（可改直屬代理的比例）、每 100 元怎麼分的示意條、Referred traders、提領紀錄。
- **Settings：** 個人資料、推薦碼（不限次數修改，只能英數字，最多 16 字）、Polymarket 交易（連接錢包 → 啟用交易，§7.5）、綁定 Telegram、語言與主題、法律聲明；最下面有後台入口（只在 Demo）。

**互動：**

- 左左選分類 → 左中列出議題 → 點議題 → 右中顯示詳情。
- 在 Signal 點右右的一張訊號 → 左中跳到那個議題，右中捲到那個選項，**對應的 Yes 或 No 按鈕變黃底黃框**，那一列淡黃底。訊號靠 Polymarket 編號對到市場（§6）。點交易終端的一個持倉也一樣。
- Sports：左左選運動或聯賽 → 左中列出賽事 → 點一場 → 右中顯示這場全部的市場。

**Sports 頁：**

- **賽事：** 進行中（議題與市場都 `in_current_scan AND active AND NOT closed AND NOT archived`），而且 `teams` 剛好兩隊的議題。Polymarket 把同一場比賽的部分盤口放在另一個議題（例如標題後面是 ` - More Markets`、` - Total Corners`），這些也各自是一列。
- **運動與聯賽：** 聯賽是議題的 `sport`（例如 `{"sport":"nhl","name":"NHL"}`）。Polymarket 沒有「運動」這一層，由頁面程式的固定對照表（[src/lib/sports.ts](typescript/web_page_demo/src/lib/sports.ts) 的 `SPORT_LEAGUES`）把聯賽代碼對到運動；表裡沒有的聯賽、或議題沒有 `sport`，放「其他」。左左最上面是「全部運動」，點一個運動會在它下面列出聯賽與場數。對照表照 2026-10-25 本機 `lac_data` 進行中兩隊議題的 230 個聯賽代碼建立：

| 運動 | 聯賽代碼（`sport.sport`） |
| --- | --- |
| 足球（`soccer`） | `acle` `arg` `argcopa` `argpn` `atc` `auc` `aus` `aut` `aze1` `aze2` `bel1` `bel2` `bl2` `bl3` `blr1` `bol1` `bra` `bra2` `bra3` `brco` `bul` `bun` `canpl` `cdr` `chi` `chi1` `chi2` `chl2` `clf` `col` `col1` `col2` `conl` `cze1` `den` `dfb` `ecu1` `efa` `efl` `egy1` `el1` `el2` `elc` `enl` `epl` `ere` `es2` `es3` `est1` `fif` `fin1` `fl1` `fpd` `fr2` `grc` `gre1` `gtm` `hr1` `hun` `idn1` `idn2` `irl1` `isl1` `isp` `isr` `itc` `itsb` `ja2` `ja3` `jap` `kaz1` `kor` `kor2` `lal` `lec` `ltu1` `lva1` `mar1` `mex` `mex2` `mls` `ned2` `nirl1` `nlc` `nls` `nor` `nor2` `nwsl` `par1` `per1` `pol` `por` `pt2` `ptc` `rou1` `rus` `sclc` `scoc` `scop` `sea` `serc` `skc` `slo` `spl` `srb` `sud` `sui` `svk1` `swe` `swe2` `tha1` `trsk` `tur` `tur2` `u20wwc` `uae1` `ucl` `uel` `ukr1` `unl` `uru1` `usl1` `uslc` `usoc` `uwcl` `uwec` `uzb1` `ven1` `wsl` `wsl2` |
| 籃球（`basketball`） | `nba` `wnba` `euroleague` `bkaba` `bkarg` `bkbbl` `bkbsl` `bkcba` `bkcl` `bkeurocup` `bkfibaqam` `bkfr1` `bkgr1` `bkisrsl` `bkjpn` `bkkbl` `bkkls` `bkligend` `bklkl` `bknbb` `bknbl` `bkplk` `bkseriea` `bkvtb` |
| 冰球（`hockey`） | `nhl` `ahl` `khl` `shl` `liiga` `dehl` `cehl` `snhl` |
| 美式足球（`football`） | `nfl` `cfb` |
| 棒球（`baseball`） | `mlb` `kbo` `npb` `cpbl` `lmb` |
| 網球（`tennis`） | `atp` `atp-doubles` `wta` `wta-doubles` `itf` |
| 桌球（`tableTennis`） | `wtt` `setkameua` `setkamecz` `setkamemd` `setkawoua` |
| 電競（`esports`） | `cs2` `dota2` `lol` `val` `ow` `sc2` `r6siege` `hok` `mlbb` |
| 板球（`cricket`） | `crint` `cricranji` `cricmukono` `criccsat20w` `cricpsl` `cricshield` `cricjcl` `cricjclt10` `crickerala` `criccoppat10` `criclcl` `cricecsbg` `crictbcl` |
| 橄欖球（`rugby`） | `rutopft` `ruurc` `ruprem` `rlsuper` |
| 綜合格鬥（`mma`） | `ufc` |
| 拳擊（`boxing`） | `boxing` `zuffa` |
| 排球（`volleyball`） | `vbefeler` `vbligueaw` `vbligueb` `vbliguea` `vbbelligaa` `vbdivisao1` `vbsuperlega` `vbbundesliga` `vbplusliga` `vbsuperliga` |
| 手球（`handball`） | `hbbundesliga` `hbasobal` `hbhandbold` `hblnh` `hbehfcl` `hbnbi` |
| 袋棍球（`lacrosse`） | `pll` `wll` |
| 飛鏢（`darts`） | `pdcdarts` `modus` |
| 澳式足球（`aussieRules`） | `aflw` |
| 匹克球（`pickleball`） | `ppa-doubles` |
| 其他（`other`） | 上面沒有的聯賽代碼，以及沒有 `sport` 的議題 |

- **賽事列表（左中）：** 每場一列：開賽時間（UTC）與聯賽、兩隊（照 `teams` 原順序，縮寫大寫加名稱，不標主客；下面小字是議題標題）、比分或狀態（`live=true` 顯示 LIVE、`period` 與 `elapsed`；`ended=true` 顯示已結束；其他顯示開賽時間；進行中與已結束的再顯示 `score` 原文），以及三種盤各一欄：
  - **勝負**（`sports_market_type='moneyline'`）：只有一個市場時列出它的兩個結果；有好幾個 Yes／No 市場（足球的主勝、和局、客勝）時，每個市場一行，用它的選項名稱與 Yes 的賠率。
  - **讓分**（`spreads`）、**大小分**（`totals`）：好幾條線時只放主線：流動性最大的那條，一樣大照 `sort_order`。顯示選項名稱與兩個結果的賠率。
  - 沒有的盤顯示「—」。
  - 排序：進行中在前，再來還沒開始的照開賽時間（沒有開賽時間的排最後），已結束的最後。上面的搜尋比對隊名與標題，搜尋時不限運動與聯賽。Live 每頁 50 場。
- **賽事詳情（右中）：** 聯賽、標題、開賽時間與市場數、兩隊與比分或狀態；這場全部進行中的市場照勝負、讓分、大小分、其他分組，組內照 `sort_order`。每條線顯示 Polymarket 原本的選項名稱（`group_title`，沒有就用 `question`），兩個結果的 label 與賠率，旁邊小字標買進價（¢）。讓分、大小分的線照 Polymarket 原樣顯示，不推算哪一隊讓幾分。
- **賠率：** 用每個結果的買進價換算。第一個結果的買進價是 `best_ask`；第二個結果是 `1 − 第一個結果的 best_bid`（§4）。右上角切換歐洲盤／美國盤，預設歐洲盤。買進價是 null 顯示「—」。
  - 歐洲盤 = 1 ÷ 買進價，到小數點後 2 位。
  - 美國盤：買進價大於 0.5 是 −(價格 ÷ (1 − 價格)) × 100；小於 0.5 是 +((1 − 價格) ÷ 價格) × 100；等於 0.5 是 +100；四捨五入到整數。
  - 例：62¢ → 1.61／−163；38¢ → 2.63／+163；50¢ → 2.00／+100。
- **Demo：** [src/data/sports.ts](typescript/web_page_demo/src/data/sports.ts) 的假資料（6 個聯賽、12 場，含進行中、還沒開始、已結束，有的場沒有讓分或大小分）。**Live：** 唯讀本機 `lac_data`，讀法見 §4。

**語言：** 繁體中文與英文都要，左下角或 Settings 切換。Polymarket 的內容（議題標題、選項名稱、標籤）維持原文不翻；我們自己的東西（分類、產品、項目名稱）兩種語言都要有。範例的文案集中在 [typescript/web_page_demo/src/i18n/](typescript/web_page_demo/src/i18n/)。

**尺寸：** 寬螢幕為主，範例已支援手機寬度：低於 768px 選單變抽屜，低於 1200px 訊號欄變抽屜，低於 1600px 交易終端變抽屜。

## 6｜對外 HTTP 介面（m_api）

**這是草稿：端點與位址還沒跟 A 組對齊，`m_api` 與收集產品資料的 `m_product` 都還沒實作。** A 組正式串接只走這個 HTTP 介面；§2 的 Live 啟動方式是範例網站的本機環境。

`m_product` 唯讀各產品已發布的 Public Table，收集訊號、體育的全球賠率與股票的分析，寫進 Web 自己的表。訊號來自各產品 `m_ev`，只收 `market_source = POLYMARKET` 的目前資料；包含 EV 不為正與 `stale`、`blocked` 等狀態，不重算數值、不重建分類。體育全球賠率與股票分析的格式還沒定。`m_api` 只讀 Web 的 `m_live`、`m_historical`、`m_product`，不直接連各產品的資料庫，也不寫入或觸發運算。

### 共通規則

- **位址：** `http://API_HOST:API_PORT`；正式位址待對齊，路徑不加版號。
- **驗證：** 每個請求的 header 都帶 `Authorization: Bearer <token>`；token 不對回 HTTP 401。
- **方法：** 只有 GET；只讀，不寫入、不觸發任何運算。
- **成功回應：** `{ "data": …, "next_cursor": "…" }`；沒有下一頁時 `next_cursor` 是 null，單筆與不分頁的回應也是 null。
- **錯誤回應：** HTTP 狀態碼加 `{ "error": "代碼", "message": "說明" }`。例如驗證失敗：

```json
{
  "error": "unauthorized",
  "message": "無效的 token"
}
```

- **時間：** 一律 UTC、ISO-8601，例如 `2026-10-21T12:00:00Z`。
- **數值：** 資料庫裡是 numeric 的值用字串傳，例如 `"0.425"`，不轉成浮點數；整數計數與布林值維持 JSON number 與 boolean。null 照實給，不補值。
- **分頁：** 支援分頁的端點用 `limit` 與 `cursor`；`limit` 預設 100、最多 500。`cursor` 原樣帶回上一頁的 `next_cursor`，不自行解析；翻頁時保留相同的篩選條件。
- **範例：** 以下編號與內容都是格式示意，不代表實際行情。§4 已定義的欄位沿用同名、同義與 null 規則。

### 議題的補充欄位

| 欄位                      | 型別          | 意思                                                                                                                                                 |
| ------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| market_count              | integer       | 議題底下符合 §4 進行中規則的市場數                                                                                                                   |
| lac                       | array 或 null | 議題底下沒有任何訊號時是 null；有的話，每個元素是 `{ product, classification_path }`，相同組合只列一次，包含非 active 或 EV 不為正的訊號所代表的覆蓋 |
| lac[].product             | string        | 訊號所屬產品，值見下方訊號欄位表                                                                                                                     |
| lac[].classification_path | array 或 null | 與訊號的分類路徑同義；分類缺少時保留 null                                                                                                            |

### GET /status

**參數：** 無。

回傳各資料最近一次更新的時間。議題與市場看最近一次**完整掃描**，不能拿掃描途中更新的單筆時間當成完整發布；價格與每個產品的訊號分開看。尚無更新時間時是 null。

| data 欄位          | 型別            | 意思                                                             |
| ------------------ | --------------- | ---------------------------------------------------------------- |
| events_updated_at  | UTC 時間或 null | 議題最近一次完整掃描的更新時間                                   |
| markets_updated_at | UTC 時間或 null | 市場最近一次完整掃描的更新時間                                   |
| prices_updated_at  | UTC 時間或 null | 價格最近一次更新時間                                             |
| signals_updated_at | object          | 以 product 為鍵，值為該產品訊號最近一次收集時間；還沒收集是 null |

```json
{
  "data": {
    "events_updated_at": "2026-10-21T12:00:00Z",
    "markets_updated_at": "2026-10-21T12:00:00Z",
    "prices_updated_at": "2026-10-21T12:00:00Z",
    "signals_updated_at": {
      "weather": "2026-10-21T11:59:30Z",
      "crypto": "2026-10-21T11:59:00Z",
      "forex": null,
      "future": null,
      "sport": null,
      "stock": null
    }
  },
  "next_cursor": null
}
```

### GET /events?tag=&q=&lac=&cursor=&limit=

只列 §4 定義的進行中議題，依 `volume_24h` 由大到小。每筆包含 §4 議題表全部欄位，**不含 `in_current_scan`**，另加 `market_count` 與 `lac`。

| Query 參數    | 必填 | 意思                                                        |
| ------------- | ---- | ----------------------------------------------------------- |
| tag           | 否   | Polymarket 標籤的 slug，例如 `weather`；省略時不限標籤      |
| q             | 否   | 標題關鍵字；省略時不篩選標題                                |
| lac           | 否   | `true` 只列 LAC 有覆蓋的議題；省略或 `false` 時不限覆蓋狀態 |
| cursor、limit | 否   | 見共通分頁規則                                              |

```json
{
  "data": [
    {
      "event_id": "34512",
      "slug": "highest-temperature-in-london-on-october-21",
      "title": "Highest temperature in London on October 21?",
      "description": "Daily high temperature at EGLC.",
      "resolution_source": null,
      "image_url": null,
      "icon_url": null,
      "start_at": "2026-10-21T00:00:00Z",
      "end_at": "2026-10-21T23:59:00Z",
      "active": true,
      "closed": false,
      "archived": false,
      "volume_total": "125000.50",
      "volume_24h": "24000.25",
      "liquidity": "30000",
      "tags": [
        {
          "id": "84",
          "label": "Weather",
          "slug": "weather"
        }
      ],
      "source_updated_at": "2026-10-21T11:58:00Z",
      "m_live_updated_at": "2026-10-21T12:00:00Z",
      "market_count": 1,
      "lac": [
        {
          "product": "weather",
          "classification_path": [
            {
              "kind": "country",
              "code": "GB",
              "display": "United Kingdom"
            },
            {
              "kind": "metric",
              "code": "daily_high",
              "display": "Daily high"
            },
            {
              "kind": "city",
              "code": "london",
              "display": "London"
            },
            {
              "kind": "icao",
              "code": "EGLC",
              "display": "EGLC"
            }
          ]
        }
      ]
    }
  ],
  "next_cursor": null
}
```

### GET /events/{event_id}

以下格式草稿的 `midpoint` 由 `m_api` 用 `(best_bid + best_ask) / 2` 計算；任一邊為 null 時 midpoint 為 null。

| Path 參數 | 必填 | 意思          |
| --------- | ---- | ------------- |
| event_id  | 是   | §4 的議題編號 |

回傳一個議題（欄位與 `/events` 每筆相同），加上 `markets` 陣列，包含底下**全部進行中的市場**，不分頁。每個市場用 §4 市場表欄位並帶 `outcomes`；每個結果用 §4 結果表欄位並帶 `price`。`price` 是 §4 價格表欄位組成的物件；沒有價格時整個 `price` 是 null，不補零。

```json
{
  "data": {
    "event_id": "34512",
    "slug": "highest-temperature-in-london-on-october-21",
    "title": "Highest temperature in London on October 21?",
    "description": "Daily high temperature at EGLC.",
    "resolution_source": null,
    "image_url": null,
    "icon_url": null,
    "start_at": "2026-10-21T00:00:00Z",
    "end_at": "2026-10-21T23:59:00Z",
    "active": true,
    "closed": false,
    "archived": false,
    "volume_total": "125000.50",
    "volume_24h": "24000.25",
    "liquidity": "30000",
    "tags": [
      {
        "id": "84",
        "label": "Weather",
        "slug": "weather"
      }
    ],
    "source_updated_at": "2026-10-21T11:58:00Z",
    "m_live_updated_at": "2026-10-21T12:00:00Z",
    "market_count": 1,
    "lac": [
      {
        "product": "weather",
        "classification_path": [
          {
            "kind": "country",
            "code": "GB",
            "display": "United Kingdom"
          },
          {
            "kind": "metric",
            "code": "daily_high",
            "display": "Daily high"
          },
          {
            "kind": "city",
            "code": "london",
            "display": "London"
          },
          {
            "kind": "icao",
            "code": "EGLC",
            "display": "EGLC"
          }
        ]
      }
    ],
    "markets": [
      {
        "market_id": "567890",
        "event_id": "34512",
        "sort_order": 0,
        "condition_id": "0x1111111111111111111111111111111111111111111111111111111111111111",
        "protocol_version": "v1",
        "slug": "highest-temperature-in-london-on-october-21-20c",
        "question": "Will the highest temperature in London be 20°C on October 21?",
        "group_title": "20°C",
        "description": "Daily high temperature at EGLC.",
        "resolution_source": null,
        "image_url": null,
        "icon_url": null,
        "start_at": "2026-10-21T00:00:00Z",
        "end_at": "2026-10-21T23:59:00Z",
        "active": true,
        "closed": false,
        "archived": false,
        "accepting_orders": true,
        "enable_order_book": true,
        "volume_total": "125000.50",
        "volume_24h": "24000.25",
        "liquidity": "30000",
        "source_updated_at": "2026-10-21T11:58:00Z",
        "in_current_scan": true,
        "m_live_updated_at": "2026-10-21T12:00:00Z",
        "outcomes": [
          {
            "market_id": "567890",
            "outcome_index": 0,
            "label": "Yes",
            "token_id": "60259740",
            "position_id": null,
            "asset_id": "60259740",
            "price": {
              "asset_id": "60259740",
              "best_bid": "0.41",
              "best_ask": "0.42",
              "midpoint": "0.415",
              "requested_at": "2026-10-21T12:00:00Z",
              "m_live_updated_at": "2026-10-21T12:00:01Z"
            }
          },
          {
            "market_id": "567890",
            "outcome_index": 1,
            "label": "No",
            "token_id": "60259741",
            "position_id": null,
            "asset_id": "60259741",
            "price": null
          }
        ]
      }
    ]
  },
  "next_cursor": null
}
```

### GET /prices?asset_ids=&cursor=&limit=

回傳最新價格，來源欄位見 §4 的 `m_live.m02_clob_price`。`midpoint` 由 `m_api` 用買賣價計算，不是資料表欄位；任一邊為 null 時回傳 null。查第二個結果的 asset_id 時，`m_api` 依 §4 的互補公式推導買賣價，沿用同一筆 requested_at。

| Query 參數    | 必填 | 意思                                                                                        |
| ------------- | ---- | ------------------------------------------------------------------------------------------- |
| asset_ids     | 否   | 逗號分隔的 Polymarket 結果編號，最多 500 個；給了就只回這些結果的最新價格，不給就分頁回全部 |
| cursor、limit | 否   | 見共通分頁規則；指定 asset_ids 時也按此分頁                                                 |

```json
{
  "data": [
    {
      "asset_id": "60259740",
      "best_bid": "0.41",
      "best_ask": "0.42",
      "midpoint": "0.415",
      "requested_at": "2026-10-21T12:00:00Z",
      "m_live_updated_at": "2026-10-21T12:00:01Z"
    }
  ],
  "next_cursor": null
}
```

### GET /history?asset_ids=&from=&to=

| Query 參數 | 必填 | 意思                                              |
| ---------- | ---- | ------------------------------------------------- |
| asset_ids  | 是   | 逗號分隔的結果編號，一次最多 20 個                |
| from       | 否   | 查詢開始時間，UTC、ISO-8601；省略時不限制開始時間 |
| to         | 否   | 查詢結束時間，UTC、ISO-8601；省略時不限制結束時間 |

此歷史 HTTP 介面尚未實作，回傳格式需在 m_api 施工前依 §4 的每日陣列表定案。來源只有 `m_historical.m01_price_day`，不另有 coverage 表；未抓的市場日沒有列，已抓的必須區分 success／no_data／error，不能把 prices 為 null 都當成成功空日。展開 success 分鐘時忽略 null 格，不補點；第二個結果的價格是推導值。


### GET /signals?product=&event_id=&cursor=&limit=

回傳目前全部訊號，包含非 `active`、EV 不為正的資料，不在 API 端篩成可顯示訊號。

| Query 參數    | 必填 | 意思                                                 |
| ------------- | ---- | ---------------------------------------------------- |
| product       | 否   | 篩選一個產品；省略時回全部產品。允許的值見下方欄位表 |
| event_id      | 否   | 篩選 §4 的議題編號；省略時不限議題                   |
| cursor、limit | 否   | 見共通分頁規則                                       |

| 訊號欄位                  | 型別                | 意思                                                                                                                                                      |
| ------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| signal_id                 | string              | 穩定的訊號編號；同一個編號的新資料蓋掉舊的                                                                                                                |
| product                   | string              | weather、crypto、forex、future、sport、stock（stock 之後才有）；決定 Signal 的分類與權益                                                                  |
| status                    | string              | `active`（可以用）或其他狀態，例如 `stale`、`blocked`                                                                                                     |
| reason                    | string 或 null      | 不是 `active` 時必須寫明原因；`active` 且沒有原因時是 null                                                                                                |
| classification_path       | array 或 null       | 分類路徑，由上到下；每層是 `{ kind, code, display? }`，`code` 固定不變、可以比對，`display` 只用來顯示。必要分類缺少時是 null，並在 reason 說明，不猜分類 |
| market_url                | string 或 null      | 官方市場網址或 null；不從標題拼網址，不拿首頁或 API 位址替代                                                                                              |
| event_id、market_id       | string 或 null      | 由 `m_api` 用 Polymarket 編號從 §4 的表對出議題與市場，對不到是 null；配合 asset_id 找到點訊號時要標黃的那一格                                            |
| condition_id、asset_id    | string 或 null      | Polymarket 的條件編號與該結果的編號，原樣保留，不從標題或網址推；缺少時是 null 並在 reason 說明                                                           |
| side                      | string              | YES 或 NO（Up／Down 類市場一樣用 YES＝第一個結果、NO＝第二個結果，以 asset_id 為準）                                                                      |
| entry                     | numeric 字串或 null | 現在的買入價                                                                                                                                              |
| fair                      | numeric 字串或 null | LAC 算出的合理價                                                                                                                                          |
| ev                        | numeric 字串或 null | fair － entry；由上游提供，Web 不重算                                                                                                                     |
| avg_cost                  | numeric 字串或 null | 從現在的掛單一路買到 fair 為止的平均成本                                                                                                                  |
| depth                     | numeric 字串或 null | 在 fair 以下可以買到的份數                                                                                                                                |
| evaluated_at、valid_until | UTC 時間或 null     | 算出這筆的時間、有效到幾點；缺少時保留 null，不推算                                                                                                       |

```json
{
  "data": [
    {
      "signal_id": "weather-34512-1",
      "product": "weather",
      "status": "active",
      "reason": null,
      "classification_path": [
        {
          "kind": "country",
          "code": "GB",
          "display": "United Kingdom"
        },
        {
          "kind": "metric",
          "code": "daily_high",
          "display": "Daily high"
        },
        {
          "kind": "city",
          "code": "london",
          "display": "London"
        },
        {
          "kind": "icao",
          "code": "EGLC",
          "display": "EGLC"
        }
      ],
      "market_url": "https://polymarket.com/event/highest-temperature-in-london-on-october-21",
      "event_id": "34512",
      "market_id": "567890",
      "condition_id": "0x1111111111111111111111111111111111111111111111111111111111111111",
      "asset_id": "60259740",
      "side": "YES",
      "entry": "0.42",
      "fair": "0.54",
      "ev": "0.12",
      "avg_cost": "0.47",
      "depth": "2400",
      "evaluated_at": "2026-10-21T11:59:30Z",
      "valid_until": "2026-10-21T23:59:00Z"
    }
  ],
  "next_cursor": null
}
```

**顯示與更新：**

- 網站只把 `status = active` 且 `ev > 0`、目前時間早於 `valid_until` 的資料當成訊號顯示；缺少可判斷的 EV 或有效期限時不能當成可用訊號。其他資料只代表這個議題在 LAC 的覆蓋範圍內。
- 到了 `valid_until` 就從訊號畫面拿掉，不等下一次 HTTP 回應。
- `/signals` 只有目前的資料，沒有歷史或差異 feed。上一次拿到、這一次沒有的訊號就是已經失效，從畫面拿掉。
- 比對是否消失時，先在**相同篩選條件**下成功取完所有分頁（`next_cursor = null`），再用完整集合取代上一輪；單頁缺少、請求失敗或切換篩選不能當成訊號失效。

**新項目怎麼進後台（建議，待確認）：** 用 `classification_path` 的某一層當「項目」：天氣是城市、加密貨幣是幣種加週期、外匯是貨幣對、期貨是商品代號、體育是運動種類。後台在 `/signals` 第一次看到某個產品底下沒見過的 `code`，就把它放進「待審核的新項目」（§7.1）。

## 7｜商業規則

### 7.1 產品與上架閘門

- **產品：** Weather、Crypto、Forex、Future、Sport 各一個訊號產品，加上 All signals（全包）。Prediction 免費。
- **項目：** 一個產品由好幾個項目組成，例如 Sport 包含足球、籃球。
- **閘門：** 訊號系統開始提供新項目（例如美式足球）時，它只會出現在後台的「待審核」，**不會自動上架**。員工核准、放進產品的新版本、訂好價格，按下發布才會上架。B 組那邊多了什麼，網站不能直接跟著變。
- **版本：** 產品發布後內容就固定。要加或拿掉項目，就發布下一版（v2、v3…），上一版自動從商店下架。價格跟著版本走。
- **已經買的人：** 買到哪一版就一直是那一版，直到到期，什麼都不用動。舊客戶想要新項目，可以再買一次，或由員工在後台把他升級到新版、自己決定到期日。
- **手動開通與兌換碼：** 都給「當下上架」的版本。
- 範例的規則與測試：[typescript/web_page_demo/src/data/products.ts](typescript/web_page_demo/src/data/products.ts)、[backend.ts](typescript/web_page_demo/src/data/backend.ts)。

### 7.2 會員與付費方案

- 註冊、登入、帳號狀態（正常／停權）由 A 組做；登入方式照 [polym.trade](https://polym.trade/)（左下角登入）。
- **權益：** 一筆權益＝一個會員 × 一個產品版本 × 一段期間（開始、到期），來源是購買、員工開通或兌換碼。客戶有哪些權益，Signal 就只顯示那些分類與訊號，Telegram 通知也一樣。
- 計費週期：月、季、年；價格待確認。
- **退款：** 退款時，那筆付款開通的權益一起撤銷。
- **停權：** 不能登入；他的提領只能駁回。

### 7.3 推薦分潤

- **兩本帳分開算：** 下單的 builder 手續費一本、訊號訂閱費一本，比例暫時一樣。
- **結構：** 所有人都在官方底下。官方先拿 20%，剩下 80% 往下一層一層分。
- 每一層只能設定**直屬下一層**的比例，不能超過自己的比例；自己拿到的＝自己的比例－給下一層的比例。
- **例子：** 官方給 B 80%，B 給 C 55%。C 這條線產生 100 美元 → 官方 20、B 25、C 55。
- **一般調整（每一層都可以）：** 只能多給下面，不能少給。例如官方自己拿 20% 時，之後只能調成 19%、18%…，不能超過 20%。任何調整**隔天才生效**，以倫敦時間（UTC+0）的 00:00 為界，畫面上要寫清楚。
- **按比例縮減（只有官方可以）：** 把整條線的比例按同一個比例一起砍，砍下來的全部回到官方。例：上面的例子砍 50% → C 從 55% 變 27.5%、B 從 25% 變 12.5%、官方從 20% 變 60%。之後官方可以再決定多給某條線（回到一般調整，只能加）。
- 比例取到小數點後 6 位。
- 推薦碼在 Settings 隨時可改，不限次數；推薦連結跟著換。
- 範例的分成計算：[typescript/web_page_demo/src/data/referral.ts](typescript/web_page_demo/src/data/referral.ts)、[admin.ts](typescript/web_page_demo/src/data/admin.ts)（代理樹）。

### 7.4 提領

- **本階段：** 先做推薦碼與分潤（業務推廣），系統不做錢包。提領只定大方向，細節之後再定。
- 推薦收入進到可提領餘額後，會員可以申請提領；這是網站唯一的出款，網站不收儲值。
- **鏈：** 一律走以太坊系（EVM）的鏈，例如 BEP20 或 Polygon，固定用一條；不走 TRC20（Tron）。
- **流程：** 會員申請時貼上自己的收款地址 → 員工在後台審核：核准或駁回（要寫原因，會員看得到）→ 員工轉帳 → 貼上交易 hash，會員那邊就看得到。駁回的金額回到可提領餘額。
- 審核中與已核准的金額會凍結，不能重複提領。
- 最低金額、手續費誰付、幾天內處理、收入何時進到可提領，都待確認。範例裡的 $50 最低金額只是暫定；範例程式還有 USDT · TRC20 選項，之後改程式時拿掉。
- 範例的流程與餘額計算：[typescript/web_page_demo/src/data/withdrawals.ts](typescript/web_page_demo/src/data/withdrawals.ts)。

### 7.5 下單（Polymarket builder）

- 客戶在 LAC 下單時，訂單的 `builder` 欄位帶 LAC 的 builder code，成交量與手續費記在 LAC 名下。builder code 是訂單內容的一部分，要在簽名前放進去。
- 每筆訂單由客戶的錢包簽名，再用客戶的 Polymarket API 憑證送出。API 憑證（key、secret、passphrase 三件一組）是**錢包簽一次名**產生的，客戶不用自己去找、也不用貼；私鑰永遠不離開錢包。Settings 的流程是「連接錢包 → 啟用交易」。
- **分工：** 頁面與交易執行由 A 組負責：在 A 組自己的伺服器上執行下單、平倉與 TP／SL，每張單帶 LAC 的 builder code。B 組不做下單引擎；LAC 的 builder code 與相關憑證怎麼交給 A 組待確認。
- 參考：[Order attribution](https://docs.polymarket.com/trading/orders/attribution)、[Builder client](https://docs.polymarket.com/trading/clients/builder)、[Authentication](https://docs.polymarket.com/api-reference/authentication)。

### 7.6 購買 USDT

- 只轉介：客戶點「前往網站」到合作網站，在那邊付款、做 KYC、收 USDT。LAC 不經手款項、不保管資金。
- 合作網站與金流由 A 組提供；清單底部註明是外部網站、款項由該服務商處理。
- 清單內容（順序、是否顯示）由後台維護。

## 8｜後台

範例在網站的 `/admin`（Settings 最下面的「開啟後台」）。**這只是參考，A 組要怎麼改、加或刪都可以**；正式版應是獨立網站、員工另外登入。

| 頁面 | 做什麼                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| 待辦 | 所有等人處理的事：待審提領、訊號的新項目、7 天內到期的權益、付款失敗；點一行就到處理它的地方                                      |
| 會員 | 列表 → 會員詳情：權益（產品版本、包含項目、期間、來源）、手動開通、改到期日、升級到新版、撤銷、付款與退款、提領、代理線、操作紀錄 |
| 產品 | 每個產品目前上架的版本與歷史版本、建立並發布新版、審核新項目、兌換碼                                                              |
| 出金 | 提領審核：核准、駁回、貼交易 hash 標記已出款                                                                                      |
| 財務 | 報表、付款（含退款）、代理分潤樹                                                                                                  |
| 系統 | 網站內容（購買 USDT 清單、公告、法律頁面）、員工帳號與角色權限、操作紀錄（不能改也不能刪）                                        |

範例裡已經做好的連動（正式版也要有）：退款會撤銷權益；停權會擋住核准與出款；發布新版會讓舊版下架；每個員工動作都留紀錄。範例的「後端」是一個 reducer：[typescript/web_page_demo/src/data/backend.ts](typescript/web_page_demo/src/data/backend.ts)，測試在 [typescript/web_page_demo/tests/](typescript/web_page_demo/tests/)。

## 9｜開發與檢查

```bash
# 前端：從 repository 根目錄開始
cd typescript/web_page_demo
npm test          # 資料對應、分成、提領、產品版本與權益、中英文鍵值
npm run build     # TypeScript 檢查與正式輸出 dist/
```

```bash
# 資料程式：從 repository 根目錄開始
cd python
uv run --env-file ../.env pytest
uv run ruff check .
uv run ruff format --check .
```

資料庫測試只在本機執行：在 rollback transaction 內清空六張 m_live 表及有外鍵關聯的 m_historical 每日價格表，再自建資料，結束後還原 transaction；測試期間會短暫鎖住這些表，先停止資料程式再跑測試。正式機不對正式資料庫跑測試。

前端的元件、路由與檔案導覽見 [typescript/web_page_demo/README.md](typescript/web_page_demo/README.md)。

## 10｜常見問題

- **對外介面還沒實作：** `m_api` 還沒實作；範例網站的 Live 由網站伺服器直接讀表，A 組正式串接走 `m_api`（§6）。
- **範例沒有真實交易：** 登入、訂閱、兌換、Telegram 綁定、Yes／No 下單按鈕都還沒接服務；Live 不計算 LAC 的 fair／EV，也沒有真實訊號。
- **範例的資料重新整理就重設：** 推薦碼、代理比例、提領申請、後台操作都存在頁面記憶體；只有語言選擇記在瀏覽器。
- **錢包與交易是展示：** 「連接錢包」「啟用交易」只切換畫面狀態，不簽名、不儲存任何憑證。
- **`npm run preview` 或直接開 `dist/` 看不到 Live：** Live 的資料庫查詢只在 `npm run dev` 的伺服器裡。
- **網站起不來或 Live 連不到：** 檢查 `.env` 五個欄位、PostgreSQL 16 有在 5432 跑、兩個 setup 都成功；網站固定用 5173，被占用會直接報錯。
- **資料程式出現 `provider_error`：** `status: 0` 是連不到 Polymarket（網路或地區封鎖，開 VPN）；401／403 會讓那個單位暫停，處理好再重開。
- **Live 價格或歷史沒更新：** 讀表成功不代表來源已刷新，看資料程式的 `published`／`round_finished` 紀錄；歷史由另一個常駐的 m_historical 程式補抓，需確認該入口也正在執行。

## 11｜待確認

1. `m_api` 的正式位址與 token 怎麼交付、端點格式（§6 是草稿）。
2. 「項目」取 `classification_path` 的哪一層。
3. LAC 的 builder code 與相關憑證怎麼交給 A 組。
4. 各產品價格、付款方式。
5. 提領規則：最低金額、手續費誰付、幾天內處理、收入何時可提領。
6. 購買 USDT 的合作網站名單。
7. 手機版的時程。

## 附錄｜之後才做

- **股票：** 台股、美股個股分析。
- **全球體育賠率分析。**
- 這兩項在網站上先留位置，這個階段不啟動。
