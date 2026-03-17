import { createPayload, file, folder } from "./_helpers.mjs";

const manifest = {
  version: "one_click_manifest_v2",
  templateKind: "monorepo_multiapp",
  outputMode: "virtual_spec",
  outputLanguage: "en",
  oneClickMode: "strict_build_v1",
  ideProfile: "generic",
  generatedAt: "2026-03-18T00:00:00.000Z",
  profile: {
    version: "spec_pack_profile_v1",
    framework: "monorepo_multiapp",
    templateKind: "monorepo_multiapp",
    routeStyle: "next_app_router",
    workspaceMode: "monorepo",
    stackSignals: ["workspace", "next", "firebase"],
    dependencyHints: ["workspace", "next", "firebase"]
  },
  tasks: [
    {
      id: "task_1",
      phase: 4,
      phaseTitle: "Phase 4 - Feature UI & Pages",
      filePath: "apps/web/app/page.tsx",
      taskType: "implementation",
      contentKind: "placeholder",
      mustWriteCode: false,
      doneCriteria: ["Implement the admin landing page."],
      validationCommands: ["npx tsc --noEmit"],
      promptContent: "Implement the admin dashboard entry page.",
      promptPath: "apps/web/app/_AI_PROMPT.md",
      dependencies: []
    },
    {
      id: "task_2",
      phase: 4,
      phaseTitle: "Phase 4 - Feature UI & Pages",
      filePath: "apps/web/app/users/page.tsx",
      taskType: "implementation",
      contentKind: "placeholder",
      mustWriteCode: false,
      doneCriteria: ["Implement the user list and management screen."],
      validationCommands: ["npx tsc --noEmit"],
      promptContent: "Implement the user list, filters, and action controls.",
      promptPath: "apps/web/app/users/_AI_PROMPT.md",
      dependencies: ["task_1"]
    },
    {
      id: "task_3",
      phase: 5,
      phaseTitle: "Phase 5 - API & Integration",
      filePath: "apps/backend/src/services/users.service.ts",
      taskType: "implementation",
      contentKind: "placeholder",
      mustWriteCode: false,
      doneCriteria: ["Implement Firebase-backed user management service logic."],
      validationCommands: ["npx tsc --noEmit"],
      promptContent: "Implement Firebase Admin operations for creating, disabling, and listing users.",
      promptPath: "apps/backend/src/services/_AI_PROMPT.md",
      dependencies: ["task_2"]
    },
    {
      id: "task_4",
      phase: 1,
      phaseTitle: "Phase 1 - Domain & Types",
      filePath: "packages/domain/src/user.types.ts",
      taskType: "implementation",
      contentKind: "placeholder",
      mustWriteCode: false,
      doneCriteria: ["Define shared domain contracts for user management."],
      validationCommands: ["npx tsc --noEmit"],
      promptContent: "Define the shared user, role, and audit event types.",
      promptPath: "packages/domain/src/_AI_PROMPT.md",
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
      inputFiles: ["packages/domain/src/user.types.ts"],
      expectedOutput: "Stable type boundaries for feature work.",
      doneCriteria: "Type contracts cover key business entities.",
      validationCommands: ["npx tsc --noEmit"]
    },
    {
      phase: 4,
      title: "Phase 4 - Feature UI & Pages",
      goal: "Implement user-facing pages and component interactions.",
      inputFiles: ["apps/web/app/page.tsx", "apps/web/app/users/page.tsx"],
      expectedOutput: "Feature pages with usable interaction loops.",
      doneCriteria: "Primary user journeys are navigable end-to-end.",
      validationCommands: ["npx tsc --noEmit"]
    },
    {
      phase: 5,
      title: "Phase 5 - API & Integration",
      goal: "Build backend routes and external integration boundaries.",
      inputFiles: ["apps/backend/src/services/users.service.ts"],
      expectedOutput: "Usable API contracts and integration flow.",
      doneCriteria: "Frontend/backend integration works stably.",
      validationCommands: ["npx tsc --noEmit"]
    }
  ],
  files: [
    { path: "README.md", contentKind: "doc" },
    { path: "IMPLEMENTATION_PLAN.md", contentKind: "doc" },
    { path: "ONE_CLICK_PROMPT.md", contentKind: "doc" },
    { path: "_AI_PROMPT.md", contentKind: "doc" },
    { path: "package.json", contentKind: "config" },
    { path: "turbo.json", contentKind: "config" },
    { path: ".env.example", contentKind: "config" },
    { path: "GENERATION_MANIFEST.json", contentKind: "config" },
    { path: "docs/ROUTE_MAP.md", contentKind: "doc" },
    { path: "apps/web/package.json", contentKind: "config" },
    { path: "apps/web/app/_AI_PROMPT.md", contentKind: "doc" },
    { path: "apps/web/app/page.tsx", contentKind: "placeholder", promptPath: "apps/web/app/_AI_PROMPT.md" },
    { path: "apps/web/app/users/_AI_PROMPT.md", contentKind: "doc" },
    { path: "apps/web/app/users/page.tsx", contentKind: "placeholder", promptPath: "apps/web/app/users/_AI_PROMPT.md" },
    { path: "apps/backend/package.json", contentKind: "config" },
    { path: "apps/backend/src/services/_AI_PROMPT.md", contentKind: "doc" },
    { path: "apps/backend/src/services/users.service.ts", contentKind: "placeholder", promptPath: "apps/backend/src/services/_AI_PROMPT.md" },
    { path: "packages/domain/package.json", contentKind: "config" },
    { path: "packages/domain/src/_AI_PROMPT.md", contentKind: "doc" },
    { path: "packages/domain/src/user.types.ts", contentKind: "placeholder", promptPath: "packages/domain/src/_AI_PROMPT.md" }
  ]
};

