import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Refund Policy | Forecoding",
  description: "Forecoding Refund Policy"
};

const REFUND_POLICY_TEXT = `Refund Policy

Effective Date: February 26, 2026

1. Scope

This Policy applies to one-time project credit purchases made through Forecoding.

2. Eligible Refund Situations

Refunds may be granted where:

A verified technical malfunction prevents project generation

Duplicate charges occur

Refund is required by law

3. Non-Refundable Situations

Refunds will not be granted where:

A project has been successfully generated

The user is dissatisfied with AI output

Incorrect input was provided

4. EU/UK Digital Content Notice

By purchasing and immediately accessing digital content, you expressly consent to immediate performance and acknowledge that you waive any applicable 14-day withdrawal right under EU/UK consumer law.

5. Request Procedure

Email: support@forecoding.com

Include:

Order number

Explanation of issue

6. Processing Time

Refunds are reviewed within 5-10 business days.
Approved refunds are returned to the original payment method.`;

export default function RefundPage() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="mx-auto max-w-4xl px-6 py-12 space-y-6">
        <h1 className="text-3xl font-bold">Refund Policy</h1>
        <article className="whitespace-pre-line text-sm leading-7 text-gray-700 dark:text-gray-300">
          {REFUND_POLICY_TEXT}
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
