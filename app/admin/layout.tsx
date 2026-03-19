import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSessionIdentity } from "@/lib/server-auth";
import { hasAdminRole } from "@/lib/admin";

export const metadata: Metadata = {
    title: "Admin Console"
};

export default async function AdminLayout({
    children
}: {
    children: React.ReactNode;
}) {
    const user = await getServerSessionIdentity();

    if (!user?.uid) {
        redirect("/login?callbackUrl=/admin");
    }

    if (!hasAdminRole({ email: user.email }, "viewer")) {
        redirect("/dashboard");
    }

    return <>{children}</>;
}
