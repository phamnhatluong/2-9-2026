
import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const CLOUDINARY_CLOUD_NAME = "dpihfxijg";
const CLOUDINARY_API_KEY = "134551449197819";
const CLOUDINARY_API_SECRET = "A81MMJgALbxgjAYe7fX1gyolITk";
const CLOUDINARY_UPLOAD_PRESET = "20-10-pnl";

async function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function createCloudinarySignature(params) {
  const text = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-1", encoder.encode(text + CLOUDINARY_API_SECRET));
  return await toHex(digest);
}

const MP_VERSION = "0.10.14";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";

const FILTERS = ["MONO", "GLITCH", "NEON", "VIETNAM", "PICTURE2", "PIC3", "PIC4", "PIC5"];
let currentFilterIdx = 0;

const TOUCH_DISTANCE_PX = 45;
const FILTER_SWITCH_COOLDOWN_MS = 1000;
let lastSwitchTime = 0;
let switchArmed = true;

const video = document.getElementById("webcam");
const canvas = document.getElementById("outputCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const overlay = document.getElementById("overlay");
const overlayText = document.getElementById("overlayText");
const startBtn = document.getElementById("startBtn");
const statusText = document.getElementById("statusText");
const filterRow = document.getElementById("filterRow");
const mobileFilterBtn = document.getElementById("mobileFilterBtn");

let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let hasTriggeredSend = false;

// Ảnh dùng cho PICTURE2 / PIC3 / PIC4 / PIC5
const userImages = { 2: null, 3: null, 4: null, 5: null };

// --- Tự động tải ảnh từ thư mục r/ (cùng cấp với file HTML này) ---
const PIC_FOLDER = "r";
const PIC_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

function autoLoadPicture(n) {
  let extIdx = 0;
  function tryNextExtension() {
    if (extIdx >= PIC_EXTENSIONS.length) {
      console.log(`Không tìm thấy ảnh tự động cho PIC${n} trong thư mục ${PIC_FOLDER}/`);
      return;
    }
    const ext = PIC_EXTENSIONS[extIdx++];
    const img = new Image();
    img.onload = () => {
      userImages[n] = img;
      console.log(`Đã tự động tải ${PIC_FOLDER}/picture${n}.${ext}`);
    };
    img.onerror = tryNextExtension;
    img.src = `${PIC_FOLDER}/picture${n}.${ext}`;
  }
  tryNextExtension();
}
[2, 3, 4, 5].forEach(autoLoadPicture);

// --- Xây danh sách chip filter (bấm trực tiếp để chọn) ---
function renderFilterChips() {
  filterRow.innerHTML = "";
  FILTERS.forEach((name, idx) => {
    const chip = document.createElement("div");
    chip.className = "filter-chip" + (idx === currentFilterIdx ? " active" : "");
    chip.textContent = name;
    chip.addEventListener("click", () => {
      currentFilterIdx = idx;
      renderFilterChips();
    });
    filterRow.appendChild(chip);
  });
}
renderFilterChips();

function setCurrentFilter(idx) {
  currentFilterIdx = ((idx % FILTERS.length) + FILTERS.length) % FILTERS.length;
  renderFilterChips();
  captureCurrentFrameAsImage();
}

// --- Nút nổi đổi filter (chỉ hiển thị trên màn hình điện thoại, xem CSS) ---
mobileFilterBtn.addEventListener("click", () => {
  setCurrentFilter(currentFilterIdx + 1);
});

// ---------------------------------------------------------------------------
// 1. Khởi tạo HandLandmarker (MediaPipe Tasks Vision)
// ---------------------------------------------------------------------------
let handLandmarker = null;

async function initHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
  );
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: HAND_MODEL_URL,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });
  statusText.textContent = "Mô hình đã sẵn sàng. Nhấn 'Bắt đầu Camera' để chạy.";
  startBtn.disabled = false;
}

startBtn.disabled = true;
initHandLandmarker().catch((err) => {
  console.error(err);
  statusText.textContent =
    "Lỗi khi tải mô hình MediaPipe. Kiểm tra kết nối Internet rồi tải lại trang.";
});

