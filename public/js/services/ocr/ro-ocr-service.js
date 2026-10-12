// public/js/services/ocr/ro-ocr-service.js
// Exact copy of current DEXP ro-ocr-service.js

const SCAN_RO_FUNCTION_URL =
    "https://scanro-kaxooupkzq-uc.a.run.app";

export async function scanROImage(file) {
    if (!file) {
        throw new Error("Missing image file");
    }

    const croppedImageBase64 =
        await cropImageToIntakeBlock(file);

    const response = await fetch(SCAN_RO_FUNCTION_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            image: croppedImageBase64
        })
    });

    if (!response.ok) {
        throw new Error("OCR request failed");
    }

    const result = await response.json();

    const rawText = result.rawText || "";

    return {
        roNumber: extractRONumber(rawText),
        tagNumber: extractTagNumber(rawText),
        vin: extractVIN(rawText),
        year: extractYear(rawText),
        make: extractMake(rawText),
        model: extractModel(rawText),
        color: extractColor(rawText),
        customerName: extractCustomerName(rawText),
        customerPhone: extractPhone(rawText),
        advisorName: extractAdvisorName(rawText),
        advisorNumber: extractAdvisorNumber(rawText),
        rawOcrText: rawText
    };
}

async function cropImageToIntakeBlock(file) {
    const image = await loadImage(file);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    // Reynolds intake block on a full-page phone photo.
    const crop = {
        x: 0.02,
        y: 0.28,
        width: 0.96,
        height: 0.36
    };

    const sourceX = image.width * crop.x;
    const sourceY = image.height * crop.y;
    const sourceWidth = image.width * crop.width;
    const sourceHeight = image.height * crop.height;

    canvas.width = sourceWidth;
    canvas.height = sourceHeight;

    ctx.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        sourceWidth,
        sourceHeight
    );

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

    return dataUrl.split(",")[1] || "";
}

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const image = new Image();

        image.onload = () => {
            resolve(image);
        };

        image.onerror = reject;

        image.src = URL.createObjectURL(file);
    });
}

function extractRONumber(text) {
    const labeledMatch = String(text).match(
        /R\.?\s*O\.?\s*NO\.?\s*[:\-]?\s*(\d{5,7})/i
    );

    if (labeledMatch) {
        return labeledMatch[1];
    }

    const lines = getCleanLines(text);
    const labelIndex = lines.findIndex((line) =>
        /R\.?\s*O\.?\s*NO/i.test(line)
    );

    if (labelIndex >= 0) {
        for (
            let i = labelIndex;
            i < Math.min(lines.length, labelIndex + 4);
            i += 1
        ) {
            const lineMatch = lines[i].match(/\b(\d{5,7})\b/);

            if (lineMatch) {
                return lineMatch[1];
            }
        }
    }

    return "";
}

function extractVIN(text = "") {
    const lines = String(text)
        .toUpperCase()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

    const transliteration = {
        A: 1,
        B: 2,
        C: 3,
        D: 4,
        E: 5,
        F: 6,
        G: 7,
        H: 8,
        J: 1,
        K: 2,
        L: 3,
        M: 4,
        N: 5,
        P: 7,
        R: 9,
        S: 2,
        T: 3,
        U: 4,
        V: 5,
        W: 6,
        X: 7,
        Y: 8,
        Z: 9
    };

    const weights = [
        8, 7, 6, 5, 4, 3, 2, 10, 0,
        9, 8, 7, 6, 5, 4, 3, 2
    ];

    function repairCandidate(value = "") {
        const candidate = String(value)
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "");

        if (candidate.length !== 17) {
            return "";
        }

        const repaired = candidate
            .replace(/O/g, "0")
            .replace(/I/g, "1")
            .replace(/Q/g, "0");

        return VIN_PATTERN.test(repaired)
            ? repaired
            : "";
    }

    function passesChecksum(vin = "") {
        if (!VIN_PATTERN.test(vin)) {
            return false;
        }

        let total = 0;

        for (let index = 0; index < vin.length; index += 1) {
            const character = vin[index];

            const value = /\d/.test(character)
                ? Number(character)
                : transliteration[character];

            if (value === undefined) {
                return false;
            }

            total += value * weights[index];
        }

        const remainder = total % 11;
        const expectedCheckDigit =
            remainder === 10 ? "X" : String(remainder);

        return vin[8] === expectedCheckDigit;
    }

    function getCandidatesFromLine(line = "") {
        const matches =
            line.match(/(?:^|[^A-Z0-9])([A-Z0-9]{17})(?=$|[^A-Z0-9])/g) || [];

        return matches
            .map((match) => repairCandidate(match))
            .filter(Boolean);
    }

    const vehicleIdIndex = lines.findIndex((line) =>
        /VEHICLE\s+(?:I\.?\s*D\.?|L\.?\s*D\.?)\s*NO/i.test(line)
    );

    const prioritizedLines = [];

    if (vehicleIdIndex >= 0) {
        for (
            let index = vehicleIdIndex + 1;
            index < Math.min(lines.length, vehicleIdIndex + 5);
            index += 1
        ) {
            prioritizedLines.push(lines[index]);
        }
    }

    const allCandidates = [];

    for (const line of [...prioritizedLines, ...lines]) {
        for (const candidate of getCandidatesFromLine(line)) {
            if (!allCandidates.includes(candidate)) {
                allCandidates.push(candidate);
            }
        }
    }

    const checksumMatch =
        allCandidates.find((candidate) =>
            passesChecksum(candidate)
        );

    return checksumMatch || allCandidates[0] || "";
}

