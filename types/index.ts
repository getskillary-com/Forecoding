
export interface Analysis {
    clarified: string[];
    missing: string[];
}

export interface NextStep {
    reasoning: string;
    question: string | null;
    options?: { label: string; value: string }[];
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
    cursorPrompt: string; // Global prompt
    startupPrompt?: string;
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
    source?: 'blueprint';
}

// Represents the "Content" of a specific version
export interface ProjectVersionData {
    messages: Message[];
    evaluation: EvaluationResponse | null;
    generation: GenerationResponse | null;
    currentDiagram: string;
    tasks: Task[];
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
