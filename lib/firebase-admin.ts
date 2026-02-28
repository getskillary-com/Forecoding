import { App, cert, getApps, initializeApp } from "firebase-admin/app";
import { Auth, UserRecord, getAuth } from "firebase-admin/auth";
import { Firestore, getFirestore } from "firebase-admin/firestore";

function readPrivateKey() {
    const raw = process.env.FIREBASE_PRIVATE_KEY || "";
    if (!raw) return "";
    return raw.replace(/\\n/g, "\n");
}

function buildFirebaseApp() {
    const existing = getApps()[0];
    if (existing) return existing;

    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || "";
    const privateKey = readPrivateKey();

    if (projectId && clientEmail && privateKey) {
        return initializeApp({
            credential: cert({
                projectId,
                clientEmail,
                privateKey
            }),
            projectId
        });
    }

    return initializeApp(projectId ? { projectId } : undefined);
}

const app: App = buildFirebaseApp();

export const firebaseAdminApp = app;
export const adminAuth: Auth = getAuth(app);
export const adminDb: Firestore = getFirestore(app);

export async function findAuthUserByEmail(email: string): Promise<UserRecord | null> {
    try {
        return await adminAuth.getUserByEmail(email);
    } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        if (code === "auth/user-not-found") {
            return null;
        }
        throw error;
    }
}

export async function findAuthUserByUid(uid: string): Promise<UserRecord | null> {
    try {
        return await adminAuth.getUser(uid);
    } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        if (code === "auth/user-not-found") {
            return null;
        }
        throw error;
    }
}

