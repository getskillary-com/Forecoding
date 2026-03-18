import type {
    ExportContentKind,
    FileNode,
    GenerationManifest,
    GenerationManifestFile,
    SpecPackProfile,
    TemplateKind
} from "@/types";

type BuildSpecPackProfileInput = {
    templateKind: TemplateKind;
    toolStack?: string;
    history?: string;
};

const STACK_SIGNAL_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
    { key: "next", pattern: /\bnext(\.js)?\b|app router/i },
    { key: "vite", pattern: /\bvite\b/i },
    { key: "react-router", pattern: /react-router|react router/i },
    { key: "firebase", pattern: /\bfirebase\b|firestore|cloud functions/i },
    { key: "prisma", pattern: /\bprisma\b/i },
    { key: "stripe", pattern: /\bstripe\b/i },
    { key: "supabase", pattern: /\bsupabase\b/i },
    { key: "openai", pattern: /\bopenai\b|responses api|vercel ai sdk/i },
    { key: "vercel-ai", pattern: /vercel ai sdk/i },
    { key: "charting", pattern: /recharts|chart/i },
    { key: "xlsx", pattern: /\bxlsx\b|excel/i },
    { key: "document-import", pattern: /pdf-parse|mammoth|docx|word|pdf/i },
    { key: "workspace", pattern: /monorepo|workspace|turborepo|turbo/i }
];

const ROOT_DOC_PATHS = new Set([
    "README.md",
    "IMPLEMENTATION_PLAN.md",
    "ONE_CLICK_PROMPT.md",
    "_AI_PROMPT.md"
]);

const ROOT_CONFIG_PATHS = new Set([
    "package.json",
    "tsconfig.json",
    "next.config.ts",
    "vite.config.ts",
    "tailwind.config.js",
    "tailwind.config.ts",
    "postcss.config.js",
    "postcss.config.mjs",
    "postcss.config.cjs",
    "turbo.json",
    ".env.example",
    "GENERATION_MANIFEST.json",
    "index.html"
]);

function normalizePath(path: string) {
    return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.?\//, "");
}

function collectFileNodes(nodes: FileNode[], prefix = ""): Array<{ path: string; content: string }> {
    const entries: Array<{ path: string; content: string }> = [];
    for (const node of nodes || []) {
        const path = prefix ? `${prefix}/${node.name}` : node.name;
        if (node.type === "folder") {
            entries.push(...collectFileNodes(node.children || [], path));
            continue;
        }
        entries.push({
            path,
            content: typeof node.content === "string" ? node.content : ""
        });
    }
    return entries;
}

export function buildSpecPackProfile(input: BuildSpecPackProfileInput): SpecPackProfile {
    const merged = `${input.toolStack || ""}\n${input.history || ""}`;
    const stackSignals = STACK_SIGNAL_PATTERNS
        .filter((entry) => entry.pattern.test(merged))
        .map((entry) => entry.key);

    if (input.templateKind === "monorepo_multiapp") {
        return {
            version: "spec_pack_profile_v1",
            framework: "monorepo_multiapp",
            templateKind: input.templateKind,
            routeStyle: "next_app_router",
            workspaceMode: "monorepo",
            stackSignals,
            dependencyHints: stackSignals
        };
    }

    if (input.templateKind === "react_vite") {
        return {
            version: "spec_pack_profile_v1",
            framework: "react_vite_spa",
            templateKind: input.templateKind,
            routeStyle: "react_router",
            workspaceMode: "single_app",
            stackSignals,
            dependencyHints: stackSignals
        };
    }

    return {
        version: "spec_pack_profile_v1",
        framework: "next_app_router",
        templateKind: input.templateKind,
        routeStyle: "next_app_router",
        workspaceMode: "single_app",
        stackSignals,
        dependencyHints: stackSignals
    };
}

export function classifySpecPackContentKind(path: string): ExportContentKind {
    const normalized = normalizePath(path);
    if (!normalized) return "placeholder";
    if (/^config\/integrations\/.+\.template\./i.test(normalized)) return "template";
    if (ROOT_DOC_PATHS.has(normalized) || normalized.startsWith("docs/") || normalized.endsWith("/_AI_PROMPT.md")) {
        return "doc";
    }
    if (
        ROOT_CONFIG_PATHS.has(normalized) ||
        /^apps\/[^/]+\/package\.json$/i.test(normalized) ||
        /^apps\/[^/]+\/tsconfig\.json$/i.test(normalized) ||
        /^packages\/[^/]+\/package\.json$/i.test(normalized) ||
        /^packages\/[^/]+\/tsconfig\.json$/i.test(normalized)
    ) {
        return "config";
    }
    return "placeholder";
}

export function findManifestFileEntry(
    manifest: GenerationManifest | null | undefined,
    path: string
): GenerationManifestFile | null {
    const normalized = normalizePath(path);
    if (!manifest || !Array.isArray(manifest.files)) return null;
    return manifest.files.find((entry) => normalizePath(entry.path) === normalized) || null;
}

export function shouldWriteRealSpecPackContent(
    path: string,
    manifest?: GenerationManifest | null
) {
    const manifestEntry = findManifestFileEntry(manifest, path);
    if (manifestEntry) {
        return manifestEntry.contentKind !== "placeholder";
    }
    return classifySpecPackContentKind(path) !== "placeholder";
}

export function parseManifestFromTree(nodes: FileNode[] | null | undefined): GenerationManifest | null {
    if (!Array.isArray(nodes) || nodes.length === 0) return null;
    const manifestEntry = collectFileNodes(nodes).find((entry) => normalizePath(entry.path) === "GENERATION_MANIFEST.json");
    if (!manifestEntry?.content) return null;
    try {
        return JSON.parse(manifestEntry.content) as GenerationManifest;
    } catch {
        return null;
    }
}
