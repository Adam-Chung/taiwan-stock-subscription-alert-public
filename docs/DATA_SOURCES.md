# 資料來源與授權邊界

檢查日期：2026-10-13

Public mirror 預設 `ENABLE_EXTERNAL_FETCH=false`，不會自動連線下列來源。啟用前必須
由部署者重新檢查當時有效的條款、授權、`robots.txt`、頻率限制、資料保存與轉傳
規則。下表是工程邊界紀錄，不是法律意見或永久授權證明。

| 來源 | 用途 | Public 預設 | 邊界 |
|---|---|---:|---|
| TWSE 公開申購介面 | 申購日程與承銷資料 | 停用 | TWSE 網站與交易資訊另有使用規範；啟用前須確認自動存取與使用目的 |
| TWSE / TPEx 公司 OpenAPI | 原已發行股數與產業類型 | 停用 | 應以各端點最新授權及資料集說明為準 |
| TWSE MIS | 上市櫃即時或前收行情 | 停用 | 不得因端點可連線就推定可公開轉傳或商業使用 |
| TPEx 興櫃 OpenAPI | 興櫃最近行情 | 停用 | data.gov.tw 列出的資料仍須遵守政府資料開放授權與欄位說明 |
| MOPS | 現金增資重大訊息 | 另行停用 | 除總開關外還須設定 `ENABLE_MOPS_FETCH=true`；不得繞過拒絕或存取限制 |
| Goodinfo 連結 | 供使用者自行查閱公告列表 | 不主動抓取 | 程式只產生連結，使用者仍須遵守該網站當時條款 |

參考入口：

- [TWSE 網站使用條款](https://wwwc.twse.com.tw/zh/terms/use.html)
- [TWSE 交易資訊使用管理](https://wwwc.twse.com.tw/zh/products/information/use.html)
- [政府資料開放平臺](https://data.gov.tw/)

## 啟用檢查清單

1. 確認來源允許目前的自動存取方式、頻率、保存期間與輸出用途。
2. 確認是否要求申請、付費、標示來源、禁止轉傳或限制商業使用。
3. 保留低頻率、有限重試、`redirect: manual` 與明確拒絕即停止的行為。
4. 不將第三方完整內容、production response body 或個人資料加入 fixture。
5. 條款、端點或使用情境改變時重新審查；商業化、多使用者或高頻使用視為新風險。
