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

function fail(message) {
  throw new Error(message);
}

function extractRuntimeSurfaces(readme) {
  const sectionMatch = readme.match(/## Runtime surfaces([\s\S]*?)## /i);
  const section = sectionMatch?.[1] || "";
  return [...section.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
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

async function main() {
  const [packageJsonRaw, readme, envExample, typesIndex] = await Promise.all([
    readFile("package.json"),
    readFile("README.md"),
    readFile(".env.example"),
    readFile("types/index.ts")
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

  const requiredEnvKeys = [
    "APP_BASE_URL",
    "EMAIL_SERVER",
    "EMAIL_FROM",
    "STRIPE_SECRET_KEY",
    "FORECODING_ADMIN_EMAILS"
  ];
  for (const key of requiredEnvKeys) {
    if (!envExample.includes(`${key}=`)) {
      fail(`.env.example is missing required key ${key}.`);
    }
    if (!readme.includes(key)) {
      fail(`README must document required env key ${key}.`);
    }
  }

  const runtimeSurfaces = extractRuntimeSurfaces(readme);
  for (const surface of runtimeSurfaces) {
    await ensureRuntimeSurfaceExists(surface);
  }

  process.stdout.write("Platform drift checks passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
