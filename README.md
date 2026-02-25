This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## AI Provider (Optional)

```env
# default: gemini
AI_PROVIDER=claude
CLAUDE_API_KEY=your_anthropic_api_key
CLAUDE_MODEL=claude-opus-4-6
# optional
CLAUDE_API_BASE_URL=https://api.anthropic.com
CLAUDE_API_VERSION=2023-06-01
CLAUDE_MAX_TOKENS=8192
```

## Stripe Checkout

Add Stripe env vars:

```env
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Optional. If set, Checkout uses your existing Stripe Price.
STRIPE_PRICE_ID=price_xxx

# Used only when STRIPE_PRICE_ID is not set.
STRIPE_UNIT_AMOUNT_CENTS=990
STRIPE_CURRENCY=usd
```

Implemented routes:

- `POST /api/payments/stripe/checkout` creates a Stripe Checkout Session and returns `checkoutUrl`.
- `POST /api/webhooks/stripe` verifies `stripe-signature` and handles `checkout.session.completed`.

Local webhook forwarding:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

## Local Secret Tool (Clickable)

You can launch the local Firebase App Hosting secrets helper by double-clicking:

- `Launch-AppHosting-Secrets.cmd`

What it does:

- Prompts in visible input mode (you can see what you type).
- Chinese UI (Chinese prompts and messages).
- Add / update / delete / view Firebase App Hosting secrets.
- Supports batch paste input with multi-line `KEY=VALUE` and `END` to finish.
- Supports `/env` (use local `.env` value) and `/gen` (generate random secret).
- Optional sync back to local `.env`.
- Delete action uses `gcloud secrets delete`.

CLI equivalent:

```bash
npm run secrets:apphosting
```

### Database Migration

Apply migrations before running the app:

```bash
npx prisma migrate deploy
npx prisma generate
```
