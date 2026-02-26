import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Cookie Policy | Forecoding",
  description: "Forecoding Cookie Policy"
};

const COOKIE_POLICY_TEXT = `Cookie Policy

Effective Date: February 26, 2026
Last Updated: February 26, 2026

Company: CIVRA LTD
Registered Address: 71-75 Shelton Street, Covent Garden, London, England, WC2H 9JQ, United Kingdom
ICO Registration Number: ZB949556
Contact: support@forecoding.com

1. Introduction

This Cookie Policy explains how CIVRA LTD ("we," "us," or "our") uses cookies and similar technologies when you access or use Forecoding (the "Service").

This Policy should be read together with our Privacy Policy.

2. What Are Cookies?

Cookies are small text files placed on your device when you visit a website. They help websites function efficiently and provide reporting information.

Cookies may be:

Session cookies (expire when you close your browser)

Persistent cookies (remain for a set period)

3. Categories of Cookies We Use
3.1 Essential Cookies

These cookies are strictly necessary for the operation of the Service.

They enable:

User authentication

Account login

Security protection

Session management

Legal basis (EU/UK): Legitimate interest / contract performance.
Consent is not required for essential cookies.

3.2 Functional Cookies

These cookies allow us to remember your preferences and improve your experience.

They may include:

Language preferences

Interface settings

Session continuity

Legal basis (EU/UK): Consent where required.

4. Cookies We Do Not Use

We do not use:

Advertising cookies

Cross-site behavioral tracking cookies

Third-party ad network cookies

We do not sell personal data for advertising purposes.

5. Third-Party Cookies

Certain service providers (such as hosting providers or security infrastructure providers) may set cookies necessary for secure platform operation.

Where third-party cookies involve personal data processing, appropriate safeguards such as Standard Contractual Clauses (SCCs) apply where required.

6. Legal Basis for Cookie Use (EU & UK Users)

For users located in the European Economic Area or United Kingdom:

Essential cookies are deployed based on legitimate interest and contract necessity.

Non-essential cookies are deployed only after user consent where required by law.

You may withdraw consent at any time.

7. Managing Cookies

You can manage cookies in several ways:

Browser Settings

Most browsers allow you to:

Block cookies

Delete existing cookies

Configure alerts for new cookies

Please note that disabling essential cookies may affect service functionality.

Consent Mechanism

Where required by law, we provide a cookie consent mechanism allowing you to:

Accept non-essential cookies

Reject non-essential cookies

You may adjust preferences at any time.

8. Data Retention

Cookies are retained:

Session cookies: until browser close

Persistent cookies: up to 12 months unless deleted earlier

Security logs associated with cookies may be retained for up to 24 months for fraud prevention and system integrity.

9. Changes to This Cookie Policy

We may update this Cookie Policy from time to time. Updates will be posted on this page with a revised effective date.

10. Contact Information

CIVRA LTD
71-75 Shelton Street
Covent Garden
London WC2H 9JQ
United Kingdom

Email: support@forecoding.com`;

export default function CookiePage() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="mx-auto max-w-4xl px-6 py-12 space-y-6">
        <h1 className="text-3xl font-bold">Cookie Policy</h1>
        <article className="whitespace-pre-line text-sm leading-7 text-gray-700 dark:text-gray-300">
          {COOKIE_POLICY_TEXT}
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
