import type {
    ArchitecturePack,
    ArchitectureReviewResult,
    DecisionRecord,
    DesignStage,
    GuardrailChecklist,
    Project,
    ProjectVersion,
    ProjectVersionData,
    ReadinessChecklist,
    ReadinessOverride
} from "@/types";
import {
    createReadinessChecklist,
    normalizeArchitecturePack,
    normalizeArchitectureReviewHistory,
    normalizeDecisionRecords,
    normalizeGuardrailChecklist,
    normalizeReadinessOverrides
} from "@/lib/architecture";

export type ScaffoldReviewState =
    | "missing_review"
    | "stale_review"
    | "approved_review";

export type ScaffoldEligibilityCode =
    | "ARCHITECTURE_NOT_READY"
    | "REVIEW_REQUIRED"
    | "REVIEW_STALE";

export type ScaffoldEligibility = {
    readiness: ReadinessChecklist;
    architectureFingerprint: string;
    latestReview: ArchitectureReviewResult | null;
    reviewState: ScaffoldReviewState;
    canCheckout: boolean;
    canGenerate: boolean;
    blockingReasons: string[];
    code: ScaffoldEligibilityCode | null;
    designStage: DesignStage;
};

export function buildScaffoldEligibilityErrorMessage(eligibility: Pick<ScaffoldEligibility, "code">) {
    switch (eligibility.code) {
        case "ARCHITECTURE_NOT_READY":
            return "Architecture pack is not ready for scaffold generation.";
        case "REVIEW_STALE":
            return "Architecture changed after the last approved review. Run review again before scaffold generation.";
        case "REVIEW_REQUIRED":
            return "Run an architecture review and resolve findings before scaffold generation.";
        default:
            return "Scaffold generation is not allowed.";
    }
}

type EligibilityInput = {
    architecturePack: unknown;
    decisionRecords: unknown;
    guardrailChecklist: unknown;
    readinessOverrides?: unknown;
    reviewHistory?: unknown;
};

function stableSerialize(value: unknown): string {
    if (value === null) return "null";
    if (value === undefined) return "";

    const valueType = typeof value;
    if (valueType === "number" || valueType === "boolean" || valueType === "string") {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
    }

    if (valueType === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, entryValue]) => entryValue !== undefined)
            .sort(([left], [right]) => left.localeCompare(right));
        return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`).join(",")}}`;
    }

    return JSON.stringify(String(value));
}

function hashString(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildReviewBlockingReasons(latestReview: ArchitectureReviewResult | null): string[] {
    if (latestReview?.verdict && latestReview.verdict !== "aligned") {
        return ["Resolve the latest architecture review findings and rerun review before scaffold generation."];
    }
    return ["Run an architecture review and resolve findings before scaffold generation."];
}

export function buildArchitectureFingerprint(
    architecturePack: ArchitecturePack,
    decisionRecords: DecisionRecord[],
    guardrailChecklist: GuardrailChecklist,
    readinessOverrides: ReadinessOverride[] = []
) {
    const serialized = stableSerialize({
        architecturePack,
        decisionRecords,
        guardrailChecklist,
        readinessOverrides
    });
    return `arch_${hashString(serialized)}`;
}

export function computeScaffoldEligibility(input: EligibilityInput): ScaffoldEligibility {
    const architecturePack = normalizeArchitecturePack(input.architecturePack);
    const decisionRecords = normalizeDecisionRecords(input.decisionRecords);
    const guardrailChecklist = normalizeGuardrailChecklist(input.guardrailChecklist);
    const readinessOverrides = normalizeReadinessOverrides(input.readinessOverrides);
    const reviewHistory = normalizeArchitectureReviewHistory(input.reviewHistory);
    const latestReview = reviewHistory[reviewHistory.length - 1] || null;
    const readiness = createReadinessChecklist(
        architecturePack,
        decisionRecords,
        guardrailChecklist,
        readinessOverrides
    );
    const architectureFingerprint = buildArchitectureFingerprint(
        architecturePack,
        decisionRecords,
        guardrailChecklist,
        readinessOverrides
    );

    let reviewState: ScaffoldReviewState = "missing_review";
    if (latestReview?.verdict === "aligned") {
        reviewState = latestReview.reviewedArchitectureFingerprint === architectureFingerprint
            ? "approved_review"
            : "stale_review";
    }

    if (!readiness.functionalReady || !readiness.uiReady) {
        return {
            readiness,
            architectureFingerprint,
            latestReview,
            reviewState,
            canCheckout: false,
            canGenerate: false,
            blockingReasons: readiness.blockingIssues,
            code: "ARCHITECTURE_NOT_READY",
            designStage: "functional_architecture"
        };
    }

    if (reviewState === "missing_review") {
        return {
            readiness,
            architectureFingerprint,
            latestReview,
            reviewState,
            canCheckout: false,
            canGenerate: false,
            blockingReasons: buildReviewBlockingReasons(latestReview),
            code: "REVIEW_REQUIRED",
            designStage: "functional_architecture"
        };
    }

    if (reviewState === "stale_review") {
        return {
            readiness,
            architectureFingerprint,
            latestReview,
            reviewState,
            canCheckout: false,
            canGenerate: false,
            blockingReasons: ["Architecture changed after the last approved review. Run review again before scaffold generation."],
            code: "REVIEW_STALE",
            designStage: "functional_architecture"
        };
    }

    return {
        readiness,
        architectureFingerprint,
        latestReview,
        reviewState,
        canCheckout: true,
        canGenerate: true,
        blockingReasons: [],
        code: null,
        designStage: "ready_to_generate"
    };
}

export function resolveLatestProjectVersion(project: Project | null): ProjectVersion | null {
    if (!project?.versions?.length) return null;
    return project.versions[project.versions.length - 1] || null;
}

export function computeProjectScaffoldEligibility(project: Project | null): ScaffoldEligibility | null {
    const latestVersion = resolveLatestProjectVersion(project);
    if (!latestVersion) return null;
    return computeVersionScaffoldEligibility(latestVersion.data);
}

export function computeVersionScaffoldEligibility(
    data: ProjectVersionData | null | undefined
): ScaffoldEligibility {
    return computeScaffoldEligibility({
        architecturePack: data?.architecturePack,
        decisionRecords: data?.decisionRecords,
        guardrailChecklist: data?.guardrailChecklist,
        readinessOverrides: data?.readinessOverrides,
        reviewHistory: data?.reviewHistory
    });
}
