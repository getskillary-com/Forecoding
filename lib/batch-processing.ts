
import { GoogleGenerativeAI } from "@google/generative-ai";
import { FileNode } from "@/types";

const apiKey = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(apiKey);
const MODEL_NAME = "gemini-3-pro-preview";

// Max size per chunk (e.g., 20KB characters ~ 5k tokens)
const CHUNK_SIZE_LIMIT = 20000;

interface BatchChunk {
    id: number;
    files: { name: string; content: string }[];
    tokenEstimate: number;
}

/**
 * Flattens the file tree and groups files into chunks
 */
export function createBatches(tree: FileNode[]): BatchChunk[] {
    const allFiles: { name: string; content: string }[] = [];

    const traverse = (nodes: FileNode[]) => {
        for (const node of nodes) {
            if (node.type === 'file' && node.content) {
                // Skip binary/lock files
                if (!node.name.match(/\.(lock|png|ico|svg)$/)) {
                    allFiles.push({ name: node.name, content: node.content });
                }
            }
            if (node.children) traverse(node.children);
        }
    };
    traverse(tree);

    const chunks: BatchChunk[] = [];
    let currentChunk: BatchChunk = { id: 1, files: [], tokenEstimate: 0 };

    for (const file of allFiles) {
        const fileSize = file.content.length;

        // If single file is huge, it gets its own chunk (truncated if needed by LLM limit, but here we just pass it)
        if (currentChunk.tokenEstimate + fileSize > CHUNK_SIZE_LIMIT && currentChunk.files.length > 0) {
            chunks.push(currentChunk);
            currentChunk = { id: chunks.length + 1, files: [], tokenEstimate: 0 };
        }

        currentChunk.files.push(file);
        currentChunk.tokenEstimate += fileSize;
    }

    if (currentChunk.files.length > 0) {
        chunks.push(currentChunk);
    }

    return chunks;
}

/**
 * Analyze a single chunk
 */
async function analyzeChunk(chunk: BatchChunk, goal: string): Promise<string> {
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    // Construct prompt
    let fileContext = "";
    for (const file of chunk.files) {
        fileContext += `\n--- FILE: ${file.name} ---\n${file.content}\n`;
    }

    const prompt = `
    You are a Senior Code Reviewer. 
    GOAL: ${goal}
    
    Analyze the following code files. 
    Identify ANY issues, improvements, or relevant details related to the GOAL.
    
    If nothing relevant is found, output "No findings".
    If findings exist, list them concisely (bullet points).
    
    CODE CONTEXT:
    ${fileContext}
    `;

    try {
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) {
        console.error(`Error processing chunk ${chunk.id}`, e);
        return `Error analyzing chunk ${chunk.id}`;
    }
}

/**
 * Consolidate all reports
 */
async function consolidateReports(reports: string[], goal: string): Promise<string> {
    const validReports = reports.filter(r => !r.includes("No findings") && !r.includes("Error analyzing"));

    if (validReports.length === 0) return "No relevant findings discovered across the codebase.";

    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    const prompt = `
    You are a Lead Architect.
    GOAL: ${goal}
    
    Here are partial analysis reports from different parts of the codebase:
    
    ${validReports.join("\n\n--- NEXT REPORT ---\n\n")}
    
    Based on these findings, provide a Final Consolidated Report.
    - Group related issues.
    - Prioritize critical items.
    - Provide a step-by-step action plan.
    - Format as Markdown.
    `;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

/**
 * Main Generator for Batch Processing
 * (Yields progress updates)
 */
export async function* runBatchAnalysis(tree: FileNode[], goal: string) {
    const chunks = createBatches(tree);
    const total = chunks.length;
    const reports: string[] = [];

    for (let i = 0; i < total; i++) {
        const chunk = chunks[i];
        yield `Processing batch ${i + 1}/${total} (${chunk.files.length} files)...`;

        const report = await analyzeChunk(chunk, goal);
        reports.push(report);
    }

    yield "Consolidating findings...";
    const finalReport = await consolidateReports(reports, goal);

    yield "DONE";
    yield finalReport; // Last message is the result
}
