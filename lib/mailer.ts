import nodemailer from "nodemailer";
import type { AuthCodePurpose } from "@/lib/auth-types";

const purposeTitle: Record<AuthCodePurpose, string> = {
    REGISTER: "Account registration",
    LOGIN: "Sign in",
    RESET_PASSWORD: "Password reset",
    CHANGE_EMAIL: "Email change"
};

function getMailerConfig() {
    const server = process.env.EMAIL_SERVER;
    const from = process.env.EMAIL_FROM;

    if (!server || !from) {
        throw new Error("Email configuration missing. Set EMAIL_SERVER and EMAIL_FROM.");
    }

    return { server, from };
}

function formatCurrencyCents(cents: number, currency: string) {
    const safeCents = Number.isFinite(cents) ? Math.max(0, Math.round(cents)) : 0;
    const safeCurrency = (currency || "usd").trim().toUpperCase() || "USD";
    try {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: safeCurrency
        }).format(safeCents / 100);
    } catch {
        return `${safeCurrency} ${(safeCents / 100).toFixed(2)}`;
    }
}

export async function sendVerificationCodeEmail(input: {
    email: string;
    code: string;
    purpose: AuthCodePurpose;
}) {
    const { server, from } = getMailerConfig();

    const transporter = nodemailer.createTransport(server);
    const title = purposeTitle[input.purpose];

    await transporter.sendMail({
        from,
        to: input.email,
        subject: `Forecoding ${title} code`,
        text: `Your Forecoding verification code is ${input.code}. It expires in 120 seconds.`,
        html: `
            <div style="font-family:Arial,sans-serif;line-height:1.6;">
              <h2 style="margin:0 0 12px;">Forecoding ${title}</h2>
              <p style="margin:0 0 12px;">Use this verification code to continue:</p>
              <div style="font-size:28px;font-weight:700;letter-spacing:4px;margin:12px 0;">${input.code}</div>
              <p style="margin:0;color:#666;">Code expires in 120 seconds.</p>
            </div>
        `
    });
}

export async function sendProjectOrderEmail(input: {
    email: string;
    projectName: string;
    orderId: string;
    amountCents: number;
    currency: string;
    paidAt: Date;
}) {
    const { server, from } = getMailerConfig();
    const transporter = nodemailer.createTransport(server);
    const displayAmount = formatCurrencyCents(input.amountCents, input.currency);
    const paidAtText = input.paidAt.toISOString().replace("T", " ").replace("Z", " UTC");
    const safeProjectName = input.projectName.trim() || "Project Credit";

    await transporter.sendMail({
        from,
        to: input.email,
        subject: `Forecoding order confirmed - ${safeProjectName}`,
        text: [
            `Your Forecoding payment was successful.`,
            `Project: ${safeProjectName}`,
            `Order ID: ${input.orderId}`,
            `Amount: ${displayAmount}`,
            `Paid at: ${paidAtText}`,
            ``,
            `You can now generate your blueprint in Forecoding.`
        ].join("\n"),
        html: `
            <div style="font-family:Arial,sans-serif;line-height:1.6;">
              <h2 style="margin:0 0 12px;">Forecoding Order Confirmed</h2>
              <p style="margin:0 0 8px;">Your payment was successful.</p>
              <p style="margin:0;"><strong>Project:</strong> ${safeProjectName}</p>
              <p style="margin:0;"><strong>Order ID:</strong> ${input.orderId}</p>
              <p style="margin:0;"><strong>Amount:</strong> ${displayAmount}</p>
              <p style="margin:0 0 12px;"><strong>Paid at:</strong> ${paidAtText}</p>
              <p style="margin:0;color:#444;">You can now generate your blueprint in Forecoding.</p>
            </div>
        `
    });
}
