# Contributing

感謝你協助改善台股申購提醒。

## 目前接受的回饋

- 可重現的 bug report
- 不含敏感資料的安全性建議；安全漏洞請依 `SECURITY.md` 私下回報
- 官方資料格式變更或測試案例建議
- 文件錯誤與無障礙改善

本 Repository 採用僅限個人非商業使用的 source-available 授權。由於尚未建立程式碼
貢獻授權機制，Public Repository 接受 Issue 回報與建議，但不直接接受 Pull Request。
請以 Issue 描述問題與建議，不要貼上受著作權保護的完整第三方內容、正式訊息、
token、userId、雜湊、內部 URL、production URL、production log 或未獲授權的 fixture。

維護者採用的建議會由 owner 在 Private source Repository 實作。完成程式碼審查、
測試、安全檢查與公開邊界驗證後，再重新產生並發布這個 source-available 公開版本。
請勿直接修改由此流程產生的 Public Repository；只有 owner 另行邀請時才提供修改內容。
Dependency 升級與安全修正也遵循相同流程，不會直接合併 Public bot Pull Request。

## 受邀修改時的本機檢查

```powershell
npm ci
npm audit --registry=https://registry.npmjs.org
npm run check
```

測試必須使用虛構值與離線 fixture，不得呼叫真實收件者或提交 runtime state。
