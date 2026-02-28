import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/server-auth";

export default async function WizardLayout({
    children
}: {
    children: React.ReactNode;
}) {
    const user = await getServerUser();

    if (!user?.uid) {
        redirect("/login?callbackUrl=/dashboard");
    }

    return <>{children}</>;
}
