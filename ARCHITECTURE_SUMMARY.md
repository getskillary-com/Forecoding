# Forecoding Architecture Summary

## Purpose
Forecoding helps non-technical users turn vague product ideas into a structured blueprint that can be implemented by AI IDEs such as Cursor. It guides requirement discovery, produces architecture artifacts, and generates a project blueprint with file-level specs.

## High-Level Components
- Web UI built with Next.js App Router in the `app` directory.
- API routes for AI evaluation, blueprint generation, and batch analysis.
- Gemini integration for reasoning and content generation.
- Local persistence via browser localStorage (`fl_projects_v2`).
- Blueprint packaging and download via JSZip.

## Key Routes and Modules
- `app/page.tsx` provides the landing page.
- `app/dashboard/page.tsx` manages project creation and local project lists.
- `app/wizard/page.tsx` is the main workspace for chat, architecture, PRD, and blueprint.
- `app/api/evaluate/route.ts` streams requirement evaluation results.
- `app/api/generate/route.ts` generates blueprint JSON.
- `app/api/batch-analyze/route.ts` runs batch review and streams results via SSE.
- `lib/gemini.ts` handles Gemini calls, fallback, JSON parsing, and post-processing.
- `lib/prompts.ts` stores system prompts for evaluation and blueprint generation.
- `lib/batch-processing.ts` chunks file trees and consolidates analysis.
- `components/FileTreeDisplay.tsx` renders and zips blueprint output.

## Core Data Model
- `Project` contains multiple `ProjectVersion` entries.
- `ProjectVersion` stores `ProjectVersionData` such as messages, evaluation, generation, and current diagram.
- `EvaluationResponse` holds density score, clarified items, and missing items.
- `GenerationResponse` includes `projectTree`, `toolStack`, and `cursorPrompt`.

## Core Flows
1. Project creation
   - User creates a project on the dashboard.
   - A first version is created and stored in localStorage.

2. Chat evaluation flow
   - Wizard sends structured chat messages to `/api/evaluate`.
   - The server streams XML-tagged output from Gemini.
   - The client parses density, diagram, clarified items, and missing items.

3. Blueprint generation flow
   - Wizard calls `/api/generate` with conversation summary and diagram.
   - Gemini returns JSON for the project blueprint.
   - Server post-processes output and injects baseline config files, quality rules, and optional Prisma or NextAuth specs.
   - Client renders the blueprint and allows download as a zip.

4. Batch review flow
   - Wizard calls `/api/batch-analyze` with the blueprint tree.
   - Server chunks the tree, analyzes each batch, and consolidates findings.
   - Client displays progress and the final report.

## Post-Processing and Guardrails
- JSON parsing is hardened with extraction and retry logic.
- Baseline configs are injected when missing.
- Default tool stack is applied if absent.
- File-level specs are augmented with quality constraints, template guidance, and good vs bad examples.
- Optional Prisma, NextAuth, and README setup sections are generated when detected.

## Current Constraints
- No server-side database; all project state is stored in localStorage.
- No user authentication within Forecoding itself.
- localStorage size limits can impact very large blueprints.

## Planned Evolution (Maintainability)
- Persist project state in a database to support multi-device and multi-user access.
- Allow importing real code repositories for reading, indexing, and diffing.
- Evolve versioning into incremental changes on the code tree (delta updates) rather than full blueprint regeneration.

## Environment
- `GEMINI_API_KEY` must be set in `.env.local` for AI features.
