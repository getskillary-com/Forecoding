import { createPayload, file, folder } from "./_helpers.mjs";

const manifest = {
  version: "one_click_manifest_v2",
  templateKind: "next_root",
  outputMode: "virtual_spec",
  outputLanguage: "en",
  oneClickMode: "strict_build_v1",
  ideProfile: "generic",
  generatedAt: "2026-03-18T00:00:00.000Z",
  profile: {
    version: "spec_pack_profile_v1",
    framework: "next_app_router",
    templateKind: "next_root",
    routeStyle: "next_app_router",
    workspaceMode: "single_app",
    stackSignals: ["next", "prisma", "vercel-ai", "openai"],
    dependencyHints: ["next", "prisma", "vercel-ai", "openai"]
  },
  tasks: [
    {
      id: "task_1",
      phase: 4,
      phaseTitle: "Phase 4 - Feature UI & Pages",
      filePath: "app/page.tsx",
      taskType: "implementation",
      contentKind: "placeholder",
      mustWriteCode: false,
      doneCriteria: ["Replace the page spec with the final travel planner screen."],
      validationCommands: ["npx tsc --noEmit"],
      promptContent: "Implement the landing and itinerary form page with loading, empty, error, and success states.",
      promptPath: "app/_AI_PROMPT.md",
      dependencies: []
    },
    {
      id: "task_2",
      phase: 5,
      phaseTitle: "Phase 5 - API & Integration",
      filePath: "app/api/generate/route.ts",
      taskType: "implementation",
      contentKind: "placeholder",
      mustWriteCode: false,
      doneCriteria: ["Implement streaming itinerary generation with structured validation."],
      validationCommands: ["npx tsc --noEmit"],
      promptContent: "Implement the server route that streams itinerary output with validated request/response contracts.",
      promptPath: "app/api/generate/_AI_PROMPT.md",
      dependencies: ["task_1"]
    },
    {
      id: "task_3",
      phase: 4,
      phaseTitle: "Phase 4 - Feature UI & Pages",
      filePath: "components/ResultPanel.tsx",
      taskType: "implementation",
      contentKind: "placeholder",
      mustWriteCode: false,
      doneCriteria: ["Render markdown itinerary output and state messaging."],
      validationCommands: ["npx tsc --noEmit"],
      promptContent: "Implement the result panel used by the generated travel guide flow.",
      promptPath: "components/_AI_PROMPT.md",
      dependencies: ["task_1"]
    },
    {
      id: "task_4",
      phase: 2,
      phaseTitle: "Phase 2 - State & Core Logic",
      filePath: "lib/ai.ts",
      taskType: "implementation",
      contentKind: "placeholder",
      mustWriteCode: false,
      doneCriteria: ["Implement AI client helpers and request shaping."],
      validationCommands: ["npx tsc --noEmit"],
      promptContent: "Implement the AI integration helper using Vercel AI SDK/OpenAI-compatible primitives.",
      promptPath: "lib/_AI_PROMPT.md",
      dependencies: []
    },
    {
      id: "task_5",
      phase: 1,
      phaseTitle: "Phase 1 - Domain & Types",
      filePath: "prisma/schema.prisma",
      taskType: "implementation",
      contentKind: "placeholder",
      mustWriteCode: false,
      doneCriteria: ["Define the attraction and itinerary data model."],
      validationCommands: ["npx tsc --noEmit"],
      promptContent: "Define the Prisma schema used to persist attractions and generated itineraries.",
      promptPath: "prisma/_AI_PROMPT.md",
      dependencies: []
    }
  ],
  phases: [
    {
      phase: 0,
      title: "Phase 0 - Bootstrap",
      goal: "Establish spec-pack baseline, safe configs, and onboarding docs.",
      inputFiles: [],
      expectedOutput: "Aligned docs, prompts, and parseable config files.",
      doneCriteria: "Config files are parseable and docs/manifests stay aligned.",
      validationCommands: ["npm run validate:generated"]
    },
    {
      phase: 1,
      title: "Phase 1 - Domain & Types",
      goal: "Define domain objects and type contracts before implementation.",
      inputFiles: ["prisma/schema.prisma"],
      expectedOutput: "Stable type boundaries for feature work.",
      doneCriteria: "Type contracts cover key business entities.",
      validationCommands: ["npx tsc --noEmit"]
    },
    {
      phase: 2,
      title: "Phase 2 - State & Core Logic",
      goal: "Implement state transitions and core business logic.",
      inputFiles: ["lib/ai.ts"],
      expectedOutput: "Callable core logic/state layer.",
      doneCriteria: "Core flow is minimally executable locally.",
      validationCommands: ["npx tsc --noEmit"]
    },
    {
      phase: 3,
      title: "Phase 3 - App Shell & Shared UI",
      goal: "Set up shared shell/layout and reusable structure.",
      inputFiles: [],
      expectedOutput: "Stable layout and shared shell components.",
      doneCriteria: "Pages can mount on consistent layout.",
      validationCommands: ["npx tsc --noEmit"]
    },
    {
      phase: 4,
      title: "Phase 4 - Feature UI & Pages",
      goal: "Implement user-facing pages and component interactions.",
      inputFiles: ["app/page.tsx", "components/ResultPanel.tsx"],
      expectedOutput: "Feature pages with usable interaction loops.",
      doneCriteria: "Primary user journeys are navigable end-to-end.",
      validationCommands: ["npx tsc --noEmit"]
    },
    {
      phase: 5,
      title: "Phase 5 - API & Integration",
      goal: "Build backend routes and external integration boundaries.",
      inputFiles: ["app/api/generate/route.ts"],
      expectedOutput: "Usable API contracts and integration flow.",
      doneCriteria: "Frontend/backend integration works stably.",
      validationCommands: ["npx tsc --noEmit"]
    },
    {
      phase: 6,
      title: "Phase 6 - Validation & Handoff",
      goal: "Run static checks, build validation, and manual QA.",
      inputFiles: [],
      expectedOutput: "Ship-ready handoff package.",
      doneCriteria: "lint/type-check/build pass and key QA completed.",
      validationCommands: ["npm run validate:generated"]
    }
  ],
  files: [
    { path: "README.md", contentKind: "doc" },
    { path: "IMPLEMENTATION_PLAN.md", contentKind: "doc" },
    { path: "ONE_CLICK_PROMPT.md", contentKind: "doc" },
    { path: "_AI_PROMPT.md", contentKind: "doc" },
    { path: "package.json", contentKind: "config" },
    { path: "tsconfig.json", contentKind: "config" },
    { path: "next.config.ts", contentKind: "config" },
    { path: ".env.example", contentKind: "config" },
    { path: "GENERATION_MANIFEST.json", contentKind: "config" },
    { path: "docs/FUNCTIONAL_ARCHITECTURE.md", contentKind: "doc" },
    { path: "docs/ROUTE_MAP.md", contentKind: "doc" },
    { path: "app/_AI_PROMPT.md", contentKind: "doc" },
    { path: "app/page.tsx", contentKind: "placeholder", promptPath: "app/_AI_PROMPT.md" },
    { path: "app/api/generate/_AI_PROMPT.md", contentKind: "doc" },
    { path: "app/api/generate/route.ts", contentKind: "placeholder", promptPath: "app/api/generate/_AI_PROMPT.md" },
    { path: "components/_AI_PROMPT.md", contentKind: "doc" },
    { path: "components/ResultPanel.tsx", contentKind: "placeholder", promptPath: "components/_AI_PROMPT.md" },
    { path: "lib/_AI_PROMPT.md", contentKind: "doc" },
    { path: "lib/ai.ts", contentKind: "placeholder", promptPath: "lib/_AI_PROMPT.md" },
    { path: "prisma/_AI_PROMPT.md", contentKind: "doc" },
    { path: "prisma/schema.prisma", contentKind: "placeholder", promptPath: "prisma/_AI_PROMPT.md" }
  ]
};

