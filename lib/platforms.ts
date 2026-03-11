import type { DecisionRecord, PlatformStrategy } from "@/types";

export type PlatformCategory =
    | "web"
    | "mobile"
    | "desktop"
    | "backend"
    | "extension"
    | "multi"
    | "unknown";

type PlatformRule = {
    category: Exclude<PlatformCategory, "multi" | "unknown">;
    patterns: RegExp[];
    primaryPlatform: string;
    targetPlatforms: string[];
    runtimeEnvironments: string[];
    distributionChannels: string[];
};

const PLATFORM_RULES: PlatformRule[] = [
    {
        category: "extension",
        patterns: [/browser extension/i, /chrome extension/i, /\bextension\b/i],
        primaryPlatform: "browser_extension",
        targetPlatforms: ["chrome", "edge"],
        runtimeEnvironments: ["browser_extension_runtime"],
        distributionChannels: ["browser_store"]
    },
    {
        category: "mobile",
        patterns: [/\bmobile app\b/i, /\bios\b/i, /\bandroid\b/i, /react native/i, /\bexpo\b/i, /\bflutter\b/i],
        primaryPlatform: "mobile_app",
        targetPlatforms: ["ios", "android"],
        runtimeEnvironments: ["native_mobile_runtime"],
        distributionChannels: ["app_store", "play_store"]
    },
    {
        category: "desktop",
        patterns: [/\bdesktop\b/i, /electron/i, /tauri/i],
        primaryPlatform: "desktop_app",
        targetPlatforms: ["windows", "macos"],
        runtimeEnvironments: ["desktop_runtime"],
        distributionChannels: ["desktop_installer"]
    },
    {
        category: "backend",
        patterns: [/\bbackend service\b/i, /\bapi service\b/i, /\bmicroservice\b/i],
        primaryPlatform: "backend_service",
        targetPlatforms: ["server"],
        runtimeEnvironments: ["server_runtime"],
        distributionChannels: ["private_deployment"]
    },
    {
        category: "web",
        patterns: [/\bweb\b/i, /website/i, /browser/i, /landing page/i, /dashboard/i, /saas/i],
        primaryPlatform: "web_app",
        targetPlatforms: ["web"],
        runtimeEnvironments: ["browser"],
        distributionChannels: ["web"]
    }
];

