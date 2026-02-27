/* eslint-disable @typescript-eslint/no-explicit-any */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { CTO_SYSTEM_PROMPT, ARCHITECT_SYSTEM_PROMPT, MAINTENANCE_PROMPT_ADDITION } from "./prompts";
import type { Message } from "@/types";

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

function shouldSkipClaude() {
    return Date.now() < claudeCooldownUntil;
}

function markClaudeFailure() {
    claudeCooldownUntil = Date.now() + CLAUDE_COOLDOWN_MS;
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

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    return String(error);
}

function isRetryableClaudeStreamError(error: unknown) {
    const message = getErrorMessage(error);
    return CLAUDE_RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

console.log(`[AI] Active provider: ${AI_PROVIDER}`);

/**
 * Helper to call Gemini with fallback logic
 */
async function withFallback<T>(
    operation: (model: any) => Promise<T>,
    isJsonMode: boolean = false
): Promise<T> {
    try {
        console.log(`[AI] Attempting with CORE model: ${CORE_MODEL}`);
        const model = genAI.getGenerativeModel({
            model: CORE_MODEL,
            generationConfig: isJsonMode ? { responseMimeType: "application/json" } : undefined
        });
        return await operation(model);
    } catch (error: any) {
        console.warn(`[AI] CORE model failed (${error.message}). Falling back to BACKUP: ${BACKUP_MODEL}`);
        // Fallback to flash, which is usually very reliable
        const model = genAI.getGenerativeModel({
            model: BACKUP_MODEL,
            generationConfig: isJsonMode ? { responseMimeType: "application/json" } : undefined
        });
        return await operation(model);
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
        throw new Error(`[Claude] ${response.status}: ${errorBody}`);
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
        throw new Error(`[Claude] ${response.status}: ${errorBody}`);
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

    const primaryModel = preferBackupModel ? BACKUP_MODEL : CORE_MODEL;
    const fallbackModel = preferBackupModel ? CORE_MODEL : BACKUP_MODEL;

    let streamResult;
    try {
        streamResult = await openStream(primaryModel);
    } catch (error: any) {
        console.warn(`[AI] ${primaryModel} stream failed (${error.message}). Falling back to ${fallbackModel}`);
        streamResult = await openStream(fallbackModel);
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
};

export async function* streamEvaluateInput(
    messages: Message[],
    context?: string,
    options?: EvaluateRuntimeOptions
) {
    const maxContextChars = 12000;
    const safeContext = typeof context === "string" && context.trim()
        ? context.trim().slice(0, maxContextChars)
        : "";
    const structureBlock = safeContext
        ? `\n\n# Existing Project Structure (Context)\n${safeContext}\n\n# Guidance\n- Use the structure above as the current source of truth for existing features.\n- If the user asks about functionality, infer from file specs before asking new questions.`
        : "";

    const coachModeBlock = options?.generationReady
        ? `\n\n# Runtime Mode\nBlueprint already exists. Prioritize implementation coaching with phased execution and include <options> for next action buttons.`
        : "";

    const systemInstructionText = `${CTO_SYSTEM_PROMPT}${structureBlock}${coachModeBlock}\n\nAnalyze the latest user message and conversation history. Respond in the required XML format.`;

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
 * 3. Generate Project Resources (The Blueprint)
 * Used when the user clicks "Generate".
 * This expects a JSON response.
 */
type GenerateProjectResourcesOptions = {
    projectName?: string;
};

export async function generateProjectResources(
    history: string,
    diagram?: string,
    existingProjectTree?: any,
    options?: GenerateProjectResourcesOptions
) {
    const resolvedProjectName = (options?.projectName || "").trim();

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

    prompt += `\n\nBased on the above, generate the Project Blueprint JSON.`;

    try {
        console.log("[AI] Generating Blueprint...");

        const text = await generateModelText(prompt, true);
        console.log("[AI] Blueprint Raw Response:", text.substring(0, 200) + "...");

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
        const generatedStartupPrompt = sanitizeStartupPromptText(
            typeof data.startupPrompt === "string" ? data.startupPrompt : ""
        );

        // --- Post-Processing (Consistency Check) ---
        data.toolStack = ensureDefaultToolStack(data.toolStack);
        let cursorRulesContent = data.cursorPrompt || "";

        // Helper to format the tree into a readable text list
        const formatTree = (nodes: any[], depth = 0): string => {
            let result = "";
            if (!nodes) return "";
            for (const node of nodes) {
                const indent = "  ".repeat(depth);
                result += `${indent}- ${node.name}`;
                if (node.type === 'file' && node.content) {
                    result += ` (Contains specs)`;
                }
                result += "\n";
                if (node.children) {
                    result += formatTree(node.children, depth + 1);
                }
            }
            return result;
        };

        const treeString = formatTree(data.projectTree);

        // Prepend quality rules to guide downstream generation
        const qualityRules = buildGlobalQualityRules(data.toolStack);
        cursorRulesContent = `${qualityRules}\n\n${cursorRulesContent}`.trim();

        // Append structured context to the .cursorrules content
        cursorRulesContent += "\n\n# Project Context (Auto-Generated)\n";
        cursorRulesContent += "## 1. Project Structure\n" + treeString;
        cursorRulesContent += "\n## 2. Tech Stack\n" + (data.toolStack || "Not specified");

        if (diagram) {
            cursorRulesContent += "\n\n## 3. System Architecture\n```mermaid\n" + diagram + "\n```";
        }


        // Overwrite the prompt with the enhanced version
        data.cursorPrompt = cursorRulesContent;

        // Ensure executable baseline config files exist
        data.projectTree = ensureCoreConfigFiles(
            data.projectTree,
            data.toolStack,
            history,
            resolvedProjectName || "generated-project"
        );
        data.projectTree = enhanceProjectTreeSpecs(data.projectTree, data.toolStack);

        data.startupPrompt = generatedStartupPrompt || sanitizeStartupPromptText(data.cursorPrompt);

        return data;

    } catch (error) {
        console.error("[AI] Blueprint Generation Error:", error);
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
        '{ "projectTree": [], "toolStack": "", "cursorPrompt": "", "startupPrompt": "" }',
        "",
        "SOURCE:",
        clipped || "[EMPTY]"
    ].join("\n");
}

function normalizeGenerationData(input: any) {
    const safe = typeof input === "object" && input !== null ? input : {};

    if (!Array.isArray(safe.projectTree)) safe.projectTree = [];
    if (typeof safe.toolStack !== "string") safe.toolStack = "";
    if (typeof safe.cursorPrompt !== "string") safe.cursorPrompt = "";
    if (typeof safe.startupPrompt !== "string") safe.startupPrompt = "";

    return safe;
}

function sanitizeStartupPromptText(prompt: string) {
    if (!prompt) return "";

    const normalized = prompt.replace(/\r\n/g, "\n").trim();
    if (!normalized) return "";

    const lines = normalized.split("\n");
    if (lines.length > 0) {
        lines[0] = lines[0]
            .replace(/^\s*(?:#{1,6}\s*)?(hello|hi|hey)\s+cursor!?[,\s:!-]*/i, "")
            .trim();
        if (!lines[0]) {
            lines.shift();
        }
    }

    return lines.join("\n").trim();
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
        "| Auth | NextAuth | Turnkey authentication |",
        "| Database | Prisma + SQLite | Fast local dev and easy schema |"
    ].join("\n");
}

function ensureCoreConfigFiles(
    projectTree: any[],
    toolStack: string,
    history: string,
    projectName: string
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

    const context = `${toolStack || ""}\n${history || ""}`;
    const usesNext = /next\.js|nextjs|\bnext\b/i.test(context) || existingNames.has("next.config.ts");
    const usesPhaser = /phaser/i.test(context);
    const usesPrisma = /prisma/i.test(context);

    const coreFiles: { name: string; content: string }[] = [];

    if (!existingNames.has("package.json")) {
        coreFiles.push({
            name: "package.json",
            content: generatePackageJson({
                framework: usesNext ? "next" : "react",
                usesPhaser,
                projectName,
                toolStack
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

    if (usesPrisma) {
        const schemaContent = generatePrismaSchema();
        upsertFileByPath(tree, "prisma/schema.prisma", schemaContent);
        upsertFileByPath(tree, ".env.example", generateEnvExample({ usesNextAuth: /nextauth|next-auth/i.test(context) }));
    }

    if (/nextauth|next-auth/i.test(context)) {
        upsertFileByPath(tree, "app/api/auth/[...nextauth]/route.ts", generateNextAuthRouteSpec());
    }

    if (usesPrisma) {
        upsertFileByPath(tree, "prisma/seed.ts", generatePrismaSeedSpec());
    }

    upsertReadmeSetup(tree, { usesPrisma, usesNextAuth: /nextauth|next-auth/i.test(context) });

    if (coreFiles.length === 0) return tree;

    return [
        ...coreFiles.map(f => ({
            name: f.name,
            type: "file",
            content: f.content
        })),
        ...tree
    ];
}

function generatePackageJson(input: { framework: "next" | "react"; usesPhaser: boolean; projectName: string; toolStack?: string }) {
    const stack = (input.toolStack || "").toLowerCase();
    const usesTailwind = /tailwind/.test(stack);
    const usesZustand = /zustand/.test(stack);
    const usesLucide = /lucide/.test(stack);
    const usesThree = /\bthree\.?js\b|\bthree\b/.test(stack);
    const usesPixi = /\bpixi\b/.test(stack);
    const usesReactQuery = /react\s*query|tanstack\s*query/.test(stack);
    const usesRedux = /redux/.test(stack);
    const usesReactHookForm = /react\s*hook\s*form/.test(stack);
    const usesZod = /\bzod\b/.test(stack);
    const usesSWR = /\bswr\b/.test(stack);
    const usesNextAuth = /nextauth|next-auth/.test(stack);
    const usesPrisma = /prisma/.test(stack);

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
    if (usesNextAuth) extraDeps["next-auth"] = "^4.24.7";
    if (usesPrisma) extraDeps["@prisma/client"] = "^5.16.2";
    if (usesPrisma && usesNextAuth) extraDeps["@auth/prisma-adapter"] = "^1.4.1";

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
            ...(usesTailwind ? { tailwindcss: "^3.4.1", postcss: "^8", autoprefixer: "^10.0.1" } : {}),
            ...(usesPrisma ? { prisma: "^5.16.2" } : {})
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

function generatePrismaSchema() {
    return [
        `generator client {`,
        `  provider = "prisma-client-js"`,
        `}`,
        ``,
        `datasource db {`,
        `  provider = "sqlite"`,
        `  url      = env("DATABASE_URL")`,
        `}`,
        ``,
        `model User {`,
        `  id            String    @id @default(cuid())`,
        `  name          String?`,
        `  email         String?   @unique`,
        `  emailVerified DateTime?`,
        `  image         String?`,
        `  createdAt     DateTime  @default(now())`,
        `  updatedAt     DateTime  @updatedAt`,
        `  accounts      Account[]`,
        `  sessions      Session[]`,
        `}`,
        ``,
        `model Account {`,
        `  id                String  @id @default(cuid())`,
        `  userId            String`,
        `  type              String`,
        `  provider          String`,
        `  providerAccountId String`,
        `  refresh_token     String?`,
        `  access_token      String?`,
        `  expires_at        Int?`,
        `  token_type        String?`,
        `  scope             String?`,
        `  id_token          String?`,
        `  session_state     String?`,
        `  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)`,
        ``,
        `  @@unique([provider, providerAccountId])`,
        `}`,
        ``,
        `model Session {`,
        `  id           String   @id @default(cuid())`,
        `  sessionToken String   @unique`,
        `  userId       String`,
        `  expires      DateTime`,
        `  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)`,
        `}`,
        ``,
        `model VerificationToken {`,
        `  identifier String`,
        `  token      String   @unique`,
        `  expires    DateTime`,
        ``,
        `  @@unique([identifier, token])`,
        `}`,
        ``
    ].join("\n");
}

function generateEnvExample(input: { usesNextAuth: boolean }) {
    const lines: string[] = [];
    lines.push("# Database");
    lines.push('DATABASE_URL="file:./dev.db"');

    if (input.usesNextAuth) {
        lines.push("");
        lines.push("# Auth");
        lines.push('NEXTAUTH_URL="http://localhost:3000"');
        lines.push('NEXTAUTH_SECRET="your-secret-here"');
    }

    lines.push("");
    return lines.join("\n");
}

function generateNextAuthRouteSpec() {
    return [
        "# NextAuth API Route Spec",
        "",
        "## Responsibility",
        "Configure NextAuth with Prisma adapter and at least one provider.",
        "",
        "## Requirements",
        "- Use `PrismaAdapter` with the Prisma client instance.",
        "- Include one OAuth provider (e.g., GitHub) and a fallback Email provider if possible.",
        "- Export `authOptions` for reuse in server components.",
        "",
        "## Env",
        "- `NEXTAUTH_URL`",
        "- `NEXTAUTH_SECRET`",
        "- Provider-specific keys (e.g., `GITHUB_ID`, `GITHUB_SECRET`)",
        "",
        "## Exports",
        "- `handlers` or `GET/POST` handlers required by NextAuth v4 app router.",
        "- `authOptions`",
        "",
        "## Notes",
        "- Keep secrets out of the repository; use `.env.local`.",
        "- Ensure session strategy is compatible with Prisma adapter."
    ].join("\n");
}

function generatePrismaSeedSpec() {
    return [
        "# Prisma Seed Spec",
        "",
        "## Responsibility",
        "Provide initial seed data for development.",
        "",
        "## Requirements",
        "- Create a Prisma client instance.",
        "- Insert at least one `User` record (and related data if needed).",
        "- Ensure seed is idempotent (safe to run multiple times).",
        "",
        "## Script",
        "- Export a main function and call it at the bottom.",
        "- Use `process.exit(1)` on error.",
        "",
        "## Notes",
        "- Keep the seed minimal to avoid test pollution.",
        "- Use environment variables where appropriate."
    ].join("\n");
}

function upsertReadmeSetup(tree: any[], input: { usesPrisma: boolean; usesNextAuth: boolean }) {
    const lines: string[] = [];
    lines.push("# Getting Started");
    lines.push("");
    lines.push("## Install");
    lines.push("```bash");
    lines.push("npm install");
    lines.push("```");

    if (input.usesPrisma) {
        lines.push("");
        lines.push("## Database");
        lines.push("```bash");
        lines.push("cp .env.example .env.local");
        lines.push("npx prisma migrate dev --name init");
        lines.push("```");
        lines.push("");
        lines.push("## Seed (optional)");
        lines.push("```bash");
        lines.push("npx prisma db seed");
        lines.push("```");
    }

    if (input.usesNextAuth) {
        lines.push("");
        lines.push("## Auth");
        lines.push("Set provider env vars in `.env.local`.");
    }

    lines.push("");
    lines.push("## Run");
    lines.push("```bash");
    lines.push("npm run dev");
    lines.push("```");
    lines.push("");

    upsertFileByPath(tree, "README.md", lines.join("\n"));
}

function enhanceProjectTreeSpecs(projectTree: any[], toolStack: string): any[] {
    const stack = (toolStack || "").toLowerCase();
    const usesZod = /\bzod\b/.test(stack);
    const usesNextAuth = /nextauth|next-auth/.test(stack);
    const usesPrisma = /prisma/.test(stack);

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
            const qualitySection = buildQualitySection(filePath, { usesZod, usesNextAuth, usesPrisma });
            const templateSection = buildTemplateSection(filePath, { usesZod, usesNextAuth, usesPrisma });
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

function buildQualitySection(filePath: string, input: { usesZod: boolean; usesNextAuth: boolean; usesPrisma: boolean }) {
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

    if (input.usesPrisma && (filePath.includes("lib/") || filePath.includes("app/api/"))) {
        lines.push("- Data: Use a single Prisma client instance; avoid re-instantiation.");
    }

    if (input.usesNextAuth && filePath.includes("auth")) {
        lines.push("- Auth: Keep secrets in env; never log tokens.");
    }

    return lines.join("\n");
}

function buildTemplateSection(filePath: string, input: { usesZod: boolean; usesNextAuth: boolean; usesPrisma: boolean }) {
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
        if (input.usesPrisma) {
            lines.push("- Data: call Prisma client; map DB errors to 4xx/5xx.");
        }
    } else if (filePath.startsWith("lib/")) {
        lines.push("- Module: pure functions where possible; avoid side effects.");
        lines.push("- Exports: named exports with clear typing.");
    } else if (filePath.endsWith(".tsx")) {
        lines.push("- Page: fetch data via server actions or API; render loading/error states.");
    }

    if (input.usesNextAuth && filePath.includes("auth")) {
        lines.push("- Auth: expose `authOptions` and route handlers.");
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
        lines.push("### ✅ Good");
        lines.push("```tsx");
        lines.push("const Button = ({ label, onClick }: { label: string; onClick: () => void }) => (");
        lines.push("  <button onClick={onClick} className=\"px-3 py-2\">{label}</button>");
        lines.push(");");
        lines.push("```");
        lines.push("### ❌ Bad");
        lines.push("```tsx");
        lines.push("const Button = (props: any) => <button>{props.label}</button>;");
        lines.push("```");
    } else if (filePath.includes("app/api/")) {
        lines.push("### ✅ Good");
        lines.push("```ts");
        lines.push("const body = schema.parse(await req.json());");
        lines.push("return NextResponse.json({ ok: true });");
        lines.push("```");
        lines.push("### ❌ Bad");
        lines.push("```ts");
        lines.push("const body = await req.json();");
        lines.push("return NextResponse.json(body);");
        lines.push("```");
    } else {
        lines.push("### ✅ Good");
        lines.push("```ts");
        lines.push("export function toTitleCase(input: string) {");
        lines.push("  return input.replace(/\\b\\w/g, c => c.toUpperCase());");
        lines.push("}");
        lines.push("```");
        lines.push("### ❌ Bad");
        lines.push("```ts");
        lines.push("export function toTitleCase(input: any) {");
        lines.push("  return input.toUpperCase();");
        lines.push("}");
        lines.push("```");
    }

    return lines.join("\n");
}

function buildGlobalQualityRules(toolStack: string) {
    const stack = (toolStack || "").toLowerCase();
    const usesZod = /\bzod\b/.test(stack);
    const usesPrisma = /prisma/.test(stack);
    const usesNextAuth = /nextauth|next-auth/.test(stack);

    const lines: string[] = [];
    lines.push("# Global Quality Rules");
    lines.push("- Prefer strict typing; avoid `any`.");
    lines.push("- Validate user input; never trust raw `req.json()`.");
    lines.push("- Handle loading/error/empty states in UI.");
    lines.push("- Keep side effects out of render; use hooks.");
    lines.push("- Do not log secrets or tokens.");

    if (usesZod) lines.push("- Use Zod for request and form validation.");
    if (usesPrisma) lines.push("- Use a single Prisma client instance; avoid re-instantiation.");
    if (usesNextAuth) lines.push("- Use NextAuth session helpers; do not expose session tokens.");

    return lines.join("\n");
}
