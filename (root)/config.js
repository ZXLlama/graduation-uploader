window.APP_CONFIG = Object.freeze({
  // Google Apps Script Web App URL（部署後填入 /exec）
  SCRIPT_URL: "https://script.google.com/macros/s/AKfycby0BfZVAyCVZWA-eFzzizrpGq3a3Ilz4yry6fHXf6BFJgfm4RvrTg8vp6ZfC5i2gHrYIQ/exec",

  // 投稿截止時間（前端顯示倒數，後端也會再次驗證）
  DEADLINE_ISO: "2026-07-01T23:59:59+08:00",

  // 前端是否也比對投稿碼（公開網站不建議硬寫真實碼，預設關閉）
  ENABLE_CLIENT_UPLOAD_CODE_CHECK: false,
  CLIENT_UPLOAD_CODE: " ",

  // 限制設定
  MAX_IMAGE_MB: 20,
  MAX_VIDEO_MB: 150,

  // 允許格式（前端預檢）
  ALLOWED_EXTENSIONS: ["jpg", "jpeg", "png", "webp", "mp4", "mov", "heif", "heic"],
  ALLOWED_MIME_TYPES: [
    "image/jpg",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heif",
    "image/heic",
    "video/mp4",
    "video/quicktime",
    "application/octet-stream"
  ]
});
