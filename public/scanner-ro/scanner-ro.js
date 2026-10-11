// public/pages/scanner-ro/scanner-ro.js
// Baseline recreation of DEXP scanner-ro.js (OCR + extraction only, no Firestore/save for testing)

import { scanROImage } from "/js/services/ocr/ro-ocr-service.js";

const roImageInput = document.getElementById("roImageInput");
const imagePreviewWrap = document.getElementById("imagePreviewWrap");
const imagePreview = document.getElementById("imagePreview");

const roNumberInput = document.getElementById("roNumberInput");
const tagNumberInput = document.getElementById("tagNumberInput");
const vinInput = document.getElementById("vinInput");
const customerNameInput = document.getElementById("customerNameInput");
const customerPhoneInput = document.getElementById("customerPhoneInput");
const advisorNameInput = document.getElementById("advisorNameInput");
const advisorNumberInput = document.getElementById("advisorNumberInput");
const concernInput = document.getElementById("concernInput");
const ocrDebugText = document.getElementById("ocrDebugText");
const scannerMessage = document.getElementById("scannerMessage");

async function processRoImageFile(file) {
  if (!file) return;

  const imageUrl = URL.createObjectURL(file);
  imagePreview.src = imageUrl;
  imagePreviewWrap.style.display = "block";

  clearMessage();
  showMessage("Scanning RO image...");

  try {
    const result = await scanROImage(file);

    roNumberInput.value = result.roNumber || "";
    tagNumberInput.value = result.tagNumber || "";
    vinInput.value = result.vin || "";
    customerNameInput.value = result.customerName || "";
    customerPhoneInput.value = result.customerPhone || "";
    advisorNameInput.value = result.advisorName || "";
    advisorNumberInput.value = result.advisorNumber || "";
    ocrDebugText.value = result.rawOcrText || "";

    showMessage(
      result.tagNumber
        ? `RO scan complete. Tag ${result.tagNumber}`
        : "RO scan complete. Tag not found"
    );
  } catch (error) {
    console.error("RO scan failed:", error);
    showMessage(
      error?.message
        ? `Could not scan RO image. ${error.message}`
        : "Could not scan RO image."
    );
  }
}

roImageInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  await processRoImageFile(file);
});

function showMessage(message) {
  scannerMessage.textContent = message;
}

function clearMessage() {
  scannerMessage.textContent = "";
}
