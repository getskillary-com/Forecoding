
export interface UiRequirements {
    visualStyle: string[];
    colorSystem: string[];
    typography: string[];
    keyScreens: string[];
    uiComponents: string[];
    responsiveStrategy: string[];
    interactionMotion: string[];
    statesAndFeedback: string[];
}

export type UiRequirementKey = keyof UiRequirements;

export type DesignStage =
    | "functional_architecture"
    | "ready_to_generate";

export interface UiReadinessReport {
    score: number;
    completed: boolean;
    missingKeys: UiRequirementKey[];
    missingLabels: string[];
    updatedAt: number;
}

export interface UiDesignState {
    needsResync: boolean;
    readiness: UiReadinessReport;
}

export type ArchitectureStage =
    | "context"
    | "boundaries"
    | "decisions"
    | "guardrails"
    | "ready_to_generate";

export type ArchitectureDiagramLayerId =
    | "context"
    | "structure"
    | "data"
    | "delivery"
    | "placeholder";

export interface ArchitectureDiagramNode {
    id: string;
    layerId: ArchitectureDiagramLayerId;
    label: string;
    kind: "summary" | "detail";
}

export interface ArchitectureDiagramEdge {
    from: string;
    to: string;
    label?: string;
}

export interface ArchitectureDiagramLayer {
    id: ArchitectureDiagramLayerId;
    title: string;
    summaryNodeId: string;
    nodeIds: string[];
}

export interface ArchitectureDiagramModel {
    version: "architecture_diagram_v1";
    direction: "LR";
    layers: ArchitectureDiagramLayer[];
    nodes: ArchitectureDiagramNode[];
    edges: ArchitectureDiagramEdge[];
}

export interface SourceArtifact {
    id: string;
    sourceType: "chat" | "text" | "pdf" | "image";
    name: string;
    summary: string;
    excerpt?: string;
    mimeType?: string;
    sourceMessageIndex?: number;
    attachmentIndex?: number;
    createdAt: number;
}

export interface BusinessContext {
    productGoal: string;
    targetUsers: string[];
    userJourneys: string[];
    constraints: string[];
    risks: string[];
}

export interface PlatformStrategy {
    primaryPlatform: string;
    targetPlatforms: string[];
    runtimeEnvironments: string[];
    distributionChannels: string[];
}

export interface DomainEntity {
    name: string;
    description: string;
    owner?: string;
}

export interface BoundedContext {
    name: string;
    responsibility: string;
    owns: string[];
    dependencies: string[];
}

export interface ModuleResponsibility {
    module: string;
    responsibility: string;
    inputs: string[];
    outputs: string[];
}

export interface DataOwnership {
    data: string;
    owner: string;
    consumers: string[];
    notes?: string;
}

export interface IntegrationContract {
    name: string;
    kind: "api" | "event" | "job" | "shared-library";
    producer: string;
    consumer: string;
    payload: string;
    notes: string;
}

export interface NonFunctionalRequirement {
    category: string;
    requirement: string;
    rationale?: string;
}

export interface DeliveryPlanItem {
    phase: string;
    goal: string;
    acceptanceCriteria: string[];
}

export interface ExperienceConstraint {
    keyScreens: string[];
    uiComponents: string[];
    interactionStates: string[];
    responsiveStrategy: string[];
}

export interface ArchitecturePack {
    version: "architecture_pack_v1";
    businessContext: BusinessContext;
    platformStrategy: PlatformStrategy;
    domainModel: DomainEntity[];
    boundedContexts: BoundedContext[];
    moduleResponsibilities: ModuleResponsibility[];
    dataOwnership: DataOwnership[];
    integrationContracts: IntegrationContract[];
    nonFunctionalRequirements: NonFunctionalRequirement[];
    deliveryPlan: DeliveryPlanItem[];
    experienceConstraints: ExperienceConstraint;
}

export interface DecisionRecord {
    title: string;
    decision: string;
    rationale: string;
    alternativesRejected: string[];
    consequences: string[];
}

export interface GuardrailChecklist {
    implementationOrder: string[];
    acceptanceCriteria: string[];
    testStrategy: string[];
}

export type ReadinessCriterionKey =
    | "business_context"
    | "boundaries"
    | "decisions"
    | "guardrails"
    | "ui";

