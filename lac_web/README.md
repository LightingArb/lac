# LAC Web

LAC 預測市場終端的前端，使用 React 19、TypeScript、Vite 與 React Router。Demo 與 Live 共用版型與互動元件。

完整的安裝、WireGuard、共用環境、資料程式與啟動步驟請看 [repository README](../README.md)。

## 開發指令

在此目錄執行：

```bash
npm ci
npm run dev
```

網站位於 [http://127.0.0.1:5173/prediction](http://127.0.0.1:5173/prediction)。Vite 讀取父層的 `.env`，檔案中的 `DB_*` 僅用於伺服器；Live middleware 不包含在 `npm run preview` 中。

```bash
npm test
npm run build
```

- `npm test`：Live 欄位對應、缺值、結果順序、分成與推薦碼規則、提領流程、後台產品版本與權益規則、中英文鍵值是否一致。
- `npm run build`：TypeScript 檢查與 Vite 靜態輸出，結果在 `dist/`。
- `npm run build:static`：輸出單一檔案 `dist-static/index.html`（JS、CSS 都包在裡面，路由用 `#/`），不用伺服器就能打開或分享；這個版本只有 Demo。
- `tests/live_event.json`：本機 Live reader 的實際回應 fixture；僅供測試，不代表目前行情。

## 程式導覽

| 路徑                                               | 責任                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| [src/Root.tsx](src/Root.tsx)                       | 客戶網站與後台（`/admin`）分流；共用語言與 demo 後端                         |
| [src/App.tsx](src/App.tsx)                         | 客戶網站的路由、Demo／Live 切換與跨頁共用狀態                                |
| [src/admin/](src/admin/)                           | 後台：待辦、會員（含詳情）、產品、出金、財務、系統；入口在 Settings 最下面   |
| [src/i18n/](src/i18n/)                             | 英文與繁體中文文案；`zh.ts` 少一個鍵就過不了型別檢查                         |
| [src/pages/](src/pages/)                           | Prediction／Signal 的 MarketsPage，以及 Stocks、Products、Referral、Settings |
| [src/components/layout/](src/components/layout/)   | Sidebar 與 TopBar                                                            |
| [src/components/markets/](src/components/markets/) | 共用 EventCard、EventDetail、PriceChart、MarketsTable                        |
| [src/components/signals/](src/components/signals/) | Signal 面板與訊號卡                                                          |
| [src/components/ui/](src/components/ui/)           | Button、Drawer、Panel、Switch 等基礎元件                                     |
| [src/data/](src/data/)                             | Demo fixtures、方案、偏好與分成規則                                          |
| [src/data/backend.ts](src/data/backend.ts)         | Demo 後端：網站與後台共用的資料與每個員工動作（一個 reducer）                |
| [src/data/products.ts](src/data/products.ts)       | 產品版本：發布後不改；要加減項目就發下一版，舊版買家照原內容用到期           |
| [src/data/withdrawals.ts](src/data/withdrawals.ts) | 提領流程：待審核 → 已核准 → 已出款，或駁回；餘額計算                         |
| [src/lib/markets.ts](src/lib/markets.ts)           | Demo 工作區、分類、搜尋與範例訊號計算                                        |
| [src/lib/live.ts](src/lib/live.ts)                 | Live 資料讀取、分頁、刷新與共用模型對應                                      |
| [src/styles/tokens.css](src/styles/tokens.css)     | 顏色、圓角、陰影等設計 token                                                 |
| [server/live.ts](server/live.ts)                   | Vite 的唯讀 PostgreSQL middleware                                            |

## 響應式版面

- 視窗寬度低於 768px：左側選單改為抽屜。
- 視窗寬度低於 1200px：Signal 面板改為抽屜。
- 主內容區低於 640px：議題列表與詳情上下排列。
- 點議題會帶到詳情；點訊號會帶到指定市場列，並將對應的 Yes／No 按鈕與該列標黃。
- 後台在視窗寬度低於 768px 時，左側選單改成頂部橫列。

## 呈現規則

Demo 的模擬資料與 Live 的讀表資料經相同市場元件呈現。Live 的分類、價格欄位、歷史缺點處理，以及各頁 Demo 限制集中說明於 [repository README](../README.md)。
