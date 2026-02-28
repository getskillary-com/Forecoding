import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/server-auth";
import { isAdminUser } from "@/lib/admin";

export default async function AdminLayout({
    children
}: {
    children: React.ReactNode;
}) {
    const user = await getServerUser();

    if (!user?.uid) {
        redirect("/login?callbackUrl=/admin");
    }

    if (!isAdminUser({ email: user.email })) {
        redirect("/dashboard");
    }

    return <>{children}</>;
}