export type ReadinessRequirementKey =
    | "business_context.product_goal"
    | "business_context.platforms"
    | "business_context.target_users"
    | "business_context.user_journeys"
    | "business_context.constraints_or_risks"
    | "boundaries.bounded_contexts"
    | "boundaries.module_responsibilities"
    | "boundaries.data_ownership"
    | "decisions.decision_records"
    | "decisions.integration_contracts"
    | "decisions.non_functional_requirements"
    | "guardrails.implementation_order"
    | "guardrails.acceptance_criteria"
    | "guardrails.test_strategy"
    | "ui.key_screens"
    | "ui.shared_components"
    | "ui.responsive_strategy";

export type ReadinessOverrideKey =
    | "single_screen_experience";

export type ReadinessRequirementStatus =
    | "missing"
    | "partial"
    | "confirmed"
    | "waived";

export type ReadinessCriterionStatus =
    | "missing"
    | "partial"
    | "confirmed";

export interface ReadinessOverride {
    key: ReadinessOverrideKey;
    requirementKey: ReadinessRequirementKey;
    rationale: string;
    createdAt?: number;
}

export interface ReadinessRequirement {
    key: ReadinessRequirementKey;
    label: string;
    status: ReadinessRequirementStatus;
    satisfiedCount: number;
    requiredCount: number;
    missing: string[];
    overrideKey?: ReadinessOverrideKey;
    overrideReason?: string;
}

export interface ReadinessCriterion {
    key: ReadinessCriterionKey;
    label: string;
    status: ReadinessCriterionStatus;
    satisfiedCount: number;
    requiredCount: number;
    missing: string[];
    requirements: ReadinessRequirement[];
    overrideApplied?: boolean;
}

export interface ReadinessChecklist {
    score: number;
    functionalReady: boolean;
    uiReady: boolean;
    paymentReady: boolean;
    blockingIssues: string[];
    nextMilestone: string;
    criteria: ReadinessCriterion[];
    overrides?: ReadinessOverride[];
}

export interface UiDesignTokens {
    colors: Record<string, string>;
    typography: {
        fontFamilies: string[];
        scale: Record<string, string>;
        weights: Record<string, string | number>;
    };
    spacing: Record<string, string>;
    radius: Record<string, string>;
    shadow: Record<string, string>;
    motion: {
        duration: Record<string, string>;
        easing: Record<string, string>;
    };
    accessibility: {
        contrastTarget: string;
        focusStyle: string;
    };
}

export interface UiDesignScreenLayout {
    type: string;
    sections: string[];
}

export interface UiDesignScreenStates {
    loading: string;
    empty: string;
    error: string;
    success: string;
}

export interface UiDesignScreen {
    id: string;
    name: string;
    route: string;
    layout: UiDesignScreenLayout;
    components: string[];
    states: UiDesignScreenStates;
    interactions: string[];
}

export interface UiDesignComponent {
    id: string;
    name: string;
    type: string;
    variants: string[];
    props: Record<string, string>;
    states: string[];
}

export interface UiDesignFlow {
    from: string;
    to: string;
    trigger: string;
}

export interface UiDesignSpec {
    version: "ui_spec_v1";
    tokens: UiDesignTokens;
    screens: UiDesignScreen[];
    components: UiDesignComponent[];
    flows: UiDesignFlow[];
}

export interface Analysis {
    clarified: string[];
    missing: string[];
    ui?: UiRequirements;
}

export type MessageAction =
    | "send_message"
    | "generate_scaffold"
    | "open_prd"
    | "focus_requirement"
    | "fill_requirement"
    | "show_blockers";

export type MessageQuestionStatus =
    | "pending"
    | "answered"
    | "stale";

export type EvaluateInteractionMode =
    | "chat"
    | "architecture";

export type MessageKind =
    | "chat"
    | "system";

export interface MessageOption {
    label: string;
    value: string;
    action?: MessageAction;
    questionKey?: string | null;
    requirementKey?: ReadinessRequirementKey | null;
    stale?: boolean;
}

export interface NextStep {
    reasoning: string;
    question: string | null;
    options?: MessageOption[];
}

