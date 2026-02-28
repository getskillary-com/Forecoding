/* eslint-disable @typescript-eslint/no-explicit-any */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { CTO_SYSTEM_PROMPT, ARCHITECT_SYSTEM_PROMPT, MAINTENANCE_PROMPT_ADDITION } from "./prompts";
import type { Message } from "@/types";

type OutputLanguage = "zh" | "en";

function normalizeProvider(value: string | undefined) {
    const raw = (value || "").trim().replace(/^['"]|['"]$/g, "").toLowerCase();
    if (raw === "claude" || raw === "anthropic") return "claude";
    if (raw === "gemini" || raw === "google") return "gemini";
    return "";
}

const AI_PROVIDER =
    normalizeProvider(process.env.AI_PROVIDER) ||
    (process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY ? "claude" : "gemini");
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || "";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-6";
const CLAUDE_API_BASE_URL = (process.env.CLAUDE_API_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
const CLAUDE_API_VERSION = process.env.CLAUDE_API_VERSION || "2023-06-01";
const CLAUDE_MAX_TOKENS = Number(process.env.CLAUDE_MAX_TOKENS || "8192");
const CLAUDE_COOLDOWN_MS = Number(process.env.CLAUDE_COOLDOWN_MS || "120000");
const GEMINI_CORE_COOLDOWN_MS = Number(process.env.GEMINI_CORE_COOLDOWN_MS || "180000");
const GEMINI_STREAM_OPEN_MAX_ATTEMPTS = Math.min(
    4,
    Math.max(1, Number(process.env.GEMINI_STREAM_OPEN_MAX_ATTEMPTS || "2"))
);
const GEMINI_STREAM_RETRY_BASE_MS = Math.min(
    2_000,
    Math.max(100, Number(process.env.GEMINI_STREAM_RETRY_BASE_MS || "350"))
);

// Initialize Gemini Client
const apiKey = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(apiKey);

// Model Configuration
// User explicitly requested gemini-3.1-pro-preview
const CORE_MODEL = "gemini-3.1-pro-preview";
const BACKUP_MODEL = "gemini-3-pro-preview";

export function getActiveAiProvider() {
    return AI_PROVIDER || "gemini";
}

function isClaudeProvider() {
    return AI_PROVIDER === "claude";
}

function hasGeminiKey() {
    return Boolean(apiKey);
}

let claudeCooldownUntil = 0;
let geminiCoreCooldownUntil = 0;

function shouldSkipClaude() {
    return Date.now() < claudeCooldownUntil;
}

function markClaudeFailure() {
    claudeCooldownUntil = Date.now() + CLAUDE_COOLDOWN_MS;
}

function shouldSkipGeminiCore() {
    return Date.now() < geminiCoreCooldownUntil;
}

function markGeminiCoreFailure() {
    geminiCoreCooldownUntil = Date.now() + GEMINI_CORE_COOLDOWN_MS;
}

const CLAUDE_RETRYABLE_ERROR_PATTERNS = [
    /overloaded/i,
    /rate limit/i,
    /\b429\b/,
    /\b503\b/,
    /\b529\b/,
    /temporarily unavailable/i,
    /timed out/i,
    /timeout/i,
    /econnreset/i,
    /socket hang up/i
];

const GEMINI_CORE_RETRYABLE_ERROR_PATTERNS = [
    /\b429\b/i,
    /\b503\b/i,
    /high demand/i,
    /temporarily unavailable/i,
    /overloaded/i,
    /resource exhausted/i,
    /deadline exceeded/i,
    /timed out/i,
    /timeout/i
];

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function clipErrorText(text: string, maxChars: number = 300) {
    const normalized = (text || "").replace(/\s+/g, " ").trim();
    if (!normalized) return "No error details";
    return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}...` : normalized;
}

function getErrorMessage(error: unknown) {
    const raw = error instanceof Error ? error.message : String(error);
    return clipErrorText(raw, 500);
}

function isRetryableClaudeStreamError(error: unknown) {
    const message = getErrorMessage(error);
    return CLAUDE_RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function isRetryableGeminiCoreError(error: unknown) {
    const message = getErrorMessage(error);
    return GEMINI_CORE_RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

console.log(`[AI] Active provider: ${AI_PROVIDER}`);

/**
 * Helper to call Gemini with fallback logic
 */
async function withFallback<T>(
    operation: (model: any) => Promise<T>,
    isJsonMode: boolean = false
): Promise<T> {
    const useBackupFirst = shouldSkipGeminiCore();
    const primaryModelName = useBackupFirst ? BACKUP_MODEL : CORE_MODEL;
    const fallbackModelName = useBackupFirst ? null : BACKUP_MODEL;

    try {
        console.log(`[AI] Attempting with model: ${primaryModelName}`);
        const model = genAI.getGenerativeModel({
            model: primaryModelName,
            generationConfig: isJsonMode ? { responseMimeType: "application/json" } : undefined
        });
        return await operation(model);
    } catch (error: any) {
        const message = getErrorMessage(error);

        if (primaryModelName === CORE_MODEL && isRetryableGeminiCoreError(error)) {
            markGeminiCoreFailure();
        }

        if (!fallbackModelName) {
            throw error;
        }

        console.warn(`[AI] ${primaryModelName} failed (${message}). Falling back to ${fallbackModelName}`);
        const fallbackModel = genAI.getGenerativeModel({
            model: fallbackModelName,
            generationConfig: isJsonMode ? { responseMimeType: "application/json" } : undefined
        });
        return await operation(fallbackModel);
    }
}

function buildGeminiContents(messages: Message[]) {
    return messages.map(msg => {
        const parts: any[] = [{ text: msg.content || "" }];

        if (msg.attachments?.length) {
            msg.attachments.forEach(att => {
                if (att.type === 'image' || att.type === 'pdf') {
                    const base64Data = att.content.includes('base64,')
                        ? att.content.split('base64,')[1]
                        : att.content;

                    parts.push({
                        inlineData: {
                            mimeType: att.mimeType,
                            data: base64Data
                        }
                    });
                } else if (att.type === 'text') {
                    parts.push({ text: `\n\n[Attached File: ${att.name}]\n${att.content}` });
                }
            });
        }

        return {
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts
        };
    });
}

type ClaudeTextBlock = { type: "text"; text: string };
type ClaudeImageBlock = {
    type: "image";
    source: {
        type: "base64";
        media_type: string;
        data: string;
    };
};
type ClaudeContentBlock = ClaudeTextBlock | ClaudeImageBlock;

function buildClaudeContent(message: Message): ClaudeContentBlock[] {
    const blocks: ClaudeContentBlock[] = [];

    if (message.content?.trim()) {
        blocks.push({ type: "text", text: message.content });
    }

    for (const attachment of message.attachments || []) {
        if (attachment.type === "image" && attachment.mimeType?.startsWith("image/")) {
            const base64Data = attachment.content.includes("base64,")
                ? attachment.content.split("base64,")[1]
                : attachment.content;
            blocks.push({
                type: "image",
                source: {
                    type: "base64",
                    media_type: attachment.mimeType,
                    data: base64Data
                }
            });
            continue;
        }

        if (attachment.type === "text") {
            blocks.push({
                type: "text",
                text: `\n\n[Attached File: ${attachment.name}]\n${attachment.content}`
            });
            continue;
        }

        blocks.push({
            type: "text",
            text: `\n\n[Attachment omitted in Claude mode: ${attachment.name} (${attachment.mimeType})]`
        });
    }

    if (blocks.length === 0) {
        blocks.push({ type: "text", text: "" });
    }

    return blocks;
}

function buildClaudeMessages(messages: Message[]) {
    return messages.map((msg) => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: buildClaudeContent(msg)
    }));
}

function parseClaudeTextResponse(payload: unknown): string {
    if (!payload || typeof payload !== "object") return "";
    const content = (payload as { content?: Array<{ type?: string; text?: string }> }).content;
    if (!Array.isArray(content)) return "";
    return content
        .filter((block) => block?.type === "text" && typeof block.text === "string")
        .map((block) => block.text || "")
        .join("");
}

async function generateTextWithClaude(
    prompt: string,
    options: { jsonMode?: boolean } = {}
) {
    if (!CLAUDE_API_KEY) {
        throw new Error("CLAUDE_API_KEY (or ANTHROPIC_API_KEY) is missing.");
    }

    const finalPrompt = options.jsonMode
        ? `${prompt}\n\nIMPORTANT: Return ONLY valid JSON. No markdown, no commentary.`
        : prompt;

    const response = await fetch(`${CLAUDE_API_BASE_URL}/v1/messages`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-api-key": CLAUDE_API_KEY,
            "anthropic-version": CLAUDE_API_VERSION
        },
        body: JSON.stringify({
            model: CLAUDE_MODEL,
            max_tokens: Number.isFinite(CLAUDE_MAX_TOKENS) ? CLAUDE_MAX_TOKENS : 8192,
            messages: [
                {
                    role: "user",
                    content: [{ type: "text", text: finalPrompt }]
                }
            ]
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`[Claude] ${response.status}: ${clipErrorText(errorBody)}`);
    }

    const payload = await response.json();
    const text = parseClaudeTextResponse(payload);
    if (!text) {
        throw new Error("[Claude] Empty response text.");
    }
    return text;
}

function parseClaudeSseChunk(rawEvent: string) {
    const dataLines = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());

    if (!dataLines.length) return { text: "", error: "" };

    const rawData = dataLines.join("\n");
    if (!rawData || rawData === "[DONE]") return { text: "", error: "" };

    try {
        const payload = JSON.parse(rawData) as {
            type?: string;
            delta?: { type?: string; text?: string };
            error?: { message?: string };
        };

        if (payload.type === "content_block_delta" && payload.delta?.type === "text_delta") {
            return { text: payload.delta.text || "", error: "" };
        }

        if (payload.type === "error") {
            return { text: "", error: payload.error?.message || "Claude stream error." };
        }
    } catch {
        return { text: "", error: "" };
    }

    return { text: "", error: "" };
}

async function* streamWithClaude(messages: Message[], systemInstructionText: string) {
    if (!CLAUDE_API_KEY) {
        throw new Error("CLAUDE_API_KEY (or ANTHROPIC_API_KEY) is missing.");
    }

    const response = await fetch(`${CLAUDE_API_BASE_URL}/v1/messages`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-api-key": CLAUDE_API_KEY,
            "anthropic-version": CLAUDE_API_VERSION
        },
        body: JSON.stringify({
            model: CLAUDE_MODEL,
            max_tokens: Number.isFinite(CLAUDE_MAX_TOKENS) ? CLAUDE_MAX_TOKENS : 8192,
            stream: true,
            system: systemInstructionText,
            messages: buildClaudeMessages(messages)
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`[Claude] ${response.status}: ${clipErrorText(errorBody)}`);
    }

    if (!response.body) {
        throw new Error("[Claude] Empty streaming body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const rawEvent of events) {
            const parsed = parseClaudeSseChunk(rawEvent);
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text) yield parsed.text;
        }
    }

    if (buffer.trim()) {
        const parsed = parseClaudeSseChunk(buffer);
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.text) yield parsed.text;
    }
}

async function* streamWithGemini(
    messages: Message[],
    systemInstructionText: string,
    preferBackupModel: boolean = false
) {
    const contents = buildGeminiContents(messages);
    const openStream = async (modelName: string) => {
        const chatModel = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: systemInstructionText
        });
        return await chatModel.generateContentStream({ contents });
    };

    const openWithRetries = async (modelName: string) => {
        const maxAttempts = GEMINI_STREAM_OPEN_MAX_ATTEMPTS;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                return await openStream(modelName);
            } catch (error) {
                const retryable = isRetryableGeminiCoreError(error);
                const isLastAttempt = attempt >= maxAttempts - 1;
                const message = getErrorMessage(error);

                if (!retryable || isLastAttempt) {
                    throw error;
                }

                const backoffMs = GEMINI_STREAM_RETRY_BASE_MS * (attempt + 1);
                console.warn(
                    `[AI] ${modelName} stream transient failure. Retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxAttempts}): ${message}`
                );
                await sleep(backoffMs);
            }
        }

        throw new Error(`[AI] ${modelName} stream failed after retries.`);
    };

    const useBackupFirst = preferBackupModel || shouldSkipGeminiCore();
    const modelCandidates = useBackupFirst
        ? [BACKUP_MODEL, CORE_MODEL]
        : [CORE_MODEL, BACKUP_MODEL];

    let streamResult: Awaited<ReturnType<typeof openStream>> | null = null;

    for (let i = 0; i < modelCandidates.length; i++) {
        const modelName = modelCandidates[i];
        try {
            streamResult = await openWithRetries(modelName);
            break;
        } catch (error) {
            const message = getErrorMessage(error);
            const retryable = isRetryableGeminiCoreError(error);

            if (modelName === CORE_MODEL && retryable) {
                markGeminiCoreFailure();
            }

            const fallbackModel = modelCandidates[i + 1];
            if (!fallbackModel) {
                throw error;
            }

            console.warn(`[AI] ${modelName} stream failed (${message}). Falling back to ${fallbackModel}`);
        }
    }

    if (!streamResult) {
        throw new Error("[AI] Failed to initialize Gemini stream.");
    }

    for await (const chunk of streamResult.stream) {
        const chunkText = chunk.text();
        if (chunkText) yield chunkText;
    }
}

async function generateModelText(prompt: string, isJsonMode: boolean = false) {
    if (isClaudeProvider() && !shouldSkipClaude()) {
        const maxClaudeAttempts = 2;
        for (let attempt = 0; attempt < maxClaudeAttempts; attempt++) {
            try {
                return await generateTextWithClaude(prompt, { jsonMode: isJsonMode });
            } catch (error) {
                const retryable = isRetryableClaudeStreamError(error);
                const isLastAttempt = attempt >= maxClaudeAttempts - 1;
                const message = getErrorMessage(error);

                if (retryable && !isLastAttempt) {
                    const backoffMs = 350 * (attempt + 1);
                    console.warn(
                        `[AI] Claude request transient failure. Retrying in ${backoffMs}ms: ${message}`
                    );
                    await sleep(backoffMs);
                    continue;
                }

                if (retryable) {
                    markClaudeFailure();
                }

                if (retryable && hasGeminiKey()) {
                    console.warn(`[AI] Claude request unavailable. Falling back to Gemini: ${message}`);
                    break;
                }

                throw error;
            }
        }
    }

    const result = await withFallback(async (model) => {
        return await model.generateContent(prompt);
    }, isJsonMode);

    return result.response.text();
}

/**
 * 1. Evaluate Input (Chat) - Streaming Version
 * Used for the real-time chat interface.
 */
type EvaluateRuntimeOptions = {
    generationReady?: boolean;
    preferBackupModel?: boolean;
    designMemory?: string;
    diagramPolicy?: string;
};

export async function* streamEvaluateInput(
    messages: Message[],
    context?: string,
    options?: EvaluateRuntimeOptions
) {
    const maxContextChars = 12000;
    const maxDesignMemoryChars = 14000;
    const defaultDiagramPolicy = "incremental_manual_review_v1";
    const safeContext = typeof context === "string" && context.trim()
        ? context.trim().slice(0, maxContextChars)
        : "";
    const safeDesignMemory = typeof options?.designMemory === "string" && options.designMemory.trim()
        ? options.designMemory.trim().slice(0, maxDesignMemoryChars)
        : "";
    const normalizedDiagramPolicy = options?.diagramPolicy === defaultDiagramPolicy
        ? options.diagramPolicy
        : defaultDiagramPolicy;
    const structureBlock = safeContext
        ? `\n\n# Existing Project Structure (Context)\n${safeContext}\n\n# Guidance\n- Use the structure above as the current source of truth for existing features.\n- If the user asks about functionality, infer from file specs before asking new questions.`
        : "";
    const designMemoryBlock = safeDesignMemory
        ? `\n\n# Persistent Design Memory\n${safeDesignMemory}`
        : "";
    const diagramStabilityBlock = `\n\n# Diagram Stability Contract (${normalizedDiagramPolicy})\n- Baseline architecture diagram is the source of truth.\n- Only propose minimal incremental changes; do not rewrite the full diagram unless user explicitly requests a structural redesign.\n- If the latest user input does not impact architecture, keep the diagram logically unchanged.\n- Reuse existing node names and existing edges whenever possible.\n- Avoid cosmetic-only rewrites and avoid reordering nodes without functional impact.\n- Always output <diagram>, but keep it stable and continuity-preserving.`;

    const coachModeBlock = options?.generationReady
        ? `\n\n# Runtime Mode\nScaffold already exists. Prioritize implementation coaching with phased execution and include <options> for next action buttons.`
        : "";

    const systemInstructionText = `${CTO_SYSTEM_PROMPT}${structureBlock}${designMemoryBlock}${diagramStabilityBlock}${coachModeBlock}\n\nAnalyze the latest user message and conversation history. Respond in the required XML format.`;

    try {
        let shouldUseGeminiStream = !isClaudeProvider() || shouldSkipClaude();

        if (isClaudeProvider()) {
            const maxClaudeAttempts = 2;
            for (let attempt = 0; attempt < maxClaudeAttempts; attempt++) {
                let emittedAnyChunk = false;
                try {
                    for await (const chunk of streamWithClaude(messages, systemInstructionText)) {
                        if (!chunk) continue;
                        emittedAnyChunk = true;
                        yield chunk;
                    }
                    return;
                } catch (error) {
                    const retryable = isRetryableClaudeStreamError(error);
                    const isLastAttempt = attempt >= maxClaudeAttempts - 1;
                    const message = getErrorMessage(error);

                    if (!emittedAnyChunk && retryable && !isLastAttempt) {
                        const backoffMs = 350 * (attempt + 1);
                        console.warn(
                            `[AI] Claude stream transient failure. Retrying in ${backoffMs}ms: ${message}`
                        );
                        await sleep(backoffMs);
                        continue;
                    }

                    if (!emittedAnyChunk && retryable) {
                        markClaudeFailure();
                    }

                    if (!emittedAnyChunk && retryable && hasGeminiKey()) {
                        console.warn(`[AI] Claude stream unavailable. Falling back to Gemini: ${message}`);
                        shouldUseGeminiStream = true;
                        break;
                    }

                    if (!emittedAnyChunk && retryable) {
                        yield "<question>AI provider timeout. Please try again in a moment.</question>";
                        return;
                    }

                    throw error;
                }
            }
        }

        if (shouldUseGeminiStream) {
            for await (const chunk of streamWithGemini(
                messages,
                systemInstructionText,
                options?.preferBackupModel === true
            )) {
                if (chunk) yield chunk;
            }
        }
    } catch (error) {
        console.error("[AI] Stream Error:", error);
        throw error;
    }
}

