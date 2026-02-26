import type { FileNode, Message, Project, ProjectVersion } from "@/types";

export type ComplexityTier =
    | "simple"
    | "standard"
    | "advanced"
    | "professional"
    | "enterprise";

export type ProjectPricingQuote = {
    unitAmountCents: number;
    currency: string;
    complexityScore: number;
    complexityTier: ComplexityTier;
    factors: string[];
};

type PricingConfig = {
    baseAmountCents: number;
    maxAmountCents: number;
    currency: string;
    dynamicEnabled: boolean;
};

type TreeStats = {
    fileCount: number;
    folderCount: number;
    maxDepth: number;
};

type WeightedKeywordRule = {
    label: string;
    score: number;
    pattern: RegExp;
};

const KEYWORD_RULES: WeightedKeywordRule[] = [
    { label: "video/streaming", score: 14, pattern: /\b(video|stream|streaming|transcode|cdn)\b/i },
    { label: "real-time", score: 10, pattern: /\b(realtime|real-time|websocket|socket|live chat)\b/i },
    { label: "ecommerce", score: 12, pattern: /\b(ecommerce|e-commerce|cart|checkout|inventory|order)\b/i },
    { label: "auth/permissions", score: 8, pattern: /\b(oauth|sso|login|signup|role|permission|rbac)\b/i },
    { label: "payments", score: 8, pattern: /\b(payment|subscription|billing|invoice|stripe)\b/i },
    { label: "ai/agents", score: 10, pattern: /\b(ai|llm|agent|rag|embedding|vector)\b/i },
    { label: "admin/analytics", score: 7, pattern: /\b(admin|dashboard|analytics|reporting)\b/i },
    { label: "search/filter", score: 5, pattern: /\b(search|filter|sort|pagination)\b/i },
    { label: "mobile", score: 6, pattern: /\b(mobile|ios|android|react native|flutter)\b/i },
    { label: "multitenant", score: 9, pattern: /\b(multi-tenant|multitenant|organization|workspace)\b/i }
];

const TIER_TABLE: Array<{ minScore: number; tier: ComplexityTier }> = [
    { minScore: 80, tier: "enterprise" },
    { minScore: 60, tier: "professional" },
    { minScore: 40, tier: "advanced" },
    { minScore: 20, tier: "standard" },
    { minScore: 0, tier: "simple" }
];

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function resolveLatestVersion(project: Project | null): ProjectVersion | null {
    if (!project?.versions?.length) return null;
    return project.versions[project.versions.length - 1] || null;
}

function flattenTreeStats(nodes?: FileNode[], depth = 1): TreeStats {
    if (!nodes?.length) {
        return { fileCount: 0, folderCount: 0, maxDepth: 0 };
    }

    let fileCount = 0;
    let folderCount = 0;
    let maxDepth = depth;

    for (const node of nodes) {
        if (node.type === "folder") {
            folderCount += 1;
            const child = flattenTreeStats(node.children, depth + 1);
            fileCount += child.fileCount;
            folderCount += child.folderCount;
            maxDepth = Math.max(maxDepth, child.maxDepth);
            continue;
        }

        fileCount += 1;
        maxDepth = Math.max(maxDepth, depth);
    }

    return { fileCount, folderCount, maxDepth };
}

function computeKeywordSignals(text: string) {
    const hits = KEYWORD_RULES.filter((rule) => rule.pattern.test(text));
    const rawScore = hits.reduce((sum, item) => sum + item.score, 0);
    return {
        score: Math.min(28, rawScore),
        labels: hits.map((item) => item.label)
    };
}

function resolveTier(score: number): ComplexityTier {
    for (const row of TIER_TABLE) {
        if (score >= row.minScore) return row.tier;
    }
    return "simple";
}

function sumUserText(messages: Message[]) {
    const userMessages = messages.filter((msg) => msg.role === "user");
    const userMessageCount = userMessages.length;
    const totalUserChars = userMessages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
    const attachmentCount = userMessages.reduce((sum, msg) => sum + (msg.attachments?.length || 0), 0);

    const mergedText = userMessages
        .map((msg) => msg.content || "")
        .join("\n")
        .toLowerCase();

    return { userMessageCount, totalUserChars, attachmentCount, mergedText };
}

function normalizeAmount(value: number, fallback: number) {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(1, Math.round(value));
}

export function formatCurrencyCents(cents: number, currency: string) {
    const normalized = (currency || "usd").trim().toUpperCase();
    try {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: normalized
        }).format(cents / 100);
    } catch {
        return `$${(cents / 100).toFixed(2)}`;
    }
}

export function quoteProjectCreditPrice(
    project: Project | null,
    config: PricingConfig
): ProjectPricingQuote {
    const baseAmountCents = normalizeAmount(config.baseAmountCents, 499);
    const maxAmountCents = Math.max(
        baseAmountCents,
        normalizeAmount(config.maxAmountCents, baseAmountCents * 8)
    );
    const currency = (config.currency || "usd").trim().toLowerCase() || "usd";

    if (!config.dynamicEnabled || !project) {
        return {
            unitAmountCents: baseAmountCents,
            currency,
            complexityScore: 0,
            complexityTier: "simple",
            factors: ["Dynamic pricing disabled or project data not found."]
        };
    }

    const latest = resolveLatestVersion(project);
    const messages = latest?.data.messages || [];
    const { userMessageCount, totalUserChars, attachmentCount, mergedText } = sumUserText(messages);

    const missingCount = latest?.data.evaluation?.analysis?.missing?.length || 0;
    const clarifiedCount = latest?.data.evaluation?.analysis?.clarified?.length || 0;
    const densityScore = latest?.data.evaluation?.density_score || 0;
    const treeStats = flattenTreeStats(latest?.data.generation?.projectTree || []);

    const keywordSeed = [
        project.name || "",
        project.description || "",
        mergedText
    ]
        .join("\n")
        .toLowerCase();
    const keywordSignals = computeKeywordSignals(keywordSeed);

    const conversationScore = Math.min(18, userMessageCount * 1.8);
    const detailScore = Math.min(14, totalUserChars / 550);
    const attachmentScore = Math.min(8, attachmentCount * 2.5);
    const requirementScore = Math.min(18, missingCount * 2.2 + clarifiedCount * 0.6);
    const architectureScore = Math.min(
        20,
        treeStats.fileCount * 0.35 + treeStats.folderCount * 0.2 + treeStats.maxDepth * 2.2
    );
    const maturityScore = Math.min(10, Math.max(0, densityScore) * 0.1);

    const complexityScore = Math.round(
        clamp(
            10 +
                conversationScore +
                detailScore +
                attachmentScore +
                requirementScore +
                architectureScore +
                maturityScore +
                keywordSignals.score,
            8,
            100
        )
    );

    const normalizedScore = complexityScore / 100;
    const curved = Math.pow(normalizedScore, 1.18);
    const rawAmount = baseAmountCents + (maxAmountCents - baseAmountCents) * curved;
    const unitAmountCents = Math.round(rawAmount);
    const complexityTier = resolveTier(complexityScore);

    const factors = [
        `Conversation depth: ${userMessageCount} user turns.`,
        `Requirement detail: ${totalUserChars} chars of user input.`,
        `Attachments: ${attachmentCount}.`,
        `Unresolved questions: ${missingCount}.`,
        `Generated structure: ${treeStats.fileCount} files, depth ${treeStats.maxDepth}.`,
        `Detected scope tags: ${keywordSignals.labels.length ? keywordSignals.labels.join(", ") : "none"}.`
    ];

    return {
        unitAmountCents,
        currency,
        complexityScore,
        complexityTier,
        factors
    };
}
