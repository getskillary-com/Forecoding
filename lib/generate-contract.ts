import { z } from "zod";
import type { FileNode, OutputMode, TemplateKind } from "@/types";

const OutputModeSchema = z.enum(["virtual_spec", "runnable_scaffold"]);
const TemplateKindSchema = z.enum(["next_root", "next_src", "react_vite", "monorepo_multiapp"]);
const ReleaseIntentSchema = z.string().trim().min(1).max(120);

const GenerateContractSchema = z.object({
    workspaceSnapshotId: z.string().trim().min(1).max(220).optional(),
    outputMode: OutputModeSchema.optional(),
    templateKind: TemplateKindSchema.optional(),
    templateKindHint: TemplateKindSchema.optional(),
    releaseIntent: ReleaseIntentSchema.optional()
}).passthrough();

const DEFAULT_OUTPUT_MODE: OutputMode = "virtual_spec";
const DEFAULT_RELEASE_INTENT = "workspace_generate";

type GenerateContractField = "workspaceSnapshotId" | "outputMode" | "templateKind" | "releaseIntent";

export type GenerateJobContract = {
    workspaceSnapshotId: string;
    outputMode: OutputMode;
    templateKind: TemplateKind;
    releaseIntent: string;
};

export type GenerateJobContractIssue = {
    code: "GENERATE_CONTRACT_INFERRED" | "GENERATE_CONTRACT_INVALID" | "GENERATE_CONTRACT_MISSING";
    severity: "warning" | "error";
    field: GenerateContractField;
    message: string;
    source?: string;
};

type ResolveGenerateJobContractInput = {
    workspaceSnapshotId?: string | null;
    outputMode?: OutputMode | null;
    templateKind?: TemplateKind | null;
    releaseIntent?: string | null;
};

type ResolveGenerateJobContractOptions = {
    strict?: boolean;
};

type ResolveGenerateJobContractResult =
    | {
        ok: true;
        contract: GenerateJobContract;
        issues: GenerateJobContractIssue[];
    }
    | {
        ok: false;
        issues: GenerateJobContractIssue[];
    };

function normalizeSnapshotId(value: unknown) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, 220);
}

function normalizeReleaseIntent(value: unknown) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, 120);
}

function formatSchemaIssues(error: z.ZodError) {
    return error.issues
        .map((issue) => {
            const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
            return `${path}: ${issue.message}`;
        })
        .join(" | ");
}

function collectFilePaths(nodes: FileNode[], prefix: string, output: Set<string>) {
    for (const node of nodes) {
        const name = typeof node?.name === "string" ? node.name.trim() : "";
        if (!name) continue;
        const currentPath = prefix ? `${prefix}/${name}` : name;
        if (node.type === "file") {
            output.add(currentPath);
            continue;
        }
        if (node.type === "folder" && Array.isArray(node.children) && node.children.length > 0) {
            collectFilePaths(node.children, currentPath, output);
        }
    }
}

export function inferTemplateKindFromProjectTree(tree?: FileNode[] | null): TemplateKind | null {
    if (!Array.isArray(tree) || tree.length === 0) return null;

    const topLevel = new Set(
        tree
            .map((node) => (typeof node?.name === "string" ? node.name.trim() : ""))
            .filter(Boolean)
    );

    if (topLevel.has("apps") || topLevel.has("packages")) {
        return "monorepo_multiapp";
    }

    const allPaths = new Set<string>();
    collectFilePaths(tree, "", allPaths);

    if (
        allPaths.has("vite.config.ts")
        || allPaths.has("src/main.tsx")
        || Array.from(allPaths).some((path) => /^src\/pages\/.+\.(ts|tsx|js|jsx)$/i.test(path))
    ) {
        return "react_vite";
    }

    if (topLevel.has("src")) {
        return "next_src";
    }

    if (topLevel.has("app")) {
        return "next_root";
    }

    return null;
}

function pickTemplateKind(
    value: {
        templateKind?: TemplateKind;
        templateKindHint?: TemplateKind;
    },
    fallback: ResolveGenerateJobContractInput
) {
    if (value.templateKind) {
        return {
            templateKind: value.templateKind,
            source: "request.templateKind",
            inferred: false
        };
    }

    if (value.templateKindHint) {
        return {
            templateKind: value.templateKindHint,
            source: "request.templateKindHint",
            inferred: true
        };
    }

    if (fallback.templateKind) {
        return {
            templateKind: fallback.templateKind,
            source: "fallback.templateKind",
            inferred: true
        };
    }

    return {
        templateKind: null,
        source: "",
        inferred: false
    };
}