/**
 * 2. Evaluate Input (Chat) - Static Version
 * Kept for compatibility.
 */
export async function evaluateInput() {
    return {
        // ... return mock or implement static call
        density_score: 0,
        is_ready: false,
        analysis: { clarified: [], missing: [] },
        next_step: { question: "System update... please use streaming." }
    };
}


/**
 * 3. Generate Project Resources (The Scaffold)
 * Used when the user clicks "Generate".
 * This expects a JSON response.
 */
type GenerateProjectResourcesOptions = {
    projectName?: string;
    outputLanguage?: OutputLanguage;
};

export async function generateProjectResources(
    history: string,
    diagram?: string,
    existingProjectTree?: any,
    options?: GenerateProjectResourcesOptions
) {
    const resolvedProjectName = (options?.projectName || "").trim();
    const resolvedOutputLanguage = resolveOutputLanguage(
        options?.outputLanguage,
        history,
        diagram,
        resolvedProjectName
    );

    let prompt = `${ARCHITECT_SYSTEM_PROMPT}\n\nFinalized Requirement Consensus:\n${history}\n\nApproved System Architecture (Mermaid):\n${diagram || "Not provided"}`;

    if (resolvedProjectName) {
        prompt += `\n\n# Project Name\n${resolvedProjectName}`;
    }


    if (existingProjectTree) {
        // Optimize the tree to prevent context overflow
        const { optimizedTree, truncatedFiles } = optimizeContext(existingProjectTree);

        prompt += `\n\n${MAINTENANCE_PROMPT_ADDITION}\n\n# EXISTING PROJECT STRUCTURE:\n${JSON.stringify(optimizedTree, null, 2)}`;

        if (truncatedFiles.length > 0) {
            prompt += `\n\n# NOTE: The following files were truncated to save space, but they exist: \n${truncatedFiles.join(", ")}`;
        }
    }

    prompt += `\n\nBased on the above, generate the Project Scaffold JSON.`;

    try {
        console.log("[AI] Generating Scaffold...");

        const text = await generateModelText(prompt, true);
        console.log("[AI] Scaffold Raw Response:", text.substring(0, 200) + "...");

        let data;
        try {
            data = parseJsonResponse(text);
        } catch {
            // Retry once with a stricter prompt to reduce JSON pollution
            console.warn("[AI] JSON parse failed. Retrying with strict JSON response...");
            const strictPrompt = `${prompt}\n\nIMPORTANT: Return ONLY valid JSON. No markdown, no commentary.`;
            const retryText = await generateModelText(strictPrompt, true);
            try {
                data = parseJsonResponse(retryText);
            } catch {
                console.warn("[AI] Strict JSON parse failed. Attempting JSON repair pass...");
                const repairedText = await generateModelText(buildJsonRepairPrompt(retryText), true);
                data = parseJsonResponse(repairedText);
            }
        }

        data = normalizeGenerationData(data);

        // --- Post-Processing (Consistency Check) ---
        data.toolStack = ensureDefaultToolStack(data.toolStack);

        // Ensure executable baseline config files exist
        data.projectTree = ensureCoreConfigFiles(
            data.projectTree,
            data.toolStack,
            history,
            resolvedProjectName || "generated-project",
            resolvedOutputLanguage
        );
        data.projectTree = enhanceProjectTreeSpecs(data.projectTree, data.toolStack);

        const generatedReadme = getFileContentByPath(data.projectTree, "README.md");
        const generatedImplementationPlan = getFileContentByPath(data.projectTree, "IMPLEMENTATION_PLAN.md");
        console.log(
            `[AI] Scaffold docs language=${resolvedOutputLanguage} readmeChars=${generatedReadme.length} implementationPlanChars=${generatedImplementationPlan.length}`
        );

        return data;

    } catch (error) {
        console.error("[AI] Scaffold Generation Error:", error);
        throw error;
    }
}

