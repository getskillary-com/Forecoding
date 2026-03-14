
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

export interface MinimumViableLoopChecklist {
    ready: boolean;
    score: number;
    blockingIssues: string[];
    nextMilestone: string;
    requirements: ReadinessRequirement[];
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

export type TemplateKind = "next_root" | "next_src" | "monorepo_multiapp";
export type OutputMode = "virtual_spec" | "runnable_scaffold";

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
    mustWriteCode?: boolean;
    doneCriteria?: string[];
    validationCommands?: string[];
    promptContent?: string;
    promptPath: string;
    dependencies?: string[];
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
    version: "one_click_manifest_v1";
    templateKind: TemplateKind;
    outputMode: OutputMode;
    outputLanguage: "zh" | "en";
    oneClickMode: "strict_build_v1";
    ideProfile: "generic";
    generatedAt: string;
    tasks: GenerationTask[];
    phases: PhasePlan[];
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
        | "RUNTIME_BASELINE_INCOMPLETE";
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
    current_diagram?: string; // Mermaid format code
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
    preflightReport?: PreflightReport;
    runtimeReadiness?: RuntimeReadiness;
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

// v2: Expanded Project Data
export interface Task {
    id: string;
    title: string;
    status: 'pending' | 'in-progress' | 'done';
    description?: string;
    source?: 'scaffold' | 'blueprint';
}

// Represents the "Content" of a specific version
export interface ProjectVersionData {
    messages: Message[];
    evaluation: EvaluationResponse | null;
    generation: GenerationResponse | null;
    generationArtifacts?: GenerationArtifacts;
    currentDiagram: string;
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
