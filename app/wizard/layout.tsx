import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSessionIdentity } from "@/lib/server-auth";

export const metadata: Metadata = {
    title: "Workspace Wizard"
};

export default async function WizardLayout({
    children
}: {
    children: React.ReactNode;
}) {
    const user = await getServerSessionIdentity();

    if (!user?.uid) {
        redirect("/login?callbackUrl=/dashboard");
    }

    return <>{children}</>;
}
