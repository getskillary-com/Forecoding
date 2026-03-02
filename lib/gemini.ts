/* eslint-disable @typescript-eslint/no-explicit-any */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { CTO_SYSTEM_PROMPT, ARCHITECT_SYSTEM_PROMPT, MAINTENANCE_PROMPT_ADDITION } from "./prompts";
import type {
    GenerationManifest,
    GenerationTask,
    Message,
    PhasePlan,
    PreflightIssue,
    PreflightReport,
    TemplateKind
} from "@/types";

type OutputLanguage = "zh" | "en";
type OneClickMode = "strict_build_v1";
type IdeProfile = "generic";

const DEFAULT_ONE_CLICK_MODE: OneClickMode = "strict_build_v1";
const DEFAULT_IDE_PROFILE: IdeProfile = "generic";

function readEnvString(name: string, fallback = "") {
    const raw = process.env[name];
    return typeof raw === "string" ? raw : fallback;
}

function readEnvNumber(name: string, fallback: number) {
    const parsed = Number(readEnvString(name));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeProvider(value: string | undefined) {
    const raw = (value || "").trim().replace(/^['"]|['"]$/g, "").toLowerCase();
    if (raw === "claude" || raw === "anthropic") return "claude";
    if (raw === "chatgpt" || raw === "openai" || raw === "gpt") return "chatgpt";
    if (raw === "deepseek") return "deepseek";
    if (raw === "gemini" || raw === "google") return "gemini";
    return "";
}

const CLAUDE_API_KEY = readEnvString("CLAUDE_API_KEY") || readEnvString("ANTHROPIC_API_KEY");
const CLAUDE_MODEL = readEnvString("CLAUDE_MODEL", "claude-opus-4-6");
const CLAUDE_API_BASE_URL = readEnvString("CLAUDE_API_BASE_URL", "https://api.anthropic.com").replace(/\/+$/, "");
const CLAUDE_API_VERSION = readEnvString("CLAUDE_API_VERSION", "2023-06-01");
const CLAUDE_MAX_TOKENS = readEnvNumber("CLAUDE_MAX_TOKENS", 8192);
const CLAUDE_COOLDOWN_MS = readEnvNumber("CLAUDE_COOLDOWN_MS", 120000);
const OPENAI_API_KEY = readEnvString("OPENAI_API_KEY");
const OPENAI_MODEL = readEnvString("OPENAI_MODEL", "gpt-4o-mini");
const OPENAI_API_BASE_URL = readEnvString("OPENAI_API_BASE_URL", "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_MAX_TOKENS = readEnvNumber("OPENAI_MAX_TOKENS", 4096);
const OPENAI_COOLDOWN_MS = readEnvNumber("OPENAI_COOLDOWN_MS", 120000);
const DEEPSEEK_API_KEY = readEnvString("DEEPSEEK_API_KEY");
const DEEPSEEK_MODEL = readEnvString("DEEPSEEK_MODEL", "deepseek-chat");
const DEEPSEEK_API_BASE_URL = readEnvString("DEEPSEEK_API_BASE_URL", "https://api.deepseek.com/v1").replace(/\/+$/, "");
const DEEPSEEK_MAX_TOKENS = readEnvNumber("DEEPSEEK_MAX_TOKENS", 4096);
const DEEPSEEK_COOLDOWN_MS = readEnvNumber("DEEPSEEK_COOLDOWN_MS", 120000);
const GEMINI_CORE_COOLDOWN_MS = readEnvNumber("GEMINI_CORE_COOLDOWN_MS", 180000);
const GEMINI_STREAM_OPEN_MAX_ATTEMPTS = Math.min(
    4,
    Math.max(1, readEnvNumber("GEMINI_STREAM_OPEN_MAX_ATTEMPTS", 4))
);
const GEMINI_STREAM_RETRY_BASE_MS = Math.min(
    2_000,
    Math.max(100, readEnvNumber("GEMINI_STREAM_RETRY_BASE_MS", 350))
);
const GEMINI_STREAM_RETRY_MAX_MS = Math.min(
    8_000,
    Math.max(500, readEnvNumber("GEMINI_STREAM_RETRY_MAX_MS", 4000))
);
const GEMINI_STREAM_RETRY_JITTER_MS = Math.min(
    1_000,
    Math.max(0, readEnvNumber("GEMINI_STREAM_RETRY_JITTER_MS", 250))
);
const OPENAI_COMPAT_MAX_ATTEMPTS = Math.min(
    4,
    Math.max(1, readEnvNumber("OPENAI_COMPAT_MAX_ATTEMPTS", 3))
);
const OPENAI_COMPAT_RETRY_BASE_MS = Math.min(
    2_000,
    Math.max(100, readEnvNumber("OPENAI_COMPAT_RETRY_BASE_MS", 350))
);
const OPENAI_COMPAT_RETRY_MAX_MS = Math.min(
    8_000,
    Math.max(500, readEnvNumber("OPENAI_COMPAT_RETRY_MAX_MS", 4000))
);
const OPENAI_COMPAT_RETRY_JITTER_MS = Math.min(
    1_000,
    Math.max(0, readEnvNumber("OPENAI_COMPAT_RETRY_JITTER_MS", 250))
);

const AI_PROVIDER = normalizeProvider(readEnvString("AI_PROVIDER")) ||
    (CLAUDE_API_KEY
        ? "claude"
        : OPENAI_API_KEY
            ? "chatgpt"
            : DEEPSEEK_API_KEY
                ? "deepseek"
                : "gemini");

// Initialize Gemini Client
const GEMINI_API_KEY = readEnvString("GEMINI_API_KEY");
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

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

function isChatGptProvider() {
    return AI_PROVIDER === "chatgpt";
}

function isDeepSeekProvider() {
    return AI_PROVIDER === "deepseek";
}

function hasGeminiKey() {
    return Boolean(GEMINI_API_KEY);
}

function hasOpenAiKey() {
    return Boolean(OPENAI_API_KEY);
}

function hasDeepSeekKey() {
    return Boolean(DEEPSEEK_API_KEY);
}

let claudeCooldownUntil = 0;
let chatGptCooldownUntil = 0;
let deepSeekCooldownUntil = 0;
let geminiCoreCooldownUntil = 0;

function shouldSkipClaude() {
    return Date.now() < claudeCooldownUntil;
}

function markClaudeFailure() {
    claudeCooldownUntil = Date.now() + CLAUDE_COOLDOWN_MS;
}

function shouldSkipChatGpt() {
    return Date.now() < chatGptCooldownUntil;
}

function markChatGptFailure() {
    chatGptCooldownUntil = Date.now() + OPENAI_COOLDOWN_MS;
}

function shouldSkipDeepSeek() {
    return Date.now() < deepSeekCooldownUntil;
}

function markDeepSeekFailure() {
    deepSeekCooldownUntil = Date.now() + DEEPSEEK_COOLDOWN_MS;
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
const OPENAI_COMPAT_RETRYABLE_ERROR_PATTERNS = [
    /\b429\b/i,
    /\b500\b/i,
    /\b502\b/i,
    /\b503\b/i,
    /\b504\b/i,
    /rate limit/i,
    /high demand/i,
    /overloaded/i,
    /temporarily unavailable/i,
    /service unavailable/i,
    /resource exhausted/i,
    /insufficient_quota/i,
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

function isRetryableOpenAiCompatError(error: unknown) {
    const message = getErrorMessage(error);
    return OPENAI_COMPAT_RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function computeRetryDelayMs(baseMs: number, maxMs: number, jitterMs: number, attempt: number) {
    const exponentialMs = baseMs * Math.pow(2, attempt);
    const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
    return Math.min(maxMs, exponentialMs + jitter);
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

type OpenAiCompatRole = "system" | "user" | "assistant";
type OpenAiCompatMessage = { role: OpenAiCompatRole; content: string };
type OpenAiCompatConfig = {
    providerName: "ChatGPT" | "DeepSeek";
    envKey: "OPENAI_API_KEY" | "DEEPSEEK_API_KEY";
    apiKey: string;
    model: string;
    baseUrl: string;
    maxTokens: number;
};

function buildOpenAiCompatMessageContent(message: Message) {
    const parts: string[] = [];
    if (message.content) {
        parts.push(message.content);
    }

    for (const attachment of message.attachments || []) {
        if (attachment.type === "text") {
            parts.push(`\n\n[Attached File: ${attachment.name}]\n${attachment.content}`);
            continue;
        }

        parts.push(`\n\n[Attachment omitted in ${AI_PROVIDER} mode: ${attachment.name} (${attachment.mimeType})]`);
    }

    return parts.join("");
}

function buildOpenAiCompatMessages(messages: Message[]): OpenAiCompatMessage[] {
    return messages.map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: buildOpenAiCompatMessageContent(message)
    }));
}

function normalizeOpenAiCompatContent(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .map((item) => {
                if (typeof item === "string") return item;
                if (!item || typeof item !== "object") return "";
                const candidate = item as { text?: unknown };
                return typeof candidate.text === "string" ? candidate.text : "";
            })
            .join("");
    }

    if (content && typeof content === "object") {
        const candidate = content as { text?: unknown };
        if (typeof candidate.text === "string") {
            return candidate.text;
        }
    }

    return "";
}

function extractOpenAiCompatResponseText(payload: unknown): string {
    if (!payload || typeof payload !== "object") return "";
    const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
    if (!Array.isArray(choices) || choices.length === 0) return "";
    return choices
        .map((choice) => normalizeOpenAiCompatContent(choice?.message?.content))
        .join("");
}

function parseOpenAiCompatSseChunk(rawEvent: string) {
    const dataLines = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());

    if (!dataLines.length) return { text: "", error: "" };

    const rawData = dataLines.join("\n");
    if (!rawData || rawData === "[DONE]") return { text: "", error: "" };

    try {
        const payload = JSON.parse(rawData) as {
            error?: { message?: string };
            choices?: Array<{
                delta?: { content?: unknown };
                message?: { content?: unknown };
            }>;
        };

        if (payload.error?.message) {
            return { text: "", error: payload.error.message };
        }

        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        const text = choices
            .map((choice) => (
                normalizeOpenAiCompatContent(choice?.delta?.content) ||
                normalizeOpenAiCompatContent(choice?.message?.content)
            ))
            .join("");
        return { text, error: "" };
    } catch {
        return { text: "", error: "" };
    }
}

async function generateTextWithOpenAiCompat(
    prompt: string,
    config: OpenAiCompatConfig,
    options: { jsonMode?: boolean } = {}
) {
    if (!config.apiKey) {
        throw new Error(`${config.envKey} is missing.`);
    }

    const requestBody: {
        model: string;
        max_tokens?: number;
        messages: OpenAiCompatMessage[];
        response_format?: { type: "json_object" };
    } = {
        model: config.model,
        messages: [{ role: "user", content: prompt }]
    };
    if (Number.isFinite(config.maxTokens) && config.maxTokens > 0) {
        requestBody.max_tokens = Math.floor(config.maxTokens);
    }
    if (options.jsonMode && config.providerName === "ChatGPT") {
        requestBody.response_format = { type: "json_object" };
    }

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`[${config.providerName}] ${response.status}: ${clipErrorText(errorBody)}`);
    }

    const payload = await response.json();
    const text = extractOpenAiCompatResponseText(payload);
    if (!text) {
        throw new Error(`[${config.providerName}] Empty response text.`);
    }
    return text;
}

async function* streamWithOpenAiCompat(
    messages: Message[],
    systemInstructionText: string,
    config: OpenAiCompatConfig
) {
    if (!config.apiKey) {
        throw new Error(`${config.envKey} is missing.`);
    }

    const payload: {
        model: string;
        stream: true;
        max_tokens?: number;
        messages: OpenAiCompatMessage[];
    } = {
        model: config.model,
        stream: true,
        messages: [
            { role: "system", content: systemInstructionText },
            ...buildOpenAiCompatMessages(messages)
        ]
    };
    if (Number.isFinite(config.maxTokens) && config.maxTokens > 0) {
        payload.max_tokens = Math.floor(config.maxTokens);
    }

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`[${config.providerName}] ${response.status}: ${clipErrorText(errorBody)}`);
    }

    if (!response.body) {
        throw new Error(`[${config.providerName}] Empty streaming body.`);
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
            const parsed = parseOpenAiCompatSseChunk(rawEvent);
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text) yield parsed.text;
        }
    }

    if (buffer.trim()) {
        const parsed = parseOpenAiCompatSseChunk(buffer);
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.text) yield parsed.text;
    }
}

const CHATGPT_CONFIG: OpenAiCompatConfig = {
    providerName: "ChatGPT",
    envKey: "OPENAI_API_KEY",
    apiKey: OPENAI_API_KEY,
    model: OPENAI_MODEL,
    baseUrl: OPENAI_API_BASE_URL,
    maxTokens: OPENAI_MAX_TOKENS
};

