# graduation-uploader

「國一到高三畢業回憶素材收集網站」完整可部署版本。  
前端放在 GitHub Pages，後端使用 Google Apps Script Web App，檔案存 Google Drive，投稿紀錄寫入 Google Sheets，全程免費、無需自架伺服器。

## 專案介紹

這個專案讓同學可以用手機或電腦投稿國一到高三的照片/影片/迷因/經典事件素材，集中到你的 Google Drive 指定資料夾，方便後續剪畢業回憶影片。  
網站包含截止倒數、拖曳上傳、多檔案管理、前後端驗證與 Google Sheets 紀錄。

## 功能列表

- 手機優先、深色卡片式 UI（時光膠囊/畢業回憶風格）
- 首頁顯示截止日期與倒數
- 截止後自動鎖定 UI，顯示「投稿已截止」
- 拖曳上傳 + 點擊選檔
- `multiple` 多檔上傳
- 圖片縮圖預覽
- 影片顯示檔名、大小與影片標記
- 顯示總檔案數與總大小（KB/MB/GB 自動格式化）
- 可刪除已選檔案
- 上傳進度文字（第 x / y 個）
- 成功訊息與錯誤訊息
- 前端與後端都驗證：
  - 投稿碼
  - 截止日期
  - 檔案類型
  - 單檔大小
  - 必填欄位
- Google Drive 自動建立分層資料夾（年級 / 類別）
- 檔名自動重新命名，避免重複
- Google Sheets 自動建立工作表表頭（若不存在）
- 健康檢查 API：`?action=status`

## 檔案結構

```text
graduation-uploader/
  README.md
  public/
    index.html
    styles.css
    app.js
    config.js
  gas/
    Code.gs
```

## 1) 建立 Google Drive 根資料夾

1. 到 Google Drive 建立一個資料夾，例如：`國一到高三回憶素材`
2. 這個資料夾就是上傳根目錄，Apps Script 會在底下自動建立：
   - `國一/照片`
   - `國一/影片`
   - `國一/迷因`
   - `國一/經典事件`
   - `國二/...`
   - `國三/...`
   - `高一/...`
   - `高二/...`
   - `高三/...`
   - `其他/...`

## 2) 取得 ROOT_FOLDER_ID

1. 打開該 Drive 資料夾
2. 網址通常長這樣：
   - `https://drive.google.com/drive/folders/xxxxxxxxxxxxxxxxxxxx`
3. `folders/` 後面的字串就是 `ROOT_FOLDER_ID`

## 3) 建立 / 綁定 Google Sheets

1. 建立一份 Google 試算表，例如：`國一到高三回憶投稿紀錄`
2. 複製網址中的 Spreadsheet ID：
   - `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`
3. 記下 `<SPREADSHEET_ID>`，稍後填到 `Code.gs` 的 `SPREADSHEET_ID`

## 4) 建立 Google Apps Script 專案

1. 進入 https://script.google.com
2. 建立新專案
3. 將 `gas/Code.gs` 內容整份貼上（覆蓋預設程式碼）

## 5) 在 Code.gs 設定常數

請修改最上方 `CONFIG`：

- `ROOT_FOLDER_ID`: 你的 Drive 根資料夾 ID
- `SPREADSHEET_ID`: 你的 Google Sheets ID
- `UPLOAD_CODE`: 投稿碼（後端真正驗證用）
- `DEADLINE_ISO`: 截止時間（ISO 格式，建議含時區）
- `SHEET_NAME`: 投稿紀錄工作表名稱（可維持 `submissions`）

範例：

```js
ROOT_FOLDER_ID: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
SPREADSHEET_ID: '1x2y3z4a5b6c7d8e9f...',
UPLOAD_CODE: 'P3CLASS2026',
DEADLINE_ISO: '2026-06-10T23:59:59+08:00',
```

## 6) 部署成 Google Apps Script Web App

1. Apps Script 右上角點 `部署` -> `新增部署`
2. 類型選 `網頁應用程式`
3. 設定：
   - `執行身分`：`我`
   - `誰可以存取`：`任何人`
4. 按部署，授權後取得 Web App URL（結尾通常是 `/exec`）

## 7) Web App 權限建議

