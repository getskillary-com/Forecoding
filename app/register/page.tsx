import { Suspense } from "react";
import LoginClient from "../login/LoginClient";

export default function RegisterPage() {
    return (
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-500 dark:text-slate-300">Loading registration...</div>}>
            <LoginClient initialMode="register" />
        </Suspense>
    );
}
