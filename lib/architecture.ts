import type {
    Analysis,
    ArchitecturePack,
    ArchitectureReviewResult,
    ArchitectureStage,
    DecisionRecord,
    GuardrailChecklist,
    Message,
    ReadinessChecklist,
    ReviewFinding,
    SourceArtifact,
    UiRequirements
} from "@/types";

export const ARCHITECTURE_STAGE_LABELS: Record<ArchitectureStage, string> = {
    context: "Context",
    boundaries: "Boundaries",
    decisions: "Decisions",
    guardrails: "Guardrails",
    review: "Review",
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

    const pack: ArchitecturePack = {
        version: "architecture_pack_v1",
        businessContext: normalizeBusinessContext(candidate.businessContext),
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
        experienceConstraints: {
            keyScreens: normalizeStringList((candidate.experienceConstraints as Record<string, unknown> | undefined)?.keyScreens),
            uiComponents: normalizeStringList((candidate.experienceConstraints as Record<string, unknown> | undefined)?.uiComponents),
            interactionStates: normalizeStringList((candidate.experienceConstraints as Record<string, unknown> | undefined)?.interactionStates),
            responsiveStrategy: normalizeStringList((candidate.experienceConstraints as Record<string, unknown> | undefined)?.responsiveStrategy)
        }
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
        testStrategy: normalizeStringList(candidate.testStrategy, 20),
        reviewChecklist: normalizeStringList(candidate.reviewChecklist, 20)
    };
}

export function normalizeReviewFindings(value: unknown): ReviewFinding[] {
    return normalizeObjectList(value, (item) => {
        const severity = item.severity;
        const area = item.area;
        const normalizedSeverity =
            severity === "low" || severity === "medium" || severity === "high"
                ? severity
                : "medium";
        const normalizedArea =
            area === "boundaries" || area === "contracts" || area === "non_functional" || area === "delivery"
                ? area
                : "delivery";
        const finding = normalizeString(item.finding);
        const recommendedAction = normalizeString(item.recommendedAction);
        if (!finding && !recommendedAction) return null;
        return {
            severity: normalizedSeverity,
            area: normalizedArea,
            finding: finding || recommendedAction,
            recommendedAction: recommendedAction || finding
        };
    }, 16);
}

export function normalizeArchitectureReviewHistory(value: unknown): ArchitectureReviewResult[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is ArchitectureReviewResult => Boolean(item && typeof item === "object"))
        .map((item) => {
            const verdict =
                item.verdict === "aligned" || item.verdict === "needs_changes" || item.verdict === "blocked"
                    ? item.verdict
                    : "needs_changes";
            return {
                summary: typeof item.summary === "string" ? item.summary.trim() : "",
                verdict,
                findings: normalizeReviewFindings(item.findings),
                reviewedAt: typeof item.reviewedAt === "number" ? item.reviewedAt : Date.now(),
                reviewedArchitectureFingerprint:
                    typeof item.reviewedArchitectureFingerprint === "string"
                        ? item.reviewedArchitectureFingerprint.trim()
                        : ""
            };
        })
        .slice(-20);
}

export function createReadinessChecklist(
    pack: ArchitecturePack,
    decisions: DecisionRecord[],
    guardrails: GuardrailChecklist
): ReadinessChecklist {
    const blockingIssues: string[] = [];

    if (!pack.businessContext.productGoal || pack.businessContext.targetUsers.length === 0 || pack.businessContext.userJourneys.length === 0) {
        blockingIssues.push("Business context is incomplete. Define product goal, target users, and main user journey.");
    }

    if (pack.boundedContexts.length === 0 || pack.moduleResponsibilities.length === 0 || pack.dataOwnership.length === 0) {
        blockingIssues.push("System boundaries are incomplete. Add bounded contexts, module responsibilities, and data ownership.");
    }

    if (decisions.length === 0 || pack.integrationContracts.length === 0 || pack.nonFunctionalRequirements.length === 0) {
        blockingIssues.push("Architecture decisions are incomplete. Add explicit decisions, contracts, and non-functional requirements.");
    }

    if (
        guardrails.implementationOrder.length === 0 ||
        guardrails.acceptanceCriteria.length === 0 ||
        guardrails.testStrategy.length === 0 ||
        guardrails.reviewChecklist.length === 0
    ) {
        blockingIssues.push("Delivery guardrails are incomplete. Define implementation order, acceptance criteria, test strategy, and review checklist.");
    }

    const uiReady =
        pack.experienceConstraints.keyScreens.length > 0 &&
        pack.experienceConstraints.uiComponents.length > 0 &&
        pack.experienceConstraints.responsiveStrategy.length > 0;

    if (!uiReady) {
        blockingIssues.push("Experience constraints are incomplete. Define key screens, shared UI components, and responsive strategy.");
    }

    const completedSections = [
        Number(Boolean(pack.businessContext.productGoal)),
        Number(pack.businessContext.targetUsers.length > 0),
        Number(pack.businessContext.userJourneys.length > 0),
        Number(pack.boundedContexts.length > 0),
        Number(pack.moduleResponsibilities.length > 0),
        Number(pack.dataOwnership.length > 0),
        Number(decisions.length > 0),
        Number(pack.integrationContracts.length > 0),
        Number(pack.nonFunctionalRequirements.length > 0),
        Number(guardrails.implementationOrder.length > 0),
        Number(guardrails.acceptanceCriteria.length > 0),
        Number(guardrails.testStrategy.length > 0),
        Number(guardrails.reviewChecklist.length > 0),
        Number(uiReady)
    ];
    const score = Math.round((completedSections.reduce((sum, item) => sum + item, 0) / completedSections.length) * 100);
    const functionalReady = blockingIssues.length === 0 || (blockingIssues.length === 1 && !uiReady);

    return {
        score,
        functionalReady,
        uiReady,
        paymentReady: functionalReady && uiReady,
        blockingIssues,
        nextMilestone: blockingIssues[0] || "Run architecture review and proceed to scaffold when ready."
    };
}

