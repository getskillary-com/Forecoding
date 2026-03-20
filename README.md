# Forecoding

Forecoding is an architecture-first AI product for engineering teams. Its job is not to jump directly to code generation. It acts as a single AI Architect that discovers business context, defines system boundaries, records tradeoffs, sets implementation guardrails, maintains a live PRD, and only then hands off to scaffold generation.

## Product model

Forecoding works through five architecture stages:

1. `context`: define product goal, target users, journeys, constraints, and risks
2. `boundaries`: define bounded contexts, ownership, modules, and data ownership
3. `decisions`: lock contracts, ADR-style decisions, and non-functional requirements
4. `guardrails`: define implementation order, acceptance criteria, and test strategy
5. `ready_to_generate`: allow scaffold generation and payment flow

The primary durable artifact is the `ArchitecturePack`, not the chat transcript.

## Core artifacts

- `ArchitecturePack`: business context, domain model, bounded contexts, module responsibilities, data ownership, contracts, non-functional requirements, delivery plan, and experience constraints
- `DecisionRecord[]`: explicit architecture decisions with rationale, rejected alternatives, and consequences
- `GuardrailChecklist`: implementation order, acceptance criteria, and test strategy
- `EvaluationResponse.analysis`: live PRD facts and open questions synced from chat
- `GenerationResponse`: optional downstream scaffold output once the architecture pack is ready

## Runtime surfaces

- `/wizard`: main Architect workspace
- `/api/evaluate`: streaming architecture conversation endpoint (`analysis.delta`, `question`, `conflict`, `readiness.update`, `trace`, `remediation`)
- `/api/generate`: scaffold generation endpoint, only available for a ready architecture pack
- `/api/workspace`: optimistic-concurrency workspace envelope endpoint with revision + snapshot history
- `/api/workspace/tasks`: task DAG execution and replay endpoint for version-scoped task runs
- `/admin/workspaces/[ownerUserId]`: workspace revision timeline and impact diff detail page
- `/api/payments/stripe/*`: checkout and pricing for scaffold generation
- `/api/admin/tenants`: tenant lifecycle governance API (active, trial, suspended)
- `/api/admin/tenants/rebind`: reassign user/workspace tenant binding with audit trail
- `/api/admin/orgs`: organization lifecycle governance API (active, suspended)
- `/api/admin/orgs/bind-tenant`: bind or unbind tenant to an organization
- `/api/admin/users`: user account governance API (active, suspended)
- `/api/admin/workspaces/[ownerUserId]`: workspace revision timeline API
- `/api/admin/workspaces/[ownerUserId]/diff`: workspace revision diff + impact analysis API
- `/api/admin/status`: admin identity, capability status, and runtime preflight summary API
- `/api/admin/flags`: governance feature-flag list and mutation API
- `/api/admin/jobs`: generation job list/search API
- `/api/admin/jobs/[jobId]`: generation job detail API
- `/api/admin/tasks/runs`: cross-workspace task DAG run query API
- `/api/admin/tasks/runs/replay`: operator-triggered task DAG replay API
- `/api/admin/webhooks/stripe`: Stripe webhook ledger query API
- `/api/admin/webhooks/stripe/[eventId]`: Stripe webhook detail API
- `/api/admin/webhooks/stripe/replay`: Stripe webhook replay mutation API
- `/api/admin/billing/events`: billing event ledger query API
- `/api/admin/billing/purchases`: purchase lifecycle query API
- `/api/admin/billing/refund`: operator-triggered refund record API
- `/api/admin/releases`: release publishing and release list API
- `/api/admin/releases/[releaseId]`: release detail and rollback impact API
- `/api/admin/releases/approve`: release approve/reject mutation API
- `/api/admin/releases/rollback`: release rollback mutation API
- `/api/admin/observability`: admin SLO and alert snapshot endpoint
- `/api/admin/audit`: platform audit and governance trail API

## Tech stack

- Next.js App Router
- React 19
- TypeScript
- Firebase Auth + Firestore
- OpenAI / Gemini / Claude provider abstraction
- Stripe Checkout

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment

Core runtime:

```env
APP_BASE_URL=https://your-domain.com
AUTH_SESSION_COOKIE_NAME=__session
```

Firebase server credentials:

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Auth and email:

```env
AUTH_CODE_SECRET=replace_with_long_random_secret
EMAIL_SERVER=smtp://user:password@smtp.example.com:587
EMAIL_FROM=Forecoding <no-reply@example.com>
```

AI provider:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.1-pro-preview
GEMINI_BACKUP_MODEL=gemini-3.1-pro-preview

# or
AI_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5-mini

