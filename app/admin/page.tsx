import Link from "next/link";
import { getServerUser } from "@/lib/server-auth";

export default async function AdminPage() {
    const user = await getServerUser();
    const email = user?.email || "admin";

    return (
        <main className="min-h-screen bg-gray-50 dark:bg-gray-950 p-8">
            <div className="max-w-4xl mx-auto space-y-6">
                <header className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                    <p className="text-sm text-gray-500 dark:text-gray-400">Admin Console</p>
                    <h1 className="text-3xl font-bold mt-1 text-gray-900 dark:text-white">Admin Backend</h1>
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                        Current account: {email}
                    </p>
                </header>

                <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Generation and Payment Policy</h2>
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                        Admin users generate directly in Wizard. Stripe checkout links are not created for admin accounts.
                    </p>
                    <div className="mt-4 flex gap-3">
                        <Link
                            href="/dashboard"
                            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
                        >
                            Open Dashboard
                        </Link>
                        <Link
                            href="/"
                            className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-sm font-medium"
                        >
                            Go Home
                        </Link>
                    </div>
                </section>
            </div>
        </main>
    );
}
