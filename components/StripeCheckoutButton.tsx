"use client";

import { useState } from "react";
import { Loader2, CreditCard } from "lucide-react";
import { useRouter } from "next/navigation";
import { useNavigationFeedback } from "@/components/NavigationFeedback";

type StripeCheckoutButtonProps = {
    className?: string;
    label?: string;
    projectId?: string;
    projectName?: string;
};

type CheckoutResponse = {
    checkoutUrl?: string;
    error?: string;
};

export function StripeCheckoutButton({
    className = "",
    label = "Buy 1 Project Credit",
    projectId = "project-credit",
    projectName = "Project Credit"
}: StripeCheckoutButtonProps) {
    const router = useRouter();
    const { beginNavigation } = useNavigationFeedback();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleCheckout = async () => {
        if (loading) return;
        setLoading(true);
        setError(null);

        try {
            const res = await fetch("/api/payments/stripe/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    projectId,
                    projectName
                })
            });

            if (res.status === 401) {
                beginNavigation("/login");
                router.push("/login");
                return;
            }

            const data = (await res.json()) as CheckoutResponse;
            if (!res.ok || !data.checkoutUrl) {
                throw new Error(data.error || "Unable to start Stripe checkout.");
            }

            window.location.assign(data.checkoutUrl);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Checkout failed.";
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col items-center gap-2">
            <button
                type="button"
                onClick={handleCheckout}
                disabled={loading}
                className={className}
            >
                {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                    <CreditCard className="w-5 h-5" />
                )}
                {label}
            </button>
            {error ? <p className="text-xs text-red-500">{error}</p> : null}
        </div>
    );
}
