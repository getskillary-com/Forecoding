#!/usr/bin/env node

import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

async function readFile(relativePath) {
  return fsp.readFile(path.join(projectRoot, relativePath), "utf8");
}

async function pathExists(absolutePath) {
  return fsp.access(absolutePath).then(() => true).catch(() => false);
}

function fail(message) {
  throw new Error(message);
}

function extractRuntimeSurfaces(readme) {
  const sectionMatch = readme.match(/## Runtime surfaces([\s\S]*?)(?:## |\s*$)/i);
  const section = sectionMatch?.[1] || "";
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const match = line.match(/`(\/[^`]+)`/);
      return match?.[1]?.trim() || "";
    })
    .filter(Boolean);
}

async function ensureRuntimeSurfaceExists(surface) {
  if (surface === "/api/payments/stripe/*") {
    const targetDir = path.join(projectRoot, "app", "api", "payments", "stripe");
    const entries = await fsp.readdir(targetDir);
    if (!entries.length) {
      fail(`Runtime surface ${surface} is documented but ${targetDir} is empty.`);
    }
    return;
  }

  const normalized = surface.replace(/^\//, "");
  const pagePath = path.join(projectRoot, "app", normalized, "page.tsx");
  const routePath = path.join(projectRoot, "app", normalized, "route.ts");

  const pageExists = await fsp.access(pagePath).then(() => true).catch(() => false);
  const routeExists = await fsp.access(routePath).then(() => true).catch(() => false);

  if (!pageExists && !routeExists) {
    fail(`Runtime surface ${surface} is documented but no matching page/route file was found.`);
  }
}

function ensureNoDuplicateRuntimeSurfaces(runtimeSurfaces) {
  const duplicates = [];
  const seen = new Set();

  for (const surface of runtimeSurfaces) {
    if (seen.has(surface)) {
      duplicates.push(surface);
      continue;
    }
    seen.add(surface);
  }

  if (duplicates.length > 0) {
    fail(`Runtime surfaces contains duplicates: ${duplicates.join(", ")}`);
  }
}

function toRuntimeSurfaceFromAppFile(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!normalized.startsWith("app/")) return null;
  if (!normalized.endsWith("/route.ts") && !normalized.endsWith("/page.tsx")) return null;

  const withoutAppPrefix = normalized.slice("app".length);
  const withoutSuffix = withoutAppPrefix
    .replace(/\/route\.ts$/, "")
    .replace(/\/page\.tsx$/, "");

  return withoutSuffix || "/";
}

async function collectRuntimeSurfaceFiles(relativeRoot) {
  const absoluteRoot = path.join(projectRoot, relativeRoot);
  if (!(await pathExists(absoluteRoot))) return [];

  const files = [];
  async function walk(currentDir) {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name !== "route.ts" && entry.name !== "page.tsx") continue;
      files.push(path.relative(projectRoot, absolutePath).replace(/\\/g, "/"));
    }
  }

  await walk(absoluteRoot);
  return files;
}

function isSurfaceDocumented(surface, documentedSurfacesSet) {
  if (documentedSurfacesSet.has(surface)) return true;
  if (surface.startsWith("/api/payments/stripe/") && documentedSurfacesSet.has("/api/payments/stripe/*")) {
    return true;
  }
  return false;
}

async function ensureGovernanceRouteDocumentation(runtimeSurfaces) {
  const documentedSurfacesSet = new Set(runtimeSurfaces);
  const routeRoots = [
    "app/api/admin",
    "app/api/workspace",
    "app/api/evaluate",
    "app/api/generate",
    "app/api/payments/stripe",
    "app/admin/workspaces"
  ];

  const requiredSurfaces = [];
  for (const root of routeRoots) {
    const files = await collectRuntimeSurfaceFiles(root);
    for (const file of files) {
      const surface = toRuntimeSurfaceFromAppFile(file);
      if (surface) {
        requiredSurfaces.push(surface);
      }
    }
  }

  const missingDocumentation = Array.from(new Set(requiredSurfaces))
    .sort((left, right) => left.localeCompare(right))
    .filter((surface) => !isSurfaceDocumented(surface, documentedSurfacesSet));
  if (missingDocumentation.length > 0) {
    fail(
      [
        "README runtime surfaces is missing governance routes:",
        ...missingDocumentation.map((surface) => `- ${surface}`)
      ].join("\n")
    );
  }
}

function extractEnvKeys(envExample) {
  const keys = [];
  const duplicates = [];
  const seen = new Set();

  for (const line of envExample.split(/\r?\n/)) {
    const keyMatch = line.match(/^\s*([A-Z0-9_]+)=/);
    if (!keyMatch) continue;
    const key = keyMatch[1];
    if (seen.has(key)) {
      duplicates.push(key);
      continue;
    }
    seen.add(key);
    keys.push(key);
  }

  return { keys, duplicates };
}

function ensureRequiredEnvKeysDocumented(readme, envExample) {
  const requiredEnvKeys = [
    "APP_BASE_URL",
    "AUTH_SESSION_COOKIE_NAME",
    "AUTH_CODE_SECRET",
    "EMAIL_SERVER",
    "EMAIL_FROM",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "AI_PROVIDER",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "CLAUDE_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PAYMENTS_PAUSED",
    "STRIPE_DYNAMIC_PRICING_ENABLED",
    "FORECODING_ADMIN_EMAILS",
    "FORECODING_OPERATOR_EMAILS",
    "FORECODING_ADMIN_VIEWER_EMAILS",
    "NEXT_PUBLIC_DEV_AUTH_BYPASS"
  ];

  const { keys, duplicates } = extractEnvKeys(envExample);
  if (duplicates.length > 0) {
    fail(`.env.example contains duplicate keys: ${duplicates.join(", ")}`);
  }

  for (const key of requiredEnvKeys) {
    if (!keys.includes(key)) {
      fail(`.env.example is missing required key ${key}.`);
    }
    if (!new RegExp(`\\b${key}\\b`).test(readme)) {
      fail(`README must document required env key ${key}.`);
    }
  }
}

function extractEvaluateSseEventsFromTypes(typesIndex) {
  const blockMatch = typesIndex.match(/export type EvaluateSseEventName =([\s\S]*?);/);
  if (!blockMatch) return [];
  return [...blockMatch[1].matchAll(/"([^"]+)"/g)]
    .map((match) => match[1])
    .filter(Boolean);
}

function extractEvaluateSseEventsFromRoute(routeSource) {
  return [...routeSource.matchAll(/emitEvent\((["'])([^"']+)\1\s*,/g)]
    .map((match) => match[2])
    .filter(Boolean);
}

function ensureEvaluateSseContractDrift(typesIndex, evaluateRouteSource) {
  const typeEvents = extractEvaluateSseEventsFromTypes(typesIndex);
  const routeEvents = extractEvaluateSseEventsFromRoute(evaluateRouteSource);

  if (typeEvents.length === 0) {
    fail("Could not extract EvaluateSseEventName from types/index.ts.");
  }

  const typeSet = new Set(typeEvents);
  const routeSet = new Set(routeEvents);

  const missingInRoute = typeEvents.filter((event) => !routeSet.has(event));
  const extraInRoute = routeEvents.filter((event) => !typeSet.has(event));

  if (missingInRoute.length > 0 || extraInRoute.length > 0) {
    const details = [];
    if (missingInRoute.length > 0) {
      details.push(`missing in evaluate route: ${missingInRoute.join(", ")}`);
    }
    if (extraInRoute.length > 0) {
      details.push(`not declared in EvaluateSseEventName: ${extraInRoute.join(", ")}`);
    }
    fail(`Evaluate SSE event contract drift detected (${details.join(" | ")}).`);
  }
}

function ensureGenerateContractDrift(generateRouteSource, wizardSource) {
  if (!/resolveGenerateJobContract\([\s\S]*?strict:\s*true[\s\S]*?\)/m.test(generateRouteSource)) {
    fail("Generate contract drift: /api/generate must call resolveGenerateJobContract(..., { strict: true }).");
  }

  const requiredGenerateRouteTokens = [
    "workspaceSnapshotId",
    "expectedRevision",
    "templateKind",
    "releaseIntent"
  ];
  for (const token of requiredGenerateRouteTokens) {
    if (!generateRouteSource.includes(token)) {
      fail(`Generate contract drift: /api/generate route is missing required contract token "${token}".`);
    }
  }

  const requiredWizardTokens = [
    "fetch(\"/api/generate\"",
    "workspaceSnapshotId",
    "expectedRevision",
    "templateKind",
    "releaseIntent"
  ];
  for (const token of requiredWizardTokens) {
    if (!wizardSource.includes(token)) {
      fail(`Generate contract drift: wizard generate request must include "${token}".`);
    }
  }
}

function ensurePaymentContractDrift(quoteRouteSource, checkoutRouteSource, wizardSource) {
  const requiredQuoteTokens = [
    "workspaceSnapshotId",
    "expectedRevision",
    "WORKSPACE_REVISION_CONFLICT",
    "WORKSPACE_SNAPSHOT_MISMATCH"
  ];
  for (const token of requiredQuoteTokens) {
    if (!quoteRouteSource.includes(token)) {
      fail(`Payment contract drift: /api/payments/stripe/quote is missing required token "${token}".`);
    }
  }

  const requiredCheckoutTokens = [
    "workspaceSnapshotId",
    "expectedRevision",
    "WORKSPACE_REVISION_CONFLICT",
    "WORKSPACE_SNAPSHOT_MISMATCH",
    "workspaceRevision"
  ];
  for (const token of requiredCheckoutTokens) {
    if (!checkoutRouteSource.includes(token)) {
      fail(`Payment contract drift: /api/payments/stripe/checkout is missing required token "${token}".`);
    }
  }

  const quoteRequestPattern = /fetch\(\"\/api\/payments\/stripe\/quote\"[\s\S]*?workspaceSnapshotId[\s\S]*?expectedRevision[\s\S]*?\)/m;
  if (!quoteRequestPattern.test(wizardSource)) {
    fail("Payment contract drift: wizard quote request must include workspaceSnapshotId and expectedRevision.");
  }

  const checkoutRequestPattern = /fetch\(\"\/api\/payments\/stripe\/checkout\"[\s\S]*?workspaceSnapshotId[\s\S]*?expectedRevision[\s\S]*?\)/m;
  if (!checkoutRequestPattern.test(wizardSource)) {
    fail("Payment contract drift: wizard checkout request must include workspaceSnapshotId and expectedRevision.");
  }
}

const ENCODING_DRIFT_TOKENS = [
  "\u951b",
  "\u9286",
  "\u9225",
  "\u951f",
  "\u9983",
  "\u9229",
  "\u9483"
];

const TEXT_FILE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".txt",
  ".yml",
  ".yaml"
]);

async function collectTextFiles(relativeRoot) {
  const absoluteRoot = path.join(projectRoot, relativeRoot);
  if (!(await pathExists(absoluteRoot))) return [];

  const files = [];
  async function walk(currentDir) {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!TEXT_FILE_EXTENSIONS.has(extension)) continue;
      files.push(path.relative(projectRoot, absolutePath).replace(/\\/g, "/"));
    }
  }

  await walk(absoluteRoot);
  return files;
}

function buildEncodingDriftExcerpt(source, tokenIndex) {
  const start = Math.max(0, tokenIndex - 24);
  const end = Math.min(source.length, tokenIndex + 24);
  return source
    .slice(start, end)
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n");
}

function resolveLineNumber(source, tokenIndex) {
  if (tokenIndex <= 0) return 1;
  return source.slice(0, tokenIndex).split("\n").length;
}

async function ensureNoEncodingDrift() {
  const roots = [
    "app",
    "lib",
    "components",
    "scripts",
    "types"
  ];
  const files = ["README.md"];
  for (const root of roots) {
    files.push(...(await collectTextFiles(root)));
  }

  const violations = [];
  for (const relativePath of Array.from(new Set(files)).sort((left, right) => left.localeCompare(right))) {
    const absolutePath = path.join(projectRoot, relativePath);
    const source = await fsp.readFile(absolutePath, "utf8");
    for (const token of ENCODING_DRIFT_TOKENS) {
      const tokenIndex = source.indexOf(token);
      if (tokenIndex < 0) continue;
      violations.push({
        relativePath,
        token,
        line: resolveLineNumber(source, tokenIndex),
        excerpt: buildEncodingDriftExcerpt(source, tokenIndex)
      });
    }
  }

  if (violations.length > 0) {
    const summary = violations
      .slice(0, 12)
      .map((item) => `${item.relativePath}:${item.line} token="${item.token}" excerpt="${item.excerpt}"`);
    fail(
      [
        "Potential encoding drift tokens detected (possible mojibake):",
        ...summary
      ].join("\n")
    );
  }
}

async function ensureAdminRouteGuards() {
  const adminRouteFiles = await collectRuntimeSurfaceFiles("app/api/admin");
  const violations = [];

  for (const relativePath of adminRouteFiles.sort((left, right) => left.localeCompare(right))) {
    const absolutePath = path.join(projectRoot, relativePath);
    const source = await fsp.readFile(absolutePath, "utf8");
    if (!source.includes("requireAdminRoute(")) {
      violations.push(relativePath);
    }
  }

  if (violations.length > 0) {
    fail(
      [
        "Admin route guard drift detected. Every /api/admin route must use requireAdminRoute():",
        ...violations.map((relativePath) => `- ${relativePath}`)
      ].join("\n")
    );
  }
}

async function main() {
  const [
    packageJsonRaw,
    readme,
    envExample,
    typesIndex,
    evaluateRouteSource,
    generateRouteSource,
    wizardSource,
    quoteRouteSource,
    checkoutRouteSource
  ] = await Promise.all([
    readFile("package.json"),
    readFile("README.md"),
    readFile(".env.example"),
    readFile("types/index.ts"),
    readFile("app/api/evaluate/route.ts"),
    readFile("app/api/generate/route.ts"),
    readFile("app/wizard/page.tsx"),
    readFile("app/api/payments/stripe/quote/route.ts"),
    readFile("app/api/payments/stripe/checkout/route.ts")
  ]);

  const packageJson = JSON.parse(packageJsonRaw);
  if (packageJson.name !== "forecoding") {
    fail(`package.json name must be "forecoding", received "${packageJson.name}".`);
  }

  if (!/Forecoding works through five architecture stages:/i.test(readme)) {
    fail("README must describe exactly five architecture stages.");
  }

  const stageLines = [...readme.matchAll(/^\d+\.\s`[^`]+`:/gm)];
  if (stageLines.length !== 5) {
    fail(`README must list 5 architecture stages, found ${stageLines.length}.`);
  }

  const architectureStageBlock = typesIndex.match(/export type ArchitectureStage =([\s\S]*?);/);
  const architectureStageValues = architectureStageBlock
    ? [...architectureStageBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])
    : [];
  if (architectureStageValues.length !== 5) {
    fail(`types/index.ts must define 5 ArchitectureStage values, found ${architectureStageValues.length}.`);
  }

  ensureRequiredEnvKeysDocumented(readme, envExample);

  const runtimeSurfaces = extractRuntimeSurfaces(readme);
  ensureNoDuplicateRuntimeSurfaces(runtimeSurfaces);
  for (const surface of runtimeSurfaces) {
    await ensureRuntimeSurfaceExists(surface);
  }
  await ensureGovernanceRouteDocumentation(runtimeSurfaces);

  ensureEvaluateSseContractDrift(typesIndex, evaluateRouteSource);
  ensureGenerateContractDrift(generateRouteSource, wizardSource);
  ensurePaymentContractDrift(quoteRouteSource, checkoutRouteSource, wizardSource);
  await ensureNoEncodingDrift();
  await ensureAdminRouteGuards();

  process.stdout.write("Platform drift checks passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
