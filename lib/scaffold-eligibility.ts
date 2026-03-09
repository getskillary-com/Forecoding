import type {
    ArchitecturePack,
    DecisionRecord,
    DesignStage,
    GuardrailChecklist,
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
    readiness: ReadinessChecklist;
    minimumViableLoop: MinimumViableLoopChecklist;
    architectureFingerprint: string;
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

    if (!minimumViableLoop.ready) {
        return {
            readiness,
            minimumViableLoop,
            architectureFingerprint,
            canCheckout: false,
            canGenerate: false,
            blockingReasons: minimumViableLoop.blockingIssues,
            code: "ARCHITECTURE_NOT_READY",
            designStage: "functional_architecture"
        };
    }

    return {
        readiness,
        minimumViableLoop,
        architectureFingerprint,
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
        readinessOverrides: data?.readinessOverrides
    });
}
