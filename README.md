# 1A2B 線上多人 PK 遊戲

依照專案規劃書開發中的 React、Express 與 Socket.IO 多人 1A2B 遊戲。

## 開發啟動

```bash
npm install
npm run dev
```

前端預設為 `http://localhost:5173`，後端為 `http://localhost:3001`。

## 測試

```bash
npm test --workspace=server
npm run build
```

## Render 部署

專案包含 `render.yaml`。連接 GitHub 儲存庫後，Render 會執行正式建置並以 `/health` 檢查服務狀態。

## 加入房間

房主分享的完整邀請網址含專用邀請碼，持有網址的人可免密碼加入。只知道四位房號或使用沒有邀請碼的舊網址時，仍需輸入房間密碼。請把完整邀請網址當作私人入房憑證。
