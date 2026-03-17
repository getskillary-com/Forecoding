# Forecoding

Forecoding is an architecture-first AI product for engineering teams. Its job is not to jump directly to code generation. It acts as a single AI Architect that discovers business context, defines system boundaries, records tradeoffs, sets implementation guardrails, maintains a live PRD, and only then hands off to scaffold generation.

## Product model

Forecoding works through six architecture stages:

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
- `/api/evaluate`: streaming architecture conversation endpoint
- `/api/generate`: scaffold generation endpoint, only available for a ready architecture pack
- `/api/payments/stripe/*`: checkout and pricing for scaffold generation

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
```

## Architecture rules

- Do not treat `density_score` as the only source of truth. Readiness is derived from the architecture pack and guardrails.
- Scaffold generation must not run without a ready architecture pack.
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

For a local `/api/generate` route smoke test, run:

```bash
npm run smoke:generate-api
```

## Demo and utilities

- `/demo` shows a read-only exported workspace
- `npm run demo:export -- --email you@example.com --project-id <PROJECT_ID>` exports a demo workspace
- `npm run secrets:apphosting` opens the Firebase App Hosting secret helper
- `npm run migrate:firebase -- --dry-run` previews historical data migration
