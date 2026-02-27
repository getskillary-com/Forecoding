import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";

export default async function AdminLayout({
    children
}: {
    children: React.ReactNode;
}) {
    const session = await getServerSession(authOptions);
    const user = session?.user as { id?: string; email?: string | null } | undefined;

    if (!user?.id) {
        redirect("/login?callbackUrl=/admin");
    }

    if (!isAdminUser(user)) {
        redirect("/dashboard");
    }

    return <>{children}</>;
}

