#!/usr/bin/env node

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptFile);
const repoRoot = path.resolve(scriptsDir, "..");
const fixturesDir = path.join(repoRoot, "fixtures", "spec-pack");
const validatorScript = path.join(repoRoot, "scripts", "validate-generated-scaffold.mjs");

function summarizeIssues(report) {
  if (!Array.isArray(report?.issues) || report.issues.length === 0) {
    return "no issues";
  }

  return report.issues
    .slice(0, 3)
    .map((issue) => {
      const code = issue?.code || "UNKNOWN";
      const message = issue?.message || "Unknown validation issue";
      return `${code}: ${message}`;
    })
    .join(" | ");
}

function runValidator(inputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [validatorScript, "--input", inputPath],
      {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: Number.isInteger(code) ? code : 1,
        stdout,
        stderr
      });
    });
  });
}

async function loadFixtures() {
  const entries = await fsp.readdir(fixturesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".fixture.mjs"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      name: entry.name,
      path: path.join(fixturesDir, entry.name)
    }));
}

async function main() {
  const fixtures = await loadFixtures();
  if (fixtures.length === 0) {
    throw new Error(`No fixture files found in ${fixturesDir}`);
  }

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "forecoding-spec-pack-fixtures-"));
  const failures = [];

  try {
    for (const fixture of fixtures) {
      const fixtureModule = await import(pathToFileURL(fixture.path).href);
      const fixtureExport = fixtureModule?.default;
      const fixtureName = fixtureExport?.name || fixture.name;
      const payload = fixtureExport?.payload;

      if (!payload) {
        failures.push({
          fixtureName,
          reason: "Fixture is missing a default payload export."
        });
        process.stdout.write(`FAIL ${fixtureName} - missing payload export\n`);
        continue;
      }

      const inputPath = path.join(tempRoot, `${path.basename(fixture.name, ".mjs")}.json`);
      await fsp.writeFile(inputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

      const result = await runValidator(inputPath);
      let report;

      try {
        report = JSON.parse(result.stdout);
      } catch (error) {
        failures.push({
          fixtureName,
          reason: `Validator returned invalid JSON. ${error instanceof Error ? error.message : String(error)}`,
          stdout: result.stdout,
          stderr: result.stderr
        });
        process.stdout.write(`FAIL ${fixtureName} - validator output was not valid JSON\n`);
        continue;
      }

      const reportFailure =
        result.code !== 0 ||
        report?.pass !== true ||
        report?.outputMode !== "virtual_spec" ||
        typeof report?.placeholderCount !== "number" ||
        report.placeholderCount < 1;

      if (reportFailure) {
        failures.push({
          fixtureName,
          reason: summarizeIssues(report),
          report,
          stderr: result.stderr
        });
        process.stdout.write(
          `FAIL ${fixtureName} - pass=${String(report?.pass)} outputMode=${String(report?.outputMode)} placeholders=${String(report?.placeholderCount)}\n`
        );
        continue;
      }

      process.stdout.write(
        `PASS ${fixtureName} - placeholders=${report.placeholderCount} issues=${report.issues.length}\n`
      );
    }
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    process.stdout.write(`\n${failures.length} fixture validation failure(s):\n`);
    for (const failure of failures) {
      process.stdout.write(`- ${failure.fixtureName}: ${failure.reason}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`\nValidated ${fixtures.length} spec-pack fixture(s) successfully.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