// ---------------------------------------------------------------------------
// 2. Bắt đầu Camera
// ---------------------------------------------------------------------------
function getSupportedMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function startRecordingFromStream(stream) {
  if (isRecording) return;

  const mimeType = getSupportedMimeType();
  const options = mimeType ? { mimeType } : {};
  const canvasStream = canvas.captureStream ? canvas.captureStream(30) : null;
  const captureSource = canvasStream || stream;

  recordedChunks = [];
  mediaRecorder = new MediaRecorder(captureSource, options);

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = () => {
    const fullBlob = new Blob(recordedChunks, { type: mediaRecorder?.mimeType || "video/webm" });
    if (fullBlob.size > 0) {
      uploadVideoToCloudinary(fullBlob);
    }
  };

  mediaRecorder.start(250);
  isRecording = true;
  statusText.textContent = "Đang ghi video... sẽ gửi khi người dùng rời trang.";
}

function stopRecordingAndSend() {
  if (!isRecording || !mediaRecorder) return;
  if (hasTriggeredSend) return;
  hasTriggeredSend = true;

  const finalizeUpload = () => {
    const fullBlob = new Blob(recordedChunks, { type: mediaRecorder?.mimeType || "video/webm" });
    if (fullBlob.size > 0) {
      uploadVideoToCloudinary(fullBlob);
    }
  };

  mediaRecorder.onstop = finalizeUpload;
  mediaRecorder.stop();
  isRecording = false;
}

