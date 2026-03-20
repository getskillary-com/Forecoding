export type RuntimePreflightSeverity = "error" | "warning";

export type RuntimePreflightIssue = {
    code: string;
    severity: RuntimePreflightSeverity;
    message: string;
    envKey?: string;
};

export type RuntimePreflightResult = {
    checkedAt: number;
    pass: boolean;
    issues: RuntimePreflightIssue[];
};

function hasEnvValue(key: string) {
    return Boolean((process.env[key] || "").trim());
}

function pushMissingEnvIssue(issues: RuntimePreflightIssue[], key: string, message: string) {
    if (hasEnvValue(key)) return;
    issues.push({
        code: "ENV_MISSING",
        severity: "error",
        message,
        envKey: key
    });
}

function normalizeAiProvider(value: string | undefined) {
    const normalized = (value || "").trim().toLowerCase();
    if (normalized === "openai" || normalized === "gemini" || normalized === "claude") {
        return normalized;
    }
    return "";
}

function issueSeverityRank(severity: RuntimePreflightSeverity) {
    return severity === "error" ? 0 : 1;
}

export function runRuntimePreflightCheck(): RuntimePreflightResult {
    const issues: RuntimePreflightIssue[] = [];

    pushMissingEnvIssue(issues, "APP_BASE_URL", "APP_BASE_URL must be configured for canonical links and callback URLs.");
    pushMissingEnvIssue(issues, "AUTH_SESSION_COOKIE_NAME", "AUTH_SESSION_COOKIE_NAME must be configured for session consistency.");
    pushMissingEnvIssue(issues, "AUTH_CODE_SECRET", "AUTH_CODE_SECRET must be configured to sign login/reset codes.");
    pushMissingEnvIssue(issues, "EMAIL_SERVER", "EMAIL_SERVER must be configured to send auth and recovery emails.");
    pushMissingEnvIssue(issues, "EMAIL_FROM", "EMAIL_FROM must be configured for outbound auth emails.");

    pushMissingEnvIssue(issues, "FIREBASE_PROJECT_ID", "FIREBASE_PROJECT_ID must be configured for server-side Firebase access.");
    pushMissingEnvIssue(issues, "FIREBASE_CLIENT_EMAIL", "FIREBASE_CLIENT_EMAIL must be configured for server-side Firebase access.");
    pushMissingEnvIssue(issues, "FIREBASE_PRIVATE_KEY", "FIREBASE_PRIVATE_KEY must be configured for server-side Firebase access.");

    pushMissingEnvIssue(issues, "STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY must be configured for checkout, refund, and reconciliation flows.");
    pushMissingEnvIssue(issues, "STRIPE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET must be configured for webhook signature verification.");

    const hasAdminEmails = hasEnvValue("FORECODING_ADMIN_EMAILS") || hasEnvValue("ADMIN_EMAILS");
    if (!hasAdminEmails) {
        issues.push({
            code: "ADMIN_CONFIG_MISSING",
            severity: "error",
            message: "At least one admin email must be configured in FORECODING_ADMIN_EMAILS (or ADMIN_EMAILS).",
            envKey: "FORECODING_ADMIN_EMAILS"
        });
    }

    const appBaseUrl = (process.env.APP_BASE_URL || "").trim();
    if (appBaseUrl) {
        try {
            const parsed = new URL(appBaseUrl);
            if (!parsed.protocol || (parsed.protocol !== "https:" && process.env.NODE_ENV === "production")) {
                issues.push({
                    code: "APP_BASE_URL_INSECURE",
                    severity: "warning",
                    message: "APP_BASE_URL should use HTTPS in production.",
                    envKey: "APP_BASE_URL"
                });
            }
        } catch {
            issues.push({
                code: "APP_BASE_URL_INVALID",
                severity: "error",
                message: "APP_BASE_URL is not a valid URL.",
                envKey: "APP_BASE_URL"
            });
        }
    }

    const aiProviderRaw = (process.env.AI_PROVIDER || "").trim();
    const aiProvider = normalizeAiProvider(aiProviderRaw);
    if (!aiProvider) {
        issues.push({
            code: "AI_PROVIDER_INVALID",
            severity: "error",
            message: "AI_PROVIDER must be one of: openai, gemini, claude.",
            envKey: "AI_PROVIDER"
        });
    } else if (aiProvider === "openai" && !hasEnvValue("OPENAI_API_KEY")) {
        issues.push({
            code: "AI_PROVIDER_KEY_MISSING",
            severity: "error",
            message: "OPENAI_API_KEY is required when AI_PROVIDER=openai.",
            envKey: "OPENAI_API_KEY"
        });
    } else if (aiProvider === "gemini" && !hasEnvValue("GEMINI_API_KEY")) {
        issues.push({
            code: "AI_PROVIDER_KEY_MISSING",
            severity: "error",
            message: "GEMINI_API_KEY is required when AI_PROVIDER=gemini.",
            envKey: "GEMINI_API_KEY"
        });
    } else if (aiProvider === "claude" && !hasEnvValue("CLAUDE_API_KEY") && !hasEnvValue("ANTHROPIC_API_KEY")) {
        issues.push({
            code: "AI_PROVIDER_KEY_MISSING",
            severity: "error",
            message: "CLAUDE_API_KEY (or ANTHROPIC_API_KEY) is required when AI_PROVIDER=claude.",
            envKey: "CLAUDE_API_KEY"
        });
    }

    if (process.env.NODE_ENV === "production" && (process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS || "").trim() === "1") {
        issues.push({
            code: "DEV_AUTH_BYPASS_ENABLED",
            severity: "warning",
            message: "NEXT_PUBLIC_DEV_AUTH_BYPASS=1 should not be enabled in production.",
            envKey: "NEXT_PUBLIC_DEV_AUTH_BYPASS"
        });
    }

    issues.sort((left, right) => {
        const severityOrder = issueSeverityRank(left.severity) - issueSeverityRank(right.severity);
        if (severityOrder !== 0) return severityOrder;
        const keyOrder = (left.envKey || "").localeCompare(right.envKey || "");
        if (keyOrder !== 0) return keyOrder;
        return left.code.localeCompare(right.code);
    });

    return {
        checkedAt: Date.now(),
        pass: issues.every((issue) => issue.severity !== "error"),
        issues
    };
}
