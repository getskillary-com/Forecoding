export function file(name, content) {
  return { name, type: "file", content };
}

export function folder(name, children) {
  return { name, type: "folder", children };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

export function createPayload({ toolStack, manifest, tree }) {
  const projectTree = clone(tree);
  upsertFileByPath(projectTree, "GENERATION_MANIFEST.json", `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    outputMode: manifest.outputMode,
    toolStack,
    generationManifest: manifest,
    projectTree
  };
}