const DEEPSEEK_CONFIG: OpenAiCompatConfig = {
    providerName: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    apiKey: DEEPSEEK_API_KEY,
    model: DEEPSEEK_MODEL,
    baseUrl: DEEPSEEK_API_BASE_URL,
    maxTokens: DEEPSEEK_MAX_TOKENS
};

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
    const generateNonStream = async (modelName: string) => {
        const chatModel = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: systemInstructionText
        });
        const result = await chatModel.generateContent({ contents });
        return result.response.text() || "";
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

                const backoffMs = computeRetryDelayMs(
                    GEMINI_STREAM_RETRY_BASE_MS,
                    GEMINI_STREAM_RETRY_MAX_MS,
                    GEMINI_STREAM_RETRY_JITTER_MS,
                    attempt
                );
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
    let lastOpenError: unknown = null;

    for (let i = 0; i < modelCandidates.length; i++) {
        const modelName = modelCandidates[i];
        try {
            streamResult = await openWithRetries(modelName);
            break;
        } catch (error) {
            lastOpenError = error;
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
        const canTryNonStreamFallback = lastOpenError ? isRetryableGeminiCoreError(lastOpenError) : false;
        if (canTryNonStreamFallback) {
            console.warn("[AI] Gemini stream unavailable after retries. Attempting non-stream fallback.");
            for (let i = 0; i < modelCandidates.length; i++) {
                const modelName = modelCandidates[i];
                try {
                    const text = await generateNonStream(modelName);
                    if (text.trim()) {
                        console.log(`[AI] Non-stream fallback succeeded with ${modelName}.`);
                        yield text;
                        return;
                    }
                } catch (error) {
                    const message = getErrorMessage(error);
                    const fallbackModel = modelCandidates[i + 1];
                    if (!fallbackModel) {
                        break;
                    }
                    console.warn(
                        `[AI] ${modelName} non-stream fallback failed (${message}). Trying ${fallbackModel}`
                    );
                }
            }
        }

        if (lastOpenError) {
            throw lastOpenError;
        }
        throw new Error("[AI] Failed to initialize Gemini stream.");
    }

    for await (const chunk of streamResult.stream) {
        const chunkText = chunk.text();
        if (chunkText) yield chunkText;
    }
}

async function generateTextWithOpenAiCompatRetries(
    prompt: string,
    config: OpenAiCompatConfig,
    options: { jsonMode?: boolean } = {},
    onRetryableFailure?: () => void
) {
    for (let attempt = 0; attempt < OPENAI_COMPAT_MAX_ATTEMPTS; attempt++) {
        try {
            return await generateTextWithOpenAiCompat(prompt, config, options);
        } catch (error) {
            const retryable = isRetryableOpenAiCompatError(error);
            const isLastAttempt = attempt >= OPENAI_COMPAT_MAX_ATTEMPTS - 1;
            const message = getErrorMessage(error);

            if (!retryable || isLastAttempt) {
                if (retryable && onRetryableFailure) onRetryableFailure();
                throw error;
            }

            const backoffMs = computeRetryDelayMs(
                OPENAI_COMPAT_RETRY_BASE_MS,
                OPENAI_COMPAT_RETRY_MAX_MS,
                OPENAI_COMPAT_RETRY_JITTER_MS,
                attempt
            );
            console.warn(
                `[AI] ${config.providerName} request transient failure. Retrying in ${backoffMs}ms (attempt ${attempt + 1}/${OPENAI_COMPAT_MAX_ATTEMPTS}): ${message}`
            );
            await sleep(backoffMs);
        }
    }

    throw new Error(`[AI] ${config.providerName} request failed after retries.`);
}

async function* streamWithOpenAiCompatRetries(
    messages: Message[],
    systemInstructionText: string,
    config: OpenAiCompatConfig,
    onRetryableFailure?: () => void
) {
    for (let attempt = 0; attempt < OPENAI_COMPAT_MAX_ATTEMPTS; attempt++) {
        let emittedAnyChunk = false;
        try {
            for await (const chunk of streamWithOpenAiCompat(messages, systemInstructionText, config)) {
                if (!chunk) continue;
                emittedAnyChunk = true;
                yield chunk;
            }
            return;
        } catch (error) {
            const retryable = isRetryableOpenAiCompatError(error);
            const isLastAttempt = attempt >= OPENAI_COMPAT_MAX_ATTEMPTS - 1;
            const message = getErrorMessage(error);

            if (emittedAnyChunk || !retryable || isLastAttempt) {
                if (!emittedAnyChunk && retryable && onRetryableFailure) {
                    onRetryableFailure();
                }
                throw error;
            }

            const backoffMs = computeRetryDelayMs(
                OPENAI_COMPAT_RETRY_BASE_MS,
                OPENAI_COMPAT_RETRY_MAX_MS,
                OPENAI_COMPAT_RETRY_JITTER_MS,
                attempt
            );
            console.warn(
                `[AI] ${config.providerName} stream transient failure. Retrying in ${backoffMs}ms (attempt ${attempt + 1}/${OPENAI_COMPAT_MAX_ATTEMPTS}): ${message}`
            );
            await sleep(backoffMs);
        }
    }

    throw new Error(`[AI] ${config.providerName} stream failed after retries.`);
}

