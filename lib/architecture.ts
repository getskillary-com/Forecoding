import type {
    Analysis,
    ArchitecturePack,
    ArchitectureStage,
    DecisionRecord,
    GuardrailChecklist,
    Message,
    ReadinessCriterion,
    ReadinessCriterionKey,
    ReadinessRequirement,
    ReadinessRequirementKey,
    ReadinessRequirementStatus,
    ReadinessCriterionStatus,
    ReadinessChecklist,
    MinimumViableLoopChecklist,
    ReadinessOverride,
    ReadinessOverrideKey,
    SourceArtifact,
    StructuredGenerationContext,
    UiRequirements
} from "@/types";
import {
    buildPlatformSummaryLine,
    hasConfirmedPlatformStrategy,
    inferPlatformStrategyFromText,
    mergePlatformStrategies,
    normalizePlatformStrategy
} from "@/lib/platforms";

export const ARCHITECTURE_STAGE_LABELS: Record<ArchitectureStage, string> = {
    context: "Context",
    boundaries: "Boundaries",
    decisions: "Decisions",
    guardrails: "Guardrails",
    ready_to_generate: "Scaffold"
};

function normalizeString(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(value: unknown, maxItems: number = 24) {
    if (!Array.isArray(value)) return [] as string[];

    const seen = new Set<string>();
    return value
        .map((item) => normalizeString(item))
        .filter(Boolean)
        .filter((item) => {
            const key = item.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, maxItems);
}

function clipText(text: string, maxChars: number) {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}...`;
}

const READINESS_PLACEHOLDER_PATTERN = /^(tbd|todo|unknown|n\/a|na|none|phase|item|items|thing|things|screen|screens|module|modules|component|components|user|users|journey|journeys|constraint|constraints|risk|risks|decision|decisions|contract|contracts|checklist)$/i;

const SOURCE_ARTIFACT_SUMMARY_CHARS = 220;
const SOURCE_ARTIFACT_EXCERPT_CHARS = 2400;

function buildSourceArtifactExcerpt(value: unknown) {
    const text = normalizeString(value);
    if (!text) return "";
    return clipText(text, SOURCE_ARTIFACT_EXCERPT_CHARS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function normalizeBusinessContext(value: unknown): ArchitecturePack["businessContext"] {
    const candidate = isRecord(value) ? value : {};
    return {
        productGoal: normalizeString(candidate.productGoal),
        targetUsers: normalizeStringList(candidate.targetUsers),
        userJourneys: normalizeStringList(candidate.userJourneys),
        constraints: normalizeStringList(candidate.constraints),
        risks: normalizeStringList(candidate.risks)
    };
}

function normalizeObjectList<T>(
    value: unknown,
    mapper: (item: Record<string, unknown>) => T | null,
    maxItems: number = 20
) {
    if (!Array.isArray(value)) return [] as T[];
    return value
        .filter(isRecord)
        .map((item) => mapper(item))
        .filter((item): item is T => Boolean(item))
        .slice(0, maxItems);
}

export function createEmptyArchitecturePack(): ArchitecturePack {
    return {
        version: "architecture_pack_v1",
        businessContext: {
            productGoal: "",
            targetUsers: [],
            userJourneys: [],
            constraints: [],
            risks: []
        },
        platformStrategy: {
            primaryPlatform: "",
            targetPlatforms: [],
            runtimeEnvironments: [],
            distributionChannels: []
        },
        domainModel: [],
        boundedContexts: [],
        moduleResponsibilities: [],
        dataOwnership: [],
        integrationContracts: [],
        nonFunctionalRequirements: [],
        deliveryPlan: [],
        experienceConstraints: {
            keyScreens: [],
            uiComponents: [],
            interactionStates: [],
            responsiveStrategy: []
        }
    };
}

export function normalizeArchitecturePack(
    value: unknown,
    fallbackUi?: UiRequirements | null
): ArchitecturePack {
    const empty = createEmptyArchitecturePack();
    const candidate = isRecord(value) ? value : {};
    const businessContext = normalizeBusinessContext(candidate.businessContext);
    const experienceConstraints = {
        keyScreens: normalizeStringList((candidate.experienceConstraints as Record<string, unknown> | undefined)?.keyScreens),
        uiComponents: normalizeStringList((candidate.experienceConstraints as Record<string, unknown> | undefined)?.uiComponents),
        interactionStates: normalizeStringList((candidate.experienceConstraints as Record<string, unknown> | undefined)?.interactionStates),
        responsiveStrategy: normalizeStringList((candidate.experienceConstraints as Record<string, unknown> | undefined)?.responsiveStrategy)
    };
    const platformStrategy = mergePlatformStrategies(
        normalizePlatformStrategy(candidate.platformStrategy),
        inferPlatformStrategyFromText(
            businessContext.productGoal,
            ...businessContext.targetUsers,
            ...businessContext.userJourneys,
            ...businessContext.constraints,
            ...businessContext.risks,
            ...experienceConstraints.keyScreens,
            ...experienceConstraints.uiComponents,
            ...experienceConstraints.responsiveStrategy,
            ...(fallbackUi?.keyScreens || []),
            ...(fallbackUi?.responsiveStrategy || [])
        )
    );

    const pack: ArchitecturePack = {
        version: "architecture_pack_v1",
        businessContext,
        platformStrategy,
        domainModel: normalizeObjectList(candidate.domainModel, (item) => {
            const name = normalizeString(item.name);
            const description = normalizeString(item.description);
            if (!name && !description) return null;
            return {
                name: name || description,
                description: description || name,
                owner: normalizeString(item.owner) || undefined
            };
        }),
        boundedContexts: normalizeObjectList(candidate.boundedContexts, (item) => {
            const name = normalizeString(item.name);
            const responsibility = normalizeString(item.responsibility);
            if (!name && !responsibility) return null;
            return {
                name: name || responsibility,
                responsibility: responsibility || name,
                owns: normalizeStringList(item.owns),
                dependencies: normalizeStringList(item.dependencies)
            };
        }),
        moduleResponsibilities: normalizeObjectList(candidate.moduleResponsibilities, (item) => {
            const moduleName = normalizeString(item.module);
            const responsibility = normalizeString(item.responsibility);
            if (!moduleName && !responsibility) return null;
            return {
                module: moduleName || responsibility,
                responsibility: responsibility || moduleName,
                inputs: normalizeStringList(item.inputs),
                outputs: normalizeStringList(item.outputs)
            };
        }),
        dataOwnership: normalizeObjectList(candidate.dataOwnership, (item) => {
            const data = normalizeString(item.data);
            const owner = normalizeString(item.owner);
            if (!data && !owner) return null;
            return {
                data: data || owner,
                owner: owner || data,
                consumers: normalizeStringList(item.consumers),
                notes: normalizeString(item.notes) || undefined
            };
        }),
        integrationContracts: normalizeObjectList(candidate.integrationContracts, (item) => {
            const name = normalizeString(item.name);
            const producer = normalizeString(item.producer);
            const consumer = normalizeString(item.consumer);
            const payload = normalizeString(item.payload);
            const notes = normalizeString(item.notes);
            const kind = item.kind;
            const normalizedKind =
                kind === "api" || kind === "event" || kind === "job" || kind === "shared-library"
                    ? kind
                    : "api";
            if (!name && !producer && !consumer) return null;
            return {
                name: name || `${producer || "producer"} -> ${consumer || "consumer"}`,
                kind: normalizedKind,
                producer,
                consumer,
                payload,
                notes
            };
        }),
        nonFunctionalRequirements: normalizeObjectList(candidate.nonFunctionalRequirements, (item) => {
            const category = normalizeString(item.category);
            const requirement = normalizeString(item.requirement);
            if (!category && !requirement) return null;
            return {
                category: category || "general",
                requirement: requirement || category,
                rationale: normalizeString(item.rationale) || undefined
            };
        }),
        deliveryPlan: normalizeObjectList(candidate.deliveryPlan, (item) => {
            const phase = normalizeString(item.phase);
            const goal = normalizeString(item.goal);
            if (!phase && !goal) return null;
            return {
                phase: phase || "Phase",
                goal: goal || phase,
                acceptanceCriteria: normalizeStringList(item.acceptanceCriteria)
            };
        }),
        experienceConstraints
    };

    if (fallbackUi) {
        pack.experienceConstraints.keyScreens = pack.experienceConstraints.keyScreens.length > 0
            ? pack.experienceConstraints.keyScreens
            : normalizeStringList(fallbackUi.keyScreens);
        pack.experienceConstraints.uiComponents = pack.experienceConstraints.uiComponents.length > 0
            ? pack.experienceConstraints.uiComponents
            : normalizeStringList(fallbackUi.uiComponents);
        pack.experienceConstraints.interactionStates = pack.experienceConstraints.interactionStates.length > 0
            ? pack.experienceConstraints.interactionStates
            : normalizeStringList(fallbackUi.statesAndFeedback);
        pack.experienceConstraints.responsiveStrategy = pack.experienceConstraints.responsiveStrategy.length > 0
            ? pack.experienceConstraints.responsiveStrategy
            : normalizeStringList(fallbackUi.responsiveStrategy);
    }

    return {
        ...empty,
        ...pack
    };
}

export function normalizeDecisionRecords(value: unknown): DecisionRecord[] {
    return normalizeObjectList(value, (item) => {
        const title = normalizeString(item.title);
        const decision = normalizeString(item.decision);
        if (!title && !decision) return null;
        return {
            title: title || decision,
            decision: decision || title,
            rationale: normalizeString(item.rationale),
            alternativesRejected: normalizeStringList(item.alternativesRejected),
            consequences: normalizeStringList(item.consequences)
        };
    }, 16);
}

export function normalizeGuardrailChecklist(value: unknown): GuardrailChecklist {
    const candidate = isRecord(value) ? value : {};
    return {
        implementationOrder: normalizeStringList(candidate.implementationOrder, 16),
        acceptanceCriteria: normalizeStringList(candidate.acceptanceCriteria, 24),
        testStrategy: normalizeStringList(candidate.testStrategy, 20)
    };
}

function isMeaningfulText(value: unknown, minChars: number = 4) {
    const normalized = normalizeString(value);
    if (!normalized) return false;
    if (normalized.length < minChars) return false;
    if (!/[A-Za-z0-9\u4e00-\u9fff]/.test(normalized)) return false;
    if (READINESS_PLACEHOLDER_PATTERN.test(normalized)) return false;
    return true;
}

function countMeaningfulStrings(values: string[], minChars: number = 4) {
    return values.filter((value) => isMeaningfulText(value, minChars)).length;
}

function countMeaningfulDecisionRecords(records: DecisionRecord[]) {
    return records.filter((record) =>
        isMeaningfulText(record.title, 4) &&
        isMeaningfulText(record.decision, 6) &&
        isMeaningfulText(record.rationale, 12)
    ).length;
}

function countMeaningfulIntegrationContracts(pack: ArchitecturePack) {
    return pack.integrationContracts.filter((contract) =>
        isMeaningfulText(contract.name, 4) &&
        (
            (isMeaningfulText(contract.producer, 3) && isMeaningfulText(contract.consumer, 3)) ||
            isMeaningfulText(contract.payload, 8)
        )
    ).length;
}

function countMeaningfulNonFunctionalRequirements(pack: ArchitecturePack) {
    return pack.nonFunctionalRequirements.filter((item) =>
        isMeaningfulText(item.requirement, 8) &&
        (isMeaningfulText(item.rationale, 8) || isMeaningfulText(item.category, 3))
    ).length;
}

function normalizeReadinessRequirementKey(value: unknown): ReadinessRequirementKey | null {
    switch (value) {
        case "business_context.product_goal":
        case "business_context.platforms":
        case "business_context.target_users":
        case "business_context.user_journeys":
        case "business_context.constraints_or_risks":
        case "boundaries.bounded_contexts":
        case "boundaries.module_responsibilities":
        case "boundaries.data_ownership":
        case "decisions.decision_records":
        case "decisions.integration_contracts":
        case "decisions.non_functional_requirements":
        case "guardrails.implementation_order":
        case "guardrails.acceptance_criteria":
        case "guardrails.test_strategy":
        case "ui.key_screens":
        case "ui.shared_components":
        case "ui.responsive_strategy":
            return value;
        default:
            return null;
    }
}

function normalizeReadinessOverrideKey(value: unknown): ReadinessOverrideKey | null {
    return value === "single_screen_experience" ? value : null;
}

export function normalizeReadinessOverrides(value: unknown): ReadinessOverride[] {
    if (!Array.isArray(value)) return [];

    const dedupe = new Set<string>();
    return value
        .filter(isRecord)
        .map((item) => {
            const key = normalizeReadinessOverrideKey(item.key);
            const requirementKey = normalizeReadinessRequirementKey(item.requirementKey);
            const rationale = normalizeString(item.rationale);
            if (!key || !requirementKey || !rationale) return null;
            const normalized: ReadinessOverride = {
                key,
                requirementKey,
                rationale,
                createdAt: typeof item.createdAt === "number" ? item.createdAt : undefined
            };
            return normalized;
        })
        .filter((item): item is ReadinessOverride => Boolean(item))
        .filter((item) => {
            const dedupeKey = `${item.key}::${item.requirementKey}`;
            if (dedupe.has(dedupeKey)) return false;
            dedupe.add(dedupeKey);
            return true;
        });
}

function buildReadinessOverrideIndex(overrides: ReadinessOverride[]) {
    const index = new Map<ReadinessRequirementKey, ReadinessOverride>();
    overrides.forEach((override) => {
        index.set(override.requirementKey, override);
    });
    return index;
}

function buildReadinessRequirement(input: {
    key: ReadinessRequirementKey;
    label: string;
    satisfiedCount: number;
    requiredCount: number;
    missing: string[];
    override?: ReadinessOverride | null;
}): ReadinessRequirement {
    const cappedSatisfiedCount = Math.max(0, Math.min(input.satisfiedCount, input.requiredCount));
    let status: ReadinessRequirementStatus = "missing";

    if (cappedSatisfiedCount >= input.requiredCount) {
        status = "confirmed";
    } else if (input.override) {
        status = "waived";
    } else if (cappedSatisfiedCount > 0) {
        status = "partial";
    }

    return {
        key: input.key,
        label: input.label,
        status,
        satisfiedCount: cappedSatisfiedCount,
        requiredCount: input.requiredCount,
        missing: status === "waived" ? [] : input.missing,
        overrideKey: status === "waived" ? input.override?.key : undefined,
        overrideReason: status === "waived" ? input.override?.rationale : undefined
    };
}

function buildReadinessCriterion(input: {
    key: ReadinessCriterionKey;
    label: string;
    requirements: ReadinessRequirement[];
}): ReadinessCriterion {
    const satisfiedCount = input.requirements.filter((requirement) =>
        requirement.status === "confirmed" || requirement.status === "waived"
    ).length;
    const requiredCount = input.requirements.length;
    const hasPartial = input.requirements.some((requirement) => requirement.status === "partial");
    const hasAnyProgress = input.requirements.some((requirement) => requirement.status !== "missing");
    let status: ReadinessCriterionStatus = "missing";

    if (satisfiedCount >= requiredCount) {
        status = "confirmed";
    } else if (hasPartial || hasAnyProgress) {
        status = "partial";
    }

    return {
        key: input.key,
        label: input.label,
        status,
        satisfiedCount,
        requiredCount,
        missing: input.requirements
            .filter((requirement) => requirement.status === "missing" || requirement.status === "partial")
            .map((requirement) => requirement.missing[0] || `Complete ${requirement.label}.`)
            .filter(Boolean),
        requirements: input.requirements,
        overrideApplied: input.requirements.some((requirement) => requirement.status === "waived")
    };
}

export function createReadinessChecklist(
    pack: ArchitecturePack,
    decisions: DecisionRecord[],
    guardrails: GuardrailChecklist,
    readinessOverrides: ReadinessOverride[] = []
): ReadinessChecklist {
    const overrideIndex = buildReadinessOverrideIndex(normalizeReadinessOverrides(readinessOverrides));
    const businessConstraintCount = countMeaningfulStrings([
        ...pack.businessContext.constraints,
        ...pack.businessContext.risks
    ], 4);
    const businessContext = buildReadinessCriterion({
        key: "business_context",
        label: "Business context",
        requirements: [
            buildReadinessRequirement({
                key: "business_context.product_goal",
                label: "Product goal",
                satisfiedCount: Number(isMeaningfulText(pack.businessContext.productGoal, 8)),
                requiredCount: 1,
                missing: !isMeaningfulText(pack.businessContext.productGoal, 8) ? ["Define a concrete product goal."] : [],
                override: overrideIndex.get("business_context.product_goal")
            }),
            buildReadinessRequirement({
                key: "business_context.platforms",
                label: "Platform strategy",
                satisfiedCount: Number(hasConfirmedPlatformStrategy(pack.platformStrategy)),
                requiredCount: 1,
                missing: !hasConfirmedPlatformStrategy(pack.platformStrategy)
                    ? ["Confirm the primary platform and required runtime targets."]
                    : [],
                override: overrideIndex.get("business_context.platforms")
            }),
            buildReadinessRequirement({
                key: "business_context.target_users",
                label: "Target users",
                satisfiedCount: countMeaningfulStrings(pack.businessContext.targetUsers, 3),
                requiredCount: 1,
                missing: countMeaningfulStrings(pack.businessContext.targetUsers, 3) < 1 ? ["Name at least 1 specific target user group."] : [],
                override: overrideIndex.get("business_context.target_users")
            }),
            buildReadinessRequirement({
                key: "business_context.user_journeys",
                label: "User journeys",
                satisfiedCount: countMeaningfulStrings(pack.businessContext.userJourneys, 8),
                requiredCount: 2,
                missing: countMeaningfulStrings(pack.businessContext.userJourneys, 8) < 2 ? ["Capture at least 2 concrete user journeys."] : [],
                override: overrideIndex.get("business_context.user_journeys")
            }),
            buildReadinessRequirement({
                key: "business_context.constraints_or_risks",
                label: "Constraints and risks",
                satisfiedCount: businessConstraintCount,
                requiredCount: 2,
                missing: businessConstraintCount < 2 ? ["Capture at least 2 concrete constraints or risks."] : [],
                override: overrideIndex.get("business_context.constraints_or_risks")
            })
        ]
    });

    const boundaries = buildReadinessCriterion({
        key: "boundaries",
        label: "System boundaries",
        requirements: [
            buildReadinessRequirement({
                key: "boundaries.bounded_contexts",
                label: "Bounded contexts",
                satisfiedCount: pack.boundedContexts.length,
                requiredCount: 1,
                missing: pack.boundedContexts.length < 1 ? ["Define at least 1 bounded context."] : [],
                override: overrideIndex.get("boundaries.bounded_contexts")
            }),
            buildReadinessRequirement({
                key: "boundaries.module_responsibilities",
                label: "Module responsibilities",
                satisfiedCount: pack.moduleResponsibilities.length,
                requiredCount: 2,
                missing: pack.moduleResponsibilities.length < 2 ? ["Define at least 2 concrete module responsibilities."] : [],
                override: overrideIndex.get("boundaries.module_responsibilities")
            }),
            buildReadinessRequirement({
                key: "boundaries.data_ownership",
                label: "Data ownership",
                satisfiedCount: pack.dataOwnership.length,
                requiredCount: 1,
                missing: pack.dataOwnership.length < 1 ? ["Define at least 1 explicit data ownership rule."] : [],
                override: overrideIndex.get("boundaries.data_ownership")
            })
        ]
    });

    const decisionDepthCount = countMeaningfulDecisionRecords(decisions);
    const integrationContractCount = countMeaningfulIntegrationContracts(pack);
    const nfrCount = countMeaningfulNonFunctionalRequirements(pack);
    const decisionCriteria = buildReadinessCriterion({
        key: "decisions",
        label: "Architecture decisions",
        requirements: [
            buildReadinessRequirement({
                key: "decisions.decision_records",
                label: "Decision records",
                satisfiedCount: decisionDepthCount,
                requiredCount: 2,
                missing: decisionDepthCount < 2 ? ["Record at least 2 concrete architecture decisions with rationale."] : [],
                override: overrideIndex.get("decisions.decision_records")
            }),
            buildReadinessRequirement({
                key: "decisions.integration_contracts",
                label: "Integration contracts",
                satisfiedCount: integrationContractCount,
                requiredCount: 1,
                missing: integrationContractCount < 1 ? ["Define at least 1 meaningful integration contract."] : [],
                override: overrideIndex.get("decisions.integration_contracts")
            }),
            buildReadinessRequirement({
                key: "decisions.non_functional_requirements",
                label: "Non-functional requirements",
                satisfiedCount: nfrCount,
                requiredCount: 2,
                missing: nfrCount < 2 ? ["Define at least 2 non-functional requirements."] : [],
                override: overrideIndex.get("decisions.non_functional_requirements")
            })
        ]
    });

    const guardrailCriteria = buildReadinessCriterion({
        key: "guardrails",
        label: "Delivery guardrails",
        requirements: [
            buildReadinessRequirement({
                key: "guardrails.implementation_order",
                label: "Implementation order",
                satisfiedCount: countMeaningfulStrings(guardrails.implementationOrder, 4),
                requiredCount: 3,
                missing: countMeaningfulStrings(guardrails.implementationOrder, 4) < 3 ? ["Define at least 3 implementation-order steps."] : [],
                override: overrideIndex.get("guardrails.implementation_order")
            }),
            buildReadinessRequirement({
                key: "guardrails.acceptance_criteria",
                label: "Acceptance criteria",
                satisfiedCount: countMeaningfulStrings(guardrails.acceptanceCriteria, 4),
                requiredCount: 4,
                missing: countMeaningfulStrings(guardrails.acceptanceCriteria, 4) < 4 ? ["Define at least 4 acceptance criteria."] : [],
                override: overrideIndex.get("guardrails.acceptance_criteria")
            }),
            buildReadinessRequirement({
                key: "guardrails.test_strategy",
                label: "Test strategy",
                satisfiedCount: countMeaningfulStrings(guardrails.testStrategy, 4),
                requiredCount: 2,
                missing: countMeaningfulStrings(guardrails.testStrategy, 4) < 2 ? ["Define at least 2 concrete test strategy items."] : [],
                override: overrideIndex.get("guardrails.test_strategy")
            })
        ]
    });

    const uiCriteria = buildReadinessCriterion({
        key: "ui",
        label: "Experience constraints",
        requirements: [
            buildReadinessRequirement({
                key: "ui.key_screens",
                label: "Key screens",
                satisfiedCount: countMeaningfulStrings(pack.experienceConstraints.keyScreens, 4),
                requiredCount: 3,
                missing: countMeaningfulStrings(pack.experienceConstraints.keyScreens, 4) < 3 ? ["Define at least 3 key screens."] : [],
                override: overrideIndex.get("ui.key_screens")
            }),
            buildReadinessRequirement({
                key: "ui.shared_components",
                label: "Shared UI components",
                satisfiedCount: countMeaningfulStrings(pack.experienceConstraints.uiComponents, 4),
                requiredCount: 3,
                missing: countMeaningfulStrings(pack.experienceConstraints.uiComponents, 4) < 3 ? ["Define at least 3 shared UI components."] : [],
                override: overrideIndex.get("ui.shared_components")
            }),
            buildReadinessRequirement({
                key: "ui.responsive_strategy",
                label: "Responsive strategy",
                satisfiedCount: countMeaningfulStrings(pack.experienceConstraints.responsiveStrategy, 4),
                requiredCount: 1,
                missing: countMeaningfulStrings(pack.experienceConstraints.responsiveStrategy, 4) < 1 ? ["Define at least 1 responsive strategy rule."] : [],
                override: overrideIndex.get("ui.responsive_strategy")
            })
        ]
    });

    const criteria = [
        businessContext,
        boundaries,
        decisionCriteria,
        guardrailCriteria,
        uiCriteria
    ];
    const blockingIssues = criteria
        .filter((criterion) => criterion.status !== "confirmed")
        .map((criterion) => `${criterion.label} is incomplete. ${criterion.missing[0] || "Add more concrete detail."}`);
    const totalSatisfied = criteria.reduce((sum, criterion) => sum + criterion.satisfiedCount, 0);
    const totalRequired = criteria.reduce((sum, criterion) => sum + criterion.requiredCount, 0);
    const score = totalRequired === 0 ? 0 : Math.round((totalSatisfied / totalRequired) * 100);
    const functionalReady =
        businessContext.status === "confirmed" &&
        boundaries.status === "confirmed" &&
        decisionCriteria.status === "confirmed" &&
        guardrailCriteria.status === "confirmed";
    const uiReady = uiCriteria.status === "confirmed";

    return {
        score,
        functionalReady,
        uiReady,
        paymentReady: functionalReady && uiReady,
        blockingIssues,
        nextMilestone: blockingIssues[0] || "Proceed to scaffold generation when ready.",
        criteria,
        overrides: [...overrideIndex.values()]
    };
}

export function createMinimumViableLoopChecklist(
    pack: ArchitecturePack,
    decisions: DecisionRecord[],
    guardrails: GuardrailChecklist,
    readinessOverrides: ReadinessOverride[] = []
): MinimumViableLoopChecklist {
    const overrideIndex = buildReadinessOverrideIndex(normalizeReadinessOverrides(readinessOverrides));
    const meaningfulTargetUsers = countMeaningfulStrings(pack.businessContext.targetUsers, 3);
    const meaningfulJourneys = countMeaningfulStrings(pack.businessContext.userJourneys, 8);
    const coreShapeCount = Math.max(pack.boundedContexts.length, pack.moduleResponsibilities.length);
    const decisionDepthCount = countMeaningfulDecisionRecords(decisions);
    const nfrCount = countMeaningfulNonFunctionalRequirements(pack);
    const keyScreenCount = countMeaningfulStrings(pack.experienceConstraints.keyScreens, 4);

    const requirements = [
        buildReadinessRequirement({
            key: "business_context.product_goal",
            label: "Product goal",
            satisfiedCount: Number(isMeaningfulText(pack.businessContext.productGoal, 8)),
            requiredCount: 1,
            missing: !isMeaningfulText(pack.businessContext.productGoal, 8) ? ["Define the core product goal."] : [],
            override: overrideIndex.get("business_context.product_goal")
        }),
        buildReadinessRequirement({
            key: "business_context.platforms",
            label: "Platform strategy",
            satisfiedCount: Number(hasConfirmedPlatformStrategy(pack.platformStrategy)),
            requiredCount: 1,
            missing: !hasConfirmedPlatformStrategy(pack.platformStrategy)
                ? ["Confirm the primary platform and runtime targets."]
                : [],
            override: overrideIndex.get("business_context.platforms")
        }),
        buildReadinessRequirement({
            key: "business_context.target_users",
            label: "Target users",
            satisfiedCount: meaningfulTargetUsers,
            requiredCount: 1,
            missing: meaningfulTargetUsers < 1 ? ["Define at least 1 concrete target user group."] : [],
            override: overrideIndex.get("business_context.target_users")
        }),
        buildReadinessRequirement({
            key: "business_context.user_journeys",
            label: "Primary journey",
            satisfiedCount: meaningfulJourneys,
            requiredCount: 1,
            missing: meaningfulJourneys < 1 ? ["Define at least 1 concrete happy-path user journey."] : [],
            override: overrideIndex.get("business_context.user_journeys")
        }),
        buildReadinessRequirement({
            key: "boundaries.module_responsibilities",
            label: "Core system shape",
            satisfiedCount: coreShapeCount,
            requiredCount: 1,
            missing: coreShapeCount < 1 ? ["Define at least 1 concrete system/module responsibility."] : [],
            override: overrideIndex.get("boundaries.module_responsibilities")
        }),
        buildReadinessRequirement({
            key: "decisions.decision_records",
            label: "Key architecture decision",
            satisfiedCount: decisionDepthCount,
            requiredCount: 1,
            missing: decisionDepthCount < 1 ? ["Record at least 1 architecture decision with rationale."] : [],
            override: overrideIndex.get("decisions.decision_records")
        }),
        buildReadinessRequirement({
            key: "decisions.non_functional_requirements",
            label: "Non-functional requirement",
            satisfiedCount: nfrCount,
            requiredCount: 1,
            missing: nfrCount < 1 ? ["Define at least 1 non-functional requirement."] : [],
            override: overrideIndex.get("decisions.non_functional_requirements")
        }),
        buildReadinessRequirement({
            key: "guardrails.implementation_order",
            label: "Implementation order",
            satisfiedCount: countMeaningfulStrings(guardrails.implementationOrder, 4),
            requiredCount: 1,
            missing: countMeaningfulStrings(guardrails.implementationOrder, 4) < 1 ? ["Define the first implementation step."] : [],
            override: overrideIndex.get("guardrails.implementation_order")
        }),
        buildReadinessRequirement({
            key: "guardrails.acceptance_criteria",
            label: "Acceptance criteria",
            satisfiedCount: countMeaningfulStrings(guardrails.acceptanceCriteria, 4),
            requiredCount: 1,
            missing: countMeaningfulStrings(guardrails.acceptanceCriteria, 4) < 1 ? ["Define at least 1 acceptance criterion."] : [],
            override: overrideIndex.get("guardrails.acceptance_criteria")
        }),
        buildReadinessRequirement({
            key: "ui.key_screens",
            label: "Key screens",
            satisfiedCount: keyScreenCount,
            requiredCount: 1,
            missing: keyScreenCount < 1 ? ["Define at least 1 key screen."] : [],
            override: overrideIndex.get("ui.key_screens")
        })
    ];

    const satisfiedCount = requirements.filter((requirement) =>
        requirement.status === "confirmed" || requirement.status === "waived"
    ).length;
    const totalRequired = requirements.length;
    const score = totalRequired === 0 ? 0 : Math.round((satisfiedCount / totalRequired) * 100);
    const blockingIssues = requirements
        .filter((requirement) => requirement.status === "missing" || requirement.status === "partial")
        .map((requirement) => requirement.missing[0] || `Complete ${requirement.label}.`);

    return {
        ready: blockingIssues.length === 0,
        score,
        blockingIssues,
        nextMilestone: blockingIssues[0] || "Proceed to scaffold generation.",
        requirements
    };
}

export function inferArchitectureStage(
    pack: ArchitecturePack,
    decisions: DecisionRecord[],
    guardrails: GuardrailChecklist,
    readinessOverrides: ReadinessOverride[] = []
): ArchitectureStage {
    const readiness = createReadinessChecklist(pack, decisions, guardrails, readinessOverrides);
    const criterionByKey = new Map(readiness.criteria.map((criterion) => [criterion.key, criterion]));

    if (criterionByKey.get("business_context")?.status !== "confirmed") {
        return "context";
    }

    if (criterionByKey.get("boundaries")?.status !== "confirmed") {
        return "boundaries";
    }

    if (criterionByKey.get("decisions")?.status !== "confirmed") {
        return "decisions";
    }

    if (
        criterionByKey.get("guardrails")?.status !== "confirmed" ||
        criterionByKey.get("ui")?.status !== "confirmed"
    ) {
        return "guardrails";
    }

    return "ready_to_generate";
}

export function isArchitecturePackReady(
    pack: ArchitecturePack,
    decisions: DecisionRecord[],
    guardrails: GuardrailChecklist,
    readinessOverrides: ReadinessOverride[] = []
) {
    const readiness = createReadinessChecklist(pack, decisions, guardrails, readinessOverrides);
    return readiness.functionalReady && readiness.uiReady;
}

export function findReadinessRequirement(
    readiness: ReadinessChecklist,
    requirementKey: ReadinessRequirementKey
): ReadinessRequirement | null {
    for (const criterion of readiness.criteria) {
        const requirement = criterion.requirements.find((item) => item.key === requirementKey);
        if (requirement) return requirement;
    }
    return null;
}

export function getPrimaryIncompleteReadinessRequirement(
    readiness: ReadinessChecklist
): ReadinessRequirement | null {
    for (const criterion of readiness.criteria) {
        for (const requirement of criterion.requirements) {
            if (requirement.status === "missing" || requirement.status === "partial") {
                return requirement;
            }
        }
    }
    return null;
}

export function extractSourceArtifacts(messages: Message[]): SourceArtifact[] {
    const artifacts: SourceArtifact[] = [];

    messages.forEach((message, messageIndex) => {
        const artifactOrderBase = messageIndex * 10;
        const normalizedContent = normalizeString(message.content);
        if (message.role === "user" && normalizedContent) {
            artifacts.push({
                id: `chat-${messageIndex}`,
                sourceType: "chat",
                name: `Conversation turn ${messageIndex + 1}`,
                summary: clipText(normalizedContent, SOURCE_ARTIFACT_SUMMARY_CHARS),
                excerpt: buildSourceArtifactExcerpt(normalizedContent),
                sourceMessageIndex: messageIndex,
                createdAt: artifactOrderBase
            });
        }

        message.attachments?.forEach((attachment, attachmentIndex) => {
            const sourceType =
                attachment.type === "pdf"
                    ? "pdf"
                    : attachment.type === "image"
                        ? "image"
                        : "text";

            let summary = attachment.name;
            let excerpt = "";
            if (sourceType === "text") {
                const normalizedAttachment = normalizeString(attachment.content);
                summary = clipText(normalizedAttachment, SOURCE_ARTIFACT_SUMMARY_CHARS) || attachment.name;
                excerpt = buildSourceArtifactExcerpt(normalizedAttachment);
            } else {
                summary = `${attachment.name} (${attachment.mimeType})`;
            }

            artifacts.push({
                id: `attachment-${messageIndex}-${attachmentIndex}`,
                sourceType,
                name: attachment.name,
                summary,
                excerpt,
                mimeType: attachment.mimeType,
                sourceMessageIndex: messageIndex,
                attachmentIndex,
                createdAt: artifactOrderBase + attachmentIndex + 1
            });
        });
    });

    return artifacts.slice(-40);
}

export function seedArchitecturePackFromAnalysis(
    analysis: Analysis | null | undefined,
    fallbackUi?: UiRequirements | null
): ArchitecturePack {
    const normalizedUi = fallbackUi || {
        visualStyle: [],
        colorSystem: [],
        typography: [],
        keyScreens: [],
        uiComponents: [],
        responsiveStrategy: [],
        interactionMotion: [],
        statesAndFeedback: []
    };
    const clarified = normalizeStringList(analysis?.clarified, 12);
    const missing = normalizeStringList(analysis?.missing, 12);

    return normalizeArchitecturePack({
        businessContext: {
            productGoal: clarified[0] || "",
            targetUsers: clarified.filter((item) => /\buser|customer|team|admin|founder|engineer|运营|用户|团队/i.test(item)).slice(0, 4),
            userJourneys: clarified.slice(1, 4),
            constraints: clarified.filter((item) => /\bmust|need|require|limit|constraint|mobile|desktop|auth|payment|实时|权限/i.test(item)).slice(0, 6),
            risks: missing.slice(0, 6)
        },
        nonFunctionalRequirements: clarified
            .filter((item) => /\bperformance|latency|security|audit|sla|scale|observability|cost|compliance|性能|安全|审计|扩展|成本|合规/i.test(item))
            .map((item) => ({ category: "general", requirement: item })),
        experienceConstraints: {
            keyScreens: normalizedUi.keyScreens,
            uiComponents: normalizedUi.uiComponents,
            interactionStates: normalizedUi.statesAndFeedback,
            responsiveStrategy: normalizedUi.responsiveStrategy
        }
    }, normalizedUi);
}

export function buildArchitecturePackScaffoldInput(
    pack: ArchitecturePack,
    decisions: DecisionRecord[],
    guardrails: GuardrailChecklist
) {
    const sections = [
        "# Architecture Pack",
        `Product goal: ${pack.businessContext.productGoal || "Not defined"}`,
        "",
        "## Platform Strategy",
        buildPlatformSummaryLine(pack.platformStrategy) || "- Not defined",
        `- Runtime environments: ${pack.platformStrategy.runtimeEnvironments.join(", ") || "n/a"}`,
        `- Distribution channels: ${pack.platformStrategy.distributionChannels.join(", ") || "n/a"}`,
        "",
        "## Target Users",
        pack.businessContext.targetUsers.length > 0 ? pack.businessContext.targetUsers.map((item) => `- ${item}`).join("\n") : "- None",
        "",
        "## User Journeys",
        pack.businessContext.userJourneys.length > 0 ? pack.businessContext.userJourneys.map((item) => `- ${item}`).join("\n") : "- None",
        "",
        "## Constraints",
        pack.businessContext.constraints.length > 0 ? pack.businessContext.constraints.map((item) => `- ${item}`).join("\n") : "- None",
        "",
        "## Risks",
        pack.businessContext.risks.length > 0 ? pack.businessContext.risks.map((item) => `- ${item}`).join("\n") : "- None",
        "",
        "## Domain Model",
        pack.domainModel.length > 0
            ? pack.domainModel.map((item) => `- ${item.name}: ${item.description}${item.owner ? ` (owner: ${item.owner})` : ""}`).join("\n")
            : "- None",
        "",
        "## Bounded Contexts",
        pack.boundedContexts.length > 0
            ? pack.boundedContexts.map((item) => `- ${item.name}: ${item.responsibility}. Owns: ${item.owns.join(", ") || "n/a"}. Depends on: ${item.dependencies.join(", ") || "n/a"}.`).join("\n")
            : "- None",
        "",
        "## Module Responsibilities",
        pack.moduleResponsibilities.length > 0
            ? pack.moduleResponsibilities.map((item) => `- ${item.module}: ${item.responsibility}. Inputs: ${item.inputs.join(", ") || "n/a"}. Outputs: ${item.outputs.join(", ") || "n/a"}.`).join("\n")
            : "- None",
        "",
        "## Data Ownership",
        pack.dataOwnership.length > 0
            ? pack.dataOwnership.map((item) => `- ${item.data}: owner ${item.owner}. Consumers: ${item.consumers.join(", ") || "n/a"}${item.notes ? `. Notes: ${item.notes}` : ""}.`).join("\n")
            : "- None",
        "",
        "## Integration Contracts",
        pack.integrationContracts.length > 0
            ? pack.integrationContracts.map((item) => `- ${item.name} [${item.kind}] ${item.producer} -> ${item.consumer}. Payload: ${item.payload || "n/a"}. ${item.notes || ""}`.trim()).join("\n")
            : "- None",
        "",
        "## Non-Functional Requirements",
        pack.nonFunctionalRequirements.length > 0
            ? pack.nonFunctionalRequirements.map((item) => `- ${item.category}: ${item.requirement}${item.rationale ? ` (${item.rationale})` : ""}`).join("\n")
            : "- None",
        "",
        "## Experience Constraints",
        `- Key screens: ${pack.experienceConstraints.keyScreens.join(", ") || "n/a"}`,
        `- UI components: ${pack.experienceConstraints.uiComponents.join(", ") || "n/a"}`,
        `- Interaction states: ${pack.experienceConstraints.interactionStates.join(", ") || "n/a"}`,
        `- Responsive strategy: ${pack.experienceConstraints.responsiveStrategy.join(", ") || "n/a"}`,
        "",
        "## Decision Records",
        decisions.length > 0
            ? decisions.map((item) => `- ${item.title}: ${item.decision}. Rationale: ${item.rationale}. Rejected: ${item.alternativesRejected.join(", ") || "n/a"}. Consequences: ${item.consequences.join(", ") || "n/a"}.`).join("\n")
            : "- None",
        "",
        "## Guardrails",
        `- Implementation order: ${guardrails.implementationOrder.join(" -> ") || "n/a"}`,
        `- Acceptance criteria: ${guardrails.acceptanceCriteria.join(" | ") || "n/a"}`,
        `- Test strategy: ${guardrails.testStrategy.join(" | ") || "n/a"}`
    ];

    return sections.join("\n").trim();
}

export function buildStructuredGenerationContext(
    pack: ArchitecturePack,
    decisions: DecisionRecord[],
    guardrails: GuardrailChecklist
): StructuredGenerationContext {
    return {
        version: "structured_generation_context_v1",
        architecturePack: pack,
        decisionRecords: decisions,
        guardrailChecklist: guardrails
    };
}


