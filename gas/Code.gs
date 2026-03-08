/**
 * 國一到高三畢業回憶素材收集 API（Google Apps Script Web App）
 * 前端可部署在 GitHub Pages，透過 fetch 呼叫本 API。
 */

const CONFIG = Object.freeze({
  // ===== 必填設定 =====
  ROOT_FOLDER_ID: "REPLACE_WITH_ROOT_FOLDER_ID",
  SPREADSHEET_ID: "REPLACE_WITH_SPREADSHEET_ID",
  UPLOAD_CODE: "CHANGE_THIS_UPLOAD_CODE",
  DEADLINE_ISO: "2026-07-01T23:59:59+08:00",

  // ===== 其他設定 =====
  SHEET_NAME: "submissions",
  TIME_ZONE: "Asia/Taipei",
  MAX_NOTE_LENGTH: 500,

  // 檔案大小上限
  MAX_IMAGE_BYTES: 20 * 1024 * 1024,
  MAX_VIDEO_BYTES: 150 * 1024 * 1024,

  ALLOWED_GRADE_PERIODS: ["國一", "國二", "國三", "高一", "高二", "高三", "其他"],
  ALLOWED_CATEGORIES: [
    "照片",
    "影片",
    "迷因",
    "經典事件",
    "班級日常",
    "社團活動",
    "校慶運動會",
    "校外教學",
    "考前衝刺",
    "老師語錄",
    "畢業活動",
    "其他趣事"
  ],
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

const SHEET_HEADERS = [
  "timestamp",
  "nickname",
  "gradePeriod",
  "category",
  "note",
  "originalFilename",
  "savedFilename",
  "mimeType",
  "fileSize",
  "driveFileId",
  "driveFileUrl"
];

/**
 * GET: 健康檢查 / 狀態查詢
 * 用法：?action=status
 */
function doGet(e) {
  try {
    const action = getAction_(e, "status");

    if (action === "status") {
      return jsonResponse_({
        success: true,
        message: "ok",
        data: buildStatus_()
      });
    }

    return jsonResponse_({
      success: false,
      message: "Unsupported action: " + action,
      data: buildStatus_()
    });
  } catch (error) {
    return jsonResponse_(buildErrorPayload_(error));
  }
}

/**
 * POST: 上傳檔案（前端逐檔呼叫）
 */
function doPost(e) {
  try {
    validateServerConfig_();

    const payload = parsePostPayload_(e);
    const action = String(payload.action || "upload").toLowerCase();

    if (action === "status") {
      return jsonResponse_({
        success: true,
        message: "ok",
        data: buildStatus_()
      });
    }

    if (action !== "upload") {
      throw new Error("Unsupported action: " + action);
    }

    validateDeadline_();
    validateUploadCode_(payload.uploadCode);

    const metadata = normalizeMetadata_(payload);
    validateMetadata_(metadata);

    const fileInfo = normalizeAndValidateFile_(payload.file);
    const uploadResult = saveFileToDrive_(metadata, fileInfo);
    appendSubmissionLog_(metadata, fileInfo, uploadResult);

    return jsonResponse_({
      success: true,
      message: "Upload success",
      data: {
        savedFilename: uploadResult.savedFilename,
        driveFileId: uploadResult.driveFileId,
        driveFileUrl: uploadResult.driveFileUrl,
        serverTimeIso: new Date().toISOString()
      }
    });
  } catch (error) {
    return jsonResponse_(buildErrorPayload_(error));
  }
}

function getAction_(e, fallbackAction) {
  if (!e || !e.parameter || !e.parameter.action) {
    return fallbackAction;
  }
  return String(e.parameter.action).toLowerCase();
}

function parsePostPayload_(e) {
  if (!e) {
    throw new Error("Missing request event.");
  }

  let raw = "";

  if (e.postData && typeof e.postData.contents === "string") {
    raw = e.postData.contents;
  } else if (e.parameter && e.parameter.payload) {
    raw = e.parameter.payload;
  }

  if (!raw) {
    throw new Error("Request body is empty.");
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("Invalid JSON payload.");
  }
}

function validateServerConfig_() {
  if (!CONFIG.ROOT_FOLDER_ID || CONFIG.ROOT_FOLDER_ID.indexOf("REPLACE_WITH") === 0) {
    throw new Error("Server config error: ROOT_FOLDER_ID is not set.");
  }

  if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID.indexOf("REPLACE_WITH") === 0) {
    throw new Error("Server config error: SPREADSHEET_ID is not set.");
  }

  if (!CONFIG.UPLOAD_CODE || CONFIG.UPLOAD_CODE.indexOf("CHANGE_THIS") === 0) {
    throw new Error("Server config error: UPLOAD_CODE is not set.");
  }

  getDeadlineDate_();
}

function getDeadlineDate_() {
  const deadline = new Date(CONFIG.DEADLINE_ISO);
  if (Number.isNaN(deadline.getTime())) {
    throw new Error("Server config error: DEADLINE_ISO format is invalid.");
  }
  return deadline;
}

function validateDeadline_() {
  const now = new Date();
  const deadline = getDeadlineDate_();
  if (now.getTime() > deadline.getTime()) {
    throw new Error("投稿已截止。");
  }
}

function validateUploadCode_(uploadCode) {
  const code = String(uploadCode || "").trim();
  if (!code) {
    throw new Error("請輸入投稿碼。");
  }
  if (code !== CONFIG.UPLOAD_CODE) {
    throw new Error("投稿碼錯誤。");
  }
}

function normalizeMetadata_(payload) {
  const nicknameRaw = String(payload.nickname || "").trim();
  const noteRaw = String(payload.note || "").trim();

  return {
    nickname: truncateText_(nicknameRaw, 40),
    gradePeriod: String(payload.gradePeriod || "").trim(),
    category: String(payload.category || "").trim(),
    note: truncateText_(noteRaw, CONFIG.MAX_NOTE_LENGTH)
  };
}

function validateMetadata_(metadata) {
  if (!metadata.nickname) {
    throw new Error("請填寫暱稱或名字。");
  }

  if (!metadata.gradePeriod || CONFIG.ALLOWED_GRADE_PERIODS.indexOf(metadata.gradePeriod) === -1) {
    throw new Error("素材年代不合法。");
  }

  if (!metadata.category || CONFIG.ALLOWED_CATEGORIES.indexOf(metadata.category) === -1) {
    throw new Error("素材類型不合法。");
  }
}

function normalizeAndValidateFile_(filePayload) {
  if (!filePayload || typeof filePayload !== "object") {
    throw new Error("缺少檔案資料。");
  }

  const originalFilename = String(filePayload.originalFilename || "").trim();
  const mimeType = String(filePayload.mimeType || "").toLowerCase().trim();
  const extension = getFileExtension_(originalFilename);
  const declaredSize = Number(filePayload.size);
  const base64Data = stripDataUrlPrefix_(String(filePayload.base64Data || "").trim());

  if (!originalFilename) {
    throw new Error("originalFilename 不可為空。");
  }

  if (!base64Data) {
    throw new Error("未收到檔案內容。");
  }

  if (!declaredSize || declaredSize <= 0) {
    throw new Error("檔案大小不合法。");
  }

  const allowedByExt = CONFIG.ALLOWED_EXTENSIONS.indexOf(extension) >= 0;
  const allowedByMime = CONFIG.ALLOWED_MIME_TYPES.indexOf(mimeType) >= 0;

  if (!allowedByExt && !allowedByMime) {
    throw new Error("檔案格式不支援。");
  }

  const isVideo = isVideoFile_(extension, mimeType);
  const sizeLimit = isVideo ? CONFIG.MAX_VIDEO_BYTES : CONFIG.MAX_IMAGE_BYTES;

  if (declaredSize > sizeLimit) {
    throw new Error(
      "檔案超過上限（" + (isVideo ? formatBytes_(CONFIG.MAX_VIDEO_BYTES) : formatBytes_(CONFIG.MAX_IMAGE_BYTES)) + "）。"
    );
  }

  return {
    originalFilename: originalFilename,
    mimeType: mimeType || guessMimeType_(extension),
    extension: extension || "bin",
    declaredSize: declaredSize,
    base64Data: base64Data,
    isVideo: isVideo
  };
}

function saveFileToDrive_(metadata, fileInfo) {
  const bytes = Utilities.base64Decode(fileInfo.base64Data);

  if (!bytes || bytes.length <= 0) {
    throw new Error("無法解碼檔案內容。");
  }

  const sizeLimit = fileInfo.isVideo ? CONFIG.MAX_VIDEO_BYTES : CONFIG.MAX_IMAGE_BYTES;
  if (bytes.length > sizeLimit) {
    throw new Error("檔案實際大小超過限制。");
  }

  const rootFolder = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  const targetFolder = ensureFolderPath_(rootFolder, [metadata.gradePeriod, metadata.category]);
  const savedFilename = buildSavedFilename_(metadata, fileInfo.originalFilename, fileInfo.extension);

  const blob = Utilities.newBlob(bytes, fileInfo.mimeType, savedFilename);
  const driveFile = targetFolder.createFile(blob);

  return {
    savedFilename: savedFilename,
    driveFileId: driveFile.getId(),
    driveFileUrl: driveFile.getUrl(),
    actualSize: bytes.length
  };
}

function buildSavedFilename_(metadata, originalFilename, extension) {
  const datePrefix = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, "yyyy-MM-dd");
  const timePrefix = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, "HHmmss");
  const safeNickname = sanitizeForFilename_(metadata.nickname, 40);
  const originalBase = sanitizeForFilename_(removeExtension_(originalFilename), 80);
  const safeGrade = sanitizeForFilename_(metadata.gradePeriod, 10);
  const safeCategory = sanitizeForFilename_(metadata.category, 12);
  const ext = sanitizeForFilename_(extension, 10) || "bin";

  return [datePrefix, timePrefix, safeGrade, safeCategory, safeNickname, originalBase].join("_") + "." + ext;
}

