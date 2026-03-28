// public/ro/modules/scanner.js

import { db } from "../firebase.js";
import { auth } from "../firebase.js";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { fmtDateMMDDYYYY } from "./utils.js";

const COL_ACTIVE = "ros";
const SCAN_ENDPOINT = "https://us-central1-dealer-wash-system.cloudfunctions.net/scanRO";

function $(id) {
  return document.getElementById(id);
}

function toDateInputValue(v) {
  const s = String(v || "").trim();
  if (!s) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  return "";
}

async function fileToImageBitmap(file) {
  const blobUrl = URL.createObjectURL(file);
  try {
    if ("createImageBitmap" in window) {
      const bmp = await createImageBitmap(await fetch(blobUrl).then(r => r.blob()));
      return bmp;
    }
  } finally {
    try { URL.revokeObjectURL(blobUrl); } catch { }
  }

  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

async function cropBarcodeBlobFromFullPhoto(file) {
  const bmp = await fileToImageBitmap(file);

  const W = bmp.width || bmp.naturalWidth || 0;
  const H = bmp.height || bmp.naturalHeight || 0;
  if (!W || !H) throw new Error("Could not read image size.");

  const x1 = 0.02, y1 = 0.05, x2 = 0.62, y2 = 0.20;
  const sx = Math.max(0, Math.floor(W * x1));
  const sy = Math.max(0, Math.floor(H * y1));
  const sw = Math.max(1, Math.floor(W * (x2 - x1)));
  const sh = Math.max(1, Math.floor(H * (y2 - y1)));

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);

  const up = document.createElement("canvas");
  up.width = sw * 2;
  up.height = sh * 2;
  const uctx = up.getContext("2d", { willReadFrequently: true });
  uctx.drawImage(canvas, 0, 0, up.width, up.height);

  const blob = await new Promise((resolve) =>
    up.toBlob((b) => resolve(b), "image/png")
  );

  if (!blob) throw new Error("Could not crop barcode region.");
  return blob;
}

async function tryDecodeReynoldsBarcode(fullFile) {
  const ZX = window.ZXingBrowser;
  if (!ZX) return "";

  let cropBlob;
  try {
    cropBlob = await cropBarcodeBlobFromFullPhoto(fullFile);
  } catch {
    return "";
  }

  const reader = new ZX.BrowserMultiFormatReader();
  const url = URL.createObjectURL(cropBlob);

  try {
    const result = await reader.decodeFromImageUrl(url);
    const raw = String(result?.getText?.() || result?.text || "").trim();
    const m = raw.match(/(\d{5,8})\b/);
    return m ? m[1] : "";
  } catch {
    return "";
  } finally {
    try { URL.revokeObjectURL(url); } catch { }
    try { reader.reset(); } catch { }
  }
}

function buildPreview(out) {
  const data = out?.data || out || {};
  return String(
    out?.rawText ||
    data?.rawText ||
    data?.ocrPreview ||
    data?.ocrRawPreview ||
    ""
  ).slice(0, 1800);
}

function initScanner() {
  const scanBtn = $("btnScan");
  const scanInput = $("scanInput");

  if (!scanBtn || !scanInput) return;

  scanBtn.addEventListener("click", () => scanInput.click());

  scanInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;

    try {
      const roFromBarcode = await tryDecodeReynoldsBarcode(file);

      const fd = new FormData();
      fd.append("file", file, file.name || "ro.jpg");

      const res = await fetch(SCAN_ENDPOINT, {
        method: "POST",
        body: fd
      });

      const raw = await res.text().catch(() => "");

      if (!res.ok) {
        throw new Error(`Scan failed (${res.status}). ${raw || "(no response body)"}`);
      }

      let out;
      try {
        out = JSON.parse(raw);
      } catch {
        throw new Error(`Scan succeeded but response was not JSON: ${raw.slice(0, 300)}`);
      }

      const data = out?.data || {};
      const roId = String(roFromBarcode || data.roNumber || "").trim();

      if (!roId) {
        alert("Scan could not find RO #.\n\nOCR preview:\n" + buildPreview(out));
        return;
      }

      const ref = doc(db, COL_ACTIVE, roId);
      const existing = await getDoc(ref);

      if (existing.exists()) {
        alert(`RO ${roId} already exists.`);
        return;
      }

      const now = new Date();
      const todayIso = now.toISOString().slice(0, 10);
      const roDate = data.roDate || todayIso;
      const promiseDate = data.promiseDate || todayIso;

      const manualBox = $("manualBox");
      const btnShowManual = $("btnShowManual");
      const btnHideManual = $("btnHideManual");

      const mCustomer = $("mCustomer");
      const mPhone = $("mPhone");
      const mRo = $("mRo");
      const mTag = $("mTag");
      const mRoDate = $("mRoDate");
      const mPromiseDate = $("mPromiseDate");
      const mModel = $("mModel");
      const mAdvisor = $("mAdvisor");
      const mConcern = $("mConcern");

      if (!manualBox || !mRo) {
        throw new Error("Scanner verification form was not found on this page.");
      }

      manualBox.style.display = "block";
      if (btnShowManual) btnShowManual.style.display = "none";
      if (btnHideManual) btnHideManual.style.display = "inline-block";

      mRo.value = roId;
      mCustomer.value = data.customerName || "";
      mPhone.value = data.cellPhone || "";
      mTag.value = data.tagNumber || "";
      mRoDate.value = toDateInputValue(roDate);
      mPromiseDate.value = toDateInputValue(promiseDate);
      mModel.value = data.yearModel || "";
      mConcern.value = data.concern || "";
      mAdvisor.value = auth.currentUser?.displayName || data.advisor || "";

      alert("Scan complete. Please verify the data, then click Save Manual RO.");

      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      return;

    } catch (err) {
      alert(err.message || String(err));
    }
  });
}

export { initScanner };