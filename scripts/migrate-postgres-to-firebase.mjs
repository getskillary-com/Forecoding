#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Pool } from "pg";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

for (const envName of [".env.local", ".env"]) {
    const envPath = path.join(projectRoot, envName);
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath, override: false });
    }
}

function parseArgs(argv) {
    const args = {
        dryRun: false,
        limit: 0,
        batchSize: 200,
        resume: false,
        stateFile: path.join(projectRoot, ".migration-state.json"),
        fromUserId: ""
    };

    for (let i = 2; i < argv.length; i += 1) {
        const current = argv[i];
        const next = argv[i + 1];

        if (current === "--dry-run") {
            args.dryRun = true;
            continue;
        }
        if (current === "--resume") {
            args.resume = true;
            continue;
        }
        if (current === "--limit" && next) {
            args.limit = Math.max(0, Number.parseInt(next, 10) || 0);
            i += 1;
            continue;
        }
        if (current === "--batch-size" && next) {
            args.batchSize = Math.max(1, Number.parseInt(next, 10) || 200);
            i += 1;
            continue;
        }
        if (current === "--state-file" && next) {
            args.stateFile = path.resolve(projectRoot, next);
            i += 1;
            continue;
        }
        if (current === "--from-user-id" && next) {
            args.fromUserId = next.trim();
            i += 1;
            continue;
        }
    }

    return args;
}

function printHelp() {
    console.log("Migrate Forecoding data from PostgreSQL to Firebase.");
    console.log("");
    console.log("Usage:");
    console.log("  node scripts/migrate-postgres-to-firebase.mjs [options]");
    console.log("");
    console.log("Options:");
    console.log("  --dry-run                Validate and report without writing to Firebase.");
    console.log("  --limit <n>              Max records per phase (users/purchases/events).");
    console.log("  --batch-size <n>         Batch size. Default: 200.");
    console.log("  --resume                 Resume from state file.");
    console.log("  --state-file <path>      State file path. Default: .migration-state.json");
    console.log("  --from-user-id <id>      Start user migration from this user id.");
}

function initFirebaseAdmin() {
    const existing = getApps()[0];
    if (existing) return existing;

    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || "";
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

    if (!projectId) {
        throw new Error("Missing FIREBASE_PROJECT_ID.");
    }

    if (clientEmail && privateKey) {
        return initializeApp({
            credential: cert({ projectId, clientEmail, privateKey }),
            projectId
        });
    }

    return initializeApp({ projectId });
}

function loadState(pathname) {
    if (!fs.existsSync(pathname)) return {};
    try {
        return JSON.parse(fs.readFileSync(pathname, "utf8"));
    } catch {
        return {};
    }
}