/**
 * Helper to prune file content for context optimization
 */
function optimizeContext(tree: any[]): { optimizedTree: any[], truncatedFiles: string[] } {
    const truncatedFiles: string[] = [];

    // Deep clone to avoid mutating original state
    const clone = JSON.parse(JSON.stringify(tree));

    // Check if clone is array (it should be for projectTree)
    const nodesToTraverse = Array.isArray(clone) ? clone : [clone];

    const traverse = (nodes: any[]) => {
        if (!nodes || !Array.isArray(nodes)) return;

        for (const node of nodes) {
            if (node.type === 'file' && node.content) {
                // 1. Truncate long files (e.g. > 20kb)
                if (node.content.length > 20000) {
                    node.content = `[CONTENT TRUNCATED: Original size ${node.content.length} bytes]`;
                    truncatedFiles.push(node.name);
                }

                // 2. Remove utility/lock files entirely from context prompt
                if (node.name.endsWith('.lock') || node.name.endsWith('.png') || node.name.endsWith('.ico') || node.name.endsWith('.svg')) {
                    node.content = `[BINARY/LOCK FILE OMITTED]`;
                    truncatedFiles.push(node.name);
                }
            }

            if (node.children) {
                traverse(node.children);
            }
        }
    };

    traverse(nodesToTraverse);
    return { optimizedTree: clone, truncatedFiles };
}

