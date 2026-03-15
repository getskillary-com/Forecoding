import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSessionIdentity } from "@/lib/server-auth";
import { isAdminUser } from "@/lib/admin";

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

    if (!isAdminUser({ email: user.email })) {
        redirect("/dashboard");
    }

    return <>{children}</>;
}