function saveState(pathname, state) {
    fs.writeFileSync(pathname, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function ensureFirebaseUser(auth, user, dryRun) {
    if (!user.email) return;
    const payload = {
        uid: user.id,
        email: user.email,
        displayName: user.name || undefined,
        photoURL: user.image || undefined,
        emailVerified: Boolean(user.emailVerified)
    };

    if (dryRun) return;

    try {
        const existing = await auth.getUser(user.id);
        const updates = {};
        if (existing.email !== payload.email) updates.email = payload.email;
        if (existing.displayName !== payload.displayName) updates.displayName = payload.displayName || null;
        if (existing.photoURL !== payload.photoURL) updates.photoURL = payload.photoURL || null;
        if (existing.emailVerified !== payload.emailVerified) updates.emailVerified = payload.emailVerified;
        if (Object.keys(updates).length > 0) {
            await auth.updateUser(user.id, updates);
        }
    } catch (error) {
        const code = error && typeof error === "object" ? error.code : "";
        if (code === "auth/user-not-found") {
            await auth.createUser(payload);
            return;
        }
        throw error;
    }
}

async function fetchUsers(pool, cursor, batchSize) {
    if (cursor) {
        const result = await pool.query(
            `
                SELECT
                    u.id,
                    u.email,
                    u.name,
                    u.image,
                    u."emailVerified" AS email_verified,
                    u."sessionVersion" AS session_version,
                    ws.data AS workspace_data,
                    ws."createdAt" AS workspace_created_at,
                    ws."updatedAt" AS workspace_updated_at
                FROM "User" u
                LEFT JOIN "WorkspaceState" ws ON ws."userId" = u.id
                WHERE u.id > $1
                ORDER BY u.id ASC
                LIMIT $2
            `,
            [cursor, batchSize]
        );
        return result.rows;
    }

    const result = await pool.query(
        `
            SELECT
                u.id,
                u.email,
                u.name,
                u.image,
                u."emailVerified" AS email_verified,
                u."sessionVersion" AS session_version,
                ws.data AS workspace_data,
                ws."createdAt" AS workspace_created_at,
                ws."updatedAt" AS workspace_updated_at
            FROM "User" u
            LEFT JOIN "WorkspaceState" ws ON ws."userId" = u.id
            ORDER BY u.id ASC
            LIMIT $1
        `,
        [batchSize]
    );
    return result.rows;
}

async function migrateUsersAndWorkspaces({ pool, auth, db, args, state, summary }) {
    let cursor = args.fromUserId || state.lastUserId || "";
    let done = false;

    while (!done) {
        const rows = await fetchUsers(pool, cursor, args.batchSize);
        if (rows.length === 0) break;

        for (const row of rows) {
            summary.users.scanned += 1;
            cursor = row.id;
            const workspaceExists = row.workspace_data !== null && row.workspace_data !== undefined;
            const user = {
                id: row.id,
                email: row.email || "",
                name: row.name || null,
                image: row.image || null,
                emailVerified: toDate(row.email_verified),
                sessionVersion: Number(row.session_version || 0),
                workspaceData: workspaceExists ? row.workspace_data : null,
                workspaceCreatedAt: toDate(row.workspace_created_at),
                workspaceUpdatedAt: toDate(row.workspace_updated_at)
            };

            try {
                await ensureFirebaseUser(auth, user, args.dryRun);

                if (!args.dryRun) {
                    await db.collection("users").doc(user.id).set(
                        {
                            email: user.email || "",
                            emailLower: (user.email || "").toLowerCase(),
                            name: user.name || null,
                            image: user.image || null,
                            emailVerified: user.emailVerified,
                            legacyPasswordResetRequired: true,
                            sessionVersion: user.sessionVersion || 0,
                            createdAt: user.workspaceCreatedAt || new Date(),
                            updatedAt: user.workspaceUpdatedAt || new Date()
                        },
                        { merge: true }
                    );

                    if (workspaceExists) {
                        await db.collection("workspaces").doc(user.id).set(
                            {
                                userId: user.id,
                                projects: Array.isArray(user.workspaceData) ? user.workspaceData : [],
                                createdAt: user.workspaceCreatedAt || new Date(),
                                updatedAt: user.workspaceUpdatedAt || new Date()
                            },
                            { merge: true }
                        );
                    }
                }

                summary.users.migrated += 1;
                if (workspaceExists) {
                    summary.workspaces.migrated += 1;
                }
            } catch (error) {
                summary.users.failed += 1;
                summary.samples.push({
                    phase: "users",
                    id: user.id,
                    error: error instanceof Error ? error.message : String(error)
                });
            }

            if (args.limit > 0 && summary.users.migrated >= args.limit) {
                done = true;
                break;
            }
        }

        state.lastUserId = cursor;
        if (args.resume) {
            saveState(args.stateFile, state);
        }
    }
}

async function migrateProjectPurchases({ pool, db, args, state, summary }) {
    let offset = Number.isFinite(state.purchaseOffset) ? state.purchaseOffset : 0;
    let done = false;

    while (!done) {
        let rows = [];
        try {
            const result = await pool.query(
                `
                    SELECT
                        "userId" AS user_id,
                        "projectId" AS project_id,
                        provider,
                        status,
                        amount,
                        currency,
                        "requestId" AS request_id,
                        "merchantOrderId" AS merchant_order_id,
                        "paymentIntentId" AS payment_intent_id,
                        "paidAt" AS paid_at,
                        "refundedAt" AS refunded_at,
                        "createdAt" AS created_at,
                        "updatedAt" AS updated_at
                    FROM "ProjectPurchase"
                    ORDER BY "createdAt" ASC
                    LIMIT $1 OFFSET $2
                `,
                [args.batchSize, offset]
            );
            rows = result.rows;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            summary.samples.push({
                phase: "projectPurchases",
                id: "query",
                error: message
            });
            return;
        }

        if (!Array.isArray(rows) || rows.length === 0) break;

        for (const row of rows) {
            summary.purchases.scanned += 1;
            const userId = row.user_id || "";
            const projectId = row.project_id || "";
            const id = `${userId}_${projectId}`;

            try {
                if (!args.dryRun) {
                    await db.collection("projectPurchases").doc(id).set(
                        {
                            userId,
                            projectId,
                            provider: row.provider || "stripe",
                            status: row.status || "PENDING",
                            amount: Number(row.amount || 0),
                            currency: (row.currency || "usd").toLowerCase(),
                            requestId: row.request_id || "",
                            merchantOrderId: row.merchant_order_id || "",
                            paymentIntentId: row.payment_intent_id || null,
                            paidAt: toDate(row.paid_at),
                            refundedAt: toDate(row.refunded_at),
                            createdAt: toDate(row.created_at) || new Date(),
                            updatedAt: toDate(row.updated_at) || new Date()
                        },
                        { merge: true }
                    );
                }
                summary.purchases.migrated += 1;
            } catch (error) {
                summary.purchases.failed += 1;
                summary.samples.push({
                    phase: "projectPurchases",
                    id,
                    error: error instanceof Error ? error.message : String(error)
                });
            }

            if (args.limit > 0 && summary.purchases.migrated >= args.limit) {
                done = true;
                break;
            }
        }

        offset += rows.length;
        state.purchaseOffset = offset;
        if (args.resume) {
            saveState(args.stateFile, state);
        }
    }
}

async function migrateWebhookEvents({ pool, db, args, state, summary }) {
    let offset = Number.isFinite(state.webhookOffset) ? state.webhookOffset : 0;
    let done = false;

    while (!done) {
        let rows = [];
        try {
            const result = await pool.query(
                `
                    SELECT
                        provider,
                        "eventId" AS event_id,
                        "eventName" AS event_name,
                        payload,
                        "processedAt" AS processed_at
                    FROM "WebhookEventLog"
                    ORDER BY "processedAt" ASC
                    LIMIT $1 OFFSET $2
                `,
                [args.batchSize, offset]
            );
            rows = result.rows;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            summary.samples.push({
                phase: "webhookEvents",
                id: "query",
                error: message
            });
            return;
        }

        if (!Array.isArray(rows) || rows.length === 0) break;

        for (const row of rows) {
            summary.webhooks.scanned += 1;
            const provider = row.provider || "stripe";
            const eventId = row.event_id || "";
            const id = `${provider}_${eventId}`;

            try {
                if (!args.dryRun) {
                    await db.collection("webhookEvents").doc(id).set(
                        {
                            provider,
                            eventId,
                            eventName: row.event_name || "unknown",
                            payload: typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload || {}),
                            processedAt: toDate(row.processed_at) || new Date()
                        },
                        { merge: true }
                    );
                }
                summary.webhooks.migrated += 1;
            } catch (error) {
                summary.webhooks.failed += 1;
                summary.samples.push({
                    phase: "webhookEvents",
                    id,
                    error: error instanceof Error ? error.message : String(error)
                });
            }

            if (args.limit > 0 && summary.webhooks.migrated >= args.limit) {
                done = true;
                break;
            }
        }

        offset += rows.length;
        state.webhookOffset = offset;
        if (args.resume) {
            saveState(args.stateFile, state);
        }
    }
}

async function main() {
    const args = parseArgs(process.argv);
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
        printHelp();
        return;
    }

    const sourceDatabaseUrl = process.env.MIGRATION_SOURCE_DATABASE_URL || "";
    if (!sourceDatabaseUrl) {
        throw new Error("Missing MIGRATION_SOURCE_DATABASE_URL. Required for PostgreSQL source migration.");
    }

    const firebaseApp = initFirebaseAdmin();
    const auth = getAuth(firebaseApp);
    const db = getFirestore(firebaseApp);
    const pool = new Pool({ connectionString: sourceDatabaseUrl });
    const state = args.resume ? loadState(args.stateFile) : {};

    const summary = {
        users: { scanned: 0, migrated: 0, failed: 0 },
        workspaces: { migrated: 0 },
        purchases: { scanned: 0, migrated: 0, failed: 0 },
        webhooks: { scanned: 0, migrated: 0, failed: 0 },
        samples: []
    };

    console.log("Starting migration with settings:");
    console.log(
        JSON.stringify(
            {
                dryRun: args.dryRun,
                limit: args.limit,
                batchSize: args.batchSize,
                resume: args.resume,
                fromUserId: args.fromUserId || null,
                stateFile: args.stateFile
            },
            null,
            2
        )
    );

    try {
        await migrateUsersAndWorkspaces({ pool, auth, db, args, state, summary });
        await migrateProjectPurchases({ pool, db, args, state, summary });
        await migrateWebhookEvents({ pool, db, args, state, summary });
    } finally {
        await pool.end();
    }

    if (args.resume) {
        saveState(args.stateFile, state);
    }

    console.log("");
    console.log("Migration summary:");
    console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
