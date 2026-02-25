import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function WizardLayout({
    children
}: {
    children: React.ReactNode;
}) {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string } | undefined)?.id;

    if (!session || !userId) {
        redirect("/login?callbackUrl=/dashboard");
    }

    return <>{children}</>;
}
