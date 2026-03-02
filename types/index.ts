
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
        | "MISSING_UI_SPEC"
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
