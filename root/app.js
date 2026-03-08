(function () {
  "use strict";

  var config = window.APP_CONFIG || {};
  var scriptUrl = String(config.SCRIPT_URL || "").trim();
  var deadlineIso = String(config.DEADLINE_ISO || "").trim();
  var deadlineDate = new Date(deadlineIso);

  var maxImageBytes = (Number(config.MAX_IMAGE_MB) || 20) * 1024 * 1024;
  var maxVideoBytes = (Number(config.MAX_VIDEO_MB) || 150) * 1024 * 1024;
  var enableClientCodeCheck = Boolean(config.ENABLE_CLIENT_UPLOAD_CODE_CHECK);
  var clientUploadCode = String(config.CLIENT_UPLOAD_CODE || "");

  var allowedExtensions = new Set(
    (config.ALLOWED_EXTENSIONS || []).map(function (item) {
      return String(item).toLowerCase();
    })
  );

  var allowedMimeTypes = new Set(
    (config.ALLOWED_MIME_TYPES || []).map(function (item) {
      return String(item).toLowerCase();
    })
  );

  var imageExtensions = new Set(["jpg", "jpeg", "png", "webp", "heif", "heic"]);
  var videoExtensions = new Set(["mp4", "mov"]);

  var state = {
    files: [],
    uploading: false,
    lockedByDeadline: false,
    timerId: null
  };

  var el = {
    form: document.getElementById("uploadForm"),
    uploadCode: document.getElementById("uploadCode"),
    nickname: document.getElementById("nickname"),
    gradePeriod: document.getElementById("gradePeriod"),
    category: document.getElementById("category"),
    note: document.getElementById("note"),
    fileInput: document.getElementById("fileInput"),
    pickBtn: document.getElementById("pickBtn"),
    clearBtn: document.getElementById("clearBtn"),
    submitBtn: document.getElementById("submitBtn"),
    dropZone: document.getElementById("dropZone"),
    fileList: document.getElementById("fileList"),
    fileCount: document.getElementById("fileCount"),
    fileSize: document.getElementById("fileSize"),
    progressText: document.getElementById("progressText"),
    messageText: document.getElementById("messageText"),
    deadlineText: document.getElementById("deadlineText"),
    countdownText: document.getElementById("countdownText"),
    statusBadge: document.getElementById("statusBadge")
  };

  init();

  function init() {
    if (!el.form) {
      return;
    }

    bindEvents();
    renderFileList();
    renderDeadlineText();
    updateCountdown();

    state.timerId = window.setInterval(updateCountdown, 1000);

    if (isScriptUrlReady()) {
      pingStatus();
    } else {
      setMessage("請先在 config.js 設定 SCRIPT_URL（Google Apps Script /exec URL）。", "error");
    }
  }

  function bindEvents() {
    el.pickBtn.addEventListener("click", function () {
      if (isInteractionLocked()) {
        return;
      }
      el.fileInput.click();
    });

    el.fileInput.addEventListener("change", function (event) {
      addFiles(event.target.files);
      event.target.value = "";
    });

    el.dropZone.addEventListener("click", function (event) {
      if (event.target.closest("button")) {
        return;
      }
      if (isInteractionLocked()) {
        return;
      }
      el.fileInput.click();
    });

    el.dropZone.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      if (isInteractionLocked()) {
        return;
      }
      el.fileInput.click();
    });

    ["dragenter", "dragover"].forEach(function (type) {
      el.dropZone.addEventListener(type, function (event) {
        event.preventDefault();
        if (isInteractionLocked()) {
          return;
        }
        el.dropZone.classList.add("is-dragover");
      });
    });

    ["dragleave", "dragend", "drop"].forEach(function (type) {
      el.dropZone.addEventListener(type, function (event) {
        event.preventDefault();
        el.dropZone.classList.remove("is-dragover");
      });
    });

    el.dropZone.addEventListener("drop", function (event) {
      if (isInteractionLocked()) {
        return;
      }
      addFiles(event.dataTransfer.files);
    });

    el.fileList.addEventListener("click", function (event) {
      var removeBtn = event.target.closest("[data-remove-id]");
      if (!removeBtn || isInteractionLocked()) {
        return;
      }
      removeFile(removeBtn.getAttribute("data-remove-id"));
    });

    el.clearBtn.addEventListener("click", function () {
      if (isInteractionLocked()) {
        return;
      }
      clearSelectedFiles();
      setMessage("", "");
      setProgress("");
    });

    el.form.addEventListener("submit", handleSubmit);
  }

  function updateCountdown() {
    if (!isValidDate(deadlineDate)) {
      setBadge("截止時間格式錯誤", "is-closed");
      el.countdownText.textContent = "請修正 config.js 的 DEADLINE_ISO。";
      setDeadlineLock(true, "截止時間設定錯誤，已暫停上傳。");
      return;
    }

    var now = Date.now();
    var diff = deadlineDate.getTime() - now;

    if (diff <= 0) {
      el.countdownText.textContent = "投稿已截止";
      setBadge("投稿已截止", "is-closed");
      setDeadlineLock(true, "投稿已截止。");
      return;
    }

    el.countdownText.textContent = "距離截止還有 " + formatCountdown(diff);
    setBadge("投稿開放中", "is-open");
    setDeadlineLock(false, "");
  }

  function renderDeadlineText() {
    if (!isValidDate(deadlineDate)) {
      el.deadlineText.textContent = "設定錯誤";
      return;
    }
    el.deadlineText.textContent = formatDate(deadlineDate);
  }

  function setBadge(text, className) {
    el.statusBadge.textContent = text;
    el.statusBadge.classList.remove("is-open", "is-closed");
    if (className) {
      el.statusBadge.classList.add(className);
    }
  }

  function setDeadlineLock(locked, reason) {
    state.lockedByDeadline = locked;
    syncDisabledState();

    if (locked && reason) {
      setMessage(reason, "error");
    }
  }

  function syncDisabledState() {
    var disabled = state.uploading || state.lockedByDeadline;

    [el.uploadCode, el.nickname, el.gradePeriod, el.category, el.note, el.fileInput, el.pickBtn, el.clearBtn, el.submitBtn].forEach(
      function (node) {
        if (node) {
          node.disabled = disabled;
        }
      }
    );

    if (disabled) {
      el.dropZone.classList.add("is-disabled");
    } else {
      el.dropZone.classList.remove("is-disabled");
    }
  }

  function isInteractionLocked() {
    return state.uploading || state.lockedByDeadline;
  }

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) {
      return;
    }

    var rejectMessages = [];

    files.forEach(function (file) {
      var check = validateFile(file);
      if (!check.ok) {
        rejectMessages.push(file.name + "： " + check.message);
        return;
      }

      var key = buildFileKey(file);
      if (state.files.some(function (item) { return item.key === key; })) {
        rejectMessages.push(file.name + "：已在清單中");
        return;
      }

      state.files.push({
        id: generateId(),
        key: key,
        file: file,
        isImage: check.isImage,
        isVideo: check.isVideo,
        previewUrl: check.isImage ? URL.createObjectURL(file) : ""
      });
    });

    renderFileList();

    if (rejectMessages.length) {
      setMessage(rejectMessages.join("\n"), "error");
    } else {
      setMessage("", "");
    }
  }

  function validateFile(file) {
    var extension = getExtension(file.name);
    var mimeType = String(file.type || "").toLowerCase();
    var allowedByExt = allowedExtensions.has(extension);
    var allowedByMime = allowedMimeTypes.has(mimeType);

    if (!allowedByExt && !allowedByMime) {
      return { ok: false, message: "檔案格式不支援（僅支援 jpg/jpeg/png/webp/mp4/mov/heif/heic）" };
    }

    var isVideo = mimeType.indexOf("video/") === 0 || videoExtensions.has(extension);
    var isImage = !isVideo && (mimeType.indexOf("image/") === 0 || imageExtensions.has(extension));
    var limit = isVideo ? maxVideoBytes : maxImageBytes;

    if (file.size > limit) {
      return {
        ok: false,
        message: "超過單檔上限（" + (isVideo ? formatBytes(maxVideoBytes) : formatBytes(maxImageBytes)) + "）"
      };
    }

    if (file.size <= 0) {
      return { ok: false, message: "檔案大小不可為 0" };
    }

    return { ok: true, isImage: isImage, isVideo: isVideo };
  }

  function renderFileList() {
    el.fileList.innerHTML = "";

    state.files.forEach(function (record) {
      var item = document.createElement("li");
      item.className = "file-item";

      var thumb = document.createElement("div");
      thumb.className = "file-thumb";

      if (record.isImage && record.previewUrl) {
        var img = document.createElement("img");
        img.src = record.previewUrl;
        img.alt = record.file.name;
        thumb.appendChild(img);
      } else {
        thumb.textContent = record.isVideo ? "VIDEO" : "FILE";
      }

      var main = document.createElement("div");
      main.className = "file-main";

      var name = document.createElement("p");
      name.className = "file-name";
      name.textContent = record.file.name;

      var meta = document.createElement("p");
      meta.className = "file-meta";
      meta.textContent = (record.isVideo ? "影片" : "圖片/素材") + " ・ " + formatBytes(record.file.size);

      main.appendChild(name);
      main.appendChild(meta);

      var removeBtn = document.createElement("button");
      removeBtn.className = "file-remove";
      removeBtn.type = "button";
      removeBtn.textContent = "刪除";
      removeBtn.setAttribute("data-remove-id", record.id);
      removeBtn.disabled = isInteractionLocked();

      item.appendChild(thumb);
      item.appendChild(main);
      item.appendChild(removeBtn);

      el.fileList.appendChild(item);
    });

    var totalSize = state.files.reduce(function (sum, item) {
      return sum + item.file.size;
    }, 0);

    el.fileCount.textContent = state.files.length + " 檔案";
    el.fileSize.textContent = "總大小 " + formatBytes(totalSize);
  }

  function removeFile(id) {
    var next = [];
    state.files.forEach(function (item) {
      if (item.id === id) {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
        return;
      }
      next.push(item);
    });

    state.files = next;
    renderFileList();
  }

  function clearSelectedFiles() {
    state.files.forEach(function (item) {
      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
    state.files = [];
    renderFileList();
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (state.uploading) {
      return;
    }

    setMessage("", "");
    setProgress("");

    if (state.lockedByDeadline) {
      setMessage("投稿已截止，無法上傳。", "error");
      return;
    }

    if (!isScriptUrlReady()) {
      setMessage("SCRIPT_URL 尚未設定正確。", "error");
      return;
    }

    if (!state.files.length) {
      setMessage("請至少選擇 1 個檔案。", "error");
      return;
    }

    var formData = collectFormData();
    var formCheck = validateFormData(formData);

    if (!formCheck.ok) {
      setMessage(formCheck.message, "error");
      return;
    }

    state.uploading = true;
    syncDisabledState();
    renderFileList();

    var uploaded = 0;

    try {
      for (var i = 0; i < state.files.length; i += 1) {
        var record = state.files[i];
        setProgress("正在上傳第 " + (i + 1) + " / " + state.files.length + " 個： " + record.file.name);

        var base64Data = await readFileAsBase64(record.file);
        var payload = {
          action: "upload",
          uploadCode: formData.uploadCode,
          nickname: formData.nickname,
          gradePeriod: formData.gradePeriod,
          category: formData.category,
          note: formData.note,
          clientDeadlineIso: deadlineIso,
          file: {
            originalFilename: record.file.name,
            mimeType: record.file.type || "",
            size: record.file.size,
            base64Data: base64Data
          }
        };

        var response = await postPayload(payload);
        if (!response.success) {
          throw new Error(response.message || "伺服器拒絕上傳");
        }

        uploaded += 1;
      }

      setProgress("上傳完成： " + uploaded + " / " + state.files.length + " 個檔案");
      setMessage("投稿成功，感謝你的回憶素材。", "success");

      el.form.reset();
      clearSelectedFiles();
    } catch (error) {
      setMessage("上傳失敗： " + normalizeError(error), "error");
      setProgress("已完成 " + uploaded + " / " + state.files.length + " 個。");
    } finally {
      state.uploading = false;
      syncDisabledState();
      renderFileList();
    }
  }

  function collectFormData() {
    return {
      uploadCode: String(el.uploadCode.value || "").trim(),
      nickname: String(el.nickname.value || "").trim(),
      gradePeriod: String(el.gradePeriod.value || "").trim(),
      category: String(el.category.value || "").trim(),
      note: String(el.note.value || "").trim()
    };
  }

  function validateFormData(formData) {
    if (!formData.uploadCode) {
      return { ok: false, message: "請輸入投稿碼。" };
    }

    if (enableClientCodeCheck && clientUploadCode && formData.uploadCode !== clientUploadCode) {
      return { ok: false, message: "投稿碼錯誤（前端檢查）。" };
    }

    if (!formData.gradePeriod) {
      return { ok: false, message: "請選擇素材年代。" };
    }

    if (!formData.nickname) {
      return { ok: false, message: "請填寫暱稱或名字。" };
    }

    if (!formData.category) {
      return { ok: false, message: "請選擇素材類型。" };
    }

    if (isValidDate(deadlineDate) && Date.now() > deadlineDate.getTime()) {
      return { ok: false, message: "投稿已截止。" };
    }

    return { ok: true };
  }

  async function postPayload(payload) {
    var response = await fetch(scriptUrl, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload)
    });

    var rawText = await response.text();
    var json;

    try {
      json = JSON.parse(rawText);
    } catch (error) {
      throw new Error("伺服器回傳非 JSON。");
    }

    if (!response.ok) {
      throw new Error(json.message || "HTTP " + response.status);
    }

    return json;
  }

  async function pingStatus() {
    try {
      var statusUrl = scriptUrl + (scriptUrl.indexOf("?") > -1 ? "&" : "?") + "action=status&t=" + Date.now();
      var response = await fetch(statusUrl, { method: "GET", mode: "cors" });
      var text = await response.text();
      var json = JSON.parse(text);

      if (!json.success || !json.data) {
        return;
      }

      if (json.data.isDeadlinePassed) {
        setDeadlineLock(true, "後端判定：投稿已截止。");
        setBadge("後端已截止", "is-closed");
      }
    } catch (error) {
      // 狀態檢查失敗不阻斷上傳，只顯示提示。
      setProgress("提醒：無法取得後端狀態，仍可嘗試上傳。");
    }
  }

  function setMessage(text, type) {
    el.messageText.textContent = text || "";
    el.messageText.classList.remove("is-error", "is-success");

    if (type === "error") {
      el.messageText.classList.add("is-error");
    } else if (type === "success") {
      el.messageText.classList.add("is-success");
    }
  }

  function setProgress(text) {
    el.progressText.textContent = text || "";
  }

  function buildFileKey(file) {
    return [file.name, file.size, file.lastModified].join("__");
  }

  function getExtension(filename) {
    var name = String(filename || "");
    var index = name.lastIndexOf(".");
    if (index < 0) {
      return "";
    }
    return name.slice(index + 1).toLowerCase();
  }

  function formatBytes(bytes) {
    if (!bytes || bytes < 0) {
      return "0 B";
    }

    var units = ["B", "KB", "MB", "GB", "TB"];
    var value = bytes;
    var unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    var digits = value >= 100 || unitIndex === 0 ? 0 : 1;
    return value.toFixed(digits) + " " + units[unitIndex];
  }

  function formatCountdown(diffMs) {
    var totalSeconds = Math.floor(diffMs / 1000);
    var days = Math.floor(totalSeconds / 86400);
    var hours = Math.floor((totalSeconds % 86400) / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;

    if (days > 0) {
      return days + " 天 " + hours + " 小時 " + minutes + " 分";
    }
    if (hours > 0) {
      return hours + " 小時 " + minutes + " 分 " + seconds + " 秒";
    }
    return minutes + " 分 " + seconds + " 秒";
  }

  function formatDate(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    var hour = String(date.getHours()).padStart(2, "0");
    var min = String(date.getMinutes()).padStart(2, "0");
    return year + "-" + month + "-" + day + " " + hour + ":" + min;
  }

  function isValidDate(date) {
    return date instanceof Date && !Number.isNaN(date.getTime());
  }

  function isScriptUrlReady() {
    return Boolean(scriptUrl) && scriptUrl.indexOf("REPLACE_WITH") === -1;
  }

  function generateId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return String(Date.now()) + "_" + Math.random().toString(36).slice(2);
  }

  function normalizeError(error) {
    if (!error) {
      return "未知錯誤";
    }
    if (typeof error === "string") {
      return error;
    }
    if (error.message) {
      return error.message;
    }
    return "未知錯誤";
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();

      reader.onload = function () {
        var result = String(reader.result || "");
        var commaIndex = result.indexOf(",");
        if (commaIndex < 0) {
          reject(new Error("檔案編碼失敗"));
          return;
        }
        resolve(result.slice(commaIndex + 1));
      };

      reader.onerror = function () {
        reject(new Error("讀取檔案失敗"));
      };

      reader.readAsDataURL(file);
    });
  }
})();