function parseJsonResponse(text: string) {
    if (!text) throw new Error("Empty model response");

    // 1) Direct parse
    try {
        return JSON.parse(text);
    } catch {
        // continue
    }

    // 2) Strip markdown code fences
    const cleanText = text.replace(/```json\n?|\n?```/g, "").trim();
    try {
        return JSON.parse(cleanText);
    } catch {
        // continue
    }

    // 3) Extract first top-level JSON object
    const extracted = extractFirstJsonObject(cleanText);
    if (!extracted) throw new Error("Unable to extract JSON object from response");
    return JSON.parse(extracted);
}

function buildJsonRepairPrompt(rawResponse: string) {
    const maxChars = 16000;
    const clipped = (rawResponse || "").slice(0, maxChars);

    return [
        "You are a JSON sanitizer.",
        "Convert the following content into ONE valid JSON object only.",
        "No markdown, no code fences, no explanation.",
        "Keep keys and values from source whenever possible.",
        "If source is unusable, return a minimal valid object with this schema:",
        '{ "projectTree": [], "toolStack": "", "isFinal": true }',
        "",
        "SOURCE:",
        clipped || "[EMPTY]"
    ].join("\n");
}

function normalizeGenerationData(input: any) {
    const safe = typeof input === "object" && input !== null ? input : {};

    if (!Array.isArray(safe.projectTree)) safe.projectTree = [];
    if (typeof safe.toolStack !== "string") safe.toolStack = "";

    return safe;
}

function extractFirstJsonObject(text: string) {
    let start = -1;
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (inString) {
            if (escape) {
                escape = false;
            } else if (ch === "\\") {
                escape = true;
            } else if (ch === "\"") {
                inString = false;
            }
            continue;
        }

        if (ch === "\"") {
            inString = true;
            continue;
        }

        if (ch === "{") {
            if (depth === 0) start = i;
            depth += 1;
        } else if (ch === "}") {
            depth -= 1;
            if (depth === 0 && start !== -1) {
                return text.slice(start, i + 1);
            }
        }
    }

    return null;
}

function ensureDefaultToolStack(toolStack: string | undefined) {
    if (toolStack && toolStack.trim().length > 0) return toolStack;
    return [
        "| Category | Tool | Why |",
        "| --- | --- | --- |",
        "| Framework | Next.js | Fullstack React with routing and API routes |",
        "| Styling | Tailwind CSS | Fast, consistent UI for non-designers |",
        "| State | Zustand | Simple global state management |",
        "| Forms | React Hook Form + Zod | Reliable forms with validation |",
        "| Data Fetching | SWR | Simple caching and revalidation |",
        "| Auth | Firebase Auth | Managed authentication with session support |",
        "| Database | Cloud Firestore | Scalable document database for app data |"
    ].join("\n");
}

function inferOutputLanguageFromText(text: string): OutputLanguage {
    const source = (text || "").trim();
    if (!source) return "en";

    const chineseChars = (source.match(/[\u3400-\u9fff]/g) || []).length;
    const latinChars = (source.match(/[A-Za-z]/g) || []).length;
    if (chineseChars >= 6) return "zh";
    if (chineseChars >= 2 && chineseChars / Math.max(1, chineseChars + latinChars) >= 0.08) return "zh";
    return "en";
}

function resolveOutputLanguage(
    explicit: OutputLanguage | undefined,
    ...texts: Array<string | undefined>
): OutputLanguage {
    if (explicit === "zh" || explicit === "en") return explicit;

    const merged = texts.filter((item): item is string => typeof item === "string" && item.trim().length > 0).join("\n");
    return inferOutputLanguageFromText(merged);
}

function collectProjectTreeText(projectTree: any[]) {
    if (!Array.isArray(projectTree) || projectTree.length === 0) return "";

    const chunks: string[] = [];
    const walk = (nodes: any[], path: string) => {
        for (const node of nodes || []) {
            if (!node || typeof node !== "object") continue;
            const name = typeof node.name === "string" ? node.name : "";
            const nextPath = path ? `${path}/${name}` : name;

            if (name) {
                chunks.push(nextPath);
            }

            if (node.type === "file" && typeof node.content === "string" && node.content.trim()) {
                chunks.push(node.content);
            }

            if (Array.isArray(node.children) && node.children.length > 0) {
                walk(node.children, nextPath);
            }
        }
    };

    walk(projectTree, "");
    return chunks.join("\n");
}

function ensureCoreConfigFiles(
    projectTree: any[],
    toolStack: string,
    history: string,
    projectName: string,
    outputLanguage: OutputLanguage
): any[] {
    const tree = Array.isArray(projectTree) ? projectTree : [];
    const existingNames = new Set<string>();

    const collectNames = (nodes: any[]) => {
        for (const node of nodes) {
            if (node?.name) existingNames.add(node.name);
            if (node?.children) collectNames(node.children);
        }
    };

    collectNames(tree);

    const treeText = collectProjectTreeText(tree);
    const context = `${toolStack || ""}\n${history || ""}\n${treeText}`;
    const usesNext = /next\.js|nextjs|\bnext\b/i.test(context) || existingNames.has("next.config.ts");
    const usesPhaser = /phaser/i.test(context);

    const coreFiles: { name: string; content: string }[] = [];

    if (!existingNames.has("package.json")) {
        coreFiles.push({
            name: "package.json",
            content: generatePackageJson({
                framework: usesNext ? "next" : "react",
                usesPhaser,
                projectName,
                toolStack,
                analysisText: `${history || ""}\n${treeText}`
            })
        });
    }

    if (!existingNames.has("tsconfig.json")) {
        coreFiles.push({
            name: "tsconfig.json",
            content: generateTsconfig({ framework: usesNext ? "next" : "react" })
        });
    }

    if (usesNext && !existingNames.has("next.config.ts")) {
        coreFiles.push({
            name: "next.config.ts",
            content: generateNextConfig({ usesPhaser })
        });
    }

    const finalTree = coreFiles.length > 0
        ? [
            ...coreFiles.map(f => ({
                name: f.name,
                type: "file",
                content: f.content
            })),
            ...tree
        ]
        : tree;

    const structuredReadme = ensureStructuredReadmeQuality(
        buildStructuredReadme({
            outputLanguage,
            projectName,
            toolStack,
            history,
            tree: finalTree
        }),
        {
            outputLanguage,
            projectName,
            toolStack,
            history,
            tree: finalTree
        }
    );
    const implementationPlan = buildImplementationPlan({
        outputLanguage,
        projectName,
        tree: finalTree
    });

    upsertFileByPath(finalTree, "README.md", structuredReadme);
    upsertFileByPath(finalTree, "IMPLEMENTATION_PLAN.md", implementationPlan);
    return finalTree;
}