export function inferArchitectureStage(
    pack: ArchitecturePack,
    decisions: DecisionRecord[],
    guardrails: GuardrailChecklist,
    reviewApproved: boolean = false
): ArchitectureStage {
    if (!pack.businessContext.productGoal || pack.businessContext.targetUsers.length === 0 || pack.businessContext.userJourneys.length === 0) {
        return "context";
    }

    if (pack.boundedContexts.length === 0 || pack.moduleResponsibilities.length === 0 || pack.dataOwnership.length === 0) {
        return "boundaries";
    }

    if (decisions.length === 0 || pack.integrationContracts.length === 0 || pack.nonFunctionalRequirements.length === 0) {
        return "decisions";
    }

    if (
        guardrails.implementationOrder.length === 0 ||
        guardrails.acceptanceCriteria.length === 0 ||
        guardrails.testStrategy.length === 0 ||
        guardrails.reviewChecklist.length === 0
    ) {
        return "guardrails";
    }

    if (!reviewApproved) {
        return "review";
    }

    return "ready_to_generate";
}

export function isArchitecturePackReady(
    pack: ArchitecturePack,
    decisions: DecisionRecord[],
    guardrails: GuardrailChecklist
) {
    const readiness = createReadinessChecklist(pack, decisions, guardrails);
    return readiness.functionalReady && readiness.uiReady;
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
        `- Test strategy: ${guardrails.testStrategy.join(" | ") || "n/a"}`,
        `- Review checklist: ${guardrails.reviewChecklist.join(" | ") || "n/a"}`
    ];

    return sections.join("\n").trim();
}

function includesAny(text: string, values: string[]) {
    return values.some((value) => {
        const normalized = normalizeString(value).toLowerCase();
        return normalized.length > 2 && text.includes(normalized);
    });
}

export function buildArchitectureReview(
    architecturePack: ArchitecturePack,
    guardrails: GuardrailChecklist,
    materials: string
): ArchitectureReviewResult {
    const normalizedMaterials = normalizeString(materials).toLowerCase();
    const findings: ReviewFinding[] = [];

    const suspiciousBoundaryPattern = /\bshared db|direct db access|cross[- ]module|bypass api|bypass service|query another module|read another context\b/i.test(materials);
    if (suspiciousBoundaryPattern) {
        findings.push({
            severity: "high",
            area: "boundaries",
            finding: "Implementation notes suggest direct cross-boundary access instead of explicit module ownership.",
            recommendedAction: "Route cross-context communication through an explicit contract or owning module API."
        });
    } else if (architecturePack.boundedContexts.length > 0 && !includesAny(normalizedMaterials, architecturePack.boundedContexts.map((item) => item.name))) {
        findings.push({
            severity: "medium",
            area: "boundaries",
            finding: "Implementation notes do not reference any bounded context or module ownership.",
            recommendedAction: "Annotate which bounded context owns each change before implementation."
        });
    }

    const suspiciousContractPattern = /\bno api|direct table|skip contract|adhoc payload|temporary endpoint\b/i.test(materials);
    if (suspiciousContractPattern) {
        findings.push({
            severity: "high",
            area: "contracts",
            finding: "Implementation notes imply bypassing an explicit API or event contract.",
            recommendedAction: "Define or reuse a stable integration contract and payload shape before coding."
        });
    } else if (architecturePack.integrationContracts.length > 0 && !includesAny(normalizedMaterials, architecturePack.integrationContracts.map((item) => item.name))) {
        findings.push({
            severity: "medium",
            area: "contracts",
            finding: "Implementation notes do not show how existing integration contracts are honored.",
            recommendedAction: "Reference the relevant API or event contract and describe payload ownership."
        });
    }

    const nfrKeywords = architecturePack.nonFunctionalRequirements.map((item) => `${item.category} ${item.requirement}`);
    if (nfrKeywords.length > 0 && !includesAny(normalizedMaterials, nfrKeywords)) {
        findings.push({
            severity: "medium",
            area: "non_functional",
            finding: "Implementation notes do not address the non-functional requirements in the architecture pack.",
            recommendedAction: "Call out how the change satisfies the required performance, security, observability, or cost constraints."
        });
    }

    if (guardrails.testStrategy.length > 0 && !includesAny(normalizedMaterials, guardrails.testStrategy)) {
        findings.push({
            severity: "low",
            area: "delivery",
            finding: "Implementation notes are missing the expected verification strategy.",
            recommendedAction: "Add the planned tests and checks before starting implementation."
        });
    }

    const highestSeverity = findings.some((item) => item.severity === "high")
        ? "high"
        : findings.some((item) => item.severity === "medium")
            ? "medium"
            : "low";

    return {
        summary:
            findings.length === 0
                ? "Implementation notes are aligned with the current architecture pack."
                : `Architecture review found ${findings.length} issue(s). Highest severity: ${highestSeverity}.`,
        verdict:
            highestSeverity === "high"
                ? "blocked"
                : findings.length > 0
                    ? "needs_changes"
                    : "aligned",
        findings,
        reviewedAt: Date.now(),
        reviewedArchitectureFingerprint: ""
    };
}