export interface DiagramGovernance {
    pendingDiagram?: string | null;
    pendingSourceRequestId?: string | null;
    pendingUpdatedAt?: number | null;
    lastDecision?: "none" | "applied" | "rejected";
    lastDecisionNote?: string | null;
    lastDecisionAt?: number | null;
}

export type TemplateKind = "next_root" | "next_src" | "react_vite" | "monorepo_multiapp";
export type OutputMode = "virtual_spec" | "runnable_scaffold";
export type ExportContentKind = "doc" | "config" | "placeholder" | "template";
export type SpecPackFramework = "next_app_router" | "react_vite_spa" | "monorepo_multiapp";

export interface SpecPackProfile {
    version: "spec_pack_profile_v1";
    framework: SpecPackFramework;
    templateKind: TemplateKind;
    routeStyle: "next_app_router" | "react_router";
    workspaceMode: "single_app" | "monorepo";
    stackSignals: string[];
    dependencyHints: string[];
}

export interface StructuredGenerationContext {
    version: "structured_generation_context_v1";
    architecturePack: ArchitecturePack;
    decisionRecords: DecisionRecord[];
    guardrailChecklist: GuardrailChecklist;
}

export type GenerationTaskType =
    | "baseline"
    | "implementation";

export interface GenerationTask {
    id: string;
    phase: number;
    phaseTitle: string;
    filePath: string;
    taskType?: GenerationTaskType;
    contentKind?: ExportContentKind;
    mustWriteCode?: boolean;
    doneCriteria?: string[];
    validationCommands?: string[];
    promptContent?: string;
    promptPath: string;
    dependencies?: string[];
}

export interface GenerationManifestFile {
    path: string;
    contentKind: ExportContentKind;
    promptPath?: string;
}

export interface PhasePlan {
    phase: number;
    title: string;
    goal: string;
    inputFiles: string[];
    expectedOutput: string;
    doneCriteria: string;
    validationCommands: string[];
}

export interface GenerationManifest {
    version: "one_click_manifest_v1" | "one_click_manifest_v2";
    templateKind: TemplateKind;
    outputMode: OutputMode;
    outputLanguage: "zh" | "en";
    oneClickMode: "strict_build_v1";
    ideProfile: "generic";
    generatedAt: string;
    profile?: SpecPackProfile;
    tasks: GenerationTask[];
    phases: PhasePlan[];
    files?: GenerationManifestFile[];
}

export interface ArtifactManifestEntry {
    path: string;
    nodeType: "file" | "folder";
    contentKind?: ExportContentKind;
    promptPath?: string;
}

export interface ArtifactManifest {
    version: "artifact_manifest_v1";
    workspaceSnapshotId: string;
    projectId: string;
    versionId: string;
    outputMode: OutputMode;
    templateKind?: TemplateKind | null;
    generatedAt: number;
    fileCount: number;
    files: ArtifactManifestEntry[];
}

export interface ContractCoverage {
    status: "unknown" | "partial" | "covered";
    contractCount: number;
    notes: string[];
}

export interface RemediationHint {
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
    action?: string;
    autoFixable?: boolean;
}

export interface PreflightIssue {
    code:
        | "NEXT_CONFIG_CONTAMINATED"
        | "MISSING_ENV_EXAMPLE"
        | "MISSING_PROMPT_FILE"
        | "MISSING_TASK_PROMPT"
        | "INVALID_PROMPT_REFERENCE"
        | "PLAN_COVERAGE_INCOMPLETE"
        | "EMPTY_GENERATION_TASKS"
        | "DUPLICATE_PATH_SEGMENT"
        | "LANGUAGE_MISMATCH"
        | "MISSING_STACK_DEPENDENCIES"
        | "MISSING_REQUIRED_DEPENDENCIES"
        | "MISSING_CSS_BASELINE"
        | "MISSING_PAGE_UI_REQUIREMENTS"
        | "RUNTIME_BASELINE_INCOMPLETE"
        | "SPEC_CONTENT_CONTAMINATED"
        | "INVALID_PLACEHOLDER_FORMAT"
        | "INVALID_JSON_FILE"
        | "ROUTE_MAP_REFERENCE_MISSING"
        | "WORKSPACE_STRUCTURE_MISMATCH"
        | "README_STACK_MISMATCH"
        | "SPEC_DOC_RUNTIME_DRIFT";
    severity: "warning" | "error";
    message: string;
    details?: string;
}