function generatePackageJson(input: {
    framework: "next" | "react";
    usesPhaser: boolean;
    projectName: string;
    toolStack?: string;
    analysisText?: string;
}) {
    const stack = `${input.toolStack || ""}\n${input.analysisText || ""}`.toLowerCase();
    const usesTailwind = /tailwind/.test(stack);
    const usesZustand = /zustand/.test(stack);
    const usesLucide = /lucide|icon/.test(stack);
    const usesThree = /\bthree\.?js\b|\bthree\b/.test(stack);
    const usesPixi = /\bpixi\b/.test(stack);
    const usesReactQuery = /react\s*query|tanstack\s*query/.test(stack);
    const usesRedux = /redux/.test(stack);
    const usesReactHookForm = /react\s*hook\s*form/.test(stack);
    const usesZod = /\bzod\b/.test(stack);
    const usesSWR = /\bswr\b/.test(stack);
    const usesSupabase = /supabase|@supabase\/ssr|@supabase\/supabase-js/.test(stack);
    const usesVercelAiSdk = /vercel ai sdk|\bgenerateobject\b|\bfrom\s+["']ai["']|@ai-sdk\/openai/.test(stack);
    const usesOpenAiSdk = /openai|@ai-sdk\/openai/.test(stack);
    const usesShadcn = /shadcn|radix|class-variance-authority|tailwind-merge|clsx/.test(stack);
    const usesDateFns = /date-fns|date range|calendar/.test(stack);

    const extraDeps: Record<string, string> = {};
    if (input.usesPhaser) extraDeps["phaser"] = "^3.80.1";
    if (usesZustand) extraDeps["zustand"] = "^4.5.2";
    if (usesLucide) extraDeps["lucide-react"] = "^0.263.1";
    if (usesThree) extraDeps["three"] = "^0.161.0";
    if (usesPixi) extraDeps["pixi.js"] = "^8.4.0";
    if (usesReactQuery) extraDeps["@tanstack/react-query"] = "^5.45.0";
    if (usesRedux) extraDeps["@reduxjs/toolkit"] = "^2.2.5";
    if (usesRedux) extraDeps["react-redux"] = "^9.1.2";
    if (usesReactHookForm) extraDeps["react-hook-form"] = "^7.52.1";
    if (usesReactHookForm && usesZod) extraDeps["@hookform/resolvers"] = "^3.9.0";
    if (usesZod) extraDeps["zod"] = "^3.23.8";
    if (usesSWR) extraDeps["swr"] = "^2.2.5";
    if (usesSupabase) extraDeps["@supabase/supabase-js"] = "^2.49.1";
    if (usesSupabase) extraDeps["@supabase/ssr"] = "^0.5.2";
    if (usesVercelAiSdk) extraDeps["ai"] = "^4.3.16";
    if (usesOpenAiSdk) extraDeps["@ai-sdk/openai"] = "^1.3.22";
    if (usesShadcn) extraDeps["class-variance-authority"] = "^0.7.1";
    if (usesShadcn) extraDeps["clsx"] = "^2.1.1";
    if (usesShadcn) extraDeps["tailwind-merge"] = "^2.6.0";
    if (usesDateFns) extraDeps["date-fns"] = "^4.1.0";

    const base = {
        name: sanitizeProjectName(input.projectName || "generated-project"),
        version: "0.1.0",
        private: true,
        scripts: input.framework === "next"
            ? {
                dev: "next dev",
                build: "next build",
                start: "next start",
                lint: "next lint",
                "type-check": "tsc --noEmit"
            }
            : {
                dev: "vite",
                build: "vite build",
                preview: "vite preview"
            },
        dependencies: input.framework === "next"
            ? {
                next: "14.2.18",
                react: "^18.3.1",
                "react-dom": "^18.3.1",
                ...extraDeps
            }
            : {
                react: "^18.3.1",
                "react-dom": "^18.3.1",
                ...extraDeps
            },
        devDependencies: {
            typescript: "^5",
            "@types/node": "^20",
            "@types/react": "^18",
            "@types/react-dom": "^18",
            ...(usesTailwind ? { tailwindcss: "^3.4.1", postcss: "^8", autoprefixer: "^10.0.1" } : {})
        },
        engines: {
            node: ">=18.17.0",
            npm: ">=9.0.0"
        }
    };

    return JSON.stringify(base, null, 2);
}

function generateTsconfig(input: { framework: "next" | "react" }) {
    const config: any = {
        compilerOptions: {
            strict: true,
            noImplicitAny: true,
            strictNullChecks: true,
            strictFunctionTypes: true,
            noUnusedLocals: true,
            noUnusedParameters: true,
            module: "esnext",
            moduleResolution: "bundler",
            esModuleInterop: true,
            noEmit: true,
            jsx: "preserve",
            lib: ["dom", "dom.iterable", "esnext"]
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
        exclude: ["node_modules"]
    };

    if (input.framework === "next") {
        config.compilerOptions.paths = {
            "@/*": ["./*"],
            "@/components/*": ["./components/*"],
            "@/lib/*": ["./lib/*"]
        };
        config.compilerOptions.plugins = [{ name: "next" }];
    }

    return JSON.stringify(config, null, 2);
}

function generateNextConfig(input: { usesPhaser: boolean }) {
    const lines: string[] = [];
    lines.push(`import type { NextConfig } from "next";`);
    lines.push("");
    lines.push("const nextConfig: NextConfig = {");
    lines.push("  reactStrictMode: true,");
    if (input.usesPhaser) {
        lines.push("  webpack: (config) => {");
        lines.push("    config.resolve.alias = {");
        lines.push("      ...config.resolve.alias,");
        lines.push("      '@': __dirname,");
        lines.push("    };");
        lines.push("    return config;");
        lines.push("  },");
    }
    lines.push("};");
    lines.push("");
    lines.push("export default nextConfig;");
    lines.push("");
    return lines.join("\n");
}

function sanitizeProjectName(name: string) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "") || "generated-project";
}

function upsertFileByPath(tree: any[], filePath: string, content: string) {
    const segments = filePath.split("/").filter(Boolean);
    if (segments.length === 0) return;

    let current = tree;
    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const isFile = i === segments.length - 1;

        if (isFile) {
            const existing = current.find((n: any) => n.name === segment && n.type === "file");
            if (existing) {
                existing.content = content;
            } else {
                current.push({ name: segment, type: "file", content });
            }
        } else {
            let folder = current.find((n: any) => n.name === segment && n.type === "folder");
            if (!folder) {
                folder = { name: segment, type: "folder", children: [] };
                current.push(folder);
            }
            if (!folder.children) folder.children = [];
            current = folder.children;
        }
    }
}

function getFileContentByPath(tree: any[], filePath: string): string {
    const segments = filePath.split("/").filter(Boolean);
    if (segments.length === 0) return "";

    let current = tree;
    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const isFile = i === segments.length - 1;
        const node = current.find((item: any) => item?.name === segment);
        if (!node) return "";

        if (isFile) {
            if (node.type === "file" && typeof node.content === "string") return node.content;
            return "";
        }

        if (node.type !== "folder" || !Array.isArray(node.children)) return "";
        current = node.children;
    }

    return "";
}

function collectFilePathsFromTree(tree: any[]): string[] {
    const paths: string[] = [];
    const walk = (nodes: any[], prefix: string) => {
        for (const node of nodes || []) {
            if (!node || typeof node !== "object" || typeof node.name !== "string") continue;
            const filePath = prefix ? `${prefix}/${node.name}` : node.name;
            if (node.type === "file") {
                paths.push(filePath);
                continue;
            }
            if (node.type === "folder" && Array.isArray(node.children)) {
                walk(node.children, filePath);
            }
        }
    };

    walk(tree, "");
    return paths.sort((a, b) => a.localeCompare(b));
}

function extractUserIntentLines(history: string, outputLanguage: OutputLanguage) {
    const lines = history
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const userLines = lines
        .filter((line) => /^user:/i.test(line))
        .map((line) => line.replace(/^user:\s*/i, ""))
        .filter((line) => line.length > 0);

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const line of userLines) {
        const normalized = line.replace(/\s+/g, " ").trim().toLowerCase();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        deduped.push(line.replace(/\s+/g, " ").trim());
        if (deduped.length >= 5) break;
    }

    if (deduped.length > 0) return deduped;
    return outputLanguage === "zh"
        ? ["待补充：请在后续会话中细化核心业务目标与关键流程。"]
        : ["TBD: clarify core business goal and user flow in follow-up prompts."];
}