async function uploadCloudinaryFile(blob, folder, type) {
  const timestamp = Math.floor(Date.now() / 1000);
  const filename = `${type}-${timestamp}-${Math.random().toString(36).slice(2)}.${type === "video" ? "webm" : "png"}`;
  const formData = new FormData();
  formData.append("file", blob, filename);
  formData.append("folder", folder);

  if (CLOUDINARY_UPLOAD_PRESET) {
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  } else {
    const params = {
      folder,
      timestamp: String(timestamp),
      api_key: CLOUDINARY_API_KEY,
    };
    const signature = await createCloudinarySignature(params);
    formData.append("timestamp", params.timestamp);
    formData.append("api_key", params.api_key);
    formData.append("signature", signature);
  }

  const endpoint = type === "video"
    ? `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`
    : `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Cloudinary ${type} upload failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.secure_url || data.url;
}

async function uploadVideoToCloudinary(videoBlob) {
  try {
    statusText.textContent = "Đang upload video lên Cloudinary...";
    const videoUrl = await uploadCloudinaryFile(videoBlob, "webcam-recordings", "video");
    console.log("Cloudinary video upload success:", videoUrl);
    statusText.textContent = `Video đã lưu lên Cloudinary. Link: ${videoUrl}`;
  } catch (err) {
    console.error("Cloudinary video upload failed:", err);
    statusText.textContent = "Lỗi khi upload video lên Cloudinary. Hãy tạo Upload Preset hoặc kiểm tra API key/secret.";
  }
}

async function captureCurrentFrameAsImage() {
  if (!canvas) return;

  try {
    const imageBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
    if (!imageBlob) return;

    const imageUrl = await uploadCloudinaryFile(imageBlob, "filter-captures", "image");
    console.log("Cloudinary image capture success:", imageUrl);
    statusText.textContent = `Ảnh khi đổi filter đã lưu lên Cloudinary. Link: ${imageUrl}`;
  } catch (err) {
    console.error("Cloudinary image capture failed:", err);
  }
}

window.addEventListener("pagehide", () => {
  stopRecordingAndSend();
});

window.addEventListener("beforeunload", () => {
  stopRecordingAndSend();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    stopRecordingAndSend();
  }
});

startBtn.addEventListener("click", async () => {
  try {
    overlayText.textContent = "Đang mở camera...";

    // Xin camera với độ phân giải khớp tỉ lệ MÀN HÌNH THỰC TẾ của thiết bị
    // (điện thoại dọc sẽ xin video dọc, tránh bị kéo méo khi hiển thị full màn hình).
    const screenW = window.innerWidth || 960;
    const screenH = window.innerHeight || 720;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: screenW },
        height: { ideal: screenH },
      },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    canvas.width = video.videoWidth || screenW;
    canvas.height = video.videoHeight || screenH;
    overlay.classList.add("hidden");
    await startRecordingFromStream(stream);
    requestAnimationFrame(renderLoop);
  } catch (err) {
    console.error(err);
    overlayText.textContent =
      "Không thể truy cập camera. Hãy cho phép quyền camera, và đảm bảo trang đang mở qua http://localhost hoặc HTTPS.";
  }
});

// ---------------------------------------------------------------------------
// 3. Các hàm bộ lọc pixel-level (áp dụng lên ImageData của vùng portal)
// ---------------------------------------------------------------------------
function filterMono(imageData) {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = gray;
  }
  return imageData;
}

function filterGlitch(imageData) {
  const { width, height, data } = imageData;
  const src = new Uint8ClampedArray(data); // bản sao gốc để đọc, tránh ghi đè lẫn
  const shift = Math.max(5, Math.floor(width / 20));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      if (x + shift < width) {
        const si = (y * width + (x + shift)) * 4;
        data[di] = src[si];
      }
      if (x - shift >= 0) {
        const si = (y * width + (x - shift)) * 4 + 2;
        data[di + 2] = src[si];
      }
    }
  }
  return imageData;
}

function filterNeon(imageData) {
  const { width, height, data } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const out = new Uint8ClampedArray(data.length);
  const gxKernel = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gyKernel = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  const THRESHOLD = 90;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0, gy = 0, k = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const val = gray[(y + ky) * width + (x + kx)];
          gx += val * gxKernel[k];
          gy += val * gyKernel[k];
          k++;
        }
      }
      const mag = Math.sqrt(gx * gx + gy * gy);
      const di = (y * width + x) * 4;
      if (mag > THRESHOLD) {
        out[di] = 255; out[di + 1] = 255; out[di + 2] = 0; out[di + 3] = 255;
      } else {
        out[di] = 0; out[di + 1] = 0; out[di + 2] = 0; out[di + 3] = 255;
      }
    }
  }
  for (let i = 0; i < data.length; i++) data[i] = out[i];
  return imageData;
}

function drawVietnamFlag(destCtx, w, h) {
  destCtx.fillStyle = "rgb(218,0,0)";
  destCtx.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;
  const outerR = 0.30 * Math.min(w, h);
  const innerR = outerR * 0.382;
  destCtx.fillStyle = "rgb(255,220,0)";
  destCtx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angleDeg = -90 + i * 36;
    const r = i % 2 === 0 ? outerR : innerR;
    const rad = (angleDeg * Math.PI) / 180;
    const x = cx + r * Math.cos(rad);
    const y = cy + r * Math.sin(rad);
    if (i === 0) destCtx.moveTo(x, y); else destCtx.lineTo(x, y);
  }
  destCtx.closePath();
  destCtx.fill();
}

function drawUserPicture(destCtx, w, h, picNumber) {
  const img = userImages[picNumber];
  if (img) {
    destCtx.drawImage(img, 0, 0, w, h);
  } else {
    destCtx.fillStyle = "rgb(60,60,60)";
    destCtx.fillRect(0, 0, w, h);
    destCtx.fillStyle = "#fff";
    destCtx.font = `${Math.max(12, Math.min(w, h) / 20)}px sans-serif`;
    destCtx.textAlign = "center";
    destCtx.fillText(`Thieu anh r/picture${picNumber}.jpg`, w / 2, h / 2);
  }
}

// ---------------------------------------------------------------------------
// 4. Áp dụng filter cho vùng bounding-box (bw x bh), trả về canvas kết quả
// ---------------------------------------------------------------------------
function buildFilteredRegion(filterName, bx, by, bw, bh) {
  const tmp = document.createElement("canvas");
  tmp.width = bw;
  tmp.height = bh;
  const tctx = tmp.getContext("2d");

  if (filterName === "VIETNAM") {
    drawVietnamFlag(tctx, bw, bh);
  } else if (filterName.startsWith("PIC")) {
    const num = filterName === "PICTURE2" ? 2 : parseInt(filterName.replace("PIC", ""), 10);
    drawUserPicture(tctx, bw, bh, num);
  } else {
    tctx.drawImage(canvas, bx, by, bw, bh, 0, 0, bw, bh);
    let imageData = tctx.getImageData(0, 0, bw, bh);
    if (filterName === "MONO") imageData = filterMono(imageData);
    else if (filterName === "GLITCH") imageData = filterGlitch(imageData);
    else if (filterName === "NEON") imageData = filterNeon(imageData);
    tctx.putImageData(imageData, 0, 0);
  }
  return tmp;
}

function dist(p1, p2) {
  return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
}

// ---------------------------------------------------------------------------
// 5. Vòng lặp render chính
// ---------------------------------------------------------------------------
function renderLoop() {
  if (video.readyState < 2) {
    requestAnimationFrame(renderLoop);
    return;
  }

  const w = canvas.width, h = canvas.height;
  const sourceW = video.videoWidth || w;
  const sourceH = video.videoHeight || h;
  const zoomOut = 0.78;
  const cropW = sourceW * zoomOut;
  const cropH = sourceH * zoomOut;
  const cropX = (sourceW - cropW) / 2;
  const cropY = (sourceH - cropH) / 2;

  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(video, cropX, cropY, cropW, cropH, -w, 0, w, h);
  ctx.restore();

  const nowMs = performance.now();
  const result = handLandmarker.detectForVideo(video, nowMs);

  const filterName = FILTERS[currentFilterIdx];
  const portalPoints = [];
  let wantSwitch = false;

  if (result.landmarks && result.landmarks.length > 0) {
    const handsLm = result.landmarks;
    const toPixel = (lm) => [Math.round((1 - lm.x) * w), Math.round(lm.y * h)];

    if (handsLm.length >= 2) {
      const a = toPixel(handsLm[0][8]);
      const b = toPixel(handsLm[1][8]);
      if (dist(a, b) < TOUCH_DISTANCE_PX) wantSwitch = true;
    }

    handsLm.forEach((lm) => {
      const thumb = toPixel(lm[4]);
      const indexF = toPixel(lm[8]);
      const pinky = toPixel(lm[20]);

      if (dist(thumb, pinky) < TOUCH_DISTANCE_PX) wantSwitch = true;

      portalPoints.push(thumb, indexF);

      ctx.fillStyle = "rgb(0,255,255)";
      [thumb, indexF].forEach(([px, py]) => {
        ctx.beginPath();
        ctx.arc(px, py, 7, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    if (wantSwitch) {
      if (switchArmed && nowMs - lastSwitchTime > FILTER_SWITCH_COOLDOWN_MS) {
        setCurrentFilter(currentFilterIdx + 1);
        lastSwitchTime = nowMs;
        switchArmed = false;
      }
    } else {
      switchArmed = true;
    }

    if (portalPoints.length === 4) {
      const sortedByY = [...portalPoints].sort((p1, p2) => p1[1] - p2[1]);
      const top = sortedByY.slice(0, 2).sort((p1, p2) => p1[0] - p2[0]);
      const bottom = sortedByY.slice(2).sort((p1, p2) => p1[0] - p2[0]);
      const poly = [top[0], top[1], bottom[1], bottom[0]];

      const xs = poly.map((p) => p[0]);
      const ys = poly.map((p) => p[1]);
      let bx = Math.max(0, Math.min(...xs));
      let by = Math.max(0, Math.min(...ys));
      let bw = Math.min(w, Math.max(...xs)) - bx;
      let bh = Math.min(h, Math.max(...ys)) - by;

      if (bw > 4 && bh > 4) {
        const filteredCanvas = buildFilteredRegion(filterName, bx, by, bw, bh);

        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = bw;
        maskCanvas.height = bh;
        const mctx = maskCanvas.getContext("2d");
        mctx.fillStyle = "#fff";
        mctx.beginPath();
        poly.forEach(([px, py], i) => {
          const rx = px - bx, ry = py - by;
          if (i === 0) mctx.moveTo(rx, ry); else mctx.lineTo(rx, ry);
        });
        mctx.closePath();
        mctx.fill();

        const fctx = filteredCanvas.getContext("2d");
        fctx.globalCompositeOperation = "destination-in";
        fctx.drawImage(maskCanvas, 0, 0);
        fctx.globalCompositeOperation = "source-over";

        ctx.drawImage(filteredCanvas, bx, by);

        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        poly.forEach(([px, py], i) => {
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.stroke();

        ctx.fillStyle = "rgba(0,255,255,0.9)";
        for (let i = 0; i < 4; i++) {
          const p1 = poly[i], p2 = poly[(i + 1) % 4];
          for (let k = 0; k < 5; k++) {
            const a = Math.random();
            const gx = p1[0] * a + p2[0] * (1 - a) + (Math.random() * 30 - 15);
            const gy = p1[1] * a + p2[1] * (1 - a) + (Math.random() * 30 - 15);
            ctx.beginPath();
            ctx.arc(gx, gy, 1 + Math.random() * 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
  } else {
    switchArmed = true;
  }

  ctx.font = "16px sans-serif";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, w, 46);
  ctx.fillStyle = "#ffffff";
  ctx.fillText("Doi filter: cham cai+ut, hoac 2 ngon tro cham nhau", 10, 18);
  ctx.fillStyle = "#00e5ff";
  ctx.fillText(`Filter: ${filterName}`, 10, 38);

  requestAnimationFrame(renderLoop);
}
