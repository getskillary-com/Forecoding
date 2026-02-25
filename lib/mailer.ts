import nodemailer from "nodemailer";
import type { AuthCodePurpose } from "@prisma/client";

const purposeTitle: Record<AuthCodePurpose, string> = {
    REGISTER: "Account registration",
    LOGIN: "Sign in",
    RESET_PASSWORD: "Password reset",
    CHANGE_EMAIL: "Email change"
};

export async function sendVerificationCodeEmail(input: {
    email: string;
    code: string;
    purpose: AuthCodePurpose;
}) {
    const server = process.env.EMAIL_SERVER;
    const from = process.env.EMAIL_FROM;

    if (!server || !from) {
        throw new Error("Email configuration missing. Set EMAIL_SERVER and EMAIL_FROM.");
    }

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