function ensureFolderPath_(rootFolder, names) {
  let current = rootFolder;
  names.forEach(function (name) {
    current = getOrCreateFolder_(current, name);
  });
  return current;
}

function getOrCreateFolder_(parent, folderName) {
  const folders = parent.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parent.createFolder(folderName);
}

function appendSubmissionLog_(metadata, fileInfo, uploadResult) {
  const sheet = getOrCreateSheet_();
  const timestamp = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, "yyyy-MM-dd HH:mm:ss");

  sheet.appendRow([
    timestamp,
    metadata.nickname,
    metadata.gradePeriod,
    metadata.category,
    metadata.note,
    fileInfo.originalFilename,
    uploadResult.savedFilename,
    fileInfo.mimeType,
    uploadResult.actualSize,
    uploadResult.driveFileId,
    uploadResult.driveFileUrl
  ]);
}

function getOrCreateSheet_() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONFIG.SHEET_NAME);
  }

  ensureSheetHeader_(sheet);
  return sheet;
}

function ensureSheetHeader_(sheet) {
  const headerRange = sheet.getRange(1, 1, 1, SHEET_HEADERS.length);
  const values = headerRange.getValues()[0];
  const isEmpty = values.every(function (cell) {
    return String(cell).trim() === "";
  });

  if (isEmpty) {
    headerRange.setValues([SHEET_HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }

  let mismatch = false;
  for (let i = 0; i < SHEET_HEADERS.length; i += 1) {
    if (String(values[i]).trim() !== SHEET_HEADERS[i]) {
      mismatch = true;
      break;
    }
  }

  if (mismatch) {
    sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, SHEET_HEADERS.length).setValues([SHEET_HEADERS]);
    sheet.setFrozenRows(1);
  }
}

function buildStatus_() {
  const now = new Date();
  const deadline = getDeadlineDate_();

  return {
    service: "graduation-uploader-gas",
    serverTimeIso: now.toISOString(),
    deadlineIso: CONFIG.DEADLINE_ISO,
    isDeadlinePassed: now.getTime() > deadline.getTime(),
    maxImageBytes: CONFIG.MAX_IMAGE_BYTES,
    maxVideoBytes: CONFIG.MAX_VIDEO_BYTES,
    allowedExtensions: CONFIG.ALLOWED_EXTENSIONS.slice()
  };
}

function buildErrorPayload_(error) {
  let message = "Unexpected error.";
  if (error && error.message) {
    message = error.message;
  }

  return {
    success: false,
    message: message,
    data: {
      serverTimeIso: new Date().toISOString()
    }
  };
}

function jsonResponse_(payload) {
  const output = ContentService.createTextOutput(JSON.stringify(payload));
  output.setMimeType(ContentService.MimeType.JSON);
  return withCorsIfSupported_(output);
}

/**
 * Apps Script 多數情況無法手動設自訂 header；
 * 若未來執行環境提供 setHeader，這裡會自動補上 CORS。
 */
function withCorsIfSupported_(output) {
  if (output && typeof output.setHeader === "function") {
    output.setHeader("Access-Control-Allow-Origin", "*");
    output.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    output.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  return output;
}

function isVideoFile_(extension, mimeType) {
  return mimeType.indexOf("video/") === 0 || extension === "mp4" || extension === "mov";
}

function getFileExtension_(filename) {
  const index = String(filename || "").lastIndexOf(".");
  if (index < 0) {
    return "";
  }
  return filename.slice(index + 1).toLowerCase();
}

function removeExtension_(filename) {
  const name = String(filename || "");
  const index = name.lastIndexOf(".");
  if (index <= 0) {
    return name;
  }
  return name.slice(0, index);
}

function stripDataUrlPrefix_(raw) {
  if (raw.indexOf("data:") === 0) {
    const comma = raw.indexOf(",");
    if (comma >= 0) {
      return raw.slice(comma + 1);
    }
  }
  return raw;
}

function truncateText_(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength);
}

function sanitizeForFilename_(text, maxLength) {
  const cleaned = String(text || "")
    .replace(/[\\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return truncateText_(cleaned || "unknown", maxLength || 60);
}

function guessMimeType_(extension) {
  const map = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heif: "image/heif",
    heic: "image/heic",
    mp4: "video/mp4",
    mov: "video/quicktime"
  };
  return map[extension] || "application/octet-stream";
}

function formatBytes_(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes) || 0;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 100 || unitIndex === 0 ? 0 : 1;
  return value.toFixed(digits) + " " + units[unitIndex];
}
