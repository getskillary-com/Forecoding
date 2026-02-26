import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Refund Policy | Forecoding",
  description: "Forecoding Refund Policy"
};

export default function RefundPage() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="mx-auto max-w-4xl px-6 py-12 space-y-8">
        <header className="space-y-3">
          <h1 className="text-3xl font-bold">Refund Policy</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">Effective Date: February 26, 2026</p>
        </header>

        <article className="space-y-6 text-sm leading-7 text-gray-700 dark:text-gray-300">
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">1. Scope</h2>
            <p>This Policy applies to one-time project credit purchases made through Forecoding.</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">2. Eligible Refund Situations</h2>
            <p>Refunds may be granted where:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>A verified technical malfunction prevents project generation</li>
              <li>Duplicate charges occur</li>
              <li>Refund is required by law</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">3. Non-Refundable Situations</h2>
            <p>Refunds will not be granted where:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>A project has been successfully generated</li>
              <li>The user is dissatisfied with AI output</li>
              <li>Incorrect input was provided</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">4. EU/UK Digital Content Notice</h2>
            <p>
              By purchasing and immediately accessing digital content, you expressly consent to immediate
              performance and acknowledge that you waive any applicable 14-day withdrawal right under EU/UK
              consumer law.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">5. Request Procedure</h2>
            <p>
              Email: <a href="mailto:support@forecoding.com" className="underline">support@forecoding.com</a>
            </p>
            <p>Include:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Order number</li>
              <li>Explanation of issue</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">6. Processing Time</h2>
            <p>Refunds are reviewed within 5-10 business days.</p>
            <p>Approved refunds are returned to the original payment method.</p>
          </section>
        </article>

        <div className="pt-4 border-t border-gray-200 dark:border-gray-800">
          <Link href="/" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
