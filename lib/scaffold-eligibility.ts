import type {
    ArchitecturePack,
    DecisionRecord,
    DesignStage,
    GuardrailChecklist,
    OutputMode,
    Project,
    ProjectVersion,
    ProjectVersionData,
    MinimumViableLoopChecklist,
    ReadinessChecklist,
    ReadinessOverride
} from "@/types";
import {
    createMinimumViableLoopChecklist,
    createReadinessChecklist,
    normalizeArchitecturePack,
    normalizeDecisionRecords,
    normalizeGuardrailChecklist,
    normalizeReadinessOverrides
} from "@/lib/architecture";

export type ScaffoldEligibilityCode = "ARCHITECTURE_NOT_READY";

export type ScaffoldEligibility = {
    targetOutputMode: OutputMode;
    readiness: ReadinessChecklist;
    minimumViableLoop: MinimumViableLoopChecklist;
    architectureFingerprint: string;
    canCheckout: boolean;
    canGenerate: boolean;
    canGenerateSpec: boolean;
    canGenerateRunnable: boolean;
    blockingReasons: string[];
    code: ScaffoldEligibilityCode | null;
    designStage: DesignStage;
};

const DEFAULT_OUTPUT_MODE: OutputMode = "virtual_spec";

export function buildScaffoldEligibilityErrorMessage(
    eligibility: Pick<ScaffoldEligibility, "code" | "targetOutputMode"> | { code: ScaffoldEligibilityCode | null; targetOutputMode?: OutputMode }
) {
    switch (eligibility.code) {
        case "ARCHITECTURE_NOT_READY":
            return eligibility.targetOutputMode === "runnable_scaffold"
                ? "Architecture pack is not ready for runnable scaffold generation."
                : "Architecture pack is not ready for scaffold generation.";
        default:
            return "Scaffold generation is not allowed.";
    }
}

type EligibilityInput = {
    architecturePack: unknown;
    decisionRecords: unknown;
    guardrailChecklist: unknown;
    readinessOverrides?: unknown;
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
    return computeScaffoldEligibilityForMode(input, DEFAULT_OUTPUT_MODE);
}

export function computeScaffoldEligibilityForMode(
    input: EligibilityInput,
    outputMode: OutputMode = DEFAULT_OUTPUT_MODE
): ScaffoldEligibility {
    const architecturePack = normalizeArchitecturePack(input.architecturePack);
    const decisionRecords = normalizeDecisionRecords(input.decisionRecords);
    const guardrailChecklist = normalizeGuardrailChecklist(input.guardrailChecklist);
    const readinessOverrides = normalizeReadinessOverrides(input.readinessOverrides);
    const readiness = createReadinessChecklist(
        architecturePack,
        decisionRecords,
        guardrailChecklist,
        readinessOverrides
    );
    const minimumViableLoop = createMinimumViableLoopChecklist(
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
    const canGenerateSpec = minimumViableLoop.ready;
    const canGenerateRunnable =
        minimumViableLoop.ready &&
        readiness.functionalReady &&
        readiness.uiReady;
    const canGenerate =
        outputMode === "runnable_scaffold"
            ? canGenerateRunnable
            : canGenerateSpec;
    const blockingReasons =
        outputMode === "runnable_scaffold"
            ? readiness.blockingIssues
            : minimumViableLoop.blockingIssues;
    const designStage: DesignStage = canGenerateRunnable
        ? "ready_to_generate"
        : "functional_architecture";

    if (!canGenerate) {
        return {
            targetOutputMode: outputMode,
            readiness,
            minimumViableLoop,
            architectureFingerprint,
            canCheckout: false,
            canGenerate: false,
            canGenerateSpec,
            canGenerateRunnable,
            blockingReasons,
            code: "ARCHITECTURE_NOT_READY",
            designStage
        };
    }

    return {
        targetOutputMode: outputMode,
        readiness,
        minimumViableLoop,
        architectureFingerprint,
        canCheckout: true,
        canGenerate: true,
        canGenerateSpec,
        canGenerateRunnable,
        blockingReasons: [],
        code: null,
        designStage
    };
}

export function resolveLatestProjectVersion(project: Project | null): ProjectVersion | null {
    if (!project?.versions?.length) return null;
    return project.versions[project.versions.length - 1] || null;
}

export function computeProjectScaffoldEligibility(
    project: Project | null,
    outputMode: OutputMode = DEFAULT_OUTPUT_MODE
): ScaffoldEligibility | null {
    const latestVersion = resolveLatestProjectVersion(project);
    if (!latestVersion) return null;
    return computeVersionScaffoldEligibility(latestVersion.data, outputMode);
}

export function computeVersionScaffoldEligibility(
    data: ProjectVersionData | null | undefined,
    outputMode: OutputMode = DEFAULT_OUTPUT_MODE
): ScaffoldEligibility {
    return computeScaffoldEligibilityForMode({
        architecturePack: data?.architecturePack,
        decisionRecords: data?.decisionRecords,
        guardrailChecklist: data?.guardrailChecklist,
        readinessOverrides: data?.readinessOverrides
    }, outputMode);
}
