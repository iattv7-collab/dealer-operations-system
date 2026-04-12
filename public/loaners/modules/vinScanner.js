// ==============================================
// LOANER MODULE — VIN SCANNER (FRONTEND)
// PURPOSE: Capture VIN from camera → send to backend
// ==============================================

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

// =========================
// CAMERA → BACKEND SCAN
// tries repeatedly for up to 10 seconds
// =========================
export async function scanVinWithCamera(videoEl, statusEl) {
  if (!videoEl) throw new Error("scannerVideo not found");

  if (statusEl) statusEl.textContent = "Opening camera...";

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" }
  });

  videoEl.srcObject = stream;
  await videoEl.play();

  const stopCamera = () => {
    try {
      stream.getTracks().forEach((t) => t.stop());
    } catch {}
    videoEl.srcObject = null;
  };

  const start = Date.now();
  const timeoutMs = 10000;
  const attemptDelayMs = 1200;

  try {
    while (Date.now() - start < timeoutMs) {
      if (statusEl) {
        const elapsed = Date.now() - start;
        const left = Math.max(1, Math.ceil((timeoutMs - elapsed) / 1000));
        statusEl.textContent = `Scanning VIN... ${left}s`;
      }

      // let camera refocus before each attempt
      await new Promise((r) => setTimeout(r, attemptDelayMs));

      const canvas = document.createElement("canvas");
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(videoEl, 0, 0);

      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9)
      );

      if (!blob) continue;

      const fd = new FormData();
      fd.append("file", blob, "vin.jpg");

      if (statusEl) statusEl.textContent = "Reading VIN...";

      const res = await fetch(
        "https://us-central1-dealer-wash-system.cloudfunctions.net/scanVIN",
        {
          method: "POST",
          body: fd
        }
      );

      const data = await res.json().catch(() => ({}));
      const vin = normalizeVin(data?.vin || "");

      if (isValidVin(vin)) {
        stopCamera();

        return {
          vin,
          reason: "VIN detected"
        };
      }
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