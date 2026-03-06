import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Forecoding",
  description: "Forecoding Privacy Policy"
};

export default function PrivacyPage() {
  return (
    <main className="relative min-h-screen overflow-hidden text-slate-900 dark:text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="fc-float absolute -top-20 -left-20 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="fc-float absolute right-0 top-1/3 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" style={{ animationDelay: "1.2s" }} />
      </div>
      <div className="relative mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="fc-surface-strong space-y-8 rounded-[var(--radius-2xl)] p-6 sm:p-8">
        <header className="space-y-3 border-b border-[color:var(--border)] pb-6">
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-100">Privacy Policy</h1>
          <p className="text-sm text-slate-500 dark:text-slate-300">Effective Date: February 26, 2026</p>
          <p className="text-sm text-slate-500 dark:text-slate-300">Legal Entity: Forecoding</p>
          <p className="text-sm text-slate-500 dark:text-slate-300">
            Contact Email: <a href="mailto:support@forecoding.com" className="underline">support@forecoding.com</a>
          </p>
        </header>

        <article className="space-y-6 text-sm leading-7 text-slate-700 dark:text-slate-300">
          <p>
            This Privacy Policy explains how Forecoding (&quot;Company,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) collects, uses,
            discloses, and safeguards Personal Information in connection with the Forecoding AI SaaS platform
            (&quot;Service&quot;).
          </p>

          <section className="space-y-2">
            <p>This Policy is designed to comply with:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>United States law (including California Consumer Privacy Act (CCPA/CPRA))</li>
              <li>EU General Data Protection Regulation (GDPR)</li>
              <li>UK GDPR and the UK Data Protection Act 2018</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">1. Scope</h2>
            <p>This Privacy Policy applies to all users worldwide who access or use the Forecoding website and services.</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">2. Data Controller</h2>
            <p>Forecoding acts as the Data Controller for Personal Information processed through the Service.</p>
            <p>The following providers act as Data Processors:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Stripe (payment processing)</li>
              <li>Google Cloud / Firebase (cloud hosting and database services)</li>
              <li>Google Gemini API (AI model processing)</li>
              <li>Email service providers (verification and notification delivery)</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">3. Categories of Data Collected</h2>
            <div className="space-y-1">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">A. Account Information</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>Email address</li>
                <li>Authentication/verification data</li>
              </ul>
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">B. Transaction Information</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>Stripe transaction ID</li>
                <li>Payment confirmation details</li>
              </ul>
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">C. User Content</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>Product ideas</li>
                <li>PRDs</li>
                <li>Architecture diagrams</li>
                <li>Development task lists</li>
                <li>Code suggestions</li>
              </ul>
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">D. Technical Information</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>IP address</li>
                <li>Device and browser metadata</li>
                <li>Usage logs</li>
                <li>Cookies and similar technologies</li>
              </ul>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">4. Legal Basis for Processing (EEA/UK Users)</h2>
            <p>
              For users located in the European Economic Area (EEA) or United Kingdom, we process Personal
              Information under the following lawful bases (Article 6 GDPR):
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Performance of a contract (Art. 6(1)(b))</li>
              <li>Legitimate interests (Art. 6(1)(f))</li>
              <li>Compliance with legal obligations (Art. 6(1)(c))</li>
              <li>Consent (Art. 6(1)(a)) for non-essential cookies</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">5. Purpose of Processing</h2>
            <p>We process Personal Information to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Provide AI-powered project generation services</li>
              <li>Authenticate user accounts</li>
              <li>Process payments</li>
              <li>Detect and prevent fraud or abuse</li>
              <li>Improve system performance and reliability</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">6. International Data Transfers</h2>
            <p>
              Personal Information may be transferred to and processed in the United States or other jurisdictions
              outside the UK/EEA.
            </p>
            <p>Where required, transfers are safeguarded by:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Standard Contractual Clauses (SCCs)</li>
              <li>UK Addendum to SCCs</li>
              <li>Applicable adequacy decisions</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">7. Data Retention</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>Account data: retained until account deletion or as required by law</li>
              <li>Financial and transaction records: retained for at least seven (7) years</li>
              <li>AI-generated and user-submitted content: retained for operational necessity and system integrity</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">8. Data Subject Rights (EEA/UK)</h2>
            <p>EEA and UK users may exercise the following rights:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Right of access</li>
              <li>Right to rectification</li>
              <li>Right to erasure</li>
              <li>Right to restriction</li>
              <li>Right to data portability</li>
              <li>Right to object</li>
              <li>Right to lodge a complaint with a supervisory authority</li>
            </ul>
            <p>Requests will be processed within 30 days. Submit requests to: support@forecoding.com</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">9. California Privacy Rights</h2>
            <p>California residents may request:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Disclosure of categories of personal information collected</li>
              <li>Deletion of personal information</li>
              <li>Information about data sharing practices</li>
            </ul>
            <p>We do not sell personal information.</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">10. Security Measures</h2>
            <p>We implement commercially reasonable safeguards including:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>HTTPS encryption</li>
              <li>Role-based access controls</li>
              <li>Secure cloud infrastructure</li>
            </ul>
            <p>However, no system is completely secure.</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">11. Children&apos;s Privacy</h2>
            <p>The Service is not intended for individuals under 13 years of age.</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">12. Updates</h2>
            <p>We may update this Privacy Policy periodically. The revised effective date will be posted on this page.</p>
          </section>
        </article>

        <div className="pt-4 border-t border-[color:var(--border)]">
          <Link href="/" className="fc-button-secondary inline-flex items-center px-4 py-2 text-sm font-semibold">
            Back to Home
          </Link>
        </div>
        </div>
      </div>
    </main>
  );
}