# or
AI_PROVIDER=claude
CLAUDE_API_KEY=your_anthropic_api_key
CLAUDE_MODEL=claude-opus-4-6
CLAUDE_API_BASE_URL=https://api.anthropic.com
CLAUDE_API_VERSION=2023-06-01
CLAUDE_MAX_TOKENS=8192
```

Stripe:

```env
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PAYMENTS_PAUSED=0
STRIPE_UNIT_AMOUNT_CENTS=799
STRIPE_MAX_UNIT_AMOUNT_CENTS=1499
STRIPE_DYNAMIC_PRICING_ENABLED=1
STRIPE_CURRENCY=usd
```

Admin:

```env
FORECODING_ADMIN_EMAILS=admin@example.com,ops@example.com
FORECODING_OPERATOR_EMAILS=release-manager@example.com
FORECODING_ADMIN_VIEWER_EMAILS=viewer@example.com
```

Role model:

- `admin`: full platform control and payment bypass.
- `operator`: can manage feature flags, publish release tags, approve/reject releases, and run rollback operations.
- `viewer`: read-only access to the admin console.

Capability model:

- `feature_flags_write`: create/enable/disable feature flags
- `orgs_manage`: create/update organizations and bind tenant-to-org
- `billing_manage`: execute refund operations and billing lifecycle interventions
- `users_manage`: update user account status (`active`, `suspended`)
- `tasks_manage`: replay workspace task DAG runs from admin operations
- `releases_publish`: publish release tags
- `releases_approve`: approve or reject release tags
- `releases_rollback`: execute release rollback operations
- `webhooks_replay`: replay stored Stripe webhook events
- `tenants_manage`: update tenant lifecycle status (`active`, `trial`, `suspended`)

Governance feature flags:

- `generation.enabled`: pauses scaffold generation for non-admin users.
- `releases.publish.enabled`: pauses release tag publishing from the admin API.
- `releases.approval.enabled`: pauses release approve/reject actions from the admin console and admin API.
- `releases.rollback.enabled`: pauses release rollback actions from the admin console and admin API.
- `stripe.webhook_replay.enabled`: pauses webhook replay actions from the admin console and admin API.
- `scope=tenant` and `scope=workspace` flags require `scopeId` (`tenantId` or workspace owner user id).
- Runtime resolution priority is `workspace scope` > `tenant scope` > `global scope`.

Dev only:

```env
NEXT_PUBLIC_DEV_AUTH_BYPASS=0
```

## Architecture rules

- Do not treat `density_score` as the only source of truth. Readiness is derived from the architecture pack and guardrails.
- Scaffold generation must not run without a ready architecture pack.
- Scaffold generation is blocked for suspended tenants unless an `admin` override is used.
- Stripe quote and checkout APIs are blocked for suspended tenants unless an `admin` override is used.
- PRD, architecture pack, and delivery guardrails stay synchronized before scaffold generation.
- UI design is a subsection of architecture, not a separate product center.
- Local chat history is not enough. Uploaded artifacts and structured architecture objects are persisted at version level.

## Verification

Run the engineering baseline before shipping changes:

```bash
npm run lint
npm run build
```

For `spec-pack` generation changes, also run:

```bash
npm run validate:fixtures
```

For evaluate SSE contract fixtures, run:

```bash
npm run check:evaluate-sse-contract
```

For release-time runtime environment gating, run:

```bash
npm run gate:runtime-preflight
```

To fail on warnings as well (strict release gate), run:

```bash
npm run gate:runtime-preflight:strict
```

For a local `/api/generate` route smoke test, run:

```bash
npm run smoke:generate-api
```

For a local `/api/evaluate` typed SSE smoke test, run:

```bash
npm run smoke:evaluate-sse-api
```

For admin API regression smoke checks, run:

```bash
npm run smoke:admin-api
```

For workspace task DAG API smoke checks, run:

```bash
npm run smoke:workspace-tasks-api
```

For a self-contained local smoke run that auto-starts `next dev`, run:

```bash
npm run smoke:admin-api:local
```

`smoke:admin-api` modes:

- unauthenticated mode: no `ADMIN_SMOKE_COOKIE` present, validates protected admin endpoints return `401`
- authenticated mode: set `ADMIN_SMOKE_COOKIE` and optionally `ADMIN_SMOKE_BASE_URL` to validate list + detail admin API flows
- mutation mode: add `--allow-mutations` plus replay/rollback ids to validate `webhook replay` and `release rollback`

CI smoke coverage:

- `Platform Validation` workflow always runs unauthenticated admin smoke checks
- if repository secret `ADMIN_SMOKE_COOKIE` is configured, the same workflow also runs authenticated list + detail smoke checks
- use manual workflow `Admin Mutation Smoke` to run replay/rollback mutation smoke with optional ids

## Demo and utilities

- `/demo` shows a read-only exported workspace
- `npm run demo:export -- --email you@example.com --project-id <PROJECT_ID>` exports a demo workspace
- `npm run secrets:apphosting` opens the Firebase App Hosting secret helper
- `npm run migrate:firebase -- --dry-run` previews historical data migration