export function resolveGenerateJobContract(
    rawBody: unknown,
    fallback: ResolveGenerateJobContractInput,
    options?: ResolveGenerateJobContractOptions
): ResolveGenerateJobContractResult {
    const parsed = GenerateContractSchema.safeParse(rawBody);
    if (!parsed.success) {
        return {
            ok: false,
            issues: [
                {
                    code: "GENERATE_CONTRACT_INVALID",
                    severity: "error",
                    field: "workspaceSnapshotId",
                    message: formatSchemaIssues(parsed.error)
                }
            ]
        };
    }

    const body = parsed.data;
    const strict = options?.strict === true;
    const issues: GenerateJobContractIssue[] = [];

    const requestWorkspaceSnapshotId = normalizeSnapshotId(body.workspaceSnapshotId);
    const fallbackWorkspaceSnapshotId = normalizeSnapshotId(fallback.workspaceSnapshotId);
    const workspaceSnapshotId = requestWorkspaceSnapshotId || (!strict ? fallbackWorkspaceSnapshotId : "");
    if (!workspaceSnapshotId) {
        issues.push({
            code: "GENERATE_CONTRACT_MISSING",
            severity: "error",
            field: "workspaceSnapshotId",
            message: strict
                ? "workspaceSnapshotId is required in strict mode."
                : "workspaceSnapshotId is required and could not be inferred from the current workspace envelope."
        });
    } else if (!requestWorkspaceSnapshotId) {
        issues.push({
            code: "GENERATE_CONTRACT_INFERRED",
            severity: "warning",
            field: "workspaceSnapshotId",
            message: "workspaceSnapshotId was inferred from fallback workspace state.",
            source: "fallback.workspaceSnapshotId"
        });
    }

    const outputMode = body.outputMode || (!strict ? fallback.outputMode || DEFAULT_OUTPUT_MODE : undefined);
    if (!outputMode) {
        issues.push({
            code: "GENERATE_CONTRACT_MISSING",
            severity: "error",
            field: "outputMode",
            message: strict
                ? "outputMode is required in strict mode."
                : "outputMode is required and could not be inferred."
        });
    } else if (!body.outputMode) {
        issues.push({
            code: "GENERATE_CONTRACT_INFERRED",
            severity: "warning",
            field: "outputMode",
            message: "outputMode was inferred because request.outputMode was not provided.",
            source: fallback.outputMode ? "fallback.outputMode" : DEFAULT_OUTPUT_MODE
        });
    }

    const templatePick = strict
        ? {
            templateKind: body.templateKind || null,
            source: body.templateKind ? "request.templateKind" : "",
            inferred: false
        }
        : pickTemplateKind(body, fallback);
    const templateKind = templatePick.templateKind;
    if (!templateKind) {
        issues.push({
            code: "GENERATE_CONTRACT_MISSING",
            severity: "error",
            field: "templateKind",
            message: strict
                ? "templateKind is required in strict mode."
                : "templateKind is required and could not be inferred from request.templateKindHint or existing project tree."
        });
    } else if (templatePick.inferred) {
        issues.push({
            code: "GENERATE_CONTRACT_INFERRED",
            severity: "warning",
            field: "templateKind",
            message: "templateKind was inferred from a compatibility source.",
            source: templatePick.source
        });
    }

    const fallbackReleaseIntent = normalizeReleaseIntent(fallback.releaseIntent);
    let releaseIntent = normalizeReleaseIntent(body.releaseIntent);
    if (!releaseIntent) {
        if (strict) {
            issues.push({
                code: "GENERATE_CONTRACT_MISSING",
                severity: "error",
                field: "releaseIntent",
                message: "releaseIntent is required in strict mode."
            });
        } else {
            releaseIntent = fallbackReleaseIntent || DEFAULT_RELEASE_INTENT;
            issues.push({
                code: "GENERATE_CONTRACT_INFERRED",
                severity: "warning",
                field: "releaseIntent",
                message: "releaseIntent was inferred because request.releaseIntent was not provided.",
                source: fallbackReleaseIntent ? "fallback.releaseIntent" : DEFAULT_RELEASE_INTENT
            });
        }
    }

    if (issues.some((issue) => issue.severity === "error")) {
        return {
            ok: false,
            issues
        };
    }

    return {
        ok: true,
        contract: {
            workspaceSnapshotId,
            outputMode: outputMode as OutputMode,
            templateKind: templateKind as TemplateKind,
            releaseIntent
        },
        issues
    };
}
