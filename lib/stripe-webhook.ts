import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_TOLERANCE_SECONDS = 300;

type ParsedSignature = {
    timestamp: number;
    signatures: string[];
};

function parseStripeSignatureHeader(header: string): ParsedSignature | null {
    const pieces = header.split(",").map((part) => part.trim()).filter(Boolean);
    let timestamp: number | null = null;
    const signatures: string[] = [];

    pieces.forEach((piece) => {
        const [key, value] = piece.split("=", 2);
        if (!key || !value) return;
        if (key === "t") {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                timestamp = parsed;
            }
            return;
        }
        if (key === "v1") {
            signatures.push(value);
        }
    });

    if (!timestamp || signatures.length === 0) {
        return null;
    }

    return {
        timestamp,
        signatures
    };
}

function secureCompareHex(a: string, b: string) {
    if (!a || !b || a.length !== b.length) return false;
    const aBuffer = Buffer.from(a, "hex");
    const bBuffer = Buffer.from(b, "hex");
    if (aBuffer.length !== bBuffer.length) return false;
    return timingSafeEqual(aBuffer, bBuffer);
}

export function verifyStripeWebhookSignature(
    payload: string,
    header: string,
    webhookSecret: string,
    toleranceSeconds = DEFAULT_TOLERANCE_SECONDS
) {
    const parsed = parseStripeSignatureHeader(header);
    if (!parsed) return false;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const ageSeconds = Math.abs(nowSeconds - parsed.timestamp);
    if (ageSeconds > toleranceSeconds) {
        return false;
    }

    const signedPayload = `${parsed.timestamp}.${payload}`;
    const expected = createHmac("sha256", webhookSecret).update(signedPayload, "utf8").digest("hex");
    return parsed.signatures.some((candidate) => secureCompareHex(candidate, expected));
}

export type StripeEvent = {
    id?: string;
    type?: string;
    data?: {
        object?: Record<string, unknown>;
    };
};