function uniqueStrings(values: string[]) {
    const seen = new Set<string>();
    return values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
        .filter((value) => {
            const key = value.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function getPlatformLabel(value: string) {
    const normalized = (value || "").trim().toLowerCase();
    const labels: Record<string, string> = {
        web_app: "Web app",
        web: "Web",
        mobile_app: "Mobile app",
        ios: "iOS",
        android: "Android",
        desktop_app: "Desktop app",
        backend_service: "Backend service",
        browser_extension: "Browser extension",
        multi_platform: "Multi-platform",
        chrome: "Chrome",
        edge: "Edge",
        windows: "Windows",
        macos: "macOS",
        server: "Server",
        browser: "Browser"
    };
    return labels[normalized] || value;
}

export function createEmptyPlatformStrategy(): PlatformStrategy {
    return {
        primaryPlatform: "",
        targetPlatforms: [],
        runtimeEnvironments: [],
        distributionChannels: []
    };
}

export function normalizePlatformStrategy(value: unknown): PlatformStrategy {
    if (!value || typeof value !== "object") {
        return createEmptyPlatformStrategy();
    }

    const candidate = value as Record<string, unknown>;
    return {
        primaryPlatform: typeof candidate.primaryPlatform === "string" ? candidate.primaryPlatform.trim() : "",
        targetPlatforms: uniqueStrings(Array.isArray(candidate.targetPlatforms) ? candidate.targetPlatforms.map(String) : []),
        runtimeEnvironments: uniqueStrings(Array.isArray(candidate.runtimeEnvironments) ? candidate.runtimeEnvironments.map(String) : []),
        distributionChannels: uniqueStrings(Array.isArray(candidate.distributionChannels) ? candidate.distributionChannels.map(String) : [])
    };
}

export function inferPlatformStrategyFromText(...texts: Array<string | undefined | null>): PlatformStrategy {
    const merged = texts
        .filter((text): text is string => typeof text === "string" && text.trim().length > 0)
        .join("\n");
    const lowered = merged.toLowerCase();
    const matched = PLATFORM_RULES.filter((rule) => rule.patterns.some((pattern) => pattern.test(lowered)));

    if (matched.length === 0) return createEmptyPlatformStrategy();
    if (matched.length > 1) {
        return {
            primaryPlatform: "multi_platform",
            targetPlatforms: uniqueStrings(matched.flatMap((rule) => rule.targetPlatforms)),
            runtimeEnvironments: uniqueStrings(matched.flatMap((rule) => rule.runtimeEnvironments)),
            distributionChannels: uniqueStrings(matched.flatMap((rule) => rule.distributionChannels))
        };
    }

    const rule = matched[0];
    return {
        primaryPlatform: rule.primaryPlatform,
        targetPlatforms: [...rule.targetPlatforms],
        runtimeEnvironments: [...rule.runtimeEnvironments],
        distributionChannels: [...rule.distributionChannels]
    };
}

export function mergePlatformStrategies(...strategies: PlatformStrategy[]): PlatformStrategy {
    const normalized = strategies.map((strategy) => normalizePlatformStrategy(strategy));
    const primaryPlatform = normalized.find((strategy) => strategy.primaryPlatform)?.primaryPlatform || "";
    return {
        primaryPlatform,
        targetPlatforms: uniqueStrings(normalized.flatMap((strategy) => strategy.targetPlatforms)),
        runtimeEnvironments: uniqueStrings(normalized.flatMap((strategy) => strategy.runtimeEnvironments)),
        distributionChannels: uniqueStrings(normalized.flatMap((strategy) => strategy.distributionChannels))
    };
}

export function hasConfirmedPlatformStrategy(strategy: PlatformStrategy | null | undefined) {
    const normalized = normalizePlatformStrategy(strategy);
    return Boolean(
        normalized.primaryPlatform ||
        normalized.targetPlatforms.length > 0 ||
        normalized.runtimeEnvironments.length > 0
    );
}

export function resolvePrimaryPlatformCategory(strategy: PlatformStrategy | null | undefined): PlatformCategory {
    const primary = normalizePlatformStrategy(strategy).primaryPlatform.toLowerCase();
    if (!primary) return "unknown";
    if (primary.includes("multi")) return "multi";
    if (primary.includes("extension")) return "extension";
    if (primary.includes("mobile") || primary.includes("ios") || primary.includes("android")) return "mobile";
    if (primary.includes("desktop")) return "desktop";
    if (primary.includes("backend") || primary.includes("service") || primary.includes("api")) return "backend";
    if (primary.includes("web")) return "web";
    return "unknown";
}

export function buildPlatformSummaryLine(strategy: PlatformStrategy | null | undefined) {
    const normalized = normalizePlatformStrategy(strategy);
    if (!hasConfirmedPlatformStrategy(normalized)) return "";

    const primary = getPlatformLabel(normalized.primaryPlatform);
    const targets = normalized.targetPlatforms.slice(0, 3).map((item) => getPlatformLabel(item));
    return `Platform strategy: ${primary || "Unnamed platform"}${targets.length > 0 ? `; targets ${targets.join(", ")}` : ""}`;
}

export function hasRecordedStackDecision(records: DecisionRecord[]) {
    const combined = records
        .map((record) => `${record.title} ${record.decision} ${record.rationale}`)
        .join(" ")
        .toLowerCase();

    if (!combined.trim()) return false;
    return /tech stack|stack baseline|framework|frontend|backend|runtime|database/.test(combined) ||
        /next\.?js|vite|fastify|nestjs|fastapi|expo|react native|flutter|tauri|electron|firebase|supabase|postgres|plasmo|wxt/.test(combined);
}

export function buildDefaultToolStackMarkdown(input: {
    platformStrategy?: PlatformStrategy | null;
    contextText?: string;
}) {
    const inferred = inferPlatformStrategyFromText(input.contextText || "");
    const merged = mergePlatformStrategies(
        inferred,
        normalizePlatformStrategy(input.platformStrategy)
    );

    switch (resolvePrimaryPlatformCategory(merged)) {
        case "mobile":
            return [
                "| Category | Tool | Why |",
                "| --- | --- | --- |",
                "| Platform | Mobile App | iOS and Android product surface |",
                "| App Shell | Expo + React Native | Fast cross-platform mobile delivery |",
                "| Navigation | Expo Router | File-based mobile routing with Expo |",
                "| Language | TypeScript | Shared contracts and safer refactors |",
                "| Data | Firebase or Supabase | Managed backend for mobile MVP and growth |",
                "| State | Zustand | Lightweight client state for mobile flows |",
                "| Deployment | EAS Build | Straight path to store-ready builds |"
            ].join("\n");
        case "desktop":
            return [
                "| Category | Tool | Why |",
                "| --- | --- | --- |",
                "| Platform | Desktop App | Native-feeling desktop delivery |",
                "| Shell | Tauri + React | Efficient desktop runtime with web UI productivity |",
                "| UI | React + Vite | Fast desktop UI iteration with web skills |",
                "| Language | TypeScript + Rust | Strong split between UI and shell concerns |",
                "| Data | SQLite or API backend | Good fit for local-first or hybrid desktop apps |",
                "| Distribution | Desktop installers | Windows and macOS packaging |",
                "| Notes | Desktop-first | Good default for modern desktop products |"
            ].join("\n");
        case "backend":
            return [
                "| Category | Tool | Why |",
                "| --- | --- | --- |",
                "| Platform | Backend Service | API-first or worker-first delivery |",
                "| Runtime | Fastify + TypeScript | Fast, lightweight backend baseline |",
                "| Language | TypeScript | Strong contracts and shared DTOs |",
                "| Data | PostgreSQL + Prisma | Predictable relational data layer |",
                "| Queue | BullMQ or managed queue | Common fit for background jobs |",
                "| Deployment | Container / Node hosting | Simple backend deployment path |",
                "| Notes | Service-first | Good default for product APIs and services |"
            ].join("\n");
        case "extension":
            return [
                "| Category | Tool | Why |",
                "| --- | --- | --- |",
                "| Platform | Browser Extension | Chrome and Edge extension delivery |",
                "| Framework | Plasmo + React | Productive extension structure with React UI |",
                "| Language | TypeScript | Safer messaging and content script contracts |",
                "| Storage | Browser storage API | Native fit for extension state |",
                "| Backend | Optional API service | Only when server workflows are required |",
                "| Distribution | Browser stores | Straight path to store packaging |",
                "| Notes | Extension-first | Good default for React-heavy teams |"
            ].join("\n");
        case "multi":
            return [
                "| Category | Tool | Why |",
                "| --- | --- | --- |",
                "| Platform | Multi-Platform | Web, mobile, and backend delivery together |",
                "| Monorepo | Turborepo | Shared contracts and coordinated builds |",
                "| Web | Next.js | Strong fit for web surface and SEO |",
                "| Mobile | Expo + React Native | Shared mobile delivery for iOS and Android |",
                "| Backend | NestJS | Structured API layer across clients |",
                "| Data | PostgreSQL | Shared durable system of record |",
                "| Notes | Multi-surface | Use when multiple product surfaces are in scope now |"
            ].join("\n");
        case "web":
        case "unknown":
        default:
            return [
                "| Category | Tool | Why |",
                "| --- | --- | --- |",
                "| Platform | Web App | Browser-first product surface |",
                "| Frontend | Next.js | Full-stack React with SSR, routing, and server actions |",
                "| Language | TypeScript | Shared types across UI and backend |",
                "| Styling | Tailwind CSS | Fast, consistent UI system |",
                "| Data | PostgreSQL + Prisma | Relational data model and predictable migrations |",
                "| Auth | Auth.js or custom session | Flexible session-based auth for web apps |",
                "| Deployment | Vercel / Node hosting | Straight path for SSR web delivery |"
            ].join("\n");
    }
}