function extractYear(text) {
    const twoDigitMatch =
        String(text).match(/\b(\d{2})\s*\/\s*PORSCHE/i);

    if (twoDigitMatch) {
        const twoDigit = Number(twoDigitMatch[1]);
        return twoDigit >= 80
            ? `19${twoDigitMatch[1]}`
            : `20${twoDigitMatch[1]}`;
    }

    const yearMakeModelMatch =
        String(text).match(/\b((?:19|20)\d{2})\s*\/\s*[A-Z]+/i);

    if (yearMakeModelMatch) {
        return yearMakeModelMatch[1];
    }

    const match = String(text).match(/\b((?:19|20)\d{2})\b/);

    return match ? match[1] : "";
}

function extractMake(text) {
    if (/porsche/i.test(text)) return "Porsche";
    if (/ford/i.test(text)) return "Ford";
    if (/toyota/i.test(text)) return "Toyota";
    if (/honda/i.test(text)) return "Honda";
    if (/bmw/i.test(text)) return "BMW";
    if (/mercedes/i.test(text)) return "Mercedes-Benz";

    return "";
}

function extractModel(text) {
    const knownModels = [
        "911",
        "Cayenne",
        "Macan",
        "Panamera",
        "Taycan",
        "Boxster",
        "Cayman"
    ];

    return knownModels.find((model) =>
        text.toLowerCase().includes(model.toLowerCase())
    ) || "";
}

function extractColor(text) {
    const colorLabelMatch =
        text.match(/COLOR\s+([A-Z]+)\/?/i);

    if (colorLabelMatch) {
        return normalizeColor(colorLabelMatch[1]);
    }

    const colors = [
        "Black",
        "White",
        "Silver",
        "Gray",
        "Grey",
        "Blue",
        "Red",
        "Green",
        "Yellow",
        "Brown"
    ];

    return colors.find((color) =>
        text.toLowerCase().includes(color.toLowerCase())
    ) || "";
}

