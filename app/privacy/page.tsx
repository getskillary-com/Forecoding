import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Forecoding",
  description: "Forecoding Privacy Policy"
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="mx-auto max-w-4xl px-6 py-12 space-y-8">
        <header className="space-y-3">
          <h1 className="text-3xl font-bold">Privacy Policy</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">Effective Date: February 26, 2026</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Legal Entity: CIVRA LTD</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Registered Address: 71-75 Shelton Street, Covent Garden, London, England, WC2H 9JQ, United Kingdom
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Contact Email: <a href="mailto:support@forecoding.com" className="underline">support@forecoding.com</a>
          </p>
        </header>

        <article className="space-y-6 text-sm leading-7 text-gray-700 dark:text-gray-300">
          <p>
            This Privacy Policy explains how CIVRA LTD ("Company," "we," "us," or "our") collects, uses,
            discloses, and safeguards Personal Information in connection with the Forecoding AI SaaS platform
            ("Service").
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
            <p>CIVRA LTD acts as the Data Controller for Personal Information processed through the Service.</p>
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
            <p>UK supervisory authority: Information Commissioner's Office (ICO)</p>
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
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">11. Children's Privacy</h2>
            <p>The Service is not intended for individuals under 13 years of age.</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">12. Updates</h2>
            <p>We may update this Privacy Policy periodically. The revised effective date will be posted on this page.</p>
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