function buildStructuredReadme(input: {
    outputLanguage: OutputLanguage;
    projectName: string;
    toolStack: string;
    history: string;
    tree: any[];
}) {
    const projectName = input.projectName || "generated-project";
    const filePaths = collectFilePathsFromTree(input.tree);
    const topLevelEntries = Array.from(new Set(filePaths.map((path) => path.split("/")[0]))).slice(0, 20);
    const scopedPaths = filePaths.slice(0, 40);
    const intents = extractUserIntentLines(input.history, input.outputLanguage);

    if (input.outputLanguage === "zh") {
        const lines: string[] = [];
        lines.push(`# ${projectName} 开发指南`);
        lines.push("");
        lines.push("## 项目概述");
        lines.push(`该项目由 Forecoding 生成，目标是为 **${projectName}** 提供可执行的脚手架规范与实现顺序。`);
        lines.push("README 作为团队与 AI IDE 的统一入口，重点说明业务目标、运行方式、环境变量、验收标准，以及开发推进顺序。");
        lines.push("");
        lines.push("## 目标用户与业务目标");
        lines.push("- 目标用户：业务负责人、产品经理、工程师、AI IDE 协作开发者。");
        lines.push("- 核心目标：将需求讨论内容稳定转化为可执行实现计划，降低“开始写代码前的不确定性”。");
        lines.push("- 本次会话提炼要点：");
        intents.forEach((line) => lines.push(`  - ${line}`));
        lines.push("");
        lines.push("## 技术栈");
        lines.push("以下技术栈由生成阶段输出，可作为默认参考：");
        lines.push("");
        lines.push(input.toolStack || "- 暂无明确技术栈，建议先在 `IMPLEMENTATION_PLAN.md` 的 Phase 0 完成基线选型。");
        lines.push("");
        lines.push("## 项目结构");
        lines.push("当前脚手架包含的主要目录/文件：");
        topLevelEntries.forEach((entry) => lines.push(`- \`${entry}\``));
        lines.push("");
        lines.push("关键路径（节选）：");
        scopedPaths.forEach((path) => lines.push(`- \`${path}\``));
        lines.push("");
        lines.push("## 快速开始");
        lines.push("### 1) 安装依赖");
        lines.push("```bash");
        lines.push("npm install");
        lines.push("```");
        lines.push("");
        lines.push("### 2) 本地运行");
        lines.push("```bash");
        lines.push("npm run dev");
        lines.push("```");
        lines.push("");
        lines.push("### 3) 构建与启动");
        lines.push("```bash");
        lines.push("npm run build");
        lines.push("npm run start");
        lines.push("```");
        lines.push("");
        lines.push("## 环境变量");
        lines.push("- 建议从 `.env.example` 复制到 `.env.local` 后再启动。");
        lines.push("- 所有密钥仅用于服务端，不要提交到仓库。");
        lines.push("- 按环境（dev/staging/prod）分离配置，避免跨环境污染。");
        lines.push("");
        lines.push("## 开发流程");
        lines.push("- **必须先阅读** `IMPLEMENTATION_PLAN.md`。");
        lines.push("- 严格按 Phase 0 -> Phase 6 依次推进，避免跳步导致返工。");
        lines.push("- 每完成一个 Phase，先执行验证命令，再进入下个 Phase。");
        lines.push("- 对于 ZIP 中的占位文件，请在 AI IDE 中根据 `_AI_PROMPT.md` 和 `IMPLEMENTATION_PLAN.md` 生成实现内容。");
        lines.push("");
        lines.push("## 验收清单");
        lines.push("- [ ] 项目可安装并成功启动。");
        lines.push("- [ ] Phase 0~6 的输出物均已完成并通过验证。");
        lines.push("- [ ] 关键页面和 API 行为与需求一致。");
        lines.push("- [ ] README、IMPLEMENTATION_PLAN 与代码实现保持一致。");
        lines.push("- [ ] 无敏感信息泄露（尤其是 `.env` 与密钥）。");
        lines.push("");
        lines.push("## 常见问题");
        lines.push("### 1) 为什么 ZIP 中有些文件是占位内容？");
        lines.push("这是 Forecoding 的规范驱动策略：关键配置与文档直接可用，其余由 AI IDE 按阶段生成，以减少一次性输出错误代码的风险。");
        lines.push("");
        lines.push("### 2) 先改哪个文件？");
        lines.push("不要按目录直觉修改，必须按 `IMPLEMENTATION_PLAN.md` 的 Phase 顺序执行。");
        lines.push("");
        lines.push("### 3) README 与实现不一致怎么办？");
        lines.push("以当前需求为准更新 README 和 IMPLEMENTATION_PLAN，再同步代码实现，保持三者一致。");
        lines.push("");
        lines.push("### 4) 如何保证交付质量？");
        lines.push("每个阶段执行对应验证命令，并在合并前完成手工回归检查。");
        lines.push("");
        return lines.join("\n");
    }

    const lines: string[] = [];
    lines.push(`# ${projectName} Development Guide`);
    lines.push("");
    lines.push("## Project Overview");
    lines.push(`This project is generated by Forecoding to provide an execution-ready scaffold for **${projectName}**.`);
    lines.push("This README is the single onboarding entry for engineers and AI IDE agents, covering business goals, runtime setup, environment variables, acceptance standards, and delivery flow.");
    lines.push("");
    lines.push("## Target Users & Business Goals");
    lines.push("- Primary users: product owners, engineers, and AI IDE-assisted builders.");
    lines.push("- Core objective: transform requirement discussions into a deterministic implementation workflow.");
    lines.push("- Key signals extracted from this conversation:");
    intents.forEach((line) => lines.push(`  - ${line}`));
    lines.push("");
    lines.push("## Tech Stack");
    lines.push("The following stack was generated as baseline context:");
    lines.push("");
    lines.push(input.toolStack || "- No explicit stack generated yet. Finalize baseline choices in `IMPLEMENTATION_PLAN.md` Phase 0.");
    lines.push("");
    lines.push("## Project Structure");
    lines.push("Main directories/files currently in scaffold:");
    topLevelEntries.forEach((entry) => lines.push(`- \`${entry}\``));
    lines.push("");
    lines.push("Key paths (sample):");
    scopedPaths.forEach((path) => lines.push(`- \`${path}\``));
    lines.push("");
    lines.push("## Quick Start");
    lines.push("### 1) Install dependencies");
    lines.push("```bash");
    lines.push("npm install");
    lines.push("```");
    lines.push("");
    lines.push("### 2) Run locally");
    lines.push("```bash");
    lines.push("npm run dev");
    lines.push("```");
    lines.push("");
    lines.push("### 3) Build and start");
    lines.push("```bash");
    lines.push("npm run build");
    lines.push("npm run start");
    lines.push("```");
    lines.push("");
    lines.push("## Environment Variables");
    lines.push("- Copy `.env.example` to `.env.local` before local execution.");
    lines.push("- Keep secrets server-side only.");
    lines.push("- Split config by environment (dev/staging/prod).");
    lines.push("");
    lines.push("## Development Workflow");
    lines.push("- **Read `IMPLEMENTATION_PLAN.md` first.**");
    lines.push("- Execute phases strictly in order (Phase 0 -> Phase 6).");
    lines.push("- Run validation commands at each phase before moving on.");
    lines.push("- For placeholder files in ZIP, generate final code in AI IDE using `_AI_PROMPT.md` + `IMPLEMENTATION_PLAN.md`.");
    lines.push("");
    lines.push("## Acceptance Checklist");
    lines.push("- [ ] Project installs and starts successfully.");
    lines.push("- [ ] Outputs for Phase 0~6 are completed and validated.");
    lines.push("- [ ] Key pages/APIs match requirement intent.");
    lines.push("- [ ] README, IMPLEMENTATION_PLAN, and implementation stay aligned.");
    lines.push("- [ ] No secret leakage in repository.");
    lines.push("");
    lines.push("## FAQ");
    lines.push("### 1) Why are some ZIP files placeholders?");
    lines.push("Forecoding intentionally ships runnable baseline + high-quality specs, then lets AI IDE complete feature code by phase to reduce one-shot generation drift.");
    lines.push("");
    lines.push("### 2) What should I implement first?");
    lines.push("Do not follow raw directory order. Always follow `IMPLEMENTATION_PLAN.md` phase order.");
    lines.push("");
    lines.push("### 3) What if docs and code drift?");
    lines.push("Update README + IMPLEMENTATION_PLAN first, then align implementation.");
    lines.push("");
    lines.push("### 4) How do we keep delivery quality stable?");
    lines.push("Run phase-level validation commands and complete manual QA before merge.");
    lines.push("");
    return lines.join("\n");
}