- 一定要用 `任何人`（否則 GitHub Pages 前端無法匿名呼叫）
- Apps Script 會用你的帳號權限寫入 Drive / Sheets

## 8) 設定前端 `public/config.js`

修改以下值：

- `SCRIPT_URL`: 你剛部署的 Web App `/exec` URL
- `DEADLINE_ISO`: 與後端相同截止時間
- `ENABLE_CLIENT_UPLOAD_CODE_CHECK`: 是否開前端比對投稿碼（預設 `false`）
- `CLIENT_UPLOAD_CODE`: 若要前端也比對，填同一組投稿碼

說明：

- 前端程式碼是公開的，不建議把真正敏感碼硬寫死
- 本專案預設前端只檢查「有沒有填投稿碼」，真正安全驗證由後端 `UPLOAD_CODE` 決定

## 9) 部署到 GitHub Pages

1. 建立 GitHub Repo（例如 `graduation-uploader`）
2. 將本專案上傳
3. 到 GitHub `Settings` -> `Pages`
4. `Source` 選 `Deploy from a branch`
5. Branch 選 `main`，資料夾選 `/public`（或你也可改用 root 目錄）
6. 儲存後等待部署完成，取得網站網址

## API 介面說明

### `GET /exec?action=status`

用途：健康檢查、取得截止狀態

回傳範例：

```json
{
  "success": true,
  "message": "ok",
  "data": {
    "service": "graduation-uploader-gas",
    "serverTimeIso": "2026-03-08T08:00:00.000Z",
    "deadlineIso": "2026-06-10T23:59:59+08:00",
    "isDeadlinePassed": false
  }
}
```

### `POST /exec`

用途：上傳單一檔案（前端會逐檔呼叫）

必要欄位：

- `action = upload`
- `uploadCode`
- `nickname`（必填）
- `gradePeriod`
- `category`
- `note`
- `file.originalFilename`
- `file.mimeType`
- `file.size`
- `file.base64Data`

`category` 目前支援：

- `照片`
- `影片`
- `迷因`
- `經典事件`
- `班級日常`
- `社團活動`
- `校慶運動會`
- `校外教學`
- `考前衝刺`
- `老師語錄`
- `畢業活動`
- `其他趣事`

## 常見錯誤排查

1. `請先設定 SCRIPT_URL`
   - `public/config.js` 還是預設值，請改成正式 `/exec` URL

2. `投稿碼錯誤`
   - 前端輸入碼與 `Code.gs` 的 `UPLOAD_CODE` 不一致

3. `投稿已截止`
   - 前端或後端任一方判定超過 `DEADLINE_ISO` 都會拒絕

4. `檔案類型不支援`
   - 檢查副檔名 / MIME 是否在允許清單

5. `Exceeded maximum execution time` 或大型影片失敗
   - Apps Script 對大檔案不穩定，請壓縮影片後重傳

6. Sheets 沒有寫入資料
   - 檢查 `SPREADSHEET_ID` 是否正確、Web App 授權是否完成

7. Drive 沒看到檔案
   - 檢查 `ROOT_FOLDER_ID` 是否正確，確認部署是最新版本

## 限制與注意事項（務必閱讀）

- Apps Script 雖可接收檔案，但對「大影片」不穩定，限制來自：
  - 請求大小
  - Base64 膨脹（約 +33%）
  - 腳本執行時間上限
- 本專案仍保留你要求的大小驗證預設：
  - 圖片：20MB/檔
  - 影片：150MB/檔
- 但實務上建議：
  - 影片盡量壓在 20MB~40MB 內
  - 單次少量影片、以照片為主
- `heic/heif`：
  - 後端可儲存至 Drive
  - 但不同手機/瀏覽器回報的 MIME 可能不一致（有時是 `application/octet-stream`），本專案已同時用副檔名與 MIME 驗證提高相容性

## 建議使用情境

- 最適合：大量照片 + 少量短影片
- 若大量長影片：建議改讓同學直接分享雲端連結，或先壓縮後再投稿

## 後續可擴充方向

- 管理員審核頁（已審/未審）
- 投稿碼多組（不同班級或群組）
- 黑名單檔名/關鍵字過濾
- 自動寄送投稿成功通知信
- 生成每週投稿統計報表
- 新增「直接上傳到指定共享雲端硬碟」模式
