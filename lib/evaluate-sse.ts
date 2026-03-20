import { z } from "zod";
import type {
    EvaluateAnalysisDeltaEvent,
    EvaluateConflictEvent,
    EvaluateQuestionEvent,
    EvaluateReadinessUpdateEvent,
    EvaluateRemediationEvent,
    EvaluateSseEventName,
    EvaluateTraceEvent
} from "@/types";

const ArchitectureStageSchema = z.enum([
    "context",
    "boundaries",
    "decisions",
    "guardrails",
    "ready_to_generate"
]);

const MessageActionSchema = z.enum([
    "send_message",
    "generate_scaffold",
    "open_prd",
    "focus_requirement",
    "fill_requirement",
    "show_blockers"
]);

const ReadinessRequirementKeySchema = z.enum([
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

const EvaluateTraceEventSchema = z.object({
    kind: z.enum(["start", "chunk", "complete"]),
    requestId: z.string().trim().min(1),
    chunk: z.string().optional(),
    source: z.enum(["model", "fallback", "system"]).optional(),
    note: z.string().optional(),
    projectId: z.string().trim().min(1).optional(),
    versionId: z.string().trim().min(1).optional(),
    workspaceSnapshotId: z.string().trim().min(1).optional(),
    workspaceRevision: z.number().int().min(0).optional()
}).strict() satisfies z.ZodType<EvaluateTraceEvent>;

const EvaluateQuestionEventSchema = z.object({
    question: z.string().trim().min(1),
    questionAction: MessageActionSchema.nullable().optional(),
    questionRequirementKey: ReadinessRequirementKeySchema.nullable().optional(),
    optionsRaw: z.string().nullable().optional(),
    source: z.enum(["model", "fallback"])
}).strict() satisfies z.ZodType<EvaluateQuestionEvent>;

const EvaluateAnalysisDeltaEventSchema = z.object({
    stage: ArchitectureStageSchema.optional(),
    densityScore: z.number().finite().optional(),
    isReady: z.boolean().optional(),
    clarified: z.array(z.string()).optional(),
    missing: z.array(z.string()).optional(),
    uiRaw: z.string().nullable().optional(),
    uiSpecRaw: z.string().nullable().optional(),
    architecturePackRaw: z.string().nullable().optional(),
    decisionRecordsRaw: z.string().nullable().optional(),
    guardrailsRaw: z.string().nullable().optional()
}).strict() satisfies z.ZodType<EvaluateAnalysisDeltaEvent>;

const EvaluateConflictEventSchema = z.object({
    summary: z.string().trim().min(1),
    items: z.array(z.string())
}).strict() satisfies z.ZodType<EvaluateConflictEvent>;

const EvaluateReadinessUpdateEventSchema = z.object({
    raw: z.string().trim().min(1)
}).strict() satisfies z.ZodType<EvaluateReadinessUpdateEvent>;

const EvaluateRemediationEventSchema = z.object({
    code: z.string().trim().min(1),
    severity: z.enum(["info", "warning", "error"]),
    message: z.string().trim().min(1),
    retrying: z.boolean().optional(),
    fallbackInjected: z.boolean().optional(),
    requestId: z.string().trim().min(1).optional()
}).strict() satisfies z.ZodType<EvaluateRemediationEvent>;

type EvaluateSsePayloadByName = {
    "analysis.delta": EvaluateAnalysisDeltaEvent;
    question: EvaluateQuestionEvent;
    conflict: EvaluateConflictEvent;
    "readiness.update": EvaluateReadinessUpdateEvent;
    trace: EvaluateTraceEvent;
    remediation: EvaluateRemediationEvent;
};

const EvaluateSseSchemaByName: {
    [Key in EvaluateSseEventName]: z.ZodType<EvaluateSsePayloadByName[Key]>;
} = {
    "analysis.delta": EvaluateAnalysisDeltaEventSchema,
    question: EvaluateQuestionEventSchema,
    conflict: EvaluateConflictEventSchema,
    "readiness.update": EvaluateReadinessUpdateEventSchema,
    trace: EvaluateTraceEventSchema,
    remediation: EvaluateRemediationEventSchema
};

function formatSchemaIssues(error: z.ZodError) {
    return error.issues
        .map((issue) => {
            const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
            return `${path}: ${issue.message}`;
        })
        .join(" | ");
}

export function validateEvaluateSseEvent<EventName extends EvaluateSseEventName>(
    event: EventName,
    payload: unknown
):
    | { ok: true; payload: EvaluateSsePayloadByName[EventName] }
    | { ok: false; issues: string } {
    const schema = EvaluateSseSchemaByName[event];
    const result = schema.safeParse(payload);
    if (result.success) {
        return {
            ok: true,
            payload: result.data
        };
    }
    return {
        ok: false,
        issues: formatSchemaIssues(result.error)
    };
}
