// ==============================================
// LOANER MODULE — VIN SCANNER (BACKEND)
// PURPOSE: Scan VIN from windshield / door jamb
// ==============================================

const functions = require("firebase-functions");
const vision = require("@google-cloud/vision");
const Busboy = require("busboy");

const client = new vision.ImageAnnotatorClient();

exports.scanVIN = functions.https.onRequest((req, res) => {
  const busboy = Busboy({ headers: req.headers });

  let imageBuffer = null;

  busboy.on("file", (_, file) => {
    const chunks = [];

    file.on("data", (data) => chunks.push(data));

    file.on("end", () => {
      imageBuffer = Buffer.concat(chunks);
    });
  });

  busboy.on("finish", async () => {
    try {
      if (!imageBuffer) {
        return res.status(400).send({ error: "No image provided" });
      }

      const [result] = await client.textDetection(imageBuffer);

      const text = result.fullTextAnnotation?.text || "";

      const cleaned = text
        .toUpperCase()
        .replace(/[^A-HJ-NPR-Z0-9]/g, " ");

      const match = cleaned.match(/[A-HJ-NPR-Z0-9]{17}/);

      if (!match) {
        return res.send({
          success: false,
          vin: null,
          raw: text.slice(0, 500)
        });
      }

      return res.send({
        success: true,
        vin: match[0]
      });

    } catch (err) {
      console.error("scanVIN error:", err);
      return res.status(500).send({ error: err.message });
    }
  });

  busboy.end(req.rawBody);
});