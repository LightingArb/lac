# LAC Web

依照「LAC Web 打版」設計稿實作的預測市場終端（React 19 + TypeScript + Vite + React Router）。

## 執行

```bash
npm install
npm run dev
```

開啟 http://localhost:5173 。`npm run build` 會做型別檢查並輸出到 `dist/`。

## 結構

- `src/App.tsx`：整體版面（左側導覽、頂部列、右側 Signal 面板）、路由與共用狀態
- `src/pages/`：Prediction / Signal（`MarketsPage`）、Stocks、Products、Referral、Settings
- `src/components/ui/`：共用元件（Button、IconButton、SegmentedControl、Switch、TextField、Panel、Page、Icon）
- `src/components/markets/`、`src/components/signals/`：市場列表、事件詳情、價格圖、LAC 公允價表、訊號卡
- `src/styles/tokens.css`：設計 token（顏色、圓角、陰影）
- `src/data/`：Demo 模式的原始範例資料
- `src/lib/markets.ts`：分類、搜尋、訊號 EV 計算等邏輯

## 響應式版面

- 767px 以下（手機）：左側選單變成抽屜，從頂部列的選單按鈕打開
- 1199px 以下：Signal 頁右側的訊號欄變成抽屜，從頂部列的訊號按鈕打開
- 主內容區寬度不到 640px 時，事件列表和詳情改成上下排；點事件或訊號會自動捲到詳情

## 尚未完成（設計稿也還沒定義）

- Demo 的資料與走勢仍是原始範例；Live Prediction 讀取下述公開資料表
- Sign in、Subscribe、Redeem、Link Telegram、Yes/No 下單按鈕還沒接功能
- Settings 的語言與深色主題只會切換狀態，還沒有翻譯和深色配色
- Stocks 頁是佔位畫面

## WSL 本機 Live demo

先在 Windows 開啟 VPN。WSL 兩個終端分別執行：

```bash
# 終端一：全量市場與最新報價，各自固定 600 秒節奏
export PATH="/home/admin/.local/bin:$PATH"
cd /home/admin/web/lac_data/python
uv run --env-file ../../.env python -m m_live.all_runtime
```

```bash
# 終端二：網站；Logo 旁可切換 Demo / Live
export PATH="/home/admin/.local/bin:$PATH"
cd /home/admin/web/lac_web
npm run dev
```

開啟 http://127.0.0.1:5173/prediction 。首次沒有資料時須等一輪 Gamma 完成；CLOB 只讀已發布名單，冷啟動可能到下一個 600 秒週期才取得價格。已有資料的 demo 可直接顯示，畫面會標示各次觀測時間。單輪超過 600 秒時不重疊啟動，完成後立即續跑。

`server/live.ts` 是 Vite 內的唯讀 PostgreSQL 查詢介面。DB 連線設定來自repo 根目錄 `/home/admin/web/.env`，沒有 `VITE_` 前綴。`npm run build` 檢查並產生靜態畫面；Live 查詢需由 `npm run dev` 提供，單獨開 `dist` 或 `npm run preview` 不提供 Live API。

歷史是一次性快照，已回補 24 小時成交量前 500 個進行中議題的全部有識別碼結果資產（含已關閉子市場）；範圍由執行時的 `m_live` 決定。它不隨 Live 報價自動回補。如需另一次固定三天窗，手動執行：

```bash
cd /home/admin/web/lac_data/python
uv run --env-file ../../.env python -m m_historical.all_runtime --once --days 3 --top-events 500
```

如同一輪中斷，沿用啟動時的 UTC `--end` 值以續跑已保存的 coverage。沒有 systemd 或常駐歷史程式。終端按 Ctrl+C 會要求各單位完成當前工作後退出。

Live 不產生 LAC 訊號，不連接交易功能。買價是各自 asset 的 best ask；Chance 是來源 midpoint。未取得報價保留空值，歷史缺分鐘不補點。非 Prediction 頁面仍保留原本的 Demo 內容，Live Signal 顯示指定空狀態。
