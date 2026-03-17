import { createPayload, file, folder } from "./_helpers.mjs";

const manifest = {
  version: "one_click_manifest_v2",
  templateKind: "react_vite",
  outputMode: "virtual_spec",
  outputLanguage: "en",
  oneClickMode: "strict_build_v1",
  ideProfile: "generic",
  generatedAt: "2026-03-18T00:00:00.000Z",
  profile: {
    version: "spec_pack_profile_v1",
    framework: "react_vite_spa",
    templateKind: "react_vite",
    routeStyle: "react_router",
    workspaceMode: "single_app",
    stackSignals: ["vite", "react-router", "firebase", "stripe"],
    dependencyHints: ["vite", "react-router", "firebase", "stripe"]
  },
  tasks: [
    {
      id: "task_1",
      phase: 4,
      phaseTitle: "Phase 4 - Feature UI & Pages",
      filePath: "src/App.tsx",
      taskType: "implementation",
      contentKind: "placeholder",
      mustWriteCode: false,
      doneCriteria: ["Implement the SPA shell and route wiring."],
      validationCommands: ["npx tsc --noEmit"],
      promptContent: "Implement the application shell and router layout.",
      promptPath: "src/_AI_PROMPT.md",
      dependencies: []
    },
    {
      id: "task_2",
      phase: 4,
      phaseTitle: "Phase 4 - Feature UI & Pages",
      filePath: "src/pages/Home.tsx",
      taskType: "implementation",
      contentKind: "placeholder",
      mustWriteCode: false,
      doneCriteria: ["Implement the landing page."],
      validationCommands: ["npx tsc --noEmit"],
      promptContent: "Implement the landing page that routes users into pricing.",
      promptPath: "src/pages/_AI_PROMPT.md",
      dependencies: ["task_1"]
    },
    {
      id: "task_3",
      phase: 4,
      phaseTitle: "Phase 4 - Feature UI & Pages",
      filePath: "src/pages/Pricing.tsx",
      taskType: "implementation",
      contentKind: "placeholder",
      mustWriteCode: false,
      doneCriteria: ["Implement pricing and checkout CTA state handling."],
      validationCommands: ["npx tsc --noEmit"],
      promptContent: "Implement the pricing page and checkout CTA state handling.",
      promptPath: "src/pages/_AI_PROMPT.md",
      dependencies: ["task_1"]
    },
    {
      id: "task_4",
      phase: 4,
      phaseTitle: "Phase 4 - Feature UI & Pages",
      filePath: "src/pages/Dashboard.tsx",
      taskType: "implementation",
      contentKind: "placeholder",
      mustWriteCode: false,
      doneCriteria: ["Implement the subscription dashboard."],
      validationCommands: ["npx tsc --noEmit"],
      promptContent: "Implement the billing dashboard, plan state, and cancellation controls.",
      promptPath: "src/pages/_AI_PROMPT.md",
      dependencies: ["task_1"]
    },
    {
      id: "task_5",
      phase: 4,
      phaseTitle: "Phase 4 - Feature UI & Pages",
      filePath: "src/pages/Login.tsx",
      taskType: "implementation",
      contentKind: "placeholder",
      mustWriteCode: false,
      doneCriteria: ["Implement the login entry screen."],
      validationCommands: ["npx tsc --noEmit"],
      promptContent: "Implement the login page used before dashboard access.",
      promptPath: "src/pages/_AI_PROMPT.md",
      dependencies: ["task_1"]
    },
    {
      id: "task_6",
      phase: 5,
      phaseTitle: "Phase 5 - API & Integration",
      filePath: "functions/package.json",
      taskType: "implementation",
      contentKind: "placeholder",
      mustWriteCode: false,
      doneCriteria: ["Replace the placeholder with a real functions package only if secondary runtime support is added."],
      validationCommands: ["npx tsc --noEmit"],
      promptContent: "Treat this as a placeholder task; do not emit invalid JSON scaffolding for unsupported secondary runtimes.",
      promptPath: "functions/_AI_PROMPT.md",
      dependencies: []
    },
    {
      id: "task_7",
      phase: 5,
      phaseTitle: "Phase 5 - API & Integration",
      filePath: "functions/src/createCheckoutSession.ts",
      taskType: "implementation",
      contentKind: "placeholder",
      mustWriteCode: false,
      doneCriteria: ["Implement checkout session creation."],
      validationCommands: ["npx tsc --noEmit"],
      promptContent: "Implement the serverless checkout session handler backed by Stripe and Firebase auth context.",
      promptPath: "functions/src/_AI_PROMPT.md",
      dependencies: ["task_6"]
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
      phase: 4,
      title: "Phase 4 - Feature UI & Pages",
      goal: "Implement user-facing pages and component interactions.",
      inputFiles: [
        "src/App.tsx",
        "src/pages/Home.tsx",
        "src/pages/Pricing.tsx",
        "src/pages/Dashboard.tsx",
        "src/pages/Login.tsx"
      ],
      expectedOutput: "Feature pages with usable interaction loops.",
      doneCriteria: "Primary user journeys are navigable end-to-end.",
      validationCommands: ["npx tsc --noEmit"]
    },
    {
      phase: 5,
      title: "Phase 5 - API & Integration",
      goal: "Build backend routes and external integration boundaries.",
      inputFiles: ["functions/package.json", "functions/src/createCheckoutSession.ts"],
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
    { path: "tsconfig.json", contentKind: "config" },
    { path: "vite.config.ts", contentKind: "config" },
    { path: "index.html", contentKind: "config" },
    { path: ".env.example", contentKind: "config" },
    { path: "GENERATION_MANIFEST.json", contentKind: "config" },
    { path: "docs/ROUTE_MAP.md", contentKind: "doc" },
    { path: "src/_AI_PROMPT.md", contentKind: "doc" },
    { path: "src/App.tsx", contentKind: "placeholder", promptPath: "src/_AI_PROMPT.md" },
    { path: "src/main.tsx", contentKind: "placeholder", promptPath: "src/_AI_PROMPT.md" },
    { path: "src/pages/_AI_PROMPT.md", contentKind: "doc" },
    { path: "src/pages/Home.tsx", contentKind: "placeholder", promptPath: "src/pages/_AI_PROMPT.md" },
    { path: "src/pages/Pricing.tsx", contentKind: "placeholder", promptPath: "src/pages/_AI_PROMPT.md" },
    { path: "src/pages/Dashboard.tsx", contentKind: "placeholder", promptPath: "src/pages/_AI_PROMPT.md" },
    { path: "src/pages/Login.tsx", contentKind: "placeholder", promptPath: "src/pages/_AI_PROMPT.md" },
    { path: "functions/_AI_PROMPT.md", contentKind: "doc" },
    { path: "functions/package.json", contentKind: "placeholder", promptPath: "functions/_AI_PROMPT.md" },
    { path: "functions/src/_AI_PROMPT.md", contentKind: "doc" },
    { path: "functions/src/createCheckoutSession.ts", contentKind: "placeholder", promptPath: "functions/src/_AI_PROMPT.md" }
  ]
};

const tree = [
  file(
    "README.md",
    `# SaaS Billing System Development Guide

## Project Overview
This project is generated by Forecoding as a **spec pack** for **SaaS Billing System**.

## Target Users & Business Goals
- Primary users: SaaS operators and self-serve subscribers.
- Core objective: sell plans, manage subscriptions, and expose billing state clearly.

## Tech Stack
| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React + Vite | Fast SPA shell for pricing and dashboard flows. |
| Routing | React Router | Explicit page routing for pricing, login, and dashboard. |
| Identity | Firebase Auth | Secure sign-in before billing access. |
| Backend | Firebase Cloud Functions | Webhook and checkout task execution boundary. |
| Payments | Stripe | Hosted checkout and subscription management. |

## Project Structure
- \`src/\`
- \`functions/\`
- \`docs/\`

## Quick Start
- Read \`ONE_CLICK_PROMPT.md\`, \`GENERATION_MANIFEST.json\`, and \`IMPLEMENTATION_PLAN.md\`.

## Environment Variables
- Use \`.env.example\` as a reference for Firebase and Stripe wiring.

## Development Workflow
- Implement SPA pages and secondary runtime tasks by manifest phase order.

## Acceptance Checklist
- [ ] Config files remain parseable.
- [ ] Route map matches the generated SPA page specs.
- [ ] Unsupported secondary runtime config stays a placeholder until implemented.

## FAQ
### 1) Why are some ZIP files placeholders?
Forecoding ships high-quality specs and safe config files first, then lets AI IDE complete feature code by phase.
`
  ),
  file(
    "package.json",
    `${JSON.stringify(
      {
        name: "saas-billing-system",
        version: "0.1.0",
        private: true,
        scripts: {
          dev: "vite",
          build: "vite build",
          preview: "vite preview",
          lint: "eslint .",
          "type-check": "tsc --noEmit"
        },
        dependencies: {
          react: "^18.3.1",
          "react-dom": "^18.3.1",
          "react-router-dom": "^7.1.5",
          firebase: "^11.6.1",
          stripe: "^17.3.1",
          "@stripe/stripe-js": "^4.10.0"
        },
        devDependencies: {
          vite: "^5.4.11",
          "@vitejs/plugin-react": "^4.3.4",
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
          jsx: "react-jsx"
        },
        include: ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"],
        exclude: ["node_modules"]
      },
      null,
      2
    )}\n`
  ),
  file(
    "vite.config.ts",
    `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()]
});
`
  ),
  file(
    "index.html",
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SaaS Billing System</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
  ),
  file(
    ".env.example",
    `NEXT_PUBLIC_FIREBASE_API_KEY=replace_me
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=replace_me.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=replace_me
STRIPE_SECRET_KEY=sk_test_replace_me
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_replace_me
`
  ),
  file(
    "IMPLEMENTATION_PLAN.md",
    `# SaaS Billing System Implementation Plan

## Phase 4 - Feature UI & Pages
### Input Files
- \`src/App.tsx\`
- \`src/pages/Home.tsx\`
- \`src/pages/Pricing.tsx\`
- \`src/pages/Dashboard.tsx\`
- \`src/pages/Login.tsx\`

## Phase 5 - API & Integration
### Input Files
- \`functions/package.json\`
- \`functions/src/createCheckoutSession.ts\`
`
  ),
  file("ONE_CLICK_PROMPT.md", "# One-Click Generation Runbook\n\nFollow manifest phases only.\n"),
  file("_AI_PROMPT.md", "# AI Task Index (Root)\n\nSee `src/` and `functions/` prompt files.\n"),
  folder("docs", [
    file(
      "ROUTE_MAP.md",
      `# Route Map

| Route | Spec Path | Notes |
| --- | --- | --- |
| / | src/pages/Home.tsx | Landing page |
| /pricing | src/pages/Pricing.tsx | Plan selection |
| /dashboard | src/pages/Dashboard.tsx | Billing dashboard |
| /login | src/pages/Login.tsx | Sign-in flow |
`
    )
  ]),
  folder("src", [
    file("_AI_PROMPT.md", "# Directory Task Prompt: src\n\nImplement the SPA shell and router setup.\n"),
    file(
      "main.tsx",
      `# Module Spec

## Role & Responsibility
- Bootstrap the SPA entrypoint and root render.

## Core Interactions
- Mount the router and application shell.
`
    ),
    file(
      "App.tsx",
      `# Page Spec

## Role & Responsibility
- Host the root route layout and navigation shell.

## UI Requirements
- Provide routing shell, auth gate, and global billing feedback.
- Include loading, empty, error, and success states where appropriate.

## Core Interactions
- Route to pricing, login, and dashboard surfaces.
`
    ),
    folder("pages", [
      file("_AI_PROMPT.md", "# Directory Task Prompt: src/pages\n\nImplement the customer-facing SaaS pages.\n"),
      file(
        "Home.tsx",
        `# Page Spec

## Role & Responsibility
- Host the landing page that routes users into pricing.

## UI Requirements
- Present product value, CTA, and logged-in redirects.
- Include loading, empty, error, and success states.

## Core Interactions
- Navigate to pricing and login.
`
      ),
      file(
        "Pricing.tsx",
        `# Page Spec

## Role & Responsibility
- Host the plan selection and checkout CTA flow.

## UI Requirements
- Show plans, billing cadence, and CTA state changes.
- Include loading, error, and success messaging.

## Core Interactions
- Start checkout and reflect plan selection.
`
      ),
      file(
        "Dashboard.tsx",
        `# Page Spec

## Role & Responsibility
- Host the subscription dashboard and billing controls.

## UI Requirements
- Show current plan, invoices, and cancellation/switch actions.
- Include loading, empty, error, and success states.

## Core Interactions
- Manage billing actions and account state.
`
      ),
      file(
        "Login.tsx",
        `# Page Spec

## Role & Responsibility
- Host sign-in before dashboard access.

## UI Requirements
- Include sign-in form, status messaging, and failure states.
- Preserve responsive layout behavior.

## Core Interactions
- Sign in and redirect to the intended billing page.
`
      )
    ])
  ]),
  folder("functions", [
    file(
      "_AI_PROMPT.md",
      `# Directory Task Prompt: functions

- Keep unsupported secondary runtime files as placeholders until a real functions workspace is introduced.
`
    ),
    file(
      "package.json",
      `# Module Spec

## Role & Responsibility
- Placeholder for a future functions workspace package.

## Core Interactions
- Replace this file with real JSON only when secondary runtime support is implemented.
`
    ),
    folder("src", [
      file("_AI_PROMPT.md", "# Directory Task Prompt: functions/src\n\nImplement checkout and webhook functions here.\n"),
      file(
        "createCheckoutSession.ts",
        `# API Spec

## Role & Responsibility
- Create Stripe checkout sessions for the selected billing plan.

## Core Interactions
- Validate auth context and plan input.
- Return stable checkout URLs and errors.
`
      )
    ])
  ])
];

const saasBillingFixture = {
  name: "saas-billing",
  payload: createPayload({
    toolStack: `| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React + Vite | Fast SPA shell |
| Routing | React Router | Pricing and dashboard routes |
| Identity | Firebase Auth | Sign-in before billing access |
| Backend | Firebase Cloud Functions | Checkout/webhook execution |
| Payments | Stripe | Hosted checkout and subscription control |`,
    manifest,
    tree
  })
};

export default saasBillingFixture;