const tree = [
  file(
    "README.md",
    `# Travel Guide Generator Development Guide

## Project Overview
This project is generated by Forecoding as a **spec pack** for **Travel Guide Generator**.
README is the shared entry for humans and AI IDE agents, covering architecture intent, safe config files, task prompts, and execution order.

## Target Users & Business Goals
- Primary users: trip planners, travel operators, and AI IDE-assisted builders.
- Core objective: generate personalized travel guides from attraction data and user preferences.

## Tech Stack
| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js (App Router) | Structured server/client boundaries for the planning flow. |
| Database | PostgreSQL + Prisma | Strong relational modeling for attractions and generated itineraries. |
| AI Toolkit | Vercel AI SDK | Reliable model orchestration for itinerary generation. |
| Model Provider | OpenAI Responses API | Structured output and streaming support. |

## Project Structure
- \`app/\`
- \`components/\`
- \`lib/\`
- \`prisma/\`
- \`docs/\`

## Quick Start
- Read \`ONE_CLICK_PROMPT.md\`, \`GENERATION_MANIFEST.json\`, and \`IMPLEMENTATION_PLAN.md\`.

## Environment Variables
- Copy \`.env.example\` to \`.env.local\` when implementing runtime code.

## Development Workflow
- Follow \`IMPLEMENTATION_PLAN.md\` in phase order.
- Use directory-level \`_AI_PROMPT.md\` files for placeholder implementation.

## Acceptance Checklist
- [ ] Placeholder files map cleanly to manifest tasks and prompt files.
- [ ] Config files remain parseable and aligned with the stack table.

## FAQ
### 1) Why are some ZIP files placeholders?
Forecoding ships high-quality specs and safe config files first, then lets AI IDE complete feature code by phase to reduce one-shot drift.
`
  ),
  file(
    "package.json",
    `${JSON.stringify(
      {
        name: "travel-guide-generator",
        version: "0.1.0",
        private: true,
        scripts: {
          dev: "next dev",
          build: "next build",
          start: "next start",
          lint: "next lint",
          "type-check": "tsc --noEmit"
        },
        dependencies: {
          next: "14.2.18",
          react: "^18.3.1",
          "react-dom": "^18.3.1",
          "@prisma/client": "^5.22.0",
          ai: "^4.3.16",
          "@ai-sdk/openai": "^1.3.22",
          openai: "^4.86.1"
        },
        devDependencies: {
          prisma: "^5.22.0",
          typescript: "^5",
          "@types/node": "^20",
          "@types/react": "^18",
          "@types/react-dom": "^18"
        }
      },
      null,
      2
    )}\n`
  ),
  file(
    "tsconfig.json",
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: "esnext",
          moduleResolution: "bundler",
          jsx: "preserve",
          plugins: [{ name: "next" }]
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
        exclude: ["node_modules"]
      },
      null,
      2
    )}\n`
  ),
  file(
    "next.config.ts",
    `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true
};

