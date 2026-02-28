"use client";

import { AuthProvider } from "@/lib/auth-client";

export function Providers({ children }: { children: React.ReactNode }) {
    return <AuthProvider>{children}</AuthProvider>;
}
