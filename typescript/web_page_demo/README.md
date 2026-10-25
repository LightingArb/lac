# LAC Web

LAC 預測市場終端的前端，使用 React 19、TypeScript、Vite 與 React Router。Demo 與 Live 共用版型與互動元件。

完整的安裝、WireGuard、共用環境、資料程式與啟動步驟請看 [repository README](../../README.md)。

## 開發指令

在此目錄執行：

```bash
npm ci
npm run dev
```

網站位於 [http://127.0.0.1:5173/prediction](http://127.0.0.1:5173/prediction)。Vite 讀取上兩層 repository 根目錄的 `.env`，檔案中的 `DB_*` 僅用於伺服器；Live middleware 不包含在 `npm run preview` 中。

```bash
npm test
npm run test:db  # 本機 lac_data：唯讀 SELECT，測 SQL numeric、歷史分桶、moneyline，以及 Sports 的合併、排序、以場翻頁與買進價
npm run build
```

- `npm test`：Live 欄位對應、缺值、結果順序、moneyline 對隊名或 alias、交易終端的淨值／可用／現值／損益與點持倉（留在 Signal 或跳到 Prediction）、Sports 的議題合併成場／代表議題／賠率換算／跨議題主線／勝負三格／聯賽對照表／排序、權益照運動（Signal 與 Sports 同一個判斷）、Sports 訊號的報酬率顯示條件／沒訂只給數量／點卡片對到的比賽與格子、Stocks 的持有時間與機率文字／日 K（同種子、約 3 年平日、高低包住開收、最後收盤＝現價）／國會持股的排序、申報天數與圖上標記／基金成分兩個方向與「其他」合計 100%／台股沒有國會持股、分成與推薦碼規則、提領流程、後台產品版本與權益規則、中英文鍵值是否一致。
- `npm run build`：TypeScript 檢查與 Vite 靜態輸出，結果在 `dist/`。
- `npm run build:static`：輸出單一檔案 `dist-static/index.html`（JS、CSS 都包在裡面，路由用 `#/`），不用伺服器就能打開或分享；這個版本只有 Demo。
- `tests/live_event.json`：以新表讀取程式於 2026-10-25 07:15:34 UTC 從本機 `lac_data` 取得 `/api/live/event?id=878226`（Russia x Ukraine any diplomatic meeting by...?）的實際回應；僅供測試，不代表目前行情。原始回應、查詢與逐點比對在 `/home/admin/research/web/web_page_demo_live/`。

## 程式導覽

| 路徑                                               | 責任                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| [src/Root.tsx](src/Root.tsx)                       | 客戶網站與後台（`/admin`）分流；共用語言與 demo 後端                         |
| [src/App.tsx](src/App.tsx)                         | 客戶網站的路由、Demo／Live 切換與跨頁共用狀態                                |
| [src/admin/](src/admin/)                           | 後台：待辦、會員（含詳情）、產品、出金、財務、系統；入口在 Settings 最下面   |
| [src/i18n/](src/i18n/)                             | 英文與繁體中文文案；`zh.ts` 少一個鍵就過不了型別檢查                         |
| [src/pages/](src/pages/)                           | Prediction／Signal 的 MarketsPage、Sports 的 SportsPage，以及 Stocks、Products、Referral、Settings |
| [src/components/layout/](src/components/layout/)   | Sidebar 與 TopBar                                                            |
| [src/components/markets/](src/components/markets/) | 共用 EventCard、EventDetail、PriceChart、MarketsTable                        |
| [src/components/signals/](src/components/signals/) | 訊號欄與訊號卡（Signal 與 Sports 共用；Sports 另有沒訂運動的數量列）         |
| [src/components/terminal/](src/components/terminal/) | Signal 最右邊的交易終端：錢包列、帳戶摘要、持倉／訂單／交易、鎖住的按鈕    |
| [src/components/sports/](src/components/sports/)   | Sports 的賽事列表（一場一列）、賽事詳情、賠率格與勝負三格                    |
| [src/components/stocks/](src/components/stocks/)   | Stocks 的選擇欄（個股分析、國會持股、基金成分）、右邊的資訊，以及 KLineChart 日 K 圖（指標、合理價格線、議員買賣標記） |
| [src/components/ui/](src/components/ui/)           | Button、Drawer、Panel、Switch 等基礎元件                                     |
| [src/data/](src/data/)                             | Demo fixtures、方案、偏好與分成規則                                          |
| [src/data/terminal.ts](src/data/terminal.ts)       | 交易終端的 Demo 帳戶：持倉、掛單、交易紀錄（都用 catalog.ts 的議題）         |
| [src/data/sports.ts](src/data/sports.ts)           | Sports 的 Demo 議題（含子議題與 `game_id`）與每個結果的買進價                |
| [src/data/sportsSignals.ts](src/data/sportsSignals.ts) | Sports 的 Demo 體育訊號（照 `/signals` 的欄位）與判斷有效期限用的 Demo 時間 |
| [src/data/stocks.ts](src/data/stocks.ts)           | Stocks 的 Demo 股票（台股、美股各 10 檔）：現價、每個持有時間的合理價格與機率、日 K 的種子；Demo「今天」 |
| [src/data/congress.ts](src/data/congress.ts)       | Stocks 的 Demo 國會申報：虛構的議員與他們的買賣、金額區間                    |
| [src/data/funds.ts](src/data/funds.ts)             | Stocks 的 Demo 基金（台股、美股各 4 檔）與成分權重                           |
| [src/data/backend.ts](src/data/backend.ts)         | Demo 後端：網站與後台共用的資料與每個員工動作（一個 reducer）；客人的權益（產品與運動） |
| [src/data/products.ts](src/data/products.ts)       | 產品版本：發布後不改；要加減項目就發下一版，舊版買家照原內容用到期           |
| [src/data/withdrawals.ts](src/data/withdrawals.ts) | 提領流程：待審核 → 已核准 → 已出款，或駁回；餘額計算                         |
| [src/lib/markets.ts](src/lib/markets.ts)           | Demo 工作區、分類、搜尋與範例訊號計算；點訊號或持倉時標黃的那一格            |
| [src/lib/terminal.ts](src/lib/terminal.ts)         | 交易終端的計算（純函式）：現值、損益、損益百分比、掛單佔用、淨值、可用         |
| [src/lib/sports.ts](src/lib/sports.ts)             | Sports：聯賽 → 運動對照表、議題合併成場、代表議題、賠率換算、主線、勝負三格、排序、分類，以及 Demo／Live 的讀取 |
| [src/lib/sportsSignals.ts](src/lib/sportsSignals.ts) | Sports 的訊號：顯示條件、格子的報酬率與標黃、訊號欄的卡片與沒訂運動的數量 |
| [src/lib/stocks.ts](src/lib/stocks.ts)             | Stocks（純函式）：日 K 產生、持有時間的合理價格與機率文字、搜尋、議員與交易、圖上標記、基金成分 |
| [src/lib/live.ts](src/lib/live.ts)                 | Live 資料讀取、分頁、刷新與共用模型對應                                      |
| [src/styles/tokens.css](src/styles/tokens.css)     | 顏色、圓角、陰影等設計 token                                                 |
| [server/live.ts](server/live.ts)                   | Vite 的唯讀 PostgreSQL middleware（Prediction 與 Sports 的 `/api/live/*`）    |

## 響應式版面

- 視窗寬度低於 768px：左側選單改為抽屜。
- 視窗寬度低於 1200px：Signal 與 Sports 的訊號欄改為抽屜。
- 視窗寬度低於 1600px：Signal 的交易終端改為抽屜，由上方列的「終端」按鈕打開（1600px 時選單 232＋訊號 330＋終端 340，中間還有約 700px 讓列表與詳情並排）。
- 主內容區低於 640px：議題列表與詳情上下排列（Sports、Stocks 也一樣）。
- Sports 的賽事列表本身低於 760px：每場的勝負、讓分、大小分移到隊名下面一排。
- Stocks 的選擇欄本身低於 520px：每檔的機率文字移到名稱下面；日 K 圖窄於 560px 時，K 棒與指標的數值只在十字線下顯示。
- 點議題會帶到詳情；點訊號或交易終端的持倉會帶到指定市場列，並將對應的 Yes／No 按鈕與該列標黃（持倉的議題沒有 LAC 訊號時，改跳到 Prediction 標黃）。Sports 點訊號欄的卡片會帶到那場比賽與那條線，對應的格子標黃。
- 後台在視窗寬度低於 768px 時，左側選單改成頂部橫列。

## 呈現規則

Demo 的模擬資料與 Live 的讀表資料經相同市場元件呈現。Live 的分類、價格欄位、歷史缺點處理，以及各頁 Demo 限制集中說明於 [repository README](../../README.md)。
