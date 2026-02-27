type StripeLineItemInput = {
    priceId?: string;
    productName: string;
    unitAmountCents: number;
    currency: string;
    quantity?: number;
};

type StripeCheckoutSessionInput = {
    secretKey: string;
    successUrl: string;
    cancelUrl: string;
    lineItem: StripeLineItemInput;
    customerEmail?: string;
    clientReferenceId?: string;
    metadata?: Record<string, string>;
};

type StripeCheckoutSessionResponse = {
    id?: string;
    url?: string;
    error?: {
        message?: string;
    };
};

export function getStripeSecretKey() {
    return (process.env.STRIPE_SECRET_KEY || "").trim();
}

export function getStripeWebhookSecret() {
    return (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
}

export function getStripePriceId() {
    return "";
}

export function getStripeCurrency() {
    return ((process.env.STRIPE_CURRENCY || "usd").trim() || "usd").toLowerCase();
}

export function getStripeUnitAmountCents() {
    const value = Number(process.env.STRIPE_UNIT_AMOUNT_CENTS || "799");
    if (!Number.isFinite(value)) return 799;
    return Math.max(1, Math.round(value));
}

export function getStripeMaxUnitAmountCents() {
    const base = getStripeUnitAmountCents();
    const configured = Number(process.env.STRIPE_MAX_UNIT_AMOUNT_CENTS || "1499");
    if (!Number.isFinite(configured)) return Math.max(base, 1499);
    return Math.max(base, Math.round(configured));
}

export function isStripeDynamicPricingEnabled() {
    const raw = (process.env.STRIPE_DYNAMIC_PRICING_ENABLED || "1").trim().toLowerCase();
    return !["0", "false", "off", "no"].includes(raw);
}

export async function createStripeCheckoutSession(
    input: StripeCheckoutSessionInput
): Promise<StripeCheckoutSessionResponse> {
    const lineItemQuantity = Math.max(1, input.lineItem.quantity ?? 1);
    const body = new URLSearchParams();
    body.set("mode", "payment");
    body.set("locale", "en");
    body.set("success_url", input.successUrl);
    body.set("cancel_url", input.cancelUrl);
    body.set("line_items[0][quantity]", String(lineItemQuantity));

    if (input.lineItem.priceId) {
        body.set("line_items[0][price]", input.lineItem.priceId);
    } else {
        body.set("line_items[0][price_data][currency]", input.lineItem.currency);
        body.set("line_items[0][price_data][unit_amount]", String(input.lineItem.unitAmountCents));
        body.set("line_items[0][price_data][product_data][name]", input.lineItem.productName);
    }

    if (input.customerEmail) {
        body.set("customer_email", input.customerEmail);
    }

    if (input.clientReferenceId) {
        body.set("client_reference_id", input.clientReferenceId);
    }

    if (input.metadata) {
        Object.entries(input.metadata).forEach(([key, value]) => {
            body.set(`metadata[${key}]`, value);
        });
    }

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${input.secretKey}`,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: body.toString()
    });

    const data = (await response.json()) as StripeCheckoutSessionResponse;
    if (!response.ok) {
        const message = data?.error?.message || "Stripe checkout session creation failed.";
        throw new Error(message);
    }

    return data;
}