function validateStructuredReadme(readme: string, outputLanguage: OutputLanguage) {
    if (readme.trim().length < 900) return false;
    const requiredHeadings = outputLanguage === "zh"
        ? ["## 项目概述", "## 目标用户与业务目标", "## 技术栈", "## 项目结构", "## 快速开始", "## 环境变量", "## 开发流程", "## 验收清单", "## 常见问题"]
        : ["## Project Overview", "## Target Users & Business Goals", "## Tech Stack", "## Project Structure", "## Quick Start", "## Environment Variables", "## Development Workflow", "## Acceptance Checklist", "## FAQ"];
    return requiredHeadings.every((heading) => readme.includes(heading));
}

function ensureStructuredReadmeQuality(
    readme: string,
    input: {
        outputLanguage: OutputLanguage;
        projectName: string;
        toolStack: string;
        history: string;
        tree: any[];
    }
) {
    if (validateStructuredReadme(readme, input.outputLanguage)) return readme;

    const rebuilt = buildStructuredReadme(input);
    if (validateStructuredReadme(rebuilt, input.outputLanguage)) return rebuilt;

    const supplement = input.outputLanguage === "zh"
        ? "\n## 附加说明\n- 若文档长度不足，请补充业务边界、失败场景、监控与回滚策略。\n- 每个 Phase 必须可验证、可回滚、可交接。\n"
        : "\n## Additional Guidance\n- If documentation is still short, expand business boundaries, failure modes, monitoring, and rollback instructions.\n- Every phase must be verifiable, reversible, and handoff-ready.\n";
    return `${rebuilt}\n${supplement}`;
}

function classifyImplementationPhase(filePath: string): number {
    const normalized = filePath.replace(/\\/g, "/");
    const bootstrapSet = new Set([
        "package.json",
        "tsconfig.json",
        "next.config.ts",
        ".env.example",
        "README.md",
        "IMPLEMENTATION_PLAN.md"
    ]);

    if (bootstrapSet.has(normalized)) return 0;
    if (normalized.startsWith("types/")) return 1;
    if (/\/(schema|model|entity|domain)\b/i.test(normalized)) return 1;
    if (normalized === "app/layout.tsx" || normalized === "app/layout.ts") return 3;
    if (normalized.startsWith("components/layout/")) return 3;
    if (normalized.startsWith("app/api/")) return 5;
    if (/^app\/.+\/page\.(tsx|ts|jsx|js)$/i.test(normalized) || normalized === "app/page.tsx") return 4;
    if (normalized.startsWith("components/")) return 4;
    if (normalized.startsWith("lib/") && /(store|service|utils|helper|core)/i.test(normalized)) return 2;
    if (normalized.startsWith("lib/")) return 2;
    if (normalized.startsWith("docs/")) return 6;
    return 4;
}

function readPackageScripts(tree: any[]) {
    const packageJsonRaw = getFileContentByPath(tree, "package.json");
    if (!packageJsonRaw) return {} as Record<string, string>;

    try {
        const parsed = JSON.parse(packageJsonRaw) as { scripts?: Record<string, string> };
        if (parsed && typeof parsed === "object" && parsed.scripts && typeof parsed.scripts === "object") {
            return parsed.scripts;
        }
    } catch {
        return {} as Record<string, string>;
    }

    return {} as Record<string, string>;
}

function buildPhaseValidationCommands(
    phaseIndex: number,
    scripts: Record<string, string>
) {
    const commands: string[] = [];
    const hasScript = (name: string) => typeof scripts[name] === "string" && scripts[name].trim().length > 0;
    const pushScript = (name: string, fallback: string) => {
        commands.push(hasScript(name) ? `npm run ${name}` : fallback);
    };

    if (phaseIndex === 0) {
        commands.push("npm install");
        pushScript("dev", "npm run dev");
        return commands;
    }

    if (phaseIndex >= 1 && phaseIndex <= 5) {
        pushScript("type-check", "npx tsc --noEmit");
        return commands;
    }

    pushScript("lint", "npx eslint .");
    pushScript("type-check", "npx tsc --noEmit");
    pushScript("build", "npm run build");
    return commands;
}

function buildImplementationPlan(input: {
    outputLanguage: OutputLanguage;
    projectName: string;
    tree: any[];
}) {
    const scripts = readPackageScripts(input.tree);
    const allFiles = collectFilePathsFromTree(input.tree);
    const phases = new Map<number, string[]>();
    for (let i = 0; i <= 6; i++) phases.set(i, []);

    for (const filePath of allFiles) {
        const phase = classifyImplementationPhase(filePath);
        phases.get(phase)?.push(filePath);
    }

    const sortedPhases = Array.from(phases.entries()).sort((a, b) => a[0] - b[0]);
    if (input.outputLanguage === "zh") {
        const phaseMeta = [
            { title: "Phase 0 - 启动与基线", goal: "建立可运行基线，确保安装、启动、配置文件完整。", output: "完成运行基线文档与配置，团队可启动项目。", done: "依赖安装通过，开发环境可启动，README 与计划文件可读。" },
            { title: "Phase 1 - 领域模型与类型", goal: "先定义业务对象、类型边界和数据契约，避免后续返工。", output: "类型与领域模型稳定，供后续状态层与页面复用。", done: "关键类型可覆盖核心业务语义，类型检查通过。" },
            { title: "Phase 2 - 状态管理与核心逻辑", goal: "实现核心业务逻辑与状态流转，形成功能主干。", output: "状态层/服务层具备可调用能力。", done: "核心流程可在本地最小验证。"},
            { title: "Phase 3 - 应用壳层与共享布局", goal: "完善应用外壳和通用布局，统一导航与视觉骨架。", output: "可复用壳层和布局组件。", done: "页面基础布局稳定，可承载业务页面。"},
            { title: "Phase 4 - 功能页面与界面交互", goal: "实现业务页面与组件交互，打通用户侧操作路径。", output: "主要页面具备交互闭环。", done: "关键用户流程可端到端操作。"},
            { title: "Phase 5 - API 与集成层", goal: "实现服务端接口与外部集成，连接前后端数据流。", output: "API 契约可用，集成边界明确。", done: "前后端对接成功，接口返回稳定。"},
            { title: "Phase 6 - 验证与交付", goal: "执行静态检查、构建验证与人工回归，形成可交付状态。", output: "最终交付包与文档一致。", done: "lint/type-check/build 通过，关键场景回归完成。"}
        ];

        const lines: string[] = [];
        lines.push(`# ${input.projectName || "generated-project"} 实施执行计划`);
        lines.push("");
        lines.push("> 本文件定义 AI IDE 的唯一执行顺序。请严格按 Phase 0 -> Phase 6 执行，不要按目录遍历顺序直接实现。");
        lines.push("");

        for (const [phaseIndex, files] of sortedPhases) {
            const meta = phaseMeta[phaseIndex];
            const commands = buildPhaseValidationCommands(phaseIndex, scripts);
            lines.push(`## ${meta.title}`);
            lines.push("");
            lines.push("### 目标");
            lines.push(meta.goal);
            lines.push("");
            lines.push("### 输入文件");
            if (files.length === 0) {
                lines.push("- （无）");
            } else {
                files.forEach((file) => lines.push(`- \`${file}\``));
            }
            lines.push("");
            lines.push("### 输出定义");
            lines.push(meta.output);
            lines.push("");
            lines.push("### 完成条件");
            lines.push(`- ${meta.done}`);
            lines.push("");
            lines.push("### 验证命令");
            lines.push("```bash");
            commands.forEach((cmd) => lines.push(cmd));
            lines.push("```");
            lines.push("");
        }

        lines.push("## 交接要求");
        lines.push("- 每个 Phase 完成后更新 README 与实现状态。");
        lines.push("- 若需求发生变化，先更新计划，再更新代码。");
        lines.push("- 提交前确保验证命令全部通过。");
        lines.push("");
        return lines.join("\n");
    }

    const phaseMeta = [
        { title: "Phase 0 - Bootstrap", goal: "Establish runnable baseline, configs, and onboarding docs.", output: "Runnable baseline with setup documentation.", done: "Dependencies install, app starts, docs are available." },
        { title: "Phase 1 - Domain & Types", goal: "Define domain objects and type contracts before implementation.", output: "Stable type boundaries for feature work.", done: "Type contracts cover key business entities." },
        { title: "Phase 2 - State & Core Logic", goal: "Implement state transitions and core business logic.", output: "Callable core logic/state layer.", done: "Core flow is minimally executable locally." },
        { title: "Phase 3 - App Shell & Shared UI", goal: "Set up shared shell/layout and reusable structure.", output: "Stable layout and shared shell components.", done: "Pages can mount on consistent layout." },
        { title: "Phase 4 - Feature UI & Pages", goal: "Implement user-facing pages and component interactions.", output: "Feature pages with usable interaction loops.", done: "Primary user journeys are navigable end-to-end." },
        { title: "Phase 5 - API & Integration", goal: "Build backend routes and external integration boundaries.", output: "Usable API contracts and integration flow.", done: "Frontend/backed integration works stably." },
        { title: "Phase 6 - Validation & Handoff", goal: "Run static checks, build validation, and manual QA.", output: "Ship-ready handoff package.", done: "lint/type-check/build pass and key QA completed." }
    ];

    const lines: string[] = [];
    lines.push(`# ${input.projectName || "generated-project"} Implementation Plan`);
    lines.push("");
    lines.push("> This file is the single source of execution order for AI IDE. Follow Phase 0 -> Phase 6 strictly. Do not implement by raw directory order.");
    lines.push("");

    for (const [phaseIndex, files] of sortedPhases) {
        const meta = phaseMeta[phaseIndex];
        const commands = buildPhaseValidationCommands(phaseIndex, scripts);
        lines.push(`## ${meta.title}`);
        lines.push("");
        lines.push("### Goal");
        lines.push(meta.goal);
        lines.push("");
        lines.push("### Input Files");
        if (files.length === 0) {
            lines.push("- (none)");
        } else {
            files.forEach((file) => lines.push(`- \`${file}\``));
        }
        lines.push("");
        lines.push("### Expected Output");
        lines.push(meta.output);
        lines.push("");
        lines.push("### Done Criteria");
        lines.push(`- ${meta.done}`);
        lines.push("");
        lines.push("### Validation Commands");
        lines.push("```bash");
        commands.forEach((cmd) => lines.push(cmd));
        lines.push("```");
        lines.push("");
    }

    lines.push("## Handoff Requirements");
    lines.push("- Keep README and implementation status updated after each phase.");
    lines.push("- If requirements change, update plan first, then implementation.");
    lines.push("- Ensure all validation commands pass before merge.");
    lines.push("");
    return lines.join("\n");
}

