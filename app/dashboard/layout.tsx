import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function DashboardLayout({
    children
}: {
    children: React.ReactNode;
}) {
    let session = null;
    try {
        session = await getServerSession(authOptions);
    } catch (error) {
        console.error("[dashboard] Failed to load session:", error);
    }
    const userId = (session?.user as { id?: string } | undefined)?.id;

    if (!session || !userId) {
        redirect("/login?callbackUrl=/dashboard");
    }

    return <>{children}</>;
}
