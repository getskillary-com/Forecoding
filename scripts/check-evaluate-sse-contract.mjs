#!/usr/bin/env node

import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const fixturePath = path.join(projectRoot, "scripts", "fixtures", "evaluate-sse-contract.v1.json");

const EVENT_NAMES = new Set([
    "analysis.delta",
    "question",
    "conflict",
    "readiness.update",
    "trace",
    "remediation"
]);

const QUESTION_ACTIONS = new Set([
    "send_message",
    "generate_scaffold",
    "open_prd",
    "focus_requirement",
    "fill_requirement",
    "show_blockers"
]);

const READINESS_REQUIREMENT_KEYS = new Set([
    "business_context.product_goal",
    "business_context.platforms",
    "business_context.target_users",
    "business_context.user_journeys",
    "business_context.constraints_or_risks",
    "boundaries.bounded_contexts",
    "boundaries.module_responsibilities",
    "boundaries.data_ownership",
    "decisions.decision_records",
    "decisions.integration_contracts",
    "decisions.non_functional_requirements",
    "guardrails.implementation_order",
    "guardrails.acceptance_criteria",
    "guardrails.test_strategy",
    "ui.key_screens",
    "ui.shared_components",
    "ui.responsive_strategy"
]);

const ARCHITECTURE_STAGES = new Set([
    "context",
    "boundaries",
    "decisions",
    "guardrails",
    "ready_to_generate"
]);

function fail(message) {
    throw new Error(message);
}

function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function hasOnlyKeys(payload, allowedKeys) {
    return Object.keys(payload).every((key) => allowedKeys.has(key));
}

function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateAnalysisDelta(payload) {
    if (!isObject(payload)) return false;
    const allowedKeys = new Set([
        "stage",
        "densityScore",
        "isReady",
        "clarified",
        "missing",
        "uiRaw",
        "uiSpecRaw",
        "architecturePackRaw",
        "decisionRecordsRaw",
        "guardrailsRaw"
    ]);
    if (!hasOnlyKeys(payload, allowedKeys)) return false;

    if ("stage" in payload && !ARCHITECTURE_STAGES.has(payload.stage)) return false;
    if ("densityScore" in payload && !(typeof payload.densityScore === "number" && Number.isFinite(payload.densityScore))) return false;
    if ("isReady" in payload && typeof payload.isReady !== "boolean") return false;
    if ("clarified" in payload && !isStringArray(payload.clarified)) return false;
    if ("missing" in payload && !isStringArray(payload.missing)) return false;
    if ("uiRaw" in payload && !(payload.uiRaw === null || typeof payload.uiRaw === "string")) return false;
    if ("uiSpecRaw" in payload && !(payload.uiSpecRaw === null || typeof payload.uiSpecRaw === "string")) return false;
    if ("architecturePackRaw" in payload && !(payload.architecturePackRaw === null || typeof payload.architecturePackRaw === "string")) return false;
    if ("decisionRecordsRaw" in payload && !(payload.decisionRecordsRaw === null || typeof payload.decisionRecordsRaw === "string")) return false;
    if ("guardrailsRaw" in payload && !(payload.guardrailsRaw === null || typeof payload.guardrailsRaw === "string")) return false;

    return true;
}

function validateQuestion(payload) {
    if (!isObject(payload)) return false;
    const allowedKeys = new Set([
        "question",
        "questionAction",
        "questionRequirementKey",
        "optionsRaw",
        "source"
    ]);
    if (!hasOnlyKeys(payload, allowedKeys)) return false;

    if (!isNonEmptyString(payload.question)) return false;
    if (!(payload.source === "model" || payload.source === "fallback")) return false;

    if ("questionAction" in payload && !(payload.questionAction === null || QUESTION_ACTIONS.has(payload.questionAction))) return false;
    if ("questionRequirementKey" in payload && !(payload.questionRequirementKey === null || READINESS_REQUIREMENT_KEYS.has(payload.questionRequirementKey))) return false;
    if ("optionsRaw" in payload && !(payload.optionsRaw === null || typeof payload.optionsRaw === "string")) return false;

    return true;
}

function validateConflict(payload) {
    if (!isObject(payload)) return false;
    const allowedKeys = new Set(["summary", "items"]);
    if (!hasOnlyKeys(payload, allowedKeys)) return false;
    if (!isNonEmptyString(payload.summary)) return false;
    if (!isStringArray(payload.items)) return false;
    return true;
}