export interface PreflightReport {
    pass: boolean;
    planCoveragePct: number;
    placeholderCount: number;
    nextConfigValid: boolean;
    envExamplePresent: boolean;
    pathNormalizationFixCount: number;
    missingDepsCount: number;
    manifestTaskCount: number;
    issues: PreflightIssue[];
}

export interface RuntimeReadiness {
    outputMode: OutputMode;
    promptRefsValid: boolean;
    dependenciesResolved: boolean;
    installable: boolean;
    typecheckable: boolean;
    lintable: boolean;
    buildable: boolean;
    issues: PreflightIssue[];
}

export interface EvaluationResponse {
    density_score: number;
    is_ready: boolean;
    current_diagram?: string; // Derived or legacy Mermaid preview, not the source of truth
    analysis: Analysis; // This powers the real-time PRD workspace
    next_step: NextStep;
    stage?: ArchitectureStage;
    openQuestions?: string[];
    architecturePackDraft?: ArchitecturePack;
    decisionDrafts?: DecisionRecord[];
    guardrailDrafts?: GuardrailChecklist;
    readiness?: ReadinessChecklist;
}

export interface FileNode {
    name: string;
    type: 'file' | 'folder';
    content?: string; // The prompt/instruction for files
    children?: FileNode[];
}

export interface GenerationResponse {
    projectTree: FileNode[]; // Structured tree
    toolStack: string; // Markdown table
    outputMode?: OutputMode;
    generationManifest?: GenerationManifest;
    artifactManifest?: ArtifactManifest;
    contractCoverage?: ContractCoverage;
    preflightReport?: PreflightReport;
    runtimeReadiness?: RuntimeReadiness;
    remediationHints?: RemediationHint[];
    generationJobId?: string;
    job?: GenerationJob;
}

export interface GenerationArtifacts {
    virtual_spec?: GenerationResponse | null;
    runnable_scaffold?: GenerationResponse | null;
}

export interface Attachment {
    type: 'image' | 'text' | 'pdf';
    mimeType: string;
    content: string; // Base64 for images/pdf, text for text files
    name: string;
}

export interface Message {
    id?: string;
    createdAt?: number;
    role: 'user' | 'assistant';
    content: string;
    kind?: MessageKind;
    options?: MessageOption[];
    attachments?: Attachment[];
    questionKey?: string | null;
    questionStatus?: MessageQuestionStatus | null;
    questionAction?: MessageAction | null;
    questionRequirementKey?: ReadinessRequirementKey | null;
    answeredQuestionKey?: string | null;
    triggeredAction?: MessageAction | null;
}

export type PrdDeltaAction =
    | "confirmed"
    | "focus_requirement"
    | "fill_requirement"
    | "show_blockers";

export interface PrdDelta {
    id: string;
    createdAt: number;
    action: PrdDeltaAction;
    requirementKey?: ReadinessRequirementKey | null;
    questionKey?: string | null;
    sourceMessageId?: string | null;
}

export interface EvidenceLink {
    id: string;
    type: "message" | "attachment" | "artifact" | "manual" | "system";
    title: string;
    summary: string;
    sourceMessageId?: string | null;
    attachmentName?: string | null;
    artifactId?: string | null;
    createdAt: number;
}

export interface RequirementRecord {
    id: string;
    title: string;
    status: "confirmed" | "pending" | "blocked";
    summary: string;
    evidenceLinkIds: string[];
    riskNotes?: string[];
    updatedAt: number;
}

export interface AssumptionRecord {
    id: string;
    statement: string;
    status: "active" | "validated" | "invalidated";
    evidenceLinkIds: string[];
    updatedAt: number;
}

export interface AcceptanceCase {
    id: string;
    title: string;
    scenario: string;
    status: "pending" | "ready" | "covered";
    evidenceLinkIds: string[];
    updatedAt: number;
}

export interface ContractSpec {
    id: string;
    name: string;
    kind: "api" | "event" | "job" | "shared-library";
    producer: string;
    consumer: string;
    schemaSummary: string;
    status: "draft" | "active" | "deprecated";
    updatedAt: number;
}

export interface TaskDefinition {
    id: string;
    title: string;
    owner: string;
    status: "pending" | "ready" | "blocked";
    dependsOn: string[];
    inputSummary: string;
    outputSummary: string;
    verifyCommand?: string;
    rollbackHint?: string;
}

