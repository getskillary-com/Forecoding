import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Cookie Policy | Forecoding",
  description: "Forecoding Cookie Policy"
};

export default function CookiePage() {
  return (
    <main className="relative min-h-screen overflow-hidden text-slate-900 dark:text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="fc-float absolute -top-20 -left-20 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="fc-float absolute right-0 top-1/3 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" style={{ animationDelay: "1s" }} />
      </div>
      <div className="relative mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="fc-surface-strong space-y-8 rounded-[var(--radius-2xl)] p-6 sm:p-8">
        <header className="space-y-3 border-b border-[color:var(--border)] pb-6">
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-100">Cookie Policy</h1>
          <p className="text-sm text-slate-500 dark:text-slate-300">Effective Date: February 26, 2026</p>
          <p className="text-sm text-slate-500 dark:text-slate-300">Last Updated: February 26, 2026</p>
          <p className="text-sm text-slate-500 dark:text-slate-300">Company: CIVRA LTD</p>
          <p className="text-sm text-slate-500 dark:text-slate-300">
            Registered Address: 71-75 Shelton Street, Covent Garden, London, England, WC2H 9JQ, United Kingdom
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-300">ICO Registration Number: ZB949556</p>
          <p className="text-sm text-slate-500 dark:text-slate-300">
            Contact: <a href="mailto:support@forecoding.com" className="underline">support@forecoding.com</a>
          </p>
        </header>

        <article className="space-y-6 text-sm leading-7 text-slate-700 dark:text-slate-300">
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">1. Introduction</h2>
            <p>
              This Cookie Policy explains how CIVRA LTD (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) uses cookies and similar
              technologies when you access or use Forecoding (the &quot;Service&quot;).
            </p>
            <p>This Policy should be read together with our Privacy Policy.</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">2. What Are Cookies?</h2>
            <p>
              Cookies are small text files placed on your device when you visit a website. They help websites
              function efficiently and provide reporting information.
            </p>
            <p>Cookies may be:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Session cookies (expire when you close your browser)</li>
              <li>Persistent cookies (remain for a set period)</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">3. Categories of Cookies We Use</h2>

            <div className="space-y-2">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">3.1 Essential Cookies</h3>
              <p>These cookies are strictly necessary for the operation of the Service.</p>
              <p>They enable:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>User authentication</li>
                <li>Account login</li>
                <li>Security protection</li>
                <li>Session management</li>
              </ul>
              <p>Legal basis (EU/UK): Legitimate interest / contract performance.</p>
              <p>Consent is not required for essential cookies.</p>
            </div>

            <div className="space-y-2">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">3.2 Functional Cookies</h3>
              <p>These cookies allow us to remember your preferences and improve your experience.</p>
              <p>They may include:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Language preferences</li>
                <li>Interface settings</li>
                <li>Session continuity</li>
              </ul>
              <p>Legal basis (EU/UK): Consent where required.</p>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">4. Cookies We Do Not Use</h2>
            <p>We do not use:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Advertising cookies</li>
              <li>Cross-site behavioral tracking cookies</li>
              <li>Third-party ad network cookies</li>
            </ul>
            <p>We do not sell personal data for advertising purposes.</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">5. Third-Party Cookies</h2>
            <p>
              Certain service providers (such as hosting providers or security infrastructure providers) may set
              cookies necessary for secure platform operation.
            </p>
            <p>
              Where third-party cookies involve personal data processing, appropriate safeguards such as Standard
              Contractual Clauses (SCCs) apply where required.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">6. Legal Basis for Cookie Use (EU & UK Users)</h2>
            <p>For users located in the European Economic Area or United Kingdom:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Essential cookies are deployed based on legitimate interest and contract necessity</li>
              <li>Non-essential cookies are deployed only after user consent where required by law</li>
            </ul>
            <p>You may withdraw consent at any time.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">7. Managing Cookies</h2>

            <div className="space-y-2">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Browser Settings</h3>
              <p>Most browsers allow you to:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Block cookies</li>
                <li>Delete existing cookies</li>
                <li>Configure alerts for new cookies</li>
              </ul>
              <p>Please note that disabling essential cookies may affect service functionality.</p>
            </div>

            <div className="space-y-2">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Consent Mechanism</h3>
              <p>
                Where required by law, we provide a cookie consent mechanism allowing you to accept or reject
                non-essential cookies.
              </p>
              <p>You may adjust preferences at any time.</p>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">8. Data Retention</h2>
            <p>Cookies are retained:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Session cookies: until browser close</li>
              <li>Persistent cookies: up to 12 months unless deleted earlier</li>
            </ul>
            <p>
              Security logs associated with cookies may be retained for up to 24 months for fraud prevention and
              system integrity.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">9. Changes to This Cookie Policy</h2>
            <p>
              We may update this Cookie Policy from time to time. Updates will be posted on this page with a
              revised effective date.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">10. Contact Information</h2>
            <p>CIVRA LTD</p>
            <p>71-75 Shelton Street</p>
            <p>Covent Garden</p>
            <p>London WC2H 9JQ</p>
            <p>United Kingdom</p>
            <p>
              Email: <a href="mailto:support@forecoding.com" className="underline">support@forecoding.com</a>
            </p>
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
