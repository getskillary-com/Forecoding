import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | Forecoding",
  description: "Forecoding Privacy Policy"
};

const PRIVACY_POLICY_TEXT = `Privacy Policy

Effective Date: February 26, 2026
Legal Entity: CIVRA LTD
Registered Address: 71-75 Shelton Street, Covent Garden, London, England, WC2H 9JQ, United Kingdom
Contact Email: support@forecoding.com

This Privacy Policy explains how CIVRA LTD ("Company," "we," "us," or "our") collects, uses, discloses, and safeguards Personal Information in connection with the Forecoding AI SaaS platform ("Service").

This Policy is designed to comply with:

United States law (including California Consumer Privacy Act (CCPA/CPRA))

EU General Data Protection Regulation (GDPR)

UK GDPR and the UK Data Protection Act 2018

1. Scope

This Privacy Policy applies to all users worldwide who access or use the Forecoding website and services.

2. Data Controller

CIVRA LTD acts as the Data Controller for Personal Information processed through the Service.

The following providers act as Data Processors:

Stripe (payment processing)

Google Cloud / Firebase (cloud hosting and database services)

Google Gemini API (AI model processing)

Email service providers (verification and notification delivery)

3. Categories of Data Collected
A. Account Information

Email address

Authentication/verification data

B. Transaction Information

Stripe transaction ID

Payment confirmation details

C. User Content

Product ideas

PRDs

Architecture diagrams

Development task lists

Code suggestions

D. Technical Information

IP address

Device and browser metadata

Usage logs

Cookies and similar technologies

4. Legal Basis for Processing (EEA/UK Users)

For users located in the European Economic Area (EEA) or United Kingdom, we process Personal Information under the following lawful bases (Article 6 GDPR):

Performance of a contract (Art. 6(1)(b))

Legitimate interests (Art. 6(1)(f))

Compliance with legal obligations (Art. 6(1)(c))

Consent (Art. 6(1)(a)) for non-essential cookies

5. Purpose of Processing

We process Personal Information to:

Provide AI-powered project generation services

Authenticate user accounts

Process payments

Detect and prevent fraud or abuse

Improve system performance and reliability

Comply with legal obligations

6. International Data Transfers

Personal Information may be transferred to and processed in the United States or other jurisdictions outside the UK/EEA.

Where required, transfers are safeguarded by:

Standard Contractual Clauses (SCCs)

UK Addendum to SCCs

Applicable adequacy decisions

7. Data Retention

Account data: retained until account deletion or as required by law

Financial and transaction records: retained for at least seven (7) years

AI-generated and user-submitted content: retained for operational necessity and system integrity

8. Data Subject Rights (EEA/UK)

EEA and UK users may exercise the following rights:

Right of access

Right to rectification

Right to erasure

Right to restriction

Right to data portability

Right to object

Right to lodge a complaint with a supervisory authority

Requests will be processed within 30 days.
Submit requests to: support@forecoding.com

UK supervisory authority:
Information Commissioner's Office (ICO)

9. California Privacy Rights

California residents may request:

Disclosure of categories of personal information collected

Deletion of personal information

Information about data sharing practices

We do not sell personal information.

10. Security Measures

We implement commercially reasonable safeguards including:

HTTPS encryption

Role-based access controls

Secure cloud infrastructure

However, no system is completely secure.

11. Children's Privacy

The Service is not intended for individuals under 13 years of age.

12. Updates

We may update this Privacy Policy periodically. The revised effective date will be posted on this page.`;

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="mx-auto max-w-4xl px-6 py-12 space-y-6">
        <h1 className="text-3xl font-bold">Privacy Policy</h1>
        <article className="whitespace-pre-line text-sm leading-7 text-gray-700 dark:text-gray-300">
          {PRIVACY_POLICY_TEXT}
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