const tree = [
  file(
    "README.md",
    `# User Management System Development Guide

## Project Overview
This project is generated by Forecoding as a **spec pack** for **User Management System**.

## Target Users & Business Goals
- Primary users: internal admins and support operators.
- Core objective: manage user lifecycle, roles, and account state safely.

## Tech Stack
| Layer | Choice | Why |
| --- | --- | --- |
| Workspace | Turborepo-style monorepo | Split web, backend, and domain ownership. |
| Web | Next.js (App Router) | Admin UI with structured server/client boundaries. |
| Backend | Firebase Admin SDK | Secure user lifecycle operations and auth management. |
| Auth | Firebase Auth | Shared identity model for admin actions and managed accounts. |

## Project Structure
- \`apps/web\`
- \`apps/backend\`
- \`packages/domain\`

## Quick Start
- Read \`ONE_CLICK_PROMPT.md\`, \`GENERATION_MANIFEST.json\`, and \`IMPLEMENTATION_PLAN.md\`.

## Environment Variables
- Use \`.env.example\` as the reference for later implementation.

## Development Workflow
- Follow manifest and implementation plan in order.

## Acceptance Checklist
- [ ] Workspace package structure stays aligned with the root manifest.
- [ ] Placeholder files map cleanly to prompt files.

## FAQ
### 1) Why are some ZIP files placeholders?
Forecoding ships high-quality specs and safe config files first, then lets AI IDE complete feature code by phase.
`
  ),
  file(
    "package.json",
    `${JSON.stringify(
      {
        name: "user-management-system",
        version: "0.1.0",
        private: true,
        workspaces: ["apps/*", "packages/*"],
        scripts: {
          dev: "turbo run dev --parallel",
          build: "turbo run build",
          lint: "turbo run lint",
          "type-check": "turbo run type-check"
        },
        devDependencies: {
          turbo: "^2.4.2",
          typescript: "^5"
        }
      },
      null,
      2
    )}\n`
  ),
  file(
    "turbo.json",
    `${JSON.stringify(
      {
        $schema: "https://turbo.build/schema.json",
        tasks: {
          dev: { cache: false, persistent: true },
          build: { dependsOn: ["^build"] },
          lint: { dependsOn: ["^lint"] },
          "type-check": { dependsOn: ["^type-check"] }
        }
      },
      null,
      2
    )}\n`
  ),
  file(
    ".env.example",
    `NEXT_PUBLIC_FIREBASE_API_KEY=replace_me
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=replace_me.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=replace_me
FIREBASE_CLIENT_EMAIL=replace_me
FIREBASE_PRIVATE_KEY=replace_me
`
  ),
  file(
    "IMPLEMENTATION_PLAN.md",
    `# User Management System Implementation Plan

## Phase 1 - Domain & Types
### Input Files
- \`packages/domain/src/user.types.ts\`

## Phase 4 - Feature UI & Pages
### Input Files
- \`apps/web/app/page.tsx\`
- \`apps/web/app/users/page.tsx\`

## Phase 5 - API & Integration
### Input Files
- \`apps/backend/src/services/users.service.ts\`
`
  ),
  file("ONE_CLICK_PROMPT.md", "# One-Click Generation Runbook\n\nFollow manifest phases only.\n"),
  file("_AI_PROMPT.md", "# AI Task Index (Root)\n\nSee workspace-specific `_AI_PROMPT.md` files.\n"),
  folder("docs", [
    file(
      "ROUTE_MAP.md",
      `# Route Map

| Route | Spec Path | Notes |
| --- | --- | --- |
| / | apps/web/app/page.tsx | Admin landing |
| /users | apps/web/app/users/page.tsx | User management |
`
    )
  ]),
  folder("apps", [
    folder("web", [
      file(
        "package.json",
        `${JSON.stringify(
          {
            name: "user-management-web",
            version: "0.1.0",
            private: true,
            dependencies: {
              next: "14.2.18",
              react: "^18.3.1",
              "react-dom": "^18.3.1"
            },
            devDependencies: {
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
      folder("app", [
        file("_AI_PROMPT.md", "# Directory Task Prompt: apps/web/app\n\nImplement the admin landing screen.\n"),
        file(
          "page.tsx",
          `# Page Spec

## Role & Responsibility
- Host the admin landing view.

## UI Requirements
- Show product summary, recent account activity, and quick actions.
- Include loading, empty, error, and success states.

## Core Interactions
- Navigate to the user management area.
`
        ),
        folder("users", [
          file("_AI_PROMPT.md", "# Directory Task Prompt: apps/web/app/users\n\nImplement the user management page.\n"),
          file(
            "page.tsx",
            `# Page Spec

## Role & Responsibility
- Host the user list, filters, and bulk actions.

## UI Requirements
- Include table, filters, action buttons, and result states.
- Preserve responsive admin layout behavior.

## Core Interactions
- Search, disable, invite, and inspect users.
`
          )
        ])
      ])
    ]),
    folder("backend", [
      file(
        "package.json",
        `${JSON.stringify(
          {
            name: "user-management-backend",
            version: "0.1.0",
            private: true,
            dependencies: {
              firebase: "^11.6.1",
              "firebase-admin": "^13.0.2"
            },
            devDependencies: {
              typescript: "^5",
              "@types/node": "^20"
            }
          },
          null,
          2
        )}\n`
      ),
      folder("src", [
        folder("services", [
          file("_AI_PROMPT.md", "# Directory Task Prompt: apps/backend/src/services\n\nImplement Firebase-backed user lifecycle service logic.\n"),
          file(
            "users.service.ts",
            `# Module Spec

## Role & Responsibility
- Encapsulate Firebase Admin user lifecycle operations.

## Core Interactions
- Create, disable, and list users.
- Emit stable audit-friendly responses.
`
          )
        ])
      ])
    ])
  ]),
  folder("packages", [
    folder("domain", [
      file(
        "package.json",
        `${JSON.stringify(
          {
            name: "user-management-domain",
            version: "0.1.0",
            private: true,
            devDependencies: {
              typescript: "^5"
            }
          },
          null,
          2
        )}\n`
      ),
      folder("src", [
        file("_AI_PROMPT.md", "# Directory Task Prompt: packages/domain/src\n\nDefine the shared user domain types.\n"),
        file(
          "user.types.ts",
          `# Type Spec

## Role & Responsibility
- Define shared user, role, and audit event contracts.

## Output Constraints
- Avoid \`any\`; prefer explicit interfaces and unions.
`
        )
      ])
    ])
  ])
];

const userManagementFixture = {
  name: "user-management",
  payload: createPayload({
    toolStack: `| Layer | Choice | Why |
| --- | --- | --- |
| Workspace | Monorepo | Split web, backend, and domain ownership |
| Web | Next.js (App Router) | Admin UI shell |
| Backend | Firebase Admin SDK | Secure user management |
| Auth | Firebase Auth | Identity and account state |`,
    manifest,
    tree
  })
};

export default userManagementFixture;