function enhanceProjectTreeSpecs(projectTree: any[], toolStack: string): any[] {
    const stack = (toolStack || "").toLowerCase();
    const usesZod = /\bzod\b/.test(stack);

    const codeFilePattern = /\.(ts|tsx|js|jsx)$/i;

    const traverse = (nodes: any[], path: string) => {
        for (const node of nodes) {
            if (node.type === "folder" && node.children) {
                traverse(node.children, `${path}${node.name}/`);
                continue;
            }

            if (node.type !== "file" || !node.name) continue;
            const filePath = `${path}${node.name}`;
            if (!codeFilePattern.test(node.name)) continue;

            const existing = node.content || "";
            const qualitySection = buildQualitySection(filePath, { usesZod });
            const templateSection = buildTemplateSection(filePath, { usesZod });
            const antiPatternSection = buildAntiPatternSection(filePath);
            const goodBadSection = buildGoodBadSection(filePath);

            let appended = "";
            if (!/##\s+Quality Constraints/i.test(existing)) appended += qualitySection;
            if (!/##\s+Template Guidance/i.test(existing)) appended += templateSection;
            if (!/##\s+Anti-Patterns/i.test(existing)) appended += antiPatternSection;
            if (!/##\s+Good\s+vs\s+Bad\s+Examples/i.test(existing)) appended += goodBadSection;

            if (appended.trim().length > 0) {
                node.content = `${existing}\n\n${appended}`.trim();
            }
        }
    };

    traverse(projectTree, "");
    return projectTree;
}

function buildQualitySection(filePath: string, input: { usesZod: boolean }) {
    const lines: string[] = [];
    lines.push("## Quality Constraints");
    lines.push("- Type Safety: Avoid `any`; prefer strict types and interfaces.");
    lines.push("- Error Handling: Fail gracefully and return user-safe messages.");
    lines.push("- Performance: Avoid heavy work in render; memoize where needed.");

    if (filePath.includes("components/") || filePath.endsWith(".tsx")) {
        lines.push("- Accessibility: Ensure buttons/inputs have labels and focus states.");
    }

    if (filePath.includes("app/api/")) {
        lines.push("- API: Validate inputs and return typed JSON responses.");
        if (input.usesZod) {
            lines.push("- Validation: Use Zod schemas for request parsing.");
        }
    }

    return lines.join("\n");
}

function buildTemplateSection(filePath: string, input: { usesZod: boolean }) {
    const lines: string[] = [];
    lines.push("## Template Guidance");

    if (filePath.includes("components/")) {
        lines.push("- Component: functional component with typed props.");
        lines.push("- State: local state via `useState`, side effects via `useEffect`.");
        lines.push("- Styling: Tailwind utility classes where possible.");
    } else if (filePath.includes("app/api/")) {
        lines.push("- Handler: export `POST/GET` functions with `Request`/`NextResponse`.");
        if (input.usesZod) {
            lines.push("- Parse: `const body = schema.parse(await req.json())`.");
        }
    } else if (filePath.startsWith("lib/")) {
        lines.push("- Module: pure functions where possible; avoid side effects.");
        lines.push("- Exports: named exports with clear typing.");
    } else if (filePath.endsWith(".tsx")) {
        lines.push("- Page: fetch data via server actions or API; render loading/error states.");
    }

    return lines.join("\n");
}

function buildAntiPatternSection(filePath: string) {
    const lines: string[] = [];
    lines.push("## Anti-Patterns");

    if (filePath.includes("components/")) {
        lines.push("- Avoid creating new objects/functions inside render loops.");
        lines.push("- Avoid accessing `window` without checking SSR.");
    } else if (filePath.includes("app/api/")) {
        lines.push("- Avoid returning raw errors or stack traces.");
        lines.push("- Avoid unvalidated input passed directly to DB.");
    } else {
        lines.push("- Avoid circular imports; keep modules focused.");
    }

    return lines.join("\n");
}

function buildGoodBadSection(filePath: string) {
    const lines: string[] = [];
    lines.push("## Good vs Bad Examples");

    if (filePath.includes("components/")) {
        lines.push("### Good");
        lines.push("```tsx");
        lines.push("const Button = ({ label, onClick }: { label: string; onClick: () => void }) => (");
        lines.push("  <button onClick={onClick} className=\"px-3 py-2\">{label}</button>");
        lines.push(");");
        lines.push("```");
        lines.push("### Bad");
        lines.push("```tsx");
        lines.push("const Button = (props: any) => <button>{props.label}</button>;");
        lines.push("```");
    } else if (filePath.includes("app/api/")) {
        lines.push("### Good");
        lines.push("```ts");
        lines.push("const body = schema.parse(await req.json());");
        lines.push("return NextResponse.json({ ok: true });");
        lines.push("```");
        lines.push("### Bad");
        lines.push("```ts");
        lines.push("const body = await req.json();");
        lines.push("return NextResponse.json(body);");
        lines.push("```");
    } else {
        lines.push("### Good");
        lines.push("```ts");
        lines.push("export function toTitleCase(input: string) {");
        lines.push("  return input.replace(/\\b\\w/g, c => c.toUpperCase());");
        lines.push("}");
        lines.push("```");
        lines.push("### Bad");
        lines.push("```ts");
        lines.push("export function toTitleCase(input: any) {");
        lines.push("  return input.toUpperCase();");
        lines.push("}");
        lines.push("```");
    }

    return lines.join("\n");
}


