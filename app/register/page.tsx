import { Suspense } from "react";
import LoginClient from "../login/LoginClient";

export default function RegisterPage() {
    return (
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading...</div>}>
            <LoginClient initialMode="register" />
        </Suspense>
    );
}