function validateReadinessUpdate(payload) {
    if (!isObject(payload)) return false;
    const allowedKeys = new Set(["raw"]);
    if (!hasOnlyKeys(payload, allowedKeys)) return false;
    if (!isNonEmptyString(payload.raw)) return false;
    return true;
}

function validateTrace(payload) {
    if (!isObject(payload)) return false;
    const allowedKeys = new Set(["kind", "requestId", "chunk", "source", "note"]);
    if (!hasOnlyKeys(payload, allowedKeys)) return false;

    if (!(payload.kind === "start" || payload.kind === "chunk" || payload.kind === "complete")) return false;
    if (!isNonEmptyString(payload.requestId)) return false;
    if ("chunk" in payload && typeof payload.chunk !== "string") return false;
    if ("source" in payload && !(payload.source === "model" || payload.source === "fallback" || payload.source === "system")) return false;
    if ("note" in payload && typeof payload.note !== "string") return false;

    return true;
}

function validateRemediation(payload) {
    if (!isObject(payload)) return false;
    const allowedKeys = new Set(["code", "severity", "message", "retrying", "fallbackInjected", "requestId"]);
    if (!hasOnlyKeys(payload, allowedKeys)) return false;

    if (!isNonEmptyString(payload.code)) return false;
    if (!(payload.severity === "info" || payload.severity === "warning" || payload.severity === "error")) return false;
    if (!isNonEmptyString(payload.message)) return false;
    if ("retrying" in payload && typeof payload.retrying !== "boolean") return false;
    if ("fallbackInjected" in payload && typeof payload.fallbackInjected !== "boolean") return false;
    if ("requestId" in payload && !isNonEmptyString(payload.requestId)) return false;

    return true;
}

function validatePayloadByEvent(event, payload) {
    if (!EVENT_NAMES.has(event)) return false;
    if (event === "analysis.delta") return validateAnalysisDelta(payload);
    if (event === "question") return validateQuestion(payload);
    if (event === "conflict") return validateConflict(payload);
    if (event === "readiness.update") return validateReadinessUpdate(payload);
    if (event === "trace") return validateTrace(payload);
    if (event === "remediation") return validateRemediation(payload);
    return false;
}

async function loadFixture() {
    const source = await fsp.readFile(fixturePath, "utf8");
    return JSON.parse(source);
}

async function main() {
    const fixture = await loadFixture();
    if (!isObject(fixture)) {
        fail("Fixture root must be a JSON object.");
    }
    if (fixture.version !== "evaluate_sse_fixture_v1") {
        fail(`Unsupported fixture version "${String(fixture.version || "")}".`);
    }

    const validCases = Array.isArray(fixture.valid) ? fixture.valid : [];
    const invalidCases = Array.isArray(fixture.invalid) ? fixture.invalid : [];
    if (validCases.length === 0) {
        fail("Fixture must include at least one valid case.");
    }
    if (invalidCases.length === 0) {
        fail("Fixture must include at least one invalid case.");
    }

    const coveredEvents = new Set();

    validCases.forEach((testCase, index) => {
        if (!isObject(testCase)) {
            fail(`valid[${index}] must be an object.`);
        }
        const event = testCase.event;
        const payload = testCase.payload;
        if (!EVENT_NAMES.has(event)) {
            fail(`valid[${index}] has unsupported event "${String(event)}".`);
        }
        if (!validatePayloadByEvent(event, payload)) {
            fail(`valid[${index}] failed payload validation for event "${event}".`);
        }
        coveredEvents.add(event);
    });

    invalidCases.forEach((testCase, index) => {
        if (!isObject(testCase)) {
            fail(`invalid[${index}] must be an object.`);
        }
        const event = testCase.event;
        const payload = testCase.payload;
        if (!EVENT_NAMES.has(event)) {
            fail(`invalid[${index}] has unsupported event "${String(event)}".`);
        }
        if (validatePayloadByEvent(event, payload)) {
            fail(`invalid[${index}] unexpectedly passed payload validation for event "${event}".`);
        }
    });

    const missingCoverage = Array.from(EVENT_NAMES).filter((event) => !coveredEvents.has(event));
    if (missingCoverage.length > 0) {
        fail(`Fixture valid cases must cover all SSE events. Missing: ${missingCoverage.join(", ")}`);
    }

    process.stdout.write(
        `Evaluate SSE fixture contract checks passed (${validCases.length} valid / ${invalidCases.length} invalid).\n`
    );
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
