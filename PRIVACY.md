# Privacy

Public mirror 本身不包含正式 LINE token、收件者 ID、收件者雜湊、傳送時間、
Cloudflare KV 內容或 production log。

自行部署後，操作者會成為其環境中資料處理與保存方式的責任人。程式的正式傳送流程
可能在操作者自己的 Cloudflare KV 保存收件者別名、LINE userId 的 SHA-256 雜湊與
傳送時間，預設 TTL 為 120 天；原始 LINE userId 應只存在 encrypted secrets。

部署者應：

- 只收集完成提醒與去重所需的最少資料。
- 限制 Cloudflare、GitHub 與 LINE 後台權限。
- 不把 `.env`、log、KV export、完整 LINE 訊息或收件者資訊提交到 Git。
- 在不再需要服務時刪除 secrets、Deploy Key、KV 資料與相關備份。
- 依所在地法律與實際使用者關係提供必要告知並處理資料權利請求。

Public mirror 不會替自行部署者自動完成上述義務。