export interface TaskRun {
    id: string;
    taskId: string;
    status: "queued" | "running" | "succeeded" | "failed" | "blocked";
    attempt?: number;
    startedAt?: number | null;
    finishedAt?: number | null;
    resultSummary?: string;
    remediationHint?: string;
    rollbackExecuted?: boolean;
}

export type ProgressTemplateVersion = "readiness_v1";

export interface ProgressTemplateRequirementV1 {
    key: ReadinessRequirementKey;
    label: string;
}

export interface ProgressTemplateCriterionV1 {
    key: ReadinessCriterionKey;
    label: string;
    requirementKeys: ReadinessRequirementKey[];
}

export interface ProgressTemplateV1 {
    version: "progress_template_v1";
    templateVersion: ProgressTemplateVersion;
    taxonomy: "readiness";
    criteria: ProgressTemplateCriterionV1[];
    requirements: ProgressTemplateRequirementV1[];
    updatedAt: number;
}

export interface ProgressStateV1 {
    version: "progress_state_v1";
    templateVersion: ProgressTemplateVersion;
    score: number;
    functionalReady: boolean;
    uiReady: boolean;
    paymentReady: boolean;
    blockingIssues: string[];
    nextMilestone: string;
    primaryBlocker: string | null;
    currentFocus: string | null;
    requirementStatuses: Partial<Record<ReadinessRequirementKey, ReadinessRequirementStatus>>;
    changedRequirementKeys: ReadinessRequirementKey[];
    updatedAt: number;
}

export type ProgressEventType =
    | "requirement.focused"
    | "requirement.filled"
    | "readiness.recomputed"
    | "task.run.updated"
    | "generation.gate.changed"
    | "workspace.patch.applied";

export interface ProgressEventV1 {
    id: string;
    type: ProgressEventType;
    createdAt: number;
    projectId?: string;
    versionId?: string;
    requirementKey?: ReadinessRequirementKey | null;
    questionKey?: string | null;
    sourceMessageId?: string | null;
    summary?: string | null;
    metadata?: Record<string, string>;
}

export type WorkspacePatchOperation =
    | {
        type: "replace_projects";
        projects: Project[];
    }
    | {
        type: "upsert_project";
        project: Project;
    }
    | {
        type: "remove_project";
        projectId: string;
    }
    | {
        type: "append_progress_events";
        projectId: string;
        versionId: string;
        events: ProgressEventV1[];
        progressState?: ProgressStateV1 | null;
    };

export interface ProviderRunLog {
    id: string;
    provider: "openai" | "gemini" | "claude" | "unknown";
    operation: "evaluate" | "generate" | "fallback" | "preflight";
    model: string;
    status: "started" | "succeeded" | "failed" | "fallback";
    costUsd?: number | null;
    latencyMs?: number | null;
    createdAt: number;
    errorCode?: string | null;
}

export interface BillingEvent {
    id: string;
    provider: "stripe" | "manual";
    eventType: string;
    status: "pending" | "succeeded" | "failed" | "refunded";
    amountCents: number;
    currency: string;
    createdAt: number;
    relatedProjectId?: string | null;
    userId?: string | null;
    tenantId?: string | null;
    providerEventId?: string | null;
    paymentIntentId?: string | null;
    invoiceId?: string | null;
    refundId?: string | null;
    merchantOrderId?: string | null;
    requestId?: string | null;
    workspaceSnapshotId?: string | null;
    workspaceRevision?: number | null;
    metadata?: Record<string, string>;
}

export interface ProjectPurchase {
    id: string;
    userId: string;
    projectId: string;
    tenantId?: string | null;
    provider: "stripe" | "manual";
    status: "PENDING" | "SUCCEEDED" | "CANCELLED" | "FAILED" | "REFUNDED";
    amount: number;
    currency: string;
    requestId: string;
    merchantOrderId: string;
    paymentIntentId?: string | null;
    sessionId?: string | null;
    invoiceId?: string | null;
    refundId?: string | null;
    customerEmail?: string | null;
    providerEventId?: string | null;
    providerEventType?: string | null;
    workspaceSnapshotId?: string | null;
    workspaceRevision?: number | null;
    paidAt?: number | null;
    refundedAt?: number | null;
    createdAt: number;
    updatedAt: number;
}

