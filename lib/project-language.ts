import type { Message, Project } from "@/types";

export type WorkspaceLanguage = "zh" | "en";

const CHINESE_DETECTION_RATIO = 0.08;
const DEFAULT_WORKSPACE_LANGUAGE: WorkspaceLanguage = "en";

function countChineseChars(text: string) {
    return (text.match(/[\u3400-\u9fff]/g) || []).length;
}

function countLatinChars(text: string) {
    return (text.match(/[A-Za-z]/g) || []).length;
}

export function normalizeWorkspaceLanguage(value: unknown): WorkspaceLanguage | null {
    return value === "zh" || value === "en" ? value : null;
}

export function detectWorkspaceLanguageFromText(text: string): WorkspaceLanguage {
    const source = text.trim();
    if (!source) return DEFAULT_WORKSPACE_LANGUAGE;

    const chinese = countChineseChars(source);
    const latin = countLatinChars(source);

    if (chinese >= 6) return "zh";
    if (chinese >= 2 && chinese / Math.max(1, chinese + latin) >= CHINESE_DETECTION_RATIO) {
        return "zh";
    }

    return "en";
}

function collectProjectLanguageSignals(project: Partial<Project> | null | undefined) {
    if (!project) return "";

    const latestVersion = Array.isArray(project.versions) && project.versions.length > 0
        ? project.versions[project.versions.length - 1]
        : null;
    const messages = Array.isArray(latestVersion?.data?.messages)
        ? (latestVersion?.data?.messages as Message[])
        : [];
    const messageText = messages
        .slice(-8)
        .map((message) => message.content || "")
        .join("\n");
    const generationLanguage =
        latestVersion?.data?.generationArtifacts?.virtual_spec?.generationManifest?.outputLanguage ||
        latestVersion?.data?.generation?.generationManifest?.outputLanguage ||
        "";

    return [
        project.name || "",
        project.description || "",
        messageText,
        generationLanguage
    ]
        .filter(Boolean)
        .join("\n");
}

export function getProjectWorkspaceLanguage(project: Partial<Project> | null | undefined): WorkspaceLanguage {
    const explicitLanguage = normalizeWorkspaceLanguage(project?.workspaceLanguage);
    if (explicitLanguage) return explicitLanguage;

    const inferred = detectWorkspaceLanguageFromText(collectProjectLanguageSignals(project));
    return normalizeWorkspaceLanguage(inferred) || DEFAULT_WORKSPACE_LANGUAGE;
}

export function ensureProjectWorkspaceLanguage(project: Project): Project {
    const workspaceLanguage = getProjectWorkspaceLanguage(project);
    if (project.workspaceLanguage === workspaceLanguage) return project;
    return {
        ...project,
        workspaceLanguage
    };
}

export function normalizeProjects(raw: unknown): Project[] {
    if (!Array.isArray(raw)) return [];

    return raw
        .filter((item): item is Project => Boolean(item && typeof item === "object"))
        .map((item) => ensureProjectWorkspaceLanguage(item));
}

export function getWorkspaceLanguageLabel(language: WorkspaceLanguage) {
    return language === "zh" ? "中文" : "English";
}
