"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState
} from "react";
import { User, onAuthStateChanged, signOut } from "firebase/auth";
import { getFirebaseAuth } from "./firebase-client";

type AuthContextValue = {
    user: User | null;
    loading: boolean;
    syncSessionCookie: (userOverride?: User | null) => Promise<boolean>;
    signOutUser: (callbackUrl?: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function postSession(idToken: string) {
    const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken })
    });
    return res.ok;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let unsubscribe = () => {};
        try {
            const auth = getFirebaseAuth();
            unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
                setUser(nextUser);
                if (nextUser) {
                    try {
                        const idToken = await nextUser.getIdToken();
                        await postSession(idToken);
                    } catch {
                        // Ignore passive session sync errors.
                    }
                }
                setLoading(false);
            });
        } catch {
            setLoading(false);
        }

        return () => unsubscribe();
    }, []);

    const syncSessionCookie = useCallback(async (userOverride?: User | null) => {
        const target = userOverride ?? user;
        if (!target) return false;
        const idToken = await target.getIdToken(true);
        return postSession(idToken);
    }, [user]);

    const signOutUser = useCallback(async (callbackUrl?: string) => {
        try {
            await fetch("/api/auth/session", { method: "DELETE" });
        } catch {
            // Ignore cookie clear error and continue local sign-out.
        }

        try {
            const auth = getFirebaseAuth();
            await signOut(auth);
        } finally {
            const target = callbackUrl || "/login?callbackUrl=/dashboard";
            window.location.assign(target);
        }
    }, []);

    const value = useMemo<AuthContextValue>(() => ({
        user,
        loading,
        syncSessionCookie,
        signOutUser
    }), [user, loading, syncSessionCookie, signOutUser]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within AuthProvider.");
    }
    return context;
}