export interface WebhookEventRecord {
    provider: string;
    eventId: string;
    eventName: string;
    payload: string;
    processedAt: number;
    replayCount?: number;
    lastReplayedAt?: number | null;
    lastReplayStatus?: "succeeded" | "failed" | null;
    lastReplayError?: string | null;
}

// v2: Expanded Project Data
export interface Task {
    id: string;
    title: string;
    status: 'pending' | 'in-progress' | 'done';
    description?: string;
    source?: 'scaffold' | 'blueprint';
}

export interface PendingEvaluation {
    requestId: string;
    requestMessages: Message[];
    startedAt: number;
    assistantContent?: string;
    interactionMode?: EvaluateInteractionMode;
}

// Represents the "Content" of a specific version
export interface ProjectVersionData {
    messages: Message[];
    evaluation: EvaluationResponse | null;
    generation: GenerationResponse | null;
    generationArtifacts?: GenerationArtifacts;
    currentDiagram: string; // Derived Mermaid cache kept for compatibility/export
    tasks: Task[];
    paymentStatus?: "paid" | "unpaid";
    diagramGovernance?: DiagramGovernance;
    designStage?: DesignStage;
    uiDesignState?: UiDesignState;
    uiDesignSpec?: UiDesignSpec;
    functionalLockedAt?: number | null;
    uiReadyAt?: number | null;
    sourceArtifacts?: SourceArtifact[];
    architecturePack?: ArchitecturePack;
    decisionRecords?: DecisionRecord[];
    guardrailChecklist?: GuardrailChecklist;
    architectureStage?: ArchitectureStage;
    readinessOverrides?: ReadinessOverride[];
    prdDeltas?: PrdDelta[];
    pendingEvaluation?: PendingEvaluation | null;
    requirements?: RequirementRecord[];
    assumptions?: AssumptionRecord[];
    acceptanceCases?: AcceptanceCase[];
    evidenceLinks?: EvidenceLink[];
    contractSpecs?: ContractSpec[];
    taskDefinitions?: TaskDefinition[];
    taskRuns?: TaskRun[];
    providerRunLogs?: ProviderRunLog[];
    billingEvents?: BillingEvent[];
    progressTemplateVersion?: ProgressTemplateVersion;
    progressTemplate?: ProgressTemplateV1;
    progressState?: ProgressStateV1;
    progressEvents?: ProgressEventV1[];
    progressCursor?: string;
}

// Represents a specific snapshot/iteration of a project
export interface ProjectVersion {
    id: string;             // Unique ID for this version
    projectId: string;      // Parent Project ID
    versionNumber: number;  // 1, 2, 3...
    name: string;           // "MVP", "Dark Mode Update" (User or AI generated label)
    createdAt: number;
    status: 'active' | 'published'; // active = currently editing, published = historical/read-only (or generated)

    data: ProjectVersionData;

    baseVersionId?: string; // The version this was forked/iterated from
}

// The high-level container
export interface Project {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    workspaceLanguage: "zh" | "en";
    description?: string;
    versions: ProjectVersion[];
}

export type WorkspaceChangeKind =
    | "workspace_sync"
    | "project_update"
    | "system_migration"
    | "payment_update"
    | "generation_update"
    | "release"
    | "admin";

export interface WorkspaceChangeSet {
    id: string;
    kind: WorkspaceChangeKind;
    summary: string;
    projectIds: string[];
    activeVersionIds: string[];
    actorId?: string | null;
    actorEmail?: string | null;
    saveMode?: "snapshot" | "patch";
    idempotencyKey?: string | null;
    operationDigest?: string | null;
    rebaseCount?: number;
    appliedOperations?: number;
    createdAt: number;
}

export interface WorkspaceRevision {
    id: string;
    number: number;
    createdAt: number;
    snapshotId: string;
    changeSet: WorkspaceChangeSet;
}

export interface WorkspaceSnapshot {
    id: string;
    revisionId: string;
    createdAt: number;
    summary: string;
    projectIds: string[];
    activeVersionIds: string[];
    projects?: Project[];
}

