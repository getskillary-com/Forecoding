import { Suspense } from "react";
import LoginClient from "./LoginClient";

export default function LoginPage() {
    return (
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-500 dark:text-slate-300">Loading authentication...</div>}>
            <LoginClient />
        </Suspense>
    );
}
