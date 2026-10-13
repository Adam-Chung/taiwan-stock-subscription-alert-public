# Contributing

感謝你協助改善這個 Public mirror。

## 目前接受的回饋

- 可重現的 bug report
- 不含敏感資料的安全性建議；安全漏洞請依 `SECURITY.md` 私下回報
- 官方資料格式變更或測試案例建議
- 文件錯誤與無障礙改善

由於本 Repository 尚未選定 License 與貢獻授權機制，目前先不接受 Pull Request。
請以 Issue 描述問題與建議，不要貼上受著作權保護的完整第三方內容、正式訊息、
token、userId、雜湊、內部 URL 或 production log。

Public Repository 是單向衍生輸出。經確認的修正會由維護者手動實作或移植到
Private source-of-truth，完成完整驗證後再重新發布；Public 內容不會自動流入 Private。

## 本機檢查

```powershell
npm ci
npm audit --registry=https://registry.npmjs.org
npm run check
```

測試必須使用虛構值與離線 fixture，不得呼叫真實收件者或提交 runtime state。
