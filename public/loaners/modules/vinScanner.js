// ==============================================
// LOANER MODULE — VIN SCANNER (FRONTEND)
// PURPOSE: Capture VIN from camera → send to backend OCR
// ==============================================

const SCAN_ENDPOINT =
  "https://us-central1-dealer-wash-system.cloudfunctions.net/scanVIN";

function normalizeVin(text = "") {
  return String(text)
    .toUpperCase()
    .replace(/[^A-HJ-NPR-Z0-9]/g, "")
    .trim();
}

function isValidVin(vin = "") {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);
}

// =========================
// VIN DECODER (NHTSA)
// =========================
export async function decodeVinLive(vin = "") {
  vin = normalizeVin(vin);
  if (!isValidVin(vin)) return null;

  const res = await fetch(
    `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${vin}?format=json`
  );

  const data = await res.json();
  const row = data?.Results?.[0];

  return {
    vin,
    make: row?.Make || "",
    model: row?.Model || "",
    year: row?.ModelYear || ""
  };
}

async function makeCropBlob(videoEl, zone, quality = 0.9) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const x = Math.max(0, Math.floor(zone.x));
  const y = Math.max(0, Math.floor(zone.y));
  const w = Math.max(1, Math.floor(zone.w));
  const h = Math.max(1, Math.floor(zone.h));

  canvas.width = w;
  canvas.height = h;

  ctx.drawImage(videoEl, x, y, w, h, 0, 0, w, h);

  return await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );
}

async function sendBlob(blob, zoneName) {
  const fd = new FormData();
  fd.append("file", blob, `${zoneName}.jpg`);

  const res = await fetch(SCAN_ENDPOINT, {
    method: "POST",
    body: fd
  });

  const json = await res.json().catch(() => null);
  return normalizeVin(json?.vin || "");
}

// =========================
// CAMERA → BACKEND OCR SCAN
// =========================
export async function scanVinWithCamera(videoEl, statusEl) {
  if (!videoEl) throw new Error("scannerVideo not found");

  if (statusEl) statusEl.textContent = "Opening camera...";

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      focusMode: { ideal: "continuous" },
      exposureMode: { ideal: "continuous" },
      whiteBalanceMode: { ideal: "continuous" }
    },
    audio: false
  });

  videoEl.setAttribute("playsinline", "true");
  videoEl.setAttribute("autoplay", "true");
  videoEl.muted = true;
  videoEl.srcObject = stream;

  await new Promise((resolve) => {
    if (videoEl.readyState >= 1) return resolve();
    videoEl.onloadedmetadata = () => resolve();
  });

  await videoEl.play();

  const stopCamera = () => {
    try {
      stream.getTracks().forEach((t) => t.stop());
    } catch { }
    videoEl.srcObject = null;
  };

  const timeoutMs = 15000;
  let stopped = false;

  setTimeout(() => {
    stopped = true;
    stopCamera();
    if (statusEl) statusEl.textContent = "Scanner stopped (timeout)";
  }, timeoutMs);

  try {
    // Small focus settle
    await new Promise((r) => setTimeout(r, 500));

    while (!stopped) {

      if (stopped) break;

      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;

      if (!vw || !vh) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }

      if (statusEl) {
        const elapsed = Date.now() - start;
        const left = Math.max(1, Math.ceil((timeoutMs - elapsed) / 1000));
        statusEl.textContent = `Scanning VIN... ${left}s`;
      }

      const zones = [
        { name: "full", x: 0, y: 0, w: vw, h: vh },
        { name: "center", x: vw * 0.08, y: vh * 0.12, w: vw * 0.84, h: vh * 0.76 },
        { name: "upper", x: vw * 0.05, y: vh * 0.05, w: vw * 0.9, h: vh * 0.45 },
        { name: "middle", x: vw * 0.05, y: vh * 0.35, w: vw * 0.9, h: vh * 0.35 },
        { name: "lower", x: vw * 0.05, y: vh * 0.58, w: vw * 0.9, h: vh * 0.37 },
        { name: "left", x: vw * 0.0, y: vh * 0.15, w: vw * 0.65, h: vh * 0.75 },
        { name: "right", x: vw * 0.35, y: vh * 0.15, w: vw * 0.65, h: vh * 0.75 }
      ];

      for (const zone of zones) {
        const blob = await makeCropBlob(videoEl, zone, 0.9);
        if (!blob) continue;

        if (statusEl) statusEl.textContent = `Reading VIN...`;

        const vin = await sendBlob(blob, zone.name);

        if (isValidVin(vin)) {
          stopCamera();

          return {
            vin,
            reason: "VIN detected"
          };
        }
      }

      await new Promise((r) => setTimeout(r, 700));
    }

    stopCamera();

    return {
      vin: "",
      reason: "No VIN found after 10 seconds"
    };
  } catch (err) {
    stopCamera();
    throw err;
  }
}

export { normalizeVin, isValidVin };