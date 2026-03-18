export function file(name, content) {
  return { name, type: "file", content };
}

export function folder(name, children) {
  return { name, type: "folder", children };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.?\//, "");
}

function upsertFileByPath(tree, filePath, content) {
  const segments = String(filePath || "").split("/").filter(Boolean);
  if (segments.length === 0) return;

  let current = tree;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isFile = index === segments.length - 1;

    if (isFile) {
      const existing = current.find((node) => node?.type === "file" && node.name === segment);
      if (existing) {
        existing.content = content;
      } else {
        current.push(file(segment, content));
      }
      return;
    }

    let next = current.find((node) => node?.type === "folder" && node.name === segment);
    if (!next) {
      next = folder(segment, []);
      current.push(next);
    }
    if (!Array.isArray(next.children)) next.children = [];
    current = next.children;
  }
}

function getFileByPath(tree, filePath) {
  const segments = normalizePath(filePath).split("/").filter(Boolean);
  if (segments.length === 0) return null;
  let current = tree;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isFile = index === segments.length - 1;
    const node = current.find((entry) => entry?.name === segment);
    if (!node) return null;
    if (isFile) return node?.type === "file" ? node : null;
    if (node.type !== "folder" || !Array.isArray(node.children)) return null;
    current = node.children;
  }
  return null;
}

function getPlaceholderCommentStyle(filePath) {
  const normalized = normalizePath(filePath).toLowerCase();
  if (/\.(ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|prisma)$/i.test(normalized)) return "block";
  if (/\.(html|htm|xml|svg)$/i.test(normalized)) return "html";
  if (/\.(py|rb|sh|bash|zsh|ya?ml|toml|ini|cfg|conf)$/i.test(normalized)) return "line";
  return null;
}

function cleanPlaceholderSpecLines(text) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/^\/\*+\s*/, "")
    .replace(/\*\/\s*$/, "")
    .replace(/^\s*<!--\s*/, "")
    .replace(/\s*-->\s*$/, "")
    .trim();
  if (!normalized) return "";

  const strippedLines = normalized
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").replace(/^\s*(?:\/\/+|#)\s?/, ""))
    .map((line) => line.replace(/^\s*\/\*\s?/, "").replace(/\s*\*\/\s*$/, ""))
    .map((line) => line.trimEnd());

  const filtered = [];
  for (const line of strippedLines) {
    const trimmed = line.trim();
    if (!trimmed && filtered.length === 0) continue;
    if (/^(?:待生成|generation pending)$/i.test(trimmed)) continue;
    if (/^(?:打开|open)\s+.+_AI_PROMPT\.md/i.test(trimmed)) continue;
    if (/^(?:内容提示|content hint|prompt file)[:：]?/i.test(trimmed)) continue;
    filtered.push(line);
  }

  return filtered.join("\n").trim();
}

function extractPlaceholderSpecText(content) {
  const source = String(content || "").replace(/\r\n/g, "\n").trim();
  if (!source) return "";
  const mixedBlockMatch = source.match(/\/\*([\s\S]*)\*\//);
  if (mixedBlockMatch?.[1]) {
    return cleanPlaceholderSpecLines(mixedBlockMatch[1]);
  }
  return cleanPlaceholderSpecLines(source);
}

function renderPlaceholderComment(filePath, content) {
  const style = getPlaceholderCommentStyle(filePath);
  if (!style) return String(content || "").trim();
  const promptPath = normalizePath(filePath).includes("/")
    ? `${normalizePath(filePath).slice(0, normalizePath(filePath).lastIndexOf("/"))}/_AI_PROMPT.md`
    : "_AI_PROMPT.md";
  const inner = extractPlaceholderSpecText(content);
  const lines = [
    "GENERATION PENDING",
    `Prompt file: ${promptPath}`
  ];
  if (inner) {
    lines.push("");
    lines.push(...inner.split("\n"));
  }

  if (style === "html") {
    return ["<!--", ...lines, "-->"].join("\n");
  }
  if (style === "line") {
    return lines.map((line) => (line ? `# ${line}` : "#")).join("\n");
  }
  return ["/*", ...lines.map((line) => (line ? ` * ${line}` : " *")), " */"].join("\n");
}

function normalizePlaceholderFiles(projectTree, manifest) {
  const placeholderPaths = new Set();
  for (const entry of manifest?.files || []) {
    if (entry?.contentKind === "placeholder" && entry.path) {
      placeholderPaths.add(normalizePath(entry.path));
    }
  }
  for (const task of manifest?.tasks || []) {
    if (task?.contentKind === "placeholder" && task.filePath) {
      placeholderPaths.add(normalizePath(task.filePath));
    }
  }

  for (const filePath of placeholderPaths) {
    const fileNode = getFileByPath(projectTree, filePath);
    if (!fileNode || typeof fileNode.content !== "string" || !fileNode.content.trim()) continue;
    if (!getPlaceholderCommentStyle(filePath)) continue;
    fileNode.content = renderPlaceholderComment(filePath, fileNode.content);
  }
}

export function createPayload({ toolStack, manifest, tree }) {
  const projectTree = clone(tree);
  normalizePlaceholderFiles(projectTree, manifest);
  upsertFileByPath(projectTree, "GENERATION_MANIFEST.json", `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    outputMode: manifest.outputMode,
    toolStack,
    generationManifest: manifest,
    projectTree
  };
}