function extractCustomerName(text) {
    const lines = getCleanLines(text);

    const vinIndex = lines.findIndex((line) =>
        /\b[A-Z0-9]{17}\b/i.test(line)
    );

    if (vinIndex < 0) {
        return "";
    }

    const skipLine =
        /^(CUSTOMER\s*NO|YEAR\s*\/\s*MAKE|SERVICE\s*CONTRACT|SAVE\s*PARTS|PRODUCTION\s*DATE|DELIVERY\s*DATE|DELIVERY\s*MILES|STOCK\s*NO|LICENSE\s*NO|SELLING\s*DEALER|CONTRACT\s*NO|COLOR|TERMS|CASH|CREDIT\s*CD|CHECK|STATE\s*REG|VEHICLE|SALESPERSON|SERVICE|HOUSE\s*DEAL|OPERATION|DRIVEABILITY|SHUTTLE|MULTIPOINT|QUALITY\s*CONTROL|CAMPAIGN|WASHCAR|PRE\s*PAID)$/i;

    for (
        let i = vinIndex + 1;
        i < Math.min(lines.length, vinIndex + 12);
        i += 1
    ) {
        let line = lines[i]
            .replace(/CUSTOMER\s*NO\.?/gi, "")
            .replace(/\bYES\b/gi, "")
            .replace(/\bNO\b/gi, "")
            .replace(/[^A-Z0-9\s\-\&]/gi, "")
            .replace(/\s+/g, " ")
            .trim();

        if (!line) {
            continue;
        }

        if (skipLine.test(line)) {
            continue;
        }

        if (/CONCERN|TRANSPORT|INSPECT|DESCRIPTION/i.test(line)) {
            continue;
        }

        if (/^\d+$/.test(line)) {
            continue;
        }

        if (/^(SUITE|STE)\b/i.test(line)) {
            continue;
        }

        if (/^\d+\s/.test(line)) {
            continue;
        }

        if (/@/.test(lines[i])) {
            continue;
        }

        const words = line.split(" ").filter(Boolean);

        if (words.length >= 2) {
            return line;
        }
    }

    return "";
}

function extractPhone(text) {
    const source = String(text || "");

    const residenceMatch = source.match(
        /RESIDENCE\s*PHONE([\s\S]{0,120}?)(\d{3}[-.\s]\d{3}[-.\s]\d{4})/i
    );

    if (residenceMatch) {
        return residenceMatch[2];
    }

    const phones =
        source.match(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g) || [];

    return phones[0] || "";
}

function normalizeColor(color = "") {
    const value = color.toLowerCase();

    if (value === "blk" || value === "black") return "Black";
    if (value === "wht" || value === "white") return "White";
    if (value === "gry" || value === "gray" || value === "grey") return "Gray";
    if (value === "blu" || value === "blue") return "Blue";
    if (value === "red") return "Red";
    if (value === "sil" || value === "silver") return "Silver";

    return color;
}

function extractTagNumber(text) {
    const source = String(text || "");
    const cutoff = source.search(/I hereby authorize/i);
    const region = cutoff >= 0 ? source.slice(0, cutoff) : source;

    // Find TAG label (handles TAGNO, TAG NO, TAG. NO, etc.)
    const tagMatch = region.match(/TAG\s*\.?\s*NO\.?/i);
    if (!tagMatch) return "";

    const start = tagMatch.index + tagMatch[0].length;

    // Look only a short distance after the TAG label
    const after = region.slice(start, start + 120);

    // Stop early if we hit ADVISOR
    const advisorPos = after.search(/ADVISOR/i);
    const window = advisorPos >= 0 ? after.slice(0, advisorPos) : after;

    // Grab the first 3–6 digit number in that small window
    const match = window.match(/\b(\d{3,6})\b/);
    return match ? match[1] : "";
}

function extractAdvisorName(text) {
    const source = String(text || "");
    const cutoff = source.search(/I hereby authorize/i);
    const region =
        cutoff >= 0 ? source.slice(0, cutoff) : source;

    const advisorBlocks = [
        ...region.matchAll(
            /ADVISOR(?!\s*NO)([\s\S]{0,120})/gi
        ),
    ];

    if (!advisorBlocks.length) {
        return "";
    }

    const lastBlock =
        advisorBlocks[advisorBlocks.length - 1][1];

    const nameMatch = lastBlock.match(
        /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/
    );

    if (nameMatch) {
        return nameMatch[0].trim();
    }

    return "";
}

function extractAdvisorNumber(text) {
    const source = String(text || "");
    const cutoff = source.search(/I hereby authorize/i);
    const region =
        cutoff >= 0 ? source.slice(0, cutoff) : source;

    const blocks = [
        ...region.matchAll(/ADVISOR\s*NO\.?([\s\S]{0,100})/gi),
    ];

    if (!blocks.length) {
        return "";
    }

    const lastBlock = blocks[blocks.length - 1][1].replace(
        /\b\d{1,3},\d{3}\b/g,
        " ",
    );

    const numbers = lastBlock.match(/\b\d{2,4}\b/g) || [];
    const threeDigit = numbers.filter((value) => value.length === 3);

    if (threeDigit.length) {
        return threeDigit[0];
    }

    return numbers[0] || "";
}

function getCleanLines(text) {
    return text
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}
