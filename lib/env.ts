import { z } from "zod";

const APP_BASE_URL_FALLBACK = "https://forecoding.com";

const optionalString = z.string().trim().optional();

const ServerEnvSchema = z.object({
    APP_BASE_URL: optionalString,
    EMAIL_SERVER: optionalString,
    EMAIL_FROM: optionalString,
    FORECODING_ADMIN_EMAILS: optionalString,
    ADMIN_EMAILS: optionalString,
    FORECODING_OPERATOR_EMAILS: optionalString,
    OPERATOR_EMAILS: optionalString,
    FORECODING_ADMIN_VIEWER_EMAILS: optionalString,
    ADMIN_VIEWER_EMAILS: optionalString,
    NEXT_PUBLIC_DEV_AUTH_BYPASS: optionalString,
    AUTH_SESSION_COOKIE_NAME: optionalString
});

type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cachedServerEnv: ServerEnv | null = null;

function readServerEnv(): ServerEnv {
    if (cachedServerEnv) return cachedServerEnv;
    cachedServerEnv = ServerEnvSchema.parse(process.env);
    return cachedServerEnv;
}

function parseBooleanFlag(value: string | undefined, fallback = false) {
    const normalized = (value || "").trim().toLowerCase();
    if (!normalized) return fallback;
    return !["0", "false", "off", "no"].includes(normalized);
}

export function getAppBaseUrl() {
    const env = readServerEnv();
    const candidate = env.APP_BASE_URL || APP_BASE_URL_FALLBACK;
    const parsed = z.string().trim().url().safeParse(candidate);
    return parsed.success ? parsed.data : APP_BASE_URL_FALLBACK;
}

export function getMailerConfigFromEnv() {
    const env = readServerEnv();
    const server = (env.EMAIL_SERVER || "").trim();
    const from = (env.EMAIL_FROM || "").trim();
    if (!server) {
        throw new Error("Email configuration missing. Set EMAIL_SERVER.");
    }
    if (!from) {
        throw new Error("Email configuration missing. Set EMAIL_FROM.");
    }
    return {
        server,
        from
    };
}

export function getAdminEmailsFromEnv() {
    const env = readServerEnv();
    const source = `${env.FORECODING_ADMIN_EMAILS || ""}\n${env.ADMIN_EMAILS || ""}`;
    return new Set(
        source
            .split(/[,\n;]+/)
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean)
    );
}

function parseEmailSet(...sources: Array<string | undefined>) {
    return new Set(
        sources
            .join("\n")
            .split(/[,\n;]+/)
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean)
    );
}

export function getOperatorEmailsFromEnv() {
    const env = readServerEnv();
    return parseEmailSet(env.FORECODING_OPERATOR_EMAILS, env.OPERATOR_EMAILS);
}

export function getAdminViewerEmailsFromEnv() {
    const env = readServerEnv();
    return parseEmailSet(env.FORECODING_ADMIN_VIEWER_EMAILS, env.ADMIN_VIEWER_EMAILS);
}

export function isDevAuthBypassEnabled() {
    if (process.env.NODE_ENV === "production") return false;
    const env = readServerEnv();
    return parseBooleanFlag(env.NEXT_PUBLIC_DEV_AUTH_BYPASS, false);
}

export function getAuthSessionCookieName() {
    const env = readServerEnv();
    return env.AUTH_SESSION_COOKIE_NAME || "__session";
}
