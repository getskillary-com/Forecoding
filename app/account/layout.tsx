import { redirect } from "next/navigation";
import { getServerSessionIdentity } from "@/lib/server-auth";

export default async function AccountLayout({
    children
}: {
    children: React.ReactNode;
}) {
    const user = await getServerSessionIdentity();

    if (!user?.uid) {
        redirect("/login?callbackUrl=/account");
    }

    return <>{children}</>;
}
