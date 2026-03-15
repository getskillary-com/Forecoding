"use client";

import { AuthProvider } from "@/lib/auth-client";
import { NavigationFeedbackProvider } from "@/components/NavigationFeedback";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <NavigationFeedbackProvider>
            <AuthProvider>{children}</AuthProvider>
        </NavigationFeedbackProvider>
    );
}
