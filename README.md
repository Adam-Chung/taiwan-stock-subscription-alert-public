# 台股申購提醒（Public mirror）

這是由 Private source-of-truth 經明確 allowlist、敏感資料掃描與獨立測試產生的
單向 Public mirror。它展示台股公開申購資料整理、規則評估、LINE 訊息組版與
Cloudflare Worker 的實作，但不包含正式排程、KV 識別碼、憑證、收件者、執行
紀錄、營運文件或 Private Git 歷史。

## 安全邊界

- `ENABLE_EXTERNAL_FETCH=false`：預設不連線任何外部資料來源。
- `ENABLE_MOPS_FETCH=false`：即使開啟一般外部來源，MOPS 仍需另外明確啟用。
- `wrangler.jsonc` 不含 Cron、KV namespace、正式 Secret 或 production topology。
- `config/issuance-overrides.json` 保持空白，不攜帶個別案件的營運補值。
- 此 Repository 不提供正式 LINE 收件者、傳送紀錄或部署保證。

開啟來源前，請先閱讀 [資料來源與授權邊界](docs/DATA_SOURCES.md)，逐一確認當時
有效的 Terms、API/data license、`robots.txt`、頻率限制與使用目的。技術上可存取
不代表已取得自動抓取、重製、轉傳或商業使用授權。

## 本機驗證

需要 Node.js 24：

```powershell
npm ci
npm audit --registry=https://registry.npmjs.org
npm run check
```

測試預設不需要 LINE 憑證，也不應執行真實發送。若要自行部署，必須先建立自己的
Cloudflare KV、encrypted secrets 與 Cron，並重新完成資料來源、隱私、安全及容量
評估；Public mirror 的設定不能直接當成 production 設定。

## 規則摘要

程式會以承銷價、市價折價率、完整新增股數、原已發行普通股數、稀釋率與安全邊際
產生規則型結果。資料缺漏時保留可取得欄位並標示「資料不足」，不以公開承銷股數
冒充整次新增股數，也不保證任何獲利或投資結果。

本專案僅供程式設計展示、學習與個人研究，不構成投資建議、交易訊號或獲利保證。

## Public / Private 協作方式

Public Repository 是衍生輸出，不是 source of truth。安全修正會先進入 Private
Repository，通過 exporter、verifier、build、test 與 dependency audit 後再單向發布。
Public 內容不會自動合併回 Private。請先閱讀 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License 狀態

目前尚未授予開源或再利用 License。除 GitHub 平台為顯示 Repository 所必要的權利
外，所有權利保留；公開可見不代表允許複製、修改、散布、商業使用或建立衍生作品。
待專案擁有者完成 License 選擇與第三方相容性審查後，才會更新此段。