export default nextConfig;
`
  ),
  file(
    ".env.example",
    `NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/travel
OPENAI_API_KEY=replace_me
`
  ),
  file(
    "IMPLEMENTATION_PLAN.md",
    `# Travel Guide Generator Implementation Plan

## Phase 1 - Domain & Types
### Input Files
- \`prisma/schema.prisma\`

## Phase 2 - State & Core Logic
### Input Files
- \`lib/ai.ts\`

## Phase 4 - Feature UI & Pages
### Input Files
- \`app/page.tsx\`
- \`components/ResultPanel.tsx\`

## Phase 5 - API & Integration
### Input Files
- \`app/api/generate/route.ts\`
`
  ),
  file(
    "ONE_CLICK_PROMPT.md",
    `# One-Click Generation Runbook

Read \`GENERATION_MANIFEST.json\` first, then execute placeholder files by phase order.
`
  ),
  file(
    "_AI_PROMPT.md",
    `# AI Task Index (Root)

- Phase 1: \`prisma/schema.prisma\`
- Phase 2: \`lib/ai.ts\`
- Phase 4: \`app/page.tsx\`
- Phase 4: \`components/ResultPanel.tsx\`
- Phase 5: \`app/api/generate/route.ts\`
`
  ),
  folder("docs", [
    file(
      "FUNCTIONAL_ARCHITECTURE.md",
      `# Functional Architecture

- Planner UI collects travel constraints and destination goals.
- AI generation route validates requests and streams itinerary output.
- Prisma schema stores attractions and generated plans.
`
    ),
    file(
      "ROUTE_MAP.md",
      `# Route Map

| Route | Spec Path | Notes |
| --- | --- | --- |
| / | app/page.tsx | Travel guide landing and request flow |
`
    )
  ]),
  folder("app", [
    file(
      "_AI_PROMPT.md",
      `# Directory Task Prompt: app

- Implement \`app/page.tsx\` and keep loading, empty, error, and success states explicit.
`
    ),
    file(
      "page.tsx",
      `# Page Spec

## Role & Responsibility
- Host the primary travel guide request flow.

## UI Requirements
- Define form layout and result panel placement.
- Specify loading, empty, error, and success states.
- Preserve responsive behavior for mobile and desktop.

## Core Interactions
- Collect destination, duration, and budget inputs.
- Trigger itinerary generation and render markdown output.
`
    ),
    folder("api", [
      folder("generate", [
        file(
          "_AI_PROMPT.md",
          `# Directory Task Prompt: app/api/generate

- Implement the itinerary generation route with validated request/response contracts.
`
        ),
        file(
          "route.ts",
          `# API Spec

## Role & Responsibility
- Generate itinerary results from validated travel preferences.

## Core Interactions
- POST accepts travel constraints and streams itinerary sections.

## Output Constraints
- Return structured, user-safe responses.
- Preserve stable validation behavior.
`
        )
      ])
    ])
  ]),
  folder("components", [
    file(
      "_AI_PROMPT.md",
      `# Directory Task Prompt: components

- Implement the result panel used by the itinerary workflow.
`
    ),
    file(
      "ResultPanel.tsx",
      `# Component Spec

## Role & Responsibility
- Render the generated itinerary markdown and supporting state copy.

## Core Interactions
- Receive loading/error/result props.
- Keep the presentation reusable across itinerary flows.
`
    )
  ]),
  folder("lib", [
    file(
      "_AI_PROMPT.md",
      `# Directory Task Prompt: lib

- Implement the AI orchestration helper for itinerary generation.
`
    ),
    file(
      "ai.ts",
      `# Module Spec

## Role & Responsibility
- Implement the OpenAI / Vercel AI SDK helper used by the itinerary route.

## Core Interactions
- Build structured prompts and model requests.
- Export testable helper functions.
`
    )
  ]),
  folder("prisma", [
    file(
      "_AI_PROMPT.md",
      `# Directory Task Prompt: prisma

- Define the schema for attractions and generated itineraries.
`
    ),
    file(
      "schema.prisma",
      `# Module Spec

## Role & Responsibility
- Define database models for attractions, destinations, and itinerary snapshots.

## Core Interactions
- Keep schema aligned with the API payload contracts.
`
    )
  ])
];

const travelGuideFixture = {
  name: "travel-guide",
  payload: createPayload({
    toolStack: `| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js (App Router) | Structured server/client boundaries |
| Database | PostgreSQL + Prisma | Relational data model |
| AI Toolkit | Vercel AI SDK | Streaming orchestration |
| Model Provider | OpenAI Responses API | Structured generation |`,
    manifest,
    tree
  })
};

export default travelGuideFixture;
