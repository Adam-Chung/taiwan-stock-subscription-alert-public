# Security Policy

## 公開版本的安全邊界

這是已排除 production state 的 source-available 公開版本，不是可直接部署的安全範本。
公開內容不包含正式憑證、LINE 收件者資料、傳送紀錄、Cloudflare KV 識別碼、正式排程
與帳號專屬部署設定。使用者仍須自行設計最小權限、encrypted secrets、資料保存、來源
授權與部署防護，不能把本 Repository 視為 deployment-ready security template。

## 支援範圍

目前只支援 `main` 最新版本。公開的 `.env.example` 與 `wrangler.jsonc` 採 fail-closed
預設值；正式環境的外部來源開關、KV binding、Cron Trigger、LINE token、收件者與第三方
API key 必須由部署者在自己的受保護環境中設定。

## 回報漏洞

請使用 GitHub 的私密漏洞回報功能私下回報。請勿在 Issue、Pull
Request、Discussion、截圖或日誌中公開 token、LINE userId、Cloudflare 資訊、個人
資料或可被用來重現對正式環境攻擊的細節。

回報內容請包含受影響版本、重現條件、預期與實際結果，以及已移除敏感內容的最小
證據。不要對不屬於你的系統、帳號或收件者執行測試。

若懷疑憑證外洩，應立即在原服務撤銷並輪替，而不是只從目前檔案或 Git history 刪除
字串；還要評估 Git history、Actions logs、artifacts、Cloudflare logs 與 cached content
的清理範圍。