async function generateModelText(prompt: string, isJsonMode: boolean = false) {
    if (isChatGptProvider() && !hasOpenAiKey()) {
        throw new Error("OPENAI_API_KEY is missing.");
    }

    if (isDeepSeekProvider() && !hasDeepSeekKey()) {
        throw new Error("DEEPSEEK_API_KEY is missing.");
    }

    if (isChatGptProvider() && (!shouldSkipChatGpt() || !hasGeminiKey())) {
        try {
            return await generateTextWithOpenAiCompatRetries(
                prompt,
                CHATGPT_CONFIG,
                { jsonMode: isJsonMode },
                markChatGptFailure
            );
        } catch (error) {
            const retryable = isRetryableOpenAiCompatError(error);
            const message = getErrorMessage(error);
            if (!retryable || !hasGeminiKey()) {
                throw error;
            }
            console.warn(`[AI] ChatGPT request unavailable. Falling back to Gemini: ${message}`);
        }
    }

    if (isDeepSeekProvider() && (!shouldSkipDeepSeek() || !hasGeminiKey())) {
        try {
            return await generateTextWithOpenAiCompatRetries(
                prompt,
                DEEPSEEK_CONFIG,
                { jsonMode: isJsonMode },
                markDeepSeekFailure
            );
        } catch (error) {
            const retryable = isRetryableOpenAiCompatError(error);
            const message = getErrorMessage(error);
            if (!retryable || !hasGeminiKey()) {
                throw error;
            }
            console.warn(`[AI] DeepSeek request unavailable. Falling back to Gemini: ${message}`);
        }
    }

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
    const defaultDiagramPolicy = "incremental_auto_apply_v1";
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
    const diagramStabilityBlock = `\n\n# Diagram Stability Contract (${normalizedDiagramPolicy})\n- Baseline architecture diagram is the source of truth.\n- Output will be auto-applied, so only make changes when user input requires architecture changes.\n- Prefer minimal incremental updates; do not rewrite the full diagram unless user explicitly requests a structural redesign.\n- If the latest user input does not impact architecture, keep the diagram logically unchanged.\n- Reuse existing node names and existing edges whenever possible.\n- Avoid cosmetic-only rewrites and avoid reordering nodes without functional impact.\n- Always output <diagram>, but keep it stable and continuity-preserving.`;

    const coachModeBlock = options?.generationReady
        ? `\n\n# Runtime Mode\nScaffold already exists. Prioritize implementation coaching with phased execution and include <options> for next action buttons.`
        : "";

    const systemInstructionText = `${CTO_SYSTEM_PROMPT}${structureBlock}${designMemoryBlock}${diagramStabilityBlock}${coachModeBlock}\n\nAnalyze the latest user message and conversation history. Respond in the required XML format.`;

    try {
        if (isChatGptProvider() && !hasOpenAiKey()) {
            throw new Error("OPENAI_API_KEY is missing.");
        }

        if (isDeepSeekProvider() && !hasDeepSeekKey()) {
            throw new Error("DEEPSEEK_API_KEY is missing.");
        }

        if (isChatGptProvider() && (!shouldSkipChatGpt() || !hasGeminiKey())) {
            try {
                for await (const chunk of streamWithOpenAiCompatRetries(
                    messages,
                    systemInstructionText,
                    CHATGPT_CONFIG,
                    markChatGptFailure
                )) {
                    if (chunk) yield chunk;
                }
                return;
            } catch (error) {
                const retryable = isRetryableOpenAiCompatError(error);
                const message = getErrorMessage(error);
                if (retryable && hasGeminiKey()) {
                    console.warn(`[AI] ChatGPT stream unavailable. Falling back to Gemini: ${message}`);
                } else if (retryable) {
                    yield "<question>AI provider timeout. Please try again in a moment.</question>";
                    return;
                } else {
                    throw error;
                }
            }
        }

        if (isDeepSeekProvider() && (!shouldSkipDeepSeek() || !hasGeminiKey())) {
            try {
                for await (const chunk of streamWithOpenAiCompatRetries(
                    messages,
                    systemInstructionText,
                    DEEPSEEK_CONFIG,
                    markDeepSeekFailure
                )) {
                    if (chunk) yield chunk;
                }
                return;
            } catch (error) {
                const retryable = isRetryableOpenAiCompatError(error);
                const message = getErrorMessage(error);
                if (retryable && hasGeminiKey()) {
                    console.warn(`[AI] DeepSeek stream unavailable. Falling back to Gemini: ${message}`);
                } else if (retryable) {
                    yield "<question>AI provider timeout. Please try again in a moment.</question>";
                    return;
                } else {
                    throw error;
                }
            }
        }

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
        analysis: {
            clarified: [],
            missing: [],
            ui: {
                visualStyle: [],
                colorSystem: [],
                typography: [],
                keyScreens: [],
                uiComponents: [],
                responsiveStrategy: [],
                interactionMotion: [],
                statesAndFeedback: []
            }
        },
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
    oneClickMode?: OneClickMode;
    ideProfile?: IdeProfile;
    templateKindHint?: TemplateKind;
};

const SCAFFOLD_HARD_BLOCKER_CODES = new Set<PreflightIssue["code"]>([
    "EMPTY_GENERATION_TASKS",
    "PLAN_COVERAGE_INCOMPLETE",
    "INVALID_PROMPT_REFERENCE",
    "NEXT_CONFIG_CONTAMINATED",
    "MISSING_ENV_EXAMPLE",
    "MISSING_UI_SPEC",
    "MISSING_PAGE_UI_REQUIREMENTS"
] as const);

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
    const resolvedOneClickMode = options?.oneClickMode === "strict_build_v1" ? options.oneClickMode : DEFAULT_ONE_CLICK_MODE;
    const resolvedIdeProfile = options?.ideProfile === "generic" ? options.ideProfile : DEFAULT_IDE_PROFILE;

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
        const templateKind = detectTemplateKind(
            options?.templateKindHint,
            data.projectTree,
            data.toolStack,
            history
        );
        const { normalizedTree, fixCount: pathNormalizationFixCount } = normalizeProjectTreePaths(data.projectTree, templateKind);

        // Ensure executable baseline config files + docs + one-click artifacts exist.
        data.projectTree = ensureCoreConfigFiles(
            normalizedTree,
            data.toolStack,
            history,
            resolvedProjectName || "generated-project",
            resolvedOutputLanguage,
            templateKind,
            resolvedOneClickMode,
            resolvedIdeProfile
        );
        data.projectTree = enhanceProjectTreeSpecs(data.projectTree, data.toolStack);

        let manifest = buildGenerationManifest({
            tree: data.projectTree,
            outputLanguage: resolvedOutputLanguage,
            templateKind,
            oneClickMode: resolvedOneClickMode,
            ideProfile: resolvedIdeProfile
        });
        upsertFileByPath(data.projectTree, "GENERATION_MANIFEST.json", JSON.stringify(manifest, null, 2));
        upsertFileByPath(
            data.projectTree,
            "ONE_CLICK_PROMPT.md",
            buildOneClickPrompt({
                outputLanguage: resolvedOutputLanguage,
                oneClickMode: resolvedOneClickMode
            })
        );
        upsertFileByPath(
            data.projectTree,
            "_AI_PROMPT.md",
            buildRootAiPrompt({
                outputLanguage: resolvedOutputLanguage,
                manifest,
                oneClickMode: resolvedOneClickMode,
                ideProfile: resolvedIdeProfile
            })
        );

        let preflight = runGenerationPreflight({
            tree: data.projectTree,
            outputLanguage: resolvedOutputLanguage,
            toolStack: data.toolStack,
            manifest,
            pathNormalizationFixCount
        });

        if (!preflight.pass) {
            const hasHardBlocker = preflight.issues.some((issue) => (
                issue.severity === "error" && SCAFFOLD_HARD_BLOCKER_CODES.has(issue.code)
            ));

            if (hasHardBlocker) {
                ensureMinimumActionableScaffold({
                    tree: data.projectTree,
                    templateKind,
                    outputLanguage: resolvedOutputLanguage,
                    projectName: resolvedProjectName || "generated-project",
                    history,
                    force: true
                });
                ensureUiDesignDocs({
                    tree: data.projectTree,
                    outputLanguage: resolvedOutputLanguage,
                    projectName: resolvedProjectName || "generated-project",
                    toolStack: data.toolStack,
                    history
                });
                ensurePageUiRequirementSections(data.projectTree);

                upsertFileByPath(
                    data.projectTree,
                    "README.md",
                    ensureStructuredReadmeQualityStable(
                        buildStructuredReadmeStable({
                            outputLanguage: resolvedOutputLanguage,
                            projectName: resolvedProjectName || "generated-project",
                            toolStack: data.toolStack,
                            history,
                            tree: data.projectTree
                        }),
                        {
                            outputLanguage: resolvedOutputLanguage,
                            projectName: resolvedProjectName || "generated-project",
                            toolStack: data.toolStack,
                            history,
                            tree: data.projectTree
                        }
                    )
                );
                upsertFileByPath(
                    data.projectTree,
                    "IMPLEMENTATION_PLAN.md",
                    buildImplementationPlanStable({
                        outputLanguage: resolvedOutputLanguage,
                        projectName: resolvedProjectName || "generated-project",
                        tree: data.projectTree
                    })
                );

                manifest = buildGenerationManifest({
                    tree: data.projectTree,
                    outputLanguage: resolvedOutputLanguage,
                    templateKind,
                    oneClickMode: resolvedOneClickMode,
                    ideProfile: resolvedIdeProfile
                });
                upsertFileByPath(data.projectTree, "GENERATION_MANIFEST.json", JSON.stringify(manifest, null, 2));
                upsertFileByPath(
                    data.projectTree,
                    "ONE_CLICK_PROMPT.md",
                    buildOneClickPrompt({
                        outputLanguage: resolvedOutputLanguage,
                        oneClickMode: resolvedOneClickMode
                    })
                );
                upsertFileByPath(
                    data.projectTree,
                    "_AI_PROMPT.md",
                    buildRootAiPrompt({
                        outputLanguage: resolvedOutputLanguage,
                        manifest,
                        oneClickMode: resolvedOneClickMode,
                        ideProfile: resolvedIdeProfile
                    })
                );

                preflight = runGenerationPreflight({
                    tree: data.projectTree,
                    outputLanguage: resolvedOutputLanguage,
                    toolStack: data.toolStack,
                    manifest,
                    pathNormalizationFixCount
                });
            }
        }

        if (!preflight.pass) {
            console.warn(
                `[AI] Scaffold preflight reported issues: ${preflight.issues.map((issue) => issue.code).join(", ")}`
            );
            throw new Error(`Scaffold preflight failed: ${preflight.issues.map((issue) => issue.code).join(", ")}`);
        }

        const generatedReadme = getFileContentByPath(data.projectTree, "README.md");
        const generatedImplementationPlan = getFileContentByPath(data.projectTree, "IMPLEMENTATION_PLAN.md");
        const oneClickPrompt = getFileContentByPath(data.projectTree, "ONE_CLICK_PROMPT.md");
        console.log(
            `[AI] Scaffold docs language=${resolvedOutputLanguage} templateKind=${templateKind} oneClickMode=${resolvedOneClickMode} ideProfile=${resolvedIdeProfile} readmeChars=${generatedReadme.length} implementationPlanChars=${generatedImplementationPlan.length} oneClickPromptChars=${oneClickPrompt.length} pathNormalizationFixCount=${pathNormalizationFixCount} planCoveragePct=${preflight.planCoveragePct} manifestTaskCount=${preflight.manifestTaskCount} missingDepsCount=${preflight.missingDepsCount}`
        );

        data.generationManifest = manifest;
        data.preflightReport = preflight;

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

const ZIP_REAL_CONTENT_PATHS = new Set([
    "package.json",
    "tsconfig.json",
    "next.config.ts",
    "turbo.json",
    ".env.example",
    "README.md",
    "IMPLEMENTATION_PLAN.md",
    "_AI_PROMPT.md",
    "ONE_CLICK_PROMPT.md",
    "GENERATION_MANIFEST.json",
    "design/tokens.json",
    "design/page-contracts.json"
]);

function shouldWriteRealContentByPath(path: string) {
    if (ZIP_REAL_CONTENT_PATHS.has(path)) return true;
    if (path.endsWith("_AI_PROMPT.md")) return true;
    if (path.startsWith("docs/")) return true;
    if (path.startsWith("design/")) return true;
    if (/^config\/integrations\/.+\.template\./.test(path)) return true;
    return false;
}

function detectTemplateKind(
    hint: TemplateKind | undefined,
    projectTree: any[],
    toolStack: string,
    history: string
): TemplateKind {
    if (hint === "next_root" || hint === "next_src" || hint === "monorepo_multiapp") return hint;

    const allPaths = collectFilePathsFromTree(Array.isArray(projectTree) ? projectTree : []);
    const topLevel = new Set(allPaths.map((path) => path.split("/")[0]).filter(Boolean));
    if (topLevel.has("apps") || topLevel.has("packages")) return "monorepo_multiapp";

    const context = `${toolStack || ""}\n${history || ""}\n${allPaths.join("\n")}`.toLowerCase();
    if (/monorepo|turborepo|workspace|react native|expo/.test(context)) return "monorepo_multiapp";
    if (topLevel.has("src") || /src\/app|src\/components|src\/lib/.test(context)) return "next_src";
    return "next_root";
}

function normalizeGeneratedPath(rawPath: string, templateKind: TemplateKind): { path: string; fixes: number } {
    let fixes = 0;
    const compact = rawPath.replace(/\\/g, "/").replace(/\/+/g, "/");
    const rawSegments = compact.split("/").filter(Boolean);

    const deduped: string[] = [];
    for (const segment of rawSegments) {
        if (deduped[deduped.length - 1] === segment) {
            fixes += 1;
            continue;
        }
        deduped.push(segment);
    }

    const srcEligibleRoots = new Set(["app", "components", "lib", "types", "hooks", "store", "prisma"]);
    if (templateKind === "next_src") {
        if (deduped[0] && srcEligibleRoots.has(deduped[0]) && deduped[0] !== "src") {
            deduped.unshift("src");
            fixes += 1;
        }
    } else if (templateKind === "next_root") {
        if (deduped[0] === "src" && deduped[1] && srcEligibleRoots.has(deduped[1])) {
            deduped.shift();
            fixes += 1;
        }
    }

    return {
        path: deduped.join("/"),
        fixes
    };
}

function collectFileEntriesFromTree(tree: any[]) {
    const entries: Array<{ path: string; content: string }> = [];
    const walk = (nodes: any[], prefix: string) => {
        for (const node of nodes || []) {
            if (!node || typeof node !== "object" || typeof node.name !== "string") continue;
            const currentPath = prefix ? `${prefix}/${node.name}` : node.name;
            if (node.type === "file") {
                entries.push({
                    path: currentPath,
                    content: typeof node.content === "string" ? node.content : ""
                });
                continue;
            }
            if (node.type === "folder" && Array.isArray(node.children)) {
                walk(node.children, currentPath);
            }
        }
    };

    walk(tree, "");
    return entries;
}

function normalizeProjectTreePaths(projectTree: any[], templateKind: TemplateKind) {
    const inputTree = Array.isArray(projectTree) ? projectTree : [];
    const entries = collectFileEntriesFromTree(inputTree);
    const normalizedTree: any[] = [];
    const pathToContent = new Map<string, string>();
    let fixCount = 0;

    for (const entry of entries) {
        const normalized = normalizeGeneratedPath(entry.path, templateKind);
        fixCount += normalized.fixes;
        if (!normalized.path) continue;
        const previous = pathToContent.get(normalized.path) || "";
        const next = entry.content || "";
        if (!previous || next.length > previous.length) {
            pathToContent.set(normalized.path, next);
        }
    }

    for (const [path, content] of pathToContent.entries()) {
        upsertFileByPath(normalizedTree, path, content);
    }

    return { normalizedTree, fixCount };
}

function ensureCoreConfigFiles(
    projectTree: any[],
    toolStack: string,
    history: string,
    projectName: string,
    outputLanguage: OutputLanguage,
    templateKind: TemplateKind,
    oneClickMode: OneClickMode,
    ideProfile: IdeProfile
): any[] {
    const tree = Array.isArray(projectTree) ? projectTree : [];
    const treeText = collectProjectTreeText(tree);
    const context = `${toolStack || ""}\n${history || ""}\n${treeText}`;
    const usesNext = templateKind !== "monorepo_multiapp";
    const usesPhaser = /phaser/i.test(context);
    const dependencyClosure = deriveDependencyClosure({
        toolStack,
        analysisText: `${history || ""}\n${treeText}`,
        templateKind
    });
    const finalTree = JSON.parse(JSON.stringify(tree)) as any[];

    const packageJson = templateKind === "monorepo_multiapp"
        ? generateMonorepoRootPackageJson({
            projectName,
            dependencyClosure
        })
        : generatePackageJson({
            framework: usesNext ? "next" : "react",
            usesPhaser,
            projectName,
            toolStack,
            analysisText: `${history || ""}\n${treeText}`,
            dependencyClosure
        });

    const tsconfig = generateTsconfig({
        framework: usesNext ? "next" : "react",
        templateKind
    });
    const nextConfig = generateNextConfig({ usesPhaser });
    const envExample = generateEnvExample({
        outputLanguage,
        templateKind,
        dependencyClosure
    });

    upsertFileByPath(finalTree, "package.json", packageJson);
    upsertFileByPath(finalTree, "tsconfig.json", tsconfig);
    upsertFileByPath(finalTree, "next.config.ts", nextConfig);
    upsertFileByPath(finalTree, ".env.example", envExample);
    if (templateKind === "monorepo_multiapp") {
        upsertFileByPath(finalTree, "turbo.json", generateTurboConfigJson());
    }
    ensureMinimumActionableScaffold({
        tree: finalTree,
        templateKind,
        outputLanguage,
        projectName,
        history
    });
    ensureUiDesignDocs({
        tree: finalTree,
        outputLanguage,
        projectName,
        toolStack,
        history
    });
    ensurePageUiRequirementSections(finalTree);

    const structuredReadme = ensureStructuredReadmeQualityStable(
        buildStructuredReadmeStable({
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
    const implementationPlan = buildImplementationPlanStable({
        outputLanguage,
        projectName,
        tree: finalTree
    });
    const oneClickPrompt = buildOneClickPrompt({
        outputLanguage,
        oneClickMode
    });
    const rootPrompt = buildRootInstructionOnlyPrompt({
        outputLanguage,
        oneClickMode,
        ideProfile
    });

    upsertFileByPath(finalTree, "README.md", structuredReadme);
    upsertFileByPath(finalTree, "IMPLEMENTATION_PLAN.md", implementationPlan);
    upsertFileByPath(finalTree, "ONE_CLICK_PROMPT.md", oneClickPrompt);
    upsertFileByPath(finalTree, "_AI_PROMPT.md", rootPrompt);
    return finalTree;
}

function buildUiSpecDoc(input: {
    projectName: string;
    history: string;
    outputLanguage: OutputLanguage;
}) {
    const intents = extractUserIntentLinesStable(input.history, input.outputLanguage).slice(0, 5);
    const focusLines = intents.length > 0
        ? intents.map((line) => `- ${line}`)
        : ["- Define user-facing goals from finalized PRD and align with key task flow."];

    const lines: string[] = [];
    lines.push(`# ${input.projectName || "generated-project"} UI Specification`);
    lines.push("");
    lines.push("## Product Surface");
    lines.push("- Primary platform: Web first, responsive for desktop/tablet/mobile.");
    lines.push("- Main objective: deliver a complete UI shell before deep feature wiring.");
    lines.push("");
    lines.push("## Key Screens");
    lines.push("- Landing/Home");
    lines.push("- Primary workflow page");
    lines.push("- Settings/Profile");
    lines.push("- Empty/error recovery views");
    lines.push("");
    lines.push("## Screen Intent Notes");
    focusLines.forEach((line) => lines.push(line));
    lines.push("");
    lines.push("## Interaction States");
    lines.push("- Loading: skeleton or progress indicator for every async panel.");
    lines.push("- Empty: clear call-to-action and onboarding hint.");
    lines.push("- Error: actionable message and retry path.");
    lines.push("- Success: explicit confirmation toast/banner.");
    lines.push("");
    lines.push("## Responsive Strategy");
    lines.push("- Mobile: single-column layout, sticky primary actions.");
    lines.push("- Tablet: adaptive split layout where context helps.");
    lines.push("- Desktop: multi-panel productivity layout with clear hierarchy.");
    lines.push("");
    lines.push("## Component Inventory");
    lines.push("- Top navigation/header");
    lines.push("- Sidebar or tab navigation");
    lines.push("- Cards, tables, forms, and modal/drawer patterns");
    lines.push("- Feedback components (toast, inline alerts, banners)");
    lines.push("");
    lines.push("## Accessibility & Motion");
    lines.push("- Preserve keyboard navigation and visible focus states.");
    lines.push("- Ensure color contrast and semantic labels for interactive controls.");
    lines.push("- Keep motion subtle; respect reduced-motion preferences.");
    lines.push("");
    return lines.join("\n");
}

function buildStyleGuideDoc(input: {
    projectName: string;
    toolStack: string;
}) {
    const stackLine = input.toolStack?.trim()
        ? `- Stack reference: ${input.toolStack.split("\n")[0].trim()}`
        : "- Stack reference: follow generated stack table.";

    return [
        `# ${input.projectName || "generated-project"} Style Guide`,
        "",
        "## Color Tokens",
        "- `--bg`: base background",
        "- `--surface`: panel surface",
        "- `--text-primary`: primary text",
        "- `--text-muted`: secondary text",
        "- `--brand-primary`: main action color",
        "- `--status-success|warning|danger`: system feedback colors",
        "",
        "## Typography Scale",
        "- Display / Heading / Body / Caption levels must be explicit.",
        "- Define font-size, line-height, weight, and letter spacing for each level.",
        "- Keep paragraph width readable on desktop and mobile.",
        "",
        "## Spacing, Radius, Elevation",
        "- Spacing scale: 4, 8, 12, 16, 24, 32.",
        "- Radius scale: 8, 12, 16.",
        "- Elevation tokens for card/modal/dropdown surfaces.",
        "",
        "## Motion Rules",
        "- Standard duration: 120-220ms for UI transitions.",
        "- Use easing that prioritizes clarity over decoration.",
        "- Avoid chained animations that block interaction.",
        "",
        "## Accessibility Rules",
        "- Minimum contrast target: WCAG AA.",
        "- All controls need visible focus ring and descriptive labels.",
        "- Interactive areas should support keyboard and touch targets.",
        "",
        "## Component Behavior Rules",
        "- Button variants: primary, secondary, ghost, danger.",
        "- Form fields: default/focus/error/disabled states defined.",
        "- Data tables/cards: loading, empty, error, success states defined.",
        stackLine,
        ""
    ].join("\n");
}

function hasMinimumDocContent(text: string, minChars: number = 160) {
    return (text || "").trim().length >= minChars;
}

function buildFunctionalArchitectureDoc(input: {
    projectName: string;
    history: string;
    toolStack: string;
}) {
    const intents = extractUserIntentLinesStable(input.history, "en").slice(0, 6);
    const intentLines = intents.length > 0
        ? intents.map((line) => `- ${line}`)
        : ["- Define and lock business-critical functional requirements."];

    return [
        `# ${input.projectName || "generated-project"} Functional Architecture`,
        "",
        "## Purpose",
        "- Capture function-level architecture before UI implementation details.",
        "",
        "## Core Functional Domains",
        "- Authentication and session flow",
        "- Primary business workflow",
        "- Data persistence and retrieval",
        "- Error handling and recovery",
        "",
        "## Key Requirement Signals",
        ...intentLines,
        "",
        "## Boundaries",
        "- Define what is in scope for MVP vs later phases.",
        "- Clarify dependency boundaries between pages, APIs, and services.",
        "",
        "## Stack Notes",
        input.toolStack?.trim() ? input.toolStack.split("\n")[0].trim() : "- Follow generated stack table.",
        "",
        "## Non-Functional Baseline",
        "- Reliability: graceful failures and retries where required.",
        "- Security: protect secrets and validate untrusted input.",
        "- Performance: avoid expensive render-path work.",
        ""
    ].join("\n");
}

function buildUiFlowDoc(tree: any[]) {
    const pagePaths = collectFilePathsFromTree(tree).filter((path) => isPageSpecPath(path));
    const normalized = pagePaths.length > 0 ? pagePaths : ["app/page.tsx"];
    const lines: string[] = [];
    lines.push("# UI Flow");
    lines.push("");
    lines.push("## Primary Navigation Graph");
    normalized.forEach((path, index) => {
        const next = normalized[index + 1];
        if (next) {
            lines.push(`- \`${path}\` -> \`${next}\` (primary progression)`);
        } else {
            lines.push(`- \`${path}\` -> \`app/page.tsx\` (return/home)`);
        }
    });
    lines.push("");
    lines.push("## Error and Recovery Flow");
    lines.push("- Any page with async operations must expose retry and safe fallback navigation.");
    lines.push("- Authentication failures should redirect to login with preserved intent.");
    lines.push("");
    return lines.join("\n");
}

function buildComponentMapDoc(tree: any[]) {
    const allPaths = collectFilePathsFromTree(tree);
    const componentPaths = allPaths.filter((path) => /\/components\//i.test(path));
    const pagePaths = allPaths.filter((path) => isPageSpecPath(path));

    const lines: string[] = [];
    lines.push("# Component Map");
    lines.push("");
    lines.push("## Shared Components");
    if (componentPaths.length === 0) {
        lines.push("- Define reusable components under `components/` as UI contracts stabilize.");
    } else {
        componentPaths.slice(0, 40).forEach((path) => lines.push(`- \`${path}\``));
    }
    lines.push("");
    lines.push("## Page to Component Mapping");
    if (pagePaths.length === 0) {
        lines.push("- No page specs detected yet.");
    } else {
        pagePaths.slice(0, 40).forEach((path) => lines.push(`- \`${path}\` uses shared layout + domain components.`));
    }
    lines.push("");
    return lines.join("\n");
}

function buildInteractionStatesDoc(tree: any[]) {
    const pagePaths = collectFilePathsFromTree(tree).filter((path) => isPageSpecPath(path));
    const targets = pagePaths.length > 0 ? pagePaths : ["app/page.tsx"];

    const lines: string[] = [];
    lines.push("# Interaction States");
    lines.push("");
    lines.push("Each key page must define these states:");
    lines.push("- Loading");
    lines.push("- Empty");
    lines.push("- Error");
    lines.push("- Success");
    lines.push("");
    lines.push("## Coverage");
    targets.forEach((path) => lines.push(`- \`${path}\`: loading/empty/error/success required.`));
    lines.push("");
    return lines.join("\n");
}

function buildRouteMapDoc(tree: any[]) {
    const pagePaths = collectFilePathsFromTree(tree).filter((path) => isPageSpecPath(path));
    const lines: string[] = [];
    lines.push("# Route Map");
    lines.push("");
    lines.push("| Route | Spec Path | Notes |");
    lines.push("| --- | --- | --- |");
    if (pagePaths.length === 0) {
        lines.push("| / | app/page.tsx | Default route placeholder |");
    } else {
        pagePaths.slice(0, 60).forEach((path) => {
            const route = path
                .replace(/^src\//, "")
                .replace(/^apps\/[^/]+\//, "")
                .replace(/^app\//, "/")
                .replace(/\/page\.(tsx|ts|jsx|js)$/i, "")
                .replace(/^$/, "/");
            lines.push(`| ${route === "" ? "/" : route} | ${path} | Derived from page spec |`);
        });
    }
    lines.push("");
    return lines.join("\n");
}

function buildAcceptanceUiDoc(tree: any[]) {
    const pagePaths = collectFilePathsFromTree(tree).filter((path) => isPageSpecPath(path));
    return [
        "# UI Acceptance Checklist",
        "",
        "## Global",
        "- [ ] Typography, colors, spacing follow STYLE_GUIDE.",
        "- [ ] Keyboard navigation and focus visibility pass.",
        "- [ ] Responsive behavior verified on mobile and desktop.",
        "",
        "## Page-Level",
        ...(pagePaths.length > 0
            ? pagePaths.map((path) => `- [ ] ${path}: loading/empty/error/success verified.`)
            : ["- [ ] app/page.tsx: loading/empty/error/success verified."]),
        "",
        "## Release Gate",
        "- [ ] No blocking visual regressions.",
        "- [ ] UI docs and implementation are consistent.",
        ""
    ].join("\n");
}

function buildDesignTokensJson() {
    return JSON.stringify(
        {
            version: "design_tokens_v1",
            color: {
                bg: "{color.neutral.0}",
                surface: "{color.neutral.50}",
                textPrimary: "{color.neutral.900}",
                textMuted: "{color.neutral.500}",
                brandPrimary: "{color.brand.500}",
                success: "{color.semantic.success}",
                warning: "{color.semantic.warning}",
                danger: "{color.semantic.danger}"
            },
            typography: {
                display: { fontSize: 40, lineHeight: 48, fontWeight: 700 },
                heading: { fontSize: 28, lineHeight: 36, fontWeight: 600 },
                body: { fontSize: 16, lineHeight: 24, fontWeight: 400 },
                caption: { fontSize: 12, lineHeight: 16, fontWeight: 500 }
            },
            spacing: [4, 8, 12, 16, 24, 32],
            radius: [8, 12, 16],
            motion: {
                fastMs: 120,
                baseMs: 180,
                slowMs: 220,
                reducedMotionRespect: true
            }
        },
        null,
        2
    );
}

function buildPageContractsJson(tree: any[]) {
    const pagePaths = collectFilePathsFromTree(tree).filter((path) => isPageSpecPath(path));
    const pages = (pagePaths.length > 0 ? pagePaths : ["app/page.tsx"]).map((path) => ({
        id: path
            .replace(/\.(tsx|ts|jsx|js)$/i, "")
            .replace(/[^a-z0-9]+/gi, "-")
            .replace(/^-+|-+$/g, "")
            .toLowerCase(),
        path,
        requiredSections: ["Role & Responsibility", "UI Requirements", "Core Interactions"],
        requiredStates: ["loading", "empty", "error", "success"],
        responsiveRequired: true
    }));

    return JSON.stringify(
        {
            version: "ui_page_contracts_v1",
            pages
        },
        null,
        2
    );
}

function ensureUiDesignDocs(input: {
    tree: any[];
    projectName: string;
    history: string;
    toolStack: string;
    outputLanguage: OutputLanguage;
}) {
    const uiSpec = getFileContentByPath(input.tree, "docs/UI_SPEC.md");
    if (!validateUiSpecContent(uiSpec)) {
        upsertFileByPath(
            input.tree,
            "docs/UI_SPEC.md",
            buildUiSpecDoc({
                projectName: input.projectName,
                history: input.history,
                outputLanguage: input.outputLanguage
            })
        );
    }

    const styleGuide = getFileContentByPath(input.tree, "docs/STYLE_GUIDE.md");
    if (!validateStyleGuideContent(styleGuide)) {
        upsertFileByPath(
            input.tree,
            "docs/STYLE_GUIDE.md",
            buildStyleGuideDoc({
                projectName: input.projectName,
                toolStack: input.toolStack
            })
        );
    }

    const functionalArchitecture = getFileContentByPath(input.tree, "docs/FUNCTIONAL_ARCHITECTURE.md");
    if (!hasMinimumDocContent(functionalArchitecture)) {
        upsertFileByPath(
            input.tree,
            "docs/FUNCTIONAL_ARCHITECTURE.md",
            buildFunctionalArchitectureDoc({
                projectName: input.projectName,
                history: input.history,
                toolStack: input.toolStack
            })
        );
    }

    const uiFlow = getFileContentByPath(input.tree, "docs/UI_FLOW.md");
    if (!hasMinimumDocContent(uiFlow)) {
        upsertFileByPath(input.tree, "docs/UI_FLOW.md", buildUiFlowDoc(input.tree));
    }

    const componentMap = getFileContentByPath(input.tree, "docs/COMPONENT_MAP.md");
    if (!hasMinimumDocContent(componentMap)) {
        upsertFileByPath(input.tree, "docs/COMPONENT_MAP.md", buildComponentMapDoc(input.tree));
    }

    const interactionStates = getFileContentByPath(input.tree, "docs/INTERACTION_STATES.md");
    if (!hasMinimumDocContent(interactionStates)) {
        upsertFileByPath(input.tree, "docs/INTERACTION_STATES.md", buildInteractionStatesDoc(input.tree));
    }

    const routeMap = getFileContentByPath(input.tree, "docs/ROUTE_MAP.md");
    if (!hasMinimumDocContent(routeMap)) {
        upsertFileByPath(input.tree, "docs/ROUTE_MAP.md", buildRouteMapDoc(input.tree));
    }

    const acceptanceUi = getFileContentByPath(input.tree, "docs/ACCEPTANCE_UI.md");
    if (!hasMinimumDocContent(acceptanceUi)) {
        upsertFileByPath(input.tree, "docs/ACCEPTANCE_UI.md", buildAcceptanceUiDoc(input.tree));
    }

    const designTokens = getFileContentByPath(input.tree, "design/tokens.json");
    let tokensValid = false;
    try {
        JSON.parse(designTokens);
        tokensValid = designTokens.trim().length > 0;
    } catch {
        tokensValid = false;
    }
    if (!tokensValid) {
        upsertFileByPath(input.tree, "design/tokens.json", buildDesignTokensJson());
    }

    const pageContracts = getFileContentByPath(input.tree, "design/page-contracts.json");
    if (!validatePageContractsContent(pageContracts)) {
        upsertFileByPath(input.tree, "design/page-contracts.json", buildPageContractsJson(input.tree));
    }
}

function ensurePageUiRequirementSections(tree: any[]) {
    const pagePaths = collectFilePathsFromTree(tree).filter((path) => isPageSpecPath(path));
    for (const path of pagePaths) {
        const existing = getFileContentByPath(tree, path);
        if (!existing.trim()) continue;
        if (hasPageUiRequirements(existing)) continue;
        const appended = [
            existing.trim(),
            "",
            "## UI Requirements",
            "- Define layout structure and visual hierarchy.",
            "- List key UI components and their intent.",
            "- Specify loading, empty, error, and success states.",
            "- Describe responsive behavior for mobile/tablet/desktop."
        ].join("\n");
        upsertFileByPath(tree, path, appended);
    }
}

type DependencyClosure = {
    deps: Record<string, string>;
    devDeps: Record<string, string>;
};

const DEPENDENCY_CATALOG: Array<{ match: RegExp; deps?: Record<string, string>; devDeps?: Record<string, string> }> = [
    { match: /prisma/, deps: { "@prisma/client": "^5.22.0" }, devDeps: { prisma: "^5.22.0" } },
    { match: /nextauth|next-auth|auth\.js|@auth\/core/, deps: { "next-auth": "^5.0.0-beta.25" } },
    { match: /stripe/, deps: { stripe: "^17.3.1", "@stripe/stripe-js": "^4.10.0" } },
    { match: /supabase/, deps: { "@supabase/supabase-js": "^2.49.1", "@supabase/ssr": "^0.5.2" } },
    { match: /\bredis\b|ioredis/, deps: { ioredis: "^5.4.1" } },
    { match: /socket\.io|websocket/, deps: { "socket.io": "^4.8.1", "socket.io-client": "^4.8.1" } },
    { match: /\bexpress\b/, deps: { express: "^4.21.2" }, devDeps: { "@types/express": "^5.0.0" } },
    { match: /\bexpo\b|react native|react-native/, deps: { expo: "^52.0.21" } },
    { match: /recharts|chart/, deps: { recharts: "^2.13.0" } },
    { match: /\bxlsx\b|excel/, deps: { xlsx: "^0.18.5" } },
    { match: /pdf-parse|mammoth|docx|word|pdf/, deps: { "pdf-parse": "^1.1.1", mammoth: "^1.9.0" } },
    { match: /openai|@ai-sdk\/openai|vercel ai sdk/, deps: { ai: "^4.3.16", "@ai-sdk/openai": "^1.3.22" } },
    { match: /zod/, deps: { zod: "^3.23.8" } },
    { match: /react query|tanstack query/, deps: { "@tanstack/react-query": "^5.45.0" } },
    { match: /tailwind/, devDeps: { tailwindcss: "^3.4.1", postcss: "^8", autoprefixer: "^10.0.1" } },
    { match: /shadcn|class-variance-authority|tailwind-merge|clsx/, deps: { "class-variance-authority": "^0.7.1", clsx: "^2.1.1", "tailwind-merge": "^2.6.0" } },
    { match: /lucide/, deps: { "lucide-react": "^0.263.1" } },
    { match: /zustand/, deps: { zustand: "^4.5.2" } },
    { match: /turborepo|monorepo/, devDeps: { turbo: "^2.4.2" } }
];

function deriveDependencyClosure(input: {
    toolStack: string;
    analysisText: string;
    templateKind: TemplateKind;
}): DependencyClosure {
    const merged = `${input.toolStack || ""}\n${input.analysisText || ""}`.toLowerCase();
    const deps: Record<string, string> = {};
    const devDeps: Record<string, string> = {};

    for (const rule of DEPENDENCY_CATALOG) {
        if (!rule.match.test(merged)) continue;
        Object.assign(deps, rule.deps || {});
        Object.assign(devDeps, rule.devDeps || {});
    }

    if (input.templateKind === "monorepo_multiapp") {
        devDeps.turbo = devDeps.turbo || "^2.4.2";
    }

    return { deps, devDeps };
}

function generateEnvExample(input: {
    outputLanguage: OutputLanguage;
    templateKind: TemplateKind;
    dependencyClosure: DependencyClosure;
}) {
    const lines: string[] = [];
    lines.push("# Runtime");
    lines.push("NODE_ENV=development");
    lines.push("");
    lines.push("# App");
    lines.push("NEXT_PUBLIC_APP_NAME=Forecoding Generated App");
    lines.push("");

    const deps = { ...input.dependencyClosure.deps, ...input.dependencyClosure.devDeps };
    if (deps["@prisma/client"] || deps.prisma) {
        lines.push("# Database");
        lines.push("DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app");
        lines.push("");
    }
    if (deps["next-auth"]) {
        lines.push("# Auth");
        lines.push("NEXTAUTH_URL=http://localhost:3000");
        lines.push("NEXTAUTH_SECRET=replace_me");
        lines.push("");
    }
    if (deps["@supabase/supabase-js"]) {
        lines.push("# Supabase");
        lines.push("NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co");
        lines.push("NEXT_PUBLIC_SUPABASE_ANON_KEY=replace_me");
        lines.push("");
    }
    if (deps.stripe || deps["@stripe/stripe-js"]) {
        lines.push("# Stripe");
        lines.push("STRIPE_SECRET_KEY=sk_test_replace_me");
        lines.push("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_replace_me");
        lines.push("");
    }
    if (deps.ioredis) {
        lines.push("# Redis");
        lines.push("REDIS_URL=redis://localhost:6379");
        lines.push("");
    }
    if (deps["socket.io"]) {
        lines.push("# Socket");
        lines.push("SOCKET_SERVER_URL=http://localhost:3000");
        lines.push("");
    }
    if (input.templateKind === "monorepo_multiapp") {
        lines.push("# Monorepo");
        lines.push("TURBO_TELEMETRY_DISABLED=1");
        lines.push("");
    }

    if (input.outputLanguage === "zh") {
        lines.push("# 说明");
        lines.push("# 复制为 .env.local 后再运行。");
    } else {
        lines.push("# Notes");
        lines.push("# Copy this file to .env.local before running.");
    }

    return `${lines.join("\n").trim()}\n`;
}

function generatePackageJson(input: {
    framework: "next" | "react";
    usesPhaser: boolean;
    projectName: string;
    toolStack?: string;
    analysisText?: string;
    dependencyClosure?: DependencyClosure;
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
    const usesPrisma = /prisma/.test(stack);
    const usesNextAuth = /nextauth|next-auth|auth\.js|@auth\/core/.test(stack);
    const usesStripe = /stripe/.test(stack);
    const usesRecharts = /recharts|chart/.test(stack);
    const usesXlsx = /xlsx|excel/.test(stack);
    const usesRedis = /\bredis\b|ioredis/.test(stack);
    const usesSocketIo = /socket\.io|websocket/.test(stack);
    const usesExpress = /\bexpress\b/.test(stack);
    const usesExpo = /\bexpo\b|react native|react-native/.test(stack);

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
    if (usesPrisma) extraDeps["@prisma/client"] = "^5.22.0";
    if (usesNextAuth) extraDeps["next-auth"] = "^5.0.0-beta.25";
    if (usesStripe) extraDeps["stripe"] = "^17.3.1";
    if (usesStripe) extraDeps["@stripe/stripe-js"] = "^4.10.0";
    if (usesRecharts) extraDeps["recharts"] = "^2.13.0";
    if (usesXlsx) extraDeps["xlsx"] = "^0.18.5";
    if (usesRedis) extraDeps["ioredis"] = "^5.4.1";
    if (usesSocketIo) extraDeps["socket.io"] = "^4.8.1";
    if (usesSocketIo) extraDeps["socket.io-client"] = "^4.8.1";
    if (usesExpress) extraDeps["express"] = "^4.21.2";
    if (usesExpo) extraDeps["expo"] = "^52.0.21";

    const closureDeps = input.dependencyClosure?.deps || {};
    const closureDevDeps = input.dependencyClosure?.devDeps || {};
    const combinedDeps = { ...extraDeps, ...closureDeps };
    const combinedDevDeps = {
        typescript: "^5",
        "@types/node": "^20",
        "@types/react": "^18",
        "@types/react-dom": "^18",
        ...(usesTailwind ? { tailwindcss: "^3.4.1", postcss: "^8", autoprefixer: "^10.0.1" } : {}),
        ...closureDevDeps
    };

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
                ...combinedDeps
            }
            : {
                react: "^18.3.1",
                "react-dom": "^18.3.1",
                ...combinedDeps
            },
        devDependencies: combinedDevDeps,
        engines: {
            node: ">=18.17.0",
            npm: ">=9.0.0"
        }
    };

    return JSON.stringify(base, null, 2);
}

function generateMonorepoRootPackageJson(input: {
    projectName: string;
    dependencyClosure: DependencyClosure;
}) {
    const base = {
        name: sanitizeProjectName(input.projectName || "generated-monorepo"),
        version: "0.1.0",
        private: true,
        workspaces: ["apps/*", "packages/*"],
        scripts: {
            dev: "turbo run dev --parallel",
            build: "turbo run build",
            lint: "turbo run lint",
            "type-check": "turbo run type-check"
        },
        dependencies: {
            ...input.dependencyClosure.deps
        },
        devDependencies: {
            turbo: "^2.4.2",
            typescript: "^5",
            ...input.dependencyClosure.devDeps
        },
        engines: {
            node: ">=18.17.0",
            npm: ">=9.0.0"
        }
    };
    return JSON.stringify(base, null, 2);
}

function generateTurboConfigJson() {
    return JSON.stringify({
        "$schema": "https://turbo.build/schema.json",
        tasks: {
            dev: { cache: false, persistent: true },
            build: { dependsOn: ["^build"], outputs: [".next/**", "dist/**", "build/**"] },
            lint: { dependsOn: ["^lint"] },
            "type-check": { dependsOn: ["^type-check"] }
        }
    }, null, 2);
}

function generateTsconfig(input: { framework: "next" | "react"; templateKind?: TemplateKind }) {
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
        const basePath = input.templateKind === "next_src" ? "./src/" : "./";
        config.compilerOptions.paths = {
            "@/*": [`${basePath}*`],
            "@/components/*": [`${basePath}components/*`],
            "@/lib/*": [`${basePath}lib/*`]
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
    const normalized = name
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");

    if (!normalized) return "generated-project";
    if (/^\d+$/.test(normalized)) return `project-${normalized}`;
    if (!/^[a-z]/.test(normalized)) return `project-${normalized}`;
    if (normalized.length < 3) return `project-${normalized}`;
    return normalized;
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

function extractUserIntentLinesStable(history: string, outputLanguage: OutputLanguage) {
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

function buildStructuredReadmeStable(input: {
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
    const intents = extractUserIntentLinesStable(input.history, input.outputLanguage);

    if (input.outputLanguage === "zh") {
        const lines: string[] = [];
        lines.push(`# ${projectName} 开发指南`);
        lines.push("");
        lines.push("## 项目概述");
        lines.push(`该项目由 Forecoding 生成，目标是为 **${projectName}** 提供可执行的脚手架规范与实现顺序。`);
        lines.push("README 作为团队与 AI IDE 的统一入口，重点说明业务目标、运行方式、环境变量、验收标准与执行顺序。");
        lines.push("");
        lines.push("## 目标用户与业务目标");
        lines.push("- 目标用户：业务负责人、产品经理、工程师、AI IDE 协作开发者。");
        lines.push("- 核心目标：将需求讨论稳定转化为可执行实现计划，降低开发前不确定性。");
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
        lines.push("- **必须先阅读** `ONE_CLICK_PROMPT.md`。");
        lines.push("- `GENERATION_MANIFEST.json` 是机器可读任务图，按 phase 顺序执行。");
        lines.push("- `IMPLEMENTATION_PLAN.md` 是唯一实施顺序来源，不要按目录遍历。");
        lines.push("- 对于占位文件，使用对应目录 `_AI_PROMPT.md` 生成最终实现。");
        lines.push("");
        lines.push("## 验收清单");
        lines.push("- [ ] 项目可安装并成功启动。");
        lines.push("- [ ] Phase 0~6 输出物均完成并通过验证。");
        lines.push("- [ ] 关键页面与 API 行为符合需求。");
        lines.push("- [ ] README、IMPLEMENTATION_PLAN 与实现保持一致。");
        lines.push("- [ ] 无敏感信息泄露。");
        lines.push("");
        lines.push("## 常见问题");
        lines.push("### 1) 为什么 ZIP 中有些文件是占位内容？");
        lines.push("Forecoding 采用规范驱动策略：核心配置与文档直接可用，其余由 AI IDE 按阶段生成，降低一次性输出偏差。");
        lines.push("");
        lines.push("### 2) 应先改哪个文件？");
        lines.push("不要按目录直觉修改，必须按 `IMPLEMENTATION_PLAN.md` 的 Phase 顺序执行。");
        lines.push("");
        lines.push("### 3) README 与实现不一致怎么办？");
        lines.push("先更新 README 与 IMPLEMENTATION_PLAN，再同步实现。");
        lines.push("");
        lines.push("### 4) 如何保证交付质量？");
        lines.push("每个阶段执行验证命令，并在合并前完成手工回归。");
        lines.push("");
        return lines.join("\n");
    }

    const lines: string[] = [];
    lines.push(`# ${projectName} Development Guide`);
    lines.push("");
    lines.push("## Project Overview");
    lines.push(`This project is generated by Forecoding to provide an execution-ready scaffold for **${projectName}**.`);
    lines.push("README is the shared entry for humans and AI IDE agents, covering goals, runtime setup, environment variables, acceptance standards, and execution order.");
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
    lines.push("- **Read `ONE_CLICK_PROMPT.md` first.**");
    lines.push("- `GENERATION_MANIFEST.json` is the machine-readable task graph.");
    lines.push("- `IMPLEMENTATION_PLAN.md` is the only execution-order source.");
    lines.push("- For placeholder files, generate final code via directory-level `_AI_PROMPT.md`.");
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
    lines.push("Forecoding ships runnable baseline files and high-quality specs first, then lets AI IDE complete feature code by phase to reduce one-shot drift.");
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

function validateStructuredReadmeStable(readme: string, outputLanguage: OutputLanguage) {
    if (readme.trim().length < 900) return false;
    const requiredHeadings = outputLanguage === "zh"
        ? ["## 项目概述", "## 目标用户与业务目标", "## 技术栈", "## 项目结构", "## 快速开始", "## 环境变量", "## 开发流程", "## 验收清单", "## 常见问题"]
        : ["## Project Overview", "## Target Users & Business Goals", "## Tech Stack", "## Project Structure", "## Quick Start", "## Environment Variables", "## Development Workflow", "## Acceptance Checklist", "## FAQ"];
    return requiredHeadings.every((heading) => readme.includes(heading));
}

function ensureStructuredReadmeQualityStable(
    readme: string,
    input: {
        outputLanguage: OutputLanguage;
        projectName: string;
        toolStack: string;
        history: string;
        tree: any[];
    }
) {
    if (validateStructuredReadmeStable(readme, input.outputLanguage)) return readme;

    const rebuilt = buildStructuredReadmeStable(input);
    if (validateStructuredReadmeStable(rebuilt, input.outputLanguage)) return rebuilt;

    const supplement = input.outputLanguage === "zh"
        ? "\n## 附加说明\n- 若文档长度不足，请补充业务边界、失败场景、监控与回滚策略。\n- 每个 Phase 必须可验证、可回滚、可交接。\n"
        : "\n## Additional Guidance\n- If documentation is still short, expand business boundaries, failure modes, monitoring, and rollback instructions.\n- Every phase must be verifiable, reversible, and handoff-ready.\n";
    return `${rebuilt}\n${supplement}`;
}

function classifyImplementationPhase(filePath: string): number {
    const normalized = filePath.replace(/\\/g, "/");
    const withoutSrc = normalized.startsWith("src/") ? normalized.slice(4) : normalized;
    const bootstrapSet = new Set([
        "package.json",
        "tsconfig.json",
        "next.config.ts",
        "turbo.json",
        ".env.example",
        "README.md",
        "IMPLEMENTATION_PLAN.md",
        "ONE_CLICK_PROMPT.md",
        "GENERATION_MANIFEST.json",
        "_AI_PROMPT.md"
    ]);

    if (bootstrapSet.has(normalized)) return 0;
    if (normalized.endsWith("_AI_PROMPT.md")) return 6;
    if (withoutSrc.startsWith("types/")) return 1;
    if (/\/(schema|model|entity|domain)\b/i.test(withoutSrc)) return 1;
    if (withoutSrc === "app/layout.tsx" || withoutSrc === "app/layout.ts") return 3;
    if (withoutSrc.startsWith("components/layout/")) return 3;
    if (withoutSrc.startsWith("app/api/")) return 5;
    if (withoutSrc.startsWith("apps/") && /\/api\/|\/services\/|\/websockets\//i.test(withoutSrc)) return 5;
    if (/^app\/.+\/page\.(tsx|ts|jsx|js)$/i.test(withoutSrc) || withoutSrc === "app/page.tsx") return 4;
    if (withoutSrc.startsWith("components/")) return 4;
    if (withoutSrc.startsWith("lib/") && /(store|service|utils|helper|core|actions)/i.test(withoutSrc)) return 2;
    if (withoutSrc.startsWith("lib/")) return 2;
    if (/^apps\/.+\/src\/screens\/.+\.(tsx|ts|jsx|js)$/i.test(withoutSrc)) return 4;
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

const IMPLEMENTATION_PLAN_FILE_RE = /-\s+`([^`]+)`/g;

function isGuidanceArtifactPath(path: string) {
    return (
        path === "README.md" ||
        path === "IMPLEMENTATION_PLAN.md" ||
        path === "ONE_CLICK_PROMPT.md" ||
        path === "GENERATION_MANIFEST.json" ||
        path.endsWith("_AI_PROMPT.md")
    );
}

function collectActionableFilePaths(tree: any[]) {
    const all = collectFilePathsFromTree(tree);
    return all.filter((path) => !isGuidanceArtifactPath(path));
}

function getPhaseMeta(outputLanguage: OutputLanguage) {
    if (outputLanguage === "zh") {
        return [
            { title: "Phase 0 - 启动与基线", goal: "建立可运行基线，确保安装、启动、配置文件完整。", output: "完成运行基线文档与配置，团队可启动项目。", done: "依赖安装通过，开发环境可启动，README 与计划文件可读。" },
            { title: "Phase 1 - 领域模型与类型", goal: "先定义业务对象、类型边界和数据契约，避免后续返工。", output: "类型与领域模型稳定，供后续状态层与页面复用。", done: "关键类型可覆盖核心业务语义，类型检查通过。" },
            { title: "Phase 2 - 状态管理与核心逻辑", goal: "实现核心业务逻辑与状态流转，形成功能主干。", output: "状态层/服务层具备可调用能力。", done: "核心流程可在本地最小验证。" },
            { title: "Phase 3 - 应用壳层与共享布局", goal: "完善应用壳层和通用布局，统一导航与视觉骨架。", output: "可复用壳层和布局组件。", done: "页面基础布局稳定，可承载业务页面。" },
            { title: "Phase 4 - 功能页面与界面交互", goal: "实现业务页面与组件交互，打通用户侧操作路径。", output: "主要页面具备交互闭环。", done: "关键用户流程可端到端操作。" },
            { title: "Phase 5 - API 与集成层", goal: "实现服务端接口与外部集成，连接前后端数据流。", output: "API 契约可用，集成边界明确。", done: "前后端对接成功，接口返回稳定。" },
            { title: "Phase 6 - 验证与交付", goal: "执行静态检查、构建验证与人工回归，形成可交付状态。", output: "最终交付包与文档一致。", done: "lint/type-check/build 通过，关键场景回归完成。" }
        ] as const;
    }

    return [
        { title: "Phase 0 - Bootstrap", goal: "Establish runnable baseline, configs, and onboarding docs.", output: "Runnable baseline with setup documentation.", done: "Dependencies install, app starts, docs are available." },
        { title: "Phase 1 - Domain & Types", goal: "Define domain objects and type contracts before implementation.", output: "Stable type boundaries for feature work.", done: "Type contracts cover key business entities." },
        { title: "Phase 2 - State & Core Logic", goal: "Implement state transitions and core business logic.", output: "Callable core logic/state layer.", done: "Core flow is minimally executable locally." },
        { title: "Phase 3 - App Shell & Shared UI", goal: "Set up shared shell/layout and reusable structure.", output: "Stable layout and shared shell components.", done: "Pages can mount on consistent layout." },
        { title: "Phase 4 - Feature UI & Pages", goal: "Implement user-facing pages and component interactions.", output: "Feature pages with usable interaction loops.", done: "Primary user journeys are navigable end-to-end." },
        { title: "Phase 5 - API & Integration", goal: "Build backend routes and external integration boundaries.", output: "Usable API contracts and integration flow.", done: "Frontend/backend integration works stably." },
        { title: "Phase 6 - Validation & Handoff", goal: "Run static checks, build validation, and manual QA.", output: "Ship-ready handoff package.", done: "lint/type-check/build pass and key QA completed." }
    ] as const;
}

function buildPhasePlansForTree(tree: any[], outputLanguage: OutputLanguage): PhasePlan[] {
    const scripts = readPackageScripts(tree);
    const actionableFiles = collectActionableFilePaths(tree);
    const phases = new Map<number, string[]>();
    for (let i = 0; i <= 6; i++) phases.set(i, []);

    for (const filePath of actionableFiles) {
        const phase = classifyImplementationPhase(filePath);
        phases.get(phase)?.push(filePath);
    }

    const meta = getPhaseMeta(outputLanguage);
    const result: PhasePlan[] = [];
    for (let i = 0; i <= 6; i++) {
        const files = (phases.get(i) || []).slice().sort((a, b) => a.localeCompare(b));
        const phaseMeta = meta[i];
        result.push({
            phase: i,
            title: phaseMeta.title,
            goal: phaseMeta.goal,
            inputFiles: files,
            expectedOutput: phaseMeta.output,
            doneCriteria: phaseMeta.done,
            validationCommands: buildPhaseValidationCommands(i, scripts)
        });
    }

    return result;
}

function renderImplementationPlan(outputLanguage: OutputLanguage, projectName: string, phasePlans: PhasePlan[]) {
    if (outputLanguage === "zh") {
        const lines: string[] = [];
        lines.push(`# ${projectName || "generated-project"} 实施执行计划`);
        lines.push("");
        lines.push("> 本文件定义 AI IDE 的唯一执行顺序。请严格按 Phase 0 -> Phase 6 执行，不要按目录遍历顺序直接实现。");
        lines.push("");
        for (const phase of phasePlans) {
            lines.push(`## ${phase.title}`);
            lines.push("");
            lines.push("### 目标");
            lines.push(phase.goal);
            lines.push("");
            lines.push("### 输入文件");
            if (phase.inputFiles.length === 0) {
                lines.push("- （无）");
            } else {
                phase.inputFiles.forEach((file) => lines.push(`- \`${file}\``));
            }
            lines.push("");
            lines.push("### 输出定义");
            lines.push(phase.expectedOutput);
            lines.push("");
            lines.push("### 完成条件");
            lines.push(`- ${phase.doneCriteria}`);
            lines.push("");
            lines.push("### 验证命令");
            lines.push("```bash");
            phase.validationCommands.forEach((cmd) => lines.push(cmd));
            lines.push("```");
            lines.push("");
        }
        lines.push("## 交接要求");
        lines.push("- 每个 Phase 完成后更新 README 与实现状态。");
        lines.push("- 若需求发生变化，先更新计划，再更新实现。");
        lines.push("- 提交前确保验证命令全部通过。");
        lines.push("");
        return lines.join("\n");
    }

    const lines: string[] = [];
    lines.push(`# ${projectName || "generated-project"} Implementation Plan`);
    lines.push("");
    lines.push("> This file is the single source of execution order for AI IDE. Follow Phase 0 -> Phase 6 strictly. Do not implement by raw directory order.");
    lines.push("");
    for (const phase of phasePlans) {
        lines.push(`## ${phase.title}`);
        lines.push("");
        lines.push("### Goal");
        lines.push(phase.goal);
        lines.push("");
        lines.push("### Input Files");
        if (phase.inputFiles.length === 0) {
            lines.push("- (none)");
        } else {
            phase.inputFiles.forEach((file) => lines.push(`- \`${file}\``));
        }
        lines.push("");
        lines.push("### Expected Output");
        lines.push(phase.expectedOutput);
        lines.push("");
        lines.push("### Done Criteria");
        lines.push(`- ${phase.doneCriteria}`);
        lines.push("");
        lines.push("### Validation Commands");
        lines.push("```bash");
        phase.validationCommands.forEach((cmd) => lines.push(cmd));
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

function buildImplementationPlanStable(input: {
    outputLanguage: OutputLanguage;
    projectName: string;
    tree: any[];
}) {
    const phasePlans = buildPhasePlansForTree(input.tree, input.outputLanguage);
    const placeholderPaths = collectPlaceholderPaths(input.tree);
    if (placeholderPaths.length > 0) {
        const existing = new Set(phasePlans.flatMap((phase) => phase.inputFiles));
        const uncovered = placeholderPaths.filter((path) => !existing.has(path));
        if (uncovered.length > 0) {
            const phase4 = phasePlans.find((phase) => phase.phase === 4);
            if (phase4) {
                phase4.inputFiles = [...phase4.inputFiles, ...uncovered].sort((a, b) => a.localeCompare(b));
            }
        }
    }
    return renderImplementationPlan(input.outputLanguage, input.projectName, phasePlans);
}

function collectPlaceholderPaths(tree: any[]) {
    return collectFilePathsFromTree(tree)
        .filter((path) => !shouldWriteRealContentByPath(path))
        .sort((a, b) => a.localeCompare(b));
}

function buildScaffoldSpecContent(input: {
    filePath: string;
    outputLanguage: OutputLanguage;
    projectName: string;
    focus: string;
}) {
    const fileName = input.filePath.split("/").pop() || input.filePath;
    const isApi = /\/api\/|route\.(ts|js)$/i.test(input.filePath);
    const isPage = /page\.(tsx|ts|jsx|js)$/i.test(fileName);
    const isLayout = /layout\.(tsx|ts|jsx|js)$/i.test(fileName);
    const isComponent = /components\//i.test(input.filePath);
    const isType = /types\//i.test(input.filePath) || /types?\.(ts|tsx)$/i.test(fileName);
    const languageHint = input.outputLanguage === "zh"
        ? "UI copy should be Chinese-first while preserving technical identifiers."
        : "UI copy should be English-first with concise wording.";

    if (isApi) {
        return [
            "# API Spec",
            "",
            "## Role & Responsibility",
            `- Serve ${input.focus} backend endpoints with validated input/output contracts.`,
            "",
            "## Core Interactions",
            "- `POST`: accept parsed document content and return structured risk findings.",
            "- `GET`: return recent analysis summary for refresh/recovery scenarios.",
            "",
            "## Output Constraints",
            "- Return stable JSON schema.",
            "- Never leak raw stack traces.",
            `- ${languageHint}`
        ].join("\n");
    }

    if (isLayout) {
        return [
            "# Layout Spec",
            "",
            "## Role & Responsibility",
            `- Provide shared app shell for ${input.projectName}.`,
            "",
            "## Core Interactions",
            "- Render global header/nav and content container.",
            "- Reserve global notice and error area.",
            `- ${languageHint}`
        ].join("\n");
    }

    if (isPage) {
        return [
            "# Page Spec",
            "",
            "## Role & Responsibility",
            `- Host primary ${input.focus} user flow.`,
            "",
            "## UI Requirements",
            "- Define page layout hierarchy (header/content/footer or split panels).",
            "- Specify key components and information priority.",
            "- Include loading, empty, error, and success states.",
            "- Ensure mobile/tablet/desktop responsive behavior.",
            "",
            "## Core Interactions",
            "- Upload files, preview risks, export report.",
            "- Handle loading/failure/retry and history navigation.",
            `- ${languageHint}`
        ].join("\n");
    }

    if (isComponent) {
        return [
            "# Component Spec",
            "",
            "## Role & Responsibility",
            `- Reusable interaction component for ${input.focus}.`,
            "",
            "## Core Interactions",
            "- Receive typed props and emit explicit callbacks.",
            "- Keep lightweight local state and lift business logic to services."
        ].join("\n");
    }

    if (isType) {
        return [
            "# Type Spec",
            "",
            "## Role & Responsibility",
            `- Define contracts for ${input.focus}.`,
            "",
            "## Output Constraints",
            "- Avoid `any`, prefer explicit interfaces/unions.",
            "- Keep names aligned with API payloads."
        ].join("\n");
    }

    return [
        "# Module Spec",
        "",
        "## Role & Responsibility",
        `- Implement core logic for ${input.focus}.`,
        "",
        "## Core Interactions",
        "- Export testable functions/services."
    ].join("\n");
}

function toKebabToken(text: string) {
    const sanitized = (text || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return sanitized;
}

function deriveFeatureSlug(projectName: string, history: string) {
    const projectToken = toKebabToken(projectName)
        .split("-")
        .find((token) => token.length >= 3 && !["app", "project", "platform", "system"].includes(token));
    if (projectToken) return projectToken;

    const historyTokens = (history || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3)
        .filter((token) => !["the", "and", "for", "with", "that", "this", "from", "user", "assistant"].includes(token));
    if (historyTokens.length > 0) return historyTokens[0];

    return "core";
}

function toPascalToken(token: string) {
    return token
        .split("-")
        .filter(Boolean)
        .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
        .join("") || "Core";
}

function buildActionableFloorFiles(templateKind: TemplateKind, featureSlug: string) {
    const safeSlug = toKebabToken(featureSlug) || "core";
    const featureComponent = `${toPascalToken(safeSlug)}Panel`;

    if (templateKind === "monorepo_multiapp") {
        return [
            "apps/web/app/layout.tsx",
            "apps/web/app/page.tsx",
            `apps/web/app/${safeSlug}/page.tsx`,
            `apps/web/app/api/${safeSlug}/route.ts`,
            `apps/web/components/${safeSlug}/${featureComponent}.tsx`,
            `apps/web/lib/${safeSlug}/client.ts`,
            `apps/backend/src/services/${safeSlug}.service.ts`,
            `packages/domain/src/${safeSlug}.types.ts`
        ];
    }

    const base = templateKind === "next_src" ? "src/" : "";
    return [
        `${base}app/layout.tsx`,
        `${base}app/page.tsx`,
        `${base}app/${safeSlug}/page.tsx`,
        `${base}app/api/${safeSlug}/route.ts`,
        `${base}components/${safeSlug}/${featureComponent}.tsx`,
        `${base}lib/${safeSlug}/service.ts`,
        `${base}types/${safeSlug}.ts`
    ];
}

function ensureMinimumActionableScaffold(input: {
    tree: any[];
    templateKind: TemplateKind;
    outputLanguage: OutputLanguage;
    projectName: string;
    history: string;
    force?: boolean;
}) {
    const existingPlaceholderPaths = collectPlaceholderPaths(input.tree);
    if (!input.force && existingPlaceholderPaths.length > 0) return;

    const intents = extractUserIntentLinesStable(input.history, input.outputLanguage);
    const focus = intents[0] || "core business";
    const featureSlug = deriveFeatureSlug(input.projectName, input.history);
    const defaultFiles = buildActionableFloorFiles(input.templateKind, featureSlug);

    for (const filePath of defaultFiles) {
        if (getFileContentByPath(input.tree, filePath)) continue;
        upsertFileByPath(
            input.tree,
            filePath,
            buildScaffoldSpecContent({
                filePath,
                outputLanguage: input.outputLanguage,
                projectName: input.projectName,
                focus
            })
        );
    }
}

function resolvePromptPathForFile(filePath: string) {
    const normalized = filePath.replace(/\\/g, "/");
    const idx = normalized.lastIndexOf("/");
    if (idx === -1) return "_AI_PROMPT.md";
    const dir = normalized.slice(0, idx);
    return `${dir}/_AI_PROMPT.md`;
}

function buildOneClickPrompt(input: {
    outputLanguage: OutputLanguage;
    oneClickMode: OneClickMode;
}) {
    if (input.outputLanguage === "zh") {
        return [
            "# 一键生成执行指令",
            "",
            "> 本文件是 AI IDE 的单入口。先读 `GENERATION_MANIFEST.json`，再执行实现。",
            "",
            "## 执行步骤",
            "1. 打开 `GENERATION_MANIFEST.json`，按 `phases` 顺序执行（Phase 0 -> Phase 6）。",
            "2. 对于每个任务文件：打开 `promptPath` 指定的 `_AI_PROMPT.md`，生成并替换 `GENERATION PENDING` 占位内容。",
            "3. 每完成一个 Phase，执行对应 `validationCommands`。",
            "4. 若验证失败，先修复本 Phase 再进入下一 Phase。",
            "",
            "## 硬性约束",
            "- 执行模式：`strict_build_v1`。",
            "- 不要按目录遍历顺序实现，必须按 Phase。",
            "- 不要改写核心配置文件协议（`package.json`、`tsconfig.json`、`next.config.ts`、`.env.example`）。",
            "",
            "## 最终验收",
            "```bash",
            "npm install",
            "npm run build",
            "```",
            ""
        ].join("\n");
    }

    return [
        "# One-Click Generation Runbook",
        "",
        "> This file is the single AI IDE entrypoint. Read `GENERATION_MANIFEST.json` first, then execute.",
        "",
        "## Execution Steps",
        "1. Open `GENERATION_MANIFEST.json` and execute tasks by phase order (Phase 0 -> Phase 6).",
        "2. For each task file, open its `_AI_PROMPT.md` (`promptPath`) and replace `GENERATION PENDING` placeholders.",
        "3. Run phase `validationCommands` before moving forward.",
        "4. If validation fails, fix the current phase before continuing.",
        "",
        "## Hard Constraints",
        "- Mode: `strict_build_v1`.",
        "- Do not implement by raw directory traversal. Follow phases only.",
        "- Do not rewrite core baseline config contracts (`package.json`, `tsconfig.json`, `next.config.ts`, `.env.example`).",
        "",
        "## Final Gate",
        "```bash",
        "npm install",
        "npm run build",
        "```",
        ""
    ].join("\n");
}

function buildRootInstructionOnlyPrompt(input: {
    outputLanguage: OutputLanguage;
    oneClickMode: OneClickMode;
    ideProfile: IdeProfile;
}) {
    if (input.outputLanguage === "zh") {
        return [
            "# AI 任务索引（根目录）",
            "",
            "## 强制顺序",
            "1. 先阅读 `ONE_CLICK_PROMPT.md`。",
            "2. 再读取 `GENERATION_MANIFEST.json` 并按 Phase 执行。",
            "3. `_AI_PROMPT.md` 仅作索引与约束，不是执行顺序来源。",
            "",
            "## 运行策略",
            `- oneClickMode: \`${input.oneClickMode}\``,
            `- ideProfile: \`${input.ideProfile}\``,
            "",
            "## 关键文件",
            "- `ONE_CLICK_PROMPT.md`",
            "- `GENERATION_MANIFEST.json`",
            "- `IMPLEMENTATION_PLAN.md`",
            ""
        ].join("\n");
    }

    return [
        "# AI Task Index (Root)",
        "",
        "## Mandatory Order",
        "1. Read `ONE_CLICK_PROMPT.md` first.",
        "2. Then read `GENERATION_MANIFEST.json` and execute by phases.",
        "3. Treat `_AI_PROMPT.md` as index/constraints only, never as execution order source.",
        "",
        "## Runtime Strategy",
        `- oneClickMode: \`${input.oneClickMode}\``,
        `- ideProfile: \`${input.ideProfile}\``,
        "",
        "## Key Files",
        "- `ONE_CLICK_PROMPT.md`",
        "- `GENERATION_MANIFEST.json`",
        "- `IMPLEMENTATION_PLAN.md`",
        ""
    ].join("\n");
}

function buildRootAiPrompt(input: {
    outputLanguage: OutputLanguage;
    manifest: GenerationManifest;
    oneClickMode: OneClickMode;
    ideProfile: IdeProfile;
}) {
    const header = buildRootInstructionOnlyPrompt({
        outputLanguage: input.outputLanguage,
        oneClickMode: input.oneClickMode,
        ideProfile: input.ideProfile
    });

    const taskHeading = input.outputLanguage === "zh" ? "## 全量占位任务" : "## All Placeholder Tasks";
    const phaseLabel = input.outputLanguage === "zh" ? "阶段" : "Phase";
    const lines: string[] = [header.trim(), "", taskHeading, ""];
    for (const task of input.manifest.tasks) {
        lines.push(`- ${phaseLabel} ${task.phase}: \`${task.filePath}\` -> \`${task.promptPath}\``);
    }
    lines.push("");
    return lines.join("\n");
}

function buildGenerationManifest(input: {
    tree: any[];
    outputLanguage: OutputLanguage;
    templateKind: TemplateKind;
    oneClickMode: OneClickMode;
    ideProfile: IdeProfile;
}): GenerationManifest {
    const phasePlans = buildPhasePlansForTree(input.tree, input.outputLanguage);
    const taskIdByPath = new Map<string, string>();
    const tasks: GenerationTask[] = [];
    const placeholderPaths = collectPlaceholderPaths(input.tree);
    const phaseByPath = new Map<string, number>();
    const phaseTitleByIndex = new Map<number, string>();

    for (const phase of phasePlans) {
        phaseTitleByIndex.set(phase.phase, phase.title);
        for (const path of phase.inputFiles) {
            if (!phaseByPath.has(path)) phaseByPath.set(path, phase.phase);
        }
    }

    for (const filePath of placeholderPaths) {
        const phase = phaseByPath.get(filePath) ?? classifyImplementationPhase(filePath);
        const phaseTitle = phaseTitleByIndex.get(phase) || `Phase ${phase}`;
        const taskId = `task_${tasks.length + 1}`;
        taskIdByPath.set(filePath, taskId);
        tasks.push({
            id: taskId,
            phase,
            phaseTitle,
            filePath,
            promptPath: resolvePromptPathForFile(filePath),
            dependencies: []
        });
    }

    for (const task of tasks) {
        const deps = tasks
            .filter((candidate) => candidate.phase < task.phase)
            .map((candidate) => candidate.id);
        task.dependencies = deps;
    }

    return {
        version: "one_click_manifest_v1",
        templateKind: input.templateKind,
        outputLanguage: input.outputLanguage,
        oneClickMode: input.oneClickMode,
        ideProfile: input.ideProfile,
        generatedAt: new Date().toISOString(),
        tasks,
        phases: phasePlans
    };
}

function parseImplementationPlanInputFiles(planContent: string) {
    const result = new Set<string>();
    const matches = planContent.matchAll(IMPLEMENTATION_PLAN_FILE_RE);
    for (const match of matches) {
        const value = match[1]?.trim();
        if (!value) continue;
        result.add(value);
    }
    return result;
}

function parsePackageDependencyKeys(packageJsonText: string) {
    const deps = new Set<string>();
    if (!packageJsonText.trim()) return deps;
    try {
        const parsed = JSON.parse(packageJsonText) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
        };
        Object.keys(parsed.dependencies || {}).forEach((key) => deps.add(key));
        Object.keys(parsed.devDependencies || {}).forEach((key) => deps.add(key));
    } catch {
        return deps;
    }
    return deps;
}

function detectDocumentLanguage(text: string): OutputLanguage {
    const chinese = (text.match(/[\u3400-\u9fff]/g) || []).length;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    if (chinese >= 6) return "zh";
    if (chinese >= 2 && chinese / Math.max(1, chinese + latin) >= 0.08) return "zh";
    return "en";
}

function validateNextConfigContent(text: string) {
    const source = (text || "").trim();
    if (!source) return false;
    if (/##\s+Quality Constraints/i.test(source)) return false;
    if (/```/.test(source)) return false;
    if (!/export\s+default\s+nextConfig/.test(source)) return false;
    return true;
}

function validateUiSpecContent(text: string) {
    const source = (text || "").trim();
    if (source.length < 320) return false;
    const required = [
        /##\s+Product Surface/i,
        /##\s+Key Screens/i,
        /##\s+Interaction States/i,
        /##\s+Responsive Strategy/i,
        /##\s+Component Inventory/i,
        /##\s+Accessibility/i
    ];
    return required.every((pattern) => pattern.test(source));
}

function validateStyleGuideContent(text: string) {
    const source = (text || "").trim();
    if (source.length < 280) return false;
    const required = [
        /##\s+Color Tokens/i,
        /##\s+Typography/i,
        /##\s+Spacing/i,
        /##\s+Motion/i,
        /##\s+Accessibility/i,
        /##\s+Component Behavior/i
    ];
    return required.every((pattern) => pattern.test(source));
}

function validatePageContractsContent(text: string) {
    const source = (text || "").trim();
    if (!source) return false;
    try {
        const parsed = JSON.parse(source) as {
            version?: string;
            pages?: Array<{ path?: string; requiredStates?: string[]; requiredSections?: string[] }>;
        };
        if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) return false;
        const hasInvalidPage = parsed.pages.some((page) => (
            typeof page.path !== "string" ||
            page.path.trim().length === 0 ||
            !Array.isArray(page.requiredStates) ||
            page.requiredStates.length === 0 ||
            !Array.isArray(page.requiredSections) ||
            page.requiredSections.length === 0
        ));
        return !hasInvalidPage;
    } catch {
        return false;
    }
}

function isPageSpecPath(path: string) {
    const normalized = (path || "").replace(/\\/g, "/");
    if (/^app\/(?:.+\/)?page\.(tsx|ts|jsx|js)$/i.test(normalized)) return true;
    if (/^src\/app\/(?:.+\/)?page\.(tsx|ts|jsx|js)$/i.test(normalized)) return true;
    if (/^apps\/[^/]+\/app\/(?:.+\/)?page\.(tsx|ts|jsx|js)$/i.test(normalized)) return true;
    return false;
}

function hasPageUiRequirements(content: string) {
    const source = (content || "").trim();
    if (!source) return false;
    return (
        /##\s+UI Requirements/i.test(source) ||
        /##\s+UI Spec/i.test(source) ||
        /##\s+Interface Requirements/i.test(source)
    );
}

function collectPagesMissingUiRequirements(tree: any[]) {
    const pagePaths = collectFilePathsFromTree(tree).filter((path) => isPageSpecPath(path));
    const missing = pagePaths.filter((path) => !hasPageUiRequirements(getFileContentByPath(tree, path)));
    return {
        pagePaths,
        missing
    };
}

function deriveMissingDependencies(toolStack: string, packageJsonText: string) {
    const closure = deriveDependencyClosure({
        toolStack,
        analysisText: toolStack,
        templateKind: "next_root"
    });
    const expected = new Set<string>([
        ...Object.keys(closure.deps || {}),
        ...Object.keys(closure.devDeps || {})
    ]);
    const actual = parsePackageDependencyKeys(packageJsonText);
    const missing = Array.from(expected).filter((name) => !actual.has(name));
    return missing;
}

function runGenerationPreflight(input: {
    tree: any[];
    outputLanguage: OutputLanguage;
    toolStack: string;
    manifest: GenerationManifest;
    pathNormalizationFixCount: number;
}): PreflightReport {
    const issues: PreflightIssue[] = [];
    const nextConfig = getFileContentByPath(input.tree, "next.config.ts");
    const nextConfigValid = validateNextConfigContent(nextConfig);
    if (!nextConfigValid) {
        issues.push({
            code: "NEXT_CONFIG_CONTAMINATED",
            severity: "error",
            message: "`next.config.ts` contains invalid scaffold text."
        });
    }

    const envExamplePresent = Boolean(getFileContentByPath(input.tree, ".env.example"));
    if (!envExamplePresent) {
        issues.push({
            code: "MISSING_ENV_EXAMPLE",
            severity: "error",
            message: "`.env.example` is missing."
        });
    }

    const uiSpecValid = validateUiSpecContent(getFileContentByPath(input.tree, "docs/UI_SPEC.md"));
    const styleGuideValid = validateStyleGuideContent(getFileContentByPath(input.tree, "docs/STYLE_GUIDE.md"));
    const pageContractsValid = validatePageContractsContent(getFileContentByPath(input.tree, "design/page-contracts.json"));
    if (!uiSpecValid || !styleGuideValid || !pageContractsValid) {
        const missingDocs: string[] = [];
        if (!uiSpecValid) missingDocs.push("docs/UI_SPEC.md");
        if (!styleGuideValid) missingDocs.push("docs/STYLE_GUIDE.md");
        if (!pageContractsValid) missingDocs.push("design/page-contracts.json");
        issues.push({
            code: "MISSING_UI_SPEC",
            severity: "error",
            message: "UI documentation is missing or incomplete.",
            details: missingDocs.join(", ")
        });
    }

    const pageUiCoverage = collectPagesMissingUiRequirements(input.tree);
    if (pageUiCoverage.pagePaths.length === 0 || pageUiCoverage.missing.length > 0) {
        issues.push({
            code: "MISSING_PAGE_UI_REQUIREMENTS",
            severity: "error",
            message: "Page specs must include `## UI Requirements` sections.",
            details:
                pageUiCoverage.pagePaths.length === 0
                    ? "No page specs found under app/**/page.*"
                    : pageUiCoverage.missing.slice(0, 10).join(", ")
        });
    }

    const placeholderPaths = collectPlaceholderPaths(input.tree);
    if (placeholderPaths.length === 0) {
        issues.push({
            code: "EMPTY_GENERATION_TASKS",
            severity: "error",
            message: "No actionable placeholder files were generated for one-click execution."
        });
    }
    const planContent = getFileContentByPath(input.tree, "IMPLEMENTATION_PLAN.md");
    const planFiles = parseImplementationPlanInputFiles(planContent);
    const uncovered = placeholderPaths.filter((path) => !planFiles.has(path));
    const planCoveragePct = placeholderPaths.length === 0
        ? 0
        : Math.round(((placeholderPaths.length - uncovered.length) / placeholderPaths.length) * 1000) / 10;
    if (uncovered.length > 0) {
        issues.push({
            code: "PLAN_COVERAGE_INCOMPLETE",
            severity: "error",
            message: "Implementation plan does not cover all placeholder files.",
            details: uncovered.slice(0, 10).join(", ")
        });
    }

    const invalidPromptRefs = input.manifest.tasks.filter((task) => !task.promptPath.endsWith("_AI_PROMPT.md"));
    if (invalidPromptRefs.length > 0) {
        issues.push({
            code: "INVALID_PROMPT_REFERENCE",
            severity: "error",
            message: "Manifest contains invalid prompt references."
        });
    }
    if (input.manifest.tasks.length === 0) {
        issues.push({
            code: "EMPTY_GENERATION_TASKS",
            severity: "error",
            message: "Manifest task graph is empty."
        });
    }
    if (input.manifest.tasks.length > 0 && input.manifest.tasks.length !== placeholderPaths.length) {
        issues.push({
            code: "INVALID_PROMPT_REFERENCE",
            severity: "error",
            message: "Manifest task count does not match placeholder file count."
        });
    }

    const duplicateSegmentPaths = collectFilePathsFromTree(input.tree).filter((path) => {
        const segments = path.split("/");
        for (let i = 1; i < segments.length; i++) {
            if (segments[i] === segments[i - 1]) return true;
        }
        return false;
    });
    if (duplicateSegmentPaths.length > 0) {
        issues.push({
            code: "DUPLICATE_PATH_SEGMENT",
            severity: "error",
            message: "Found duplicate path segments in generated files.",
            details: duplicateSegmentPaths.slice(0, 10).join(", ")
        });
    }

    const readmeLanguage = detectDocumentLanguage(getFileContentByPath(input.tree, "README.md"));
    const rootPromptLanguage = detectDocumentLanguage(getFileContentByPath(input.tree, "_AI_PROMPT.md"));
    if (readmeLanguage !== rootPromptLanguage || readmeLanguage !== input.outputLanguage) {
        issues.push({
            code: "LANGUAGE_MISMATCH",
            severity: "error",
            message: "Generated docs and prompts are not language-consistent."
        });
    }

    const missingDeps = deriveMissingDependencies(
        input.toolStack,
        getFileContentByPath(input.tree, "package.json")
    );
    if (missingDeps.length > 0) {
        issues.push({
            code: "MISSING_STACK_DEPENDENCIES",
            severity: "warning",
            message: "Some stack dependencies are missing from package.json.",
            details: missingDeps.slice(0, 10).join(", ")
        });
    }

    return {
        pass: issues.every((issue) => issue.severity !== "error"),
        planCoveragePct,
        placeholderCount: placeholderPaths.length,
        nextConfigValid,
        envExamplePresent,
        pathNormalizationFixCount: input.pathNormalizationFixCount,
        missingDepsCount: missingDeps.length,
        manifestTaskCount: input.manifest.tasks.length,
        issues
    };
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

void ensureStructuredReadmeQuality;
void buildImplementationPlan;

function enhanceProjectTreeSpecs(projectTree: any[], toolStack: string): any[] {
    const stack = (toolStack || "").toLowerCase();
    const usesZod = /\bzod\b/.test(stack);

    const codeFilePattern = /\.(ts|tsx|js|jsx)$/i;
    const exemptCodeFiles = new Set([
        "next.config.ts",
        "next.config.js",
        "turbo.json"
    ]);

    const traverse = (nodes: any[], path: string) => {
        for (const node of nodes) {
            if (node.type === "folder" && node.children) {
                traverse(node.children, `${path}${node.name}/`);
                continue;
            }

            if (node.type !== "file" || !node.name) continue;
            const filePath = `${path}${node.name}`;
            if (!codeFilePattern.test(node.name)) continue;
            if (exemptCodeFiles.has(filePath)) continue;
            if (filePath === "package.json" || filePath === "tsconfig.json") continue;

            const existing = node.content || "";
            const qualitySection = buildQualitySection(filePath, { usesZod });
            const templateSection = buildTemplateSection(filePath, { usesZod });
            const antiPatternSection = buildAntiPatternSection(filePath);
            const goodBadSection = buildGoodBadSection(filePath);

            const sections: string[] = [];
            if (!/##\s+Quality Constraints/i.test(existing)) sections.push(qualitySection);
            if (!/##\s+Template Guidance/i.test(existing)) sections.push(templateSection);
            if (!/##\s+Anti-Patterns/i.test(existing)) sections.push(antiPatternSection);
            if (!/##\s+Good\s+vs\s+Bad\s+Examples/i.test(existing)) sections.push(goodBadSection);

            if (sections.length > 0) {
                node.content = `${existing}\n\n${sections.join("\n\n")}`.trim();
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


