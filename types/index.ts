
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
    | "review"
    | "ready_to_generate";

export interface SourceArtifact {
    id: string;
    sourceType: "chat" | "text" | "pdf" | "image";
    name: string;
    summary: string;
    createdAt: number;
}

export interface BusinessContext {
    productGoal: string;
    targetUsers: string[];
    userJourneys: string[];
    constraints: string[];
    risks: string[];
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
    reviewChecklist: string[];
}

export interface ReadinessChecklist {
    score: number;
    functionalReady: boolean;
    uiReady: boolean;
    paymentReady: boolean;
    blockingIssues: string[];
    nextMilestone: string;
}

export interface ReviewFinding {
    severity: "low" | "medium" | "high";
    area: "boundaries" | "contracts" | "non_functional" | "delivery";
    finding: string;
    recommendedAction: string;
}

export interface ArchitectureReviewResult {
    summary: string;
    verdict: "aligned" | "needs_changes" | "blocked";
    findings: ReviewFinding[];
    reviewedAt: number;
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

export interface NextStep {
    reasoning: string;
    question: string | null;
    options?: { label: string; value: string }[];
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

export interface GenerationTask {
    id: string;
    phase: number;
    phaseTitle: string;
    filePath: string;
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
        | "INVALID_PROMPT_REFERENCE"
        | "PLAN_COVERAGE_INCOMPLETE"
        | "EMPTY_GENERATION_TASKS"
        | "DUPLICATE_PATH_SEGMENT"
        | "LANGUAGE_MISMATCH"
        | "MISSING_STACK_DEPENDENCIES"
        | "MISSING_CSS_BASELINE"
        | "MISSING_PAGE_UI_REQUIREMENTS";
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

export interface EvaluationResponse {
    density_score: number;
    is_ready: boolean;
    current_diagram?: string; // Mermaid format code
    analysis: Analysis; // This acts as our real-time PRD
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
    generationManifest?: GenerationManifest;
    preflightReport?: PreflightReport;
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
    options?: { label: string; value: string }[];
    attachments?: Attachment[];
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
    reviewHistory?: ArchitectureReviewResult[];
    architectureStage?: ArchitectureStage;
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
    description?: string;
    versions: ProjectVersion[];
}