export interface ReleaseTag {
    id: string;
    label: string;
    snapshotId: string;
    createdAt: number;
    note?: string | null;
    approvalStatus?: "pending" | "approved" | "rejected";
    approvalNote?: string | null;
    approvedBy?: string | null;
    approvedAt?: number | null;
}

export interface WorkspaceEnvelope {
    version: "workspace_envelope_v1";
    ownerUserId: string;
    tenantId?: string | null;
    projects: Project[];
    revision: number;
    revisionHistory: WorkspaceRevision[];
    snapshots: WorkspaceSnapshot[];
    releaseTags: ReleaseTag[];
    createdAt: number;
    updatedAt: number;
}

export interface AuditEvent {
    id: string;
    eventType: string;
    severity: "info" | "warning" | "critical";
    actorId?: string | null;
    actorEmail?: string | null;
    resourceType: string;
    resourceId: string;
    summary: string;
    metadata?: Record<string, string>;
    createdAt: number;
}

export interface FeatureFlag {
    key: string;
    description: string;
    enabled: boolean;
    scope: "global" | "tenant" | "workspace";
    scopeId?: string | null;
    value?: string | number | boolean | null;
    updatedAt: number;
    updatedBy?: string | null;
}

export interface GenerationJob {
    id: string;
    status: "queued" | "running" | "succeeded" | "failed";
    workspaceSnapshotId: string;
    projectId?: string | null;
    versionId?: string | null;
    tenantId?: string | null;
    tenantStatus?: "active" | "trial" | "suspended" | null;
    outputMode: string;
    templateKind?: string | null;
    releaseIntent?: string | null;
    artifactManifest?: ArtifactManifest | null;
    preflightReport?: PreflightReport | null;
    remediationHints?: RemediationHint[];
    errorCode?: string | null;
    errorMessage?: string | null;
    createdAt: number;
    updatedAt: number;
}

export type EvaluateSseEventName =
    | "analysis.delta"
    | "question"
    | "conflict"
    | "readiness.update"
    | "trace"
    | "remediation";

export interface EvaluateTraceEvent {
    kind: "start" | "chunk" | "complete";
    requestId: string;
    chunk?: string;
    source?: "model" | "fallback" | "system";
    note?: string;
    projectId?: string;
    versionId?: string;
    workspaceSnapshotId?: string;
    workspaceRevision?: number;
}

export interface EvaluateQuestionEvent {
    question: string;
    questionAction?: MessageAction | null;
    questionRequirementKey?: ReadinessRequirementKey | null;
    optionsRaw?: string | null;
    source: "model" | "fallback";
}

export interface EvaluateAnalysisDeltaEvent {
    stage?: ArchitectureStage;
    densityScore?: number;
    isReady?: boolean;
    clarified?: string[];
    missing?: string[];
    uiRaw?: string | null;
    uiSpecRaw?: string | null;
    architecturePackRaw?: string | null;
    decisionRecordsRaw?: string | null;
    guardrailsRaw?: string | null;
}

export interface EvaluateConflictEvent {
    summary: string;
    items: string[];
}

export interface EvaluateReadinessUpdateEvent {
    raw: string;
}

export interface EvaluateRemediationEvent {
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
    retrying?: boolean;
    fallbackInjected?: boolean;
    requestId?: string;
}

export interface Tenant {
    id: string;
    orgId?: string | null;
    name: string;
    slug: string;
    status: "active" | "trial" | "suspended";
    workspaceCount: number;
    createdAt: number;
    updatedAt: number;
}

export interface Org {
    id: string;
    name: string;
    slug: string;
    status: "active" | "suspended";
    tenantCount: number;
    createdAt: number;
    updatedAt: number;
}

export interface SloMetric {
    key: string;
    label: string;
    value: number;
    unit: "percent" | "count";
    target: string;
    status: "ok" | "warning" | "critical";
    sampleSize: number;
    windowMs: number;
    description: string;
}

export interface PlatformAlert {
    id: string;
    severity: "warning" | "critical";
    title: string;
    message: string;
    source: "generation" | "webhook" | "release" | "audit";
    createdAt: number;
    eventType?: string;
    resourceType?: string;
    resourceId?: string;
    actionHref?: string;
}

export interface ObservabilitySnapshot {
    generatedAt: number;
    windowMs: number;
    metrics: SloMetric[];
    alerts: PlatformAlert[];
}
