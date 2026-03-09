import { adminDb } from "@/lib/firebase-admin";
import { toDateOrNull } from "./firestore-utils";
import { normalizeProjects } from "@/lib/project-language";
import type { Project } from "@/types";

type WorkspaceDoc = {
    userId: string;
    projects: Project[];
    createdAt: Date | null;
    updatedAt: Date | null;
};

function workspacesCollection() {
    return adminDb.collection("workspaces");
}

function parseProjects(raw: unknown): Project[] {
    return normalizeProjects(raw);
}

export async function getWorkspaceByUserId(userId: string): Promise<WorkspaceDoc | null> {
    const snap = await workspacesCollection().doc(userId).get();
    if (!snap.exists) return null;

    const data = snap.data() || {};
    return {
        userId,
        projects: parseProjects(data.projects),
        createdAt: toDateOrNull(data.createdAt),
        updatedAt: toDateOrNull(data.updatedAt)
    };
}

export async function saveWorkspaceByUserId(userId: string, projects: Project[]) {
    const docRef = workspacesCollection().doc(userId);
    const now = new Date();
    const existing = await docRef.get();

    await docRef.set(
        {
            userId,
            projects,
            updatedAt: now,
            ...(existing.exists ? {} : { createdAt: now })
        },
        { merge: true }
    );
}

export async function markProjectPaidInWorkspace(userId: string, projectId: string): Promise<boolean> {
    const docRef = workspacesCollection().doc(userId);
    const snap = await docRef.get();
    if (!snap.exists) return false;

    const data = snap.data() || {};
    const projects = parseProjects(data.projects);
    if (projects.length === 0) return false;

    let touched = false;
    const updatedProjects = projects.map((project) => {
        if (project.id !== projectId) return project;
        touched = true;
        return {
            ...project,
            updatedAt: Date.now(),
            versions: project.versions.map((version) => ({
                ...version,
                data: {
                    ...version.data,
                    paymentStatus: "paid" as const
                }
            }))
        };
    });

    if (!touched) return false;

    await docRef.set(
        {
            projects: updatedProjects,
            updatedAt: new Date()
        },
        { merge: true }
    );

    return true;
}
