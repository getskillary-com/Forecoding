"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef
} from "react";

type NavigationFeedbackContextValue = {
    beginNavigation: (href?: string) => void;
};

const DEFAULT_TITLE = "Forecoding";
const TITLE_SUFFIX = " | Forecoding";
const FALLBACK_LOADING_TITLE = `Loading...${TITLE_SUFFIX}`;
const LOADING_RESET_MS = 8_000;

const NavigationFeedbackContext = createContext<NavigationFeedbackContextValue>({
    beginNavigation: () => {}
});

function toInternalUrl(href?: string): URL | null {
    if (typeof window === "undefined" || !href) return null;

    try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return null;
        return url;
    } catch {
        return null;
    }
}

function resolveStableDocumentTitle(pathname: string) {
    switch (pathname) {
        case "/":
            return `AI Product Blueprint Studio${TITLE_SUFFIX}`;
        case "/dashboard":
            return `Dashboard${TITLE_SUFFIX}`;
        case "/wizard":
            return `Workspace Wizard${TITLE_SUFFIX}`;
        case "/account":
            return `Account${TITLE_SUFFIX}`;
        case "/admin":
            return `Admin Console${TITLE_SUFFIX}`;
        case "/login":
            return `Sign In${TITLE_SUFFIX}`;
        case "/register":
            return `Create Account${TITLE_SUFFIX}`;
        case "/demo":
            return `Demo Workspace${TITLE_SUFFIX}`;
        case "/privacy":
            return `Privacy Policy${TITLE_SUFFIX}`;
        case "/terms":
            return `Terms of Service${TITLE_SUFFIX}`;
        case "/refund":
            return `Refund Policy${TITLE_SUFFIX}`;
        case "/cookie":
            return `Cookie Policy${TITLE_SUFFIX}`;
        default:
            return DEFAULT_TITLE;
    }
}

function resolveLoadingDocumentTitle(href?: string) {
    const pathname = toInternalUrl(href)?.pathname;

    switch (pathname) {
        case "/dashboard":
            return `Loading Dashboard...${TITLE_SUFFIX}`;
        case "/wizard":
            return `Loading Workspace...${TITLE_SUFFIX}`;
        case "/account":
            return `Loading Account...${TITLE_SUFFIX}`;
        case "/admin":
            return `Loading Admin Console...${TITLE_SUFFIX}`;
        case "/login":
        case "/register":
            return `Loading Authentication...${TITLE_SUFFIX}`;
        case "/demo":
            return `Loading Demo Workspace...${TITLE_SUFFIX}`;
        default:
            return FALLBACK_LOADING_TITLE;
    }
}

function applyStableDocumentTitle() {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    document.title = resolveStableDocumentTitle(window.location.pathname);
}

export function NavigationFeedbackProvider({ children }: { children: React.ReactNode }) {
    const resetTimerRef = useRef<number | null>(null);
    const activeLoadingTitleRef = useRef<string | null>(null);

    const clearPendingReset = useCallback(() => {
        if (resetTimerRef.current !== null) {
            window.clearTimeout(resetTimerRef.current);
            resetTimerRef.current = null;
        }
    }, []);

    const beginNavigation = useCallback((href?: string) => {
        if (typeof document === "undefined" || typeof window === "undefined") return;

        const nextUrl = toInternalUrl(href);
        if (nextUrl) {
            const currentRoute = `${window.location.pathname}${window.location.search}`;
            const nextRoute = `${nextUrl.pathname}${nextUrl.search}`;
            if (currentRoute === nextRoute) return;
        }

        clearPendingReset();
        const loadingTitle = resolveLoadingDocumentTitle(href);
        activeLoadingTitleRef.current = loadingTitle;
        document.title = loadingTitle;

        resetTimerRef.current = window.setTimeout(() => {
            if (activeLoadingTitleRef.current !== loadingTitle) return;
            activeLoadingTitleRef.current = null;
            applyStableDocumentTitle();
            resetTimerRef.current = null;
        }, LOADING_RESET_MS);
    }, [clearPendingReset]);

    useEffect(() => {
        if (typeof document === "undefined" || typeof window === "undefined") return;

        const syncTitleAfterNavigation = () => {
            clearPendingReset();
            activeLoadingTitleRef.current = null;
            applyStableDocumentTitle();
        };

        const originalPushState = window.history.pushState.bind(window.history);
        const originalReplaceState = window.history.replaceState.bind(window.history);

        window.history.pushState = function pushState(...args) {
            const result = originalPushState(...args);
            window.setTimeout(syncTitleAfterNavigation, 0);
            return result;
        };

        window.history.replaceState = function replaceState(...args) {
            const result = originalReplaceState(...args);
            window.setTimeout(syncTitleAfterNavigation, 0);
            return result;
        };

        syncTitleAfterNavigation();
        window.addEventListener("popstate", syncTitleAfterNavigation);

        return () => {
            window.history.pushState = originalPushState;
            window.history.replaceState = originalReplaceState;
            window.removeEventListener("popstate", syncTitleAfterNavigation);
            clearPendingReset();
            activeLoadingTitleRef.current = null;
        };
    }, [clearPendingReset]);

    useEffect(() => {
        if (typeof document === "undefined") return;

        const handleClick = (event: MouseEvent) => {
            if (event.defaultPrevented || event.button !== 0) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

            const target = event.target as Element | null;
            const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
            if (!anchor) return;
            if (anchor.target && anchor.target !== "_self") return;
            if (anchor.hasAttribute("download")) return;

            const nextUrl = toInternalUrl(anchor.href);
            if (!nextUrl) return;

            const currentRoute = `${window.location.pathname}${window.location.search}`;
            const nextRoute = `${nextUrl.pathname}${nextUrl.search}`;
            if (currentRoute === nextRoute) return;

            beginNavigation(anchor.href);
        };

        document.addEventListener("click", handleClick, true);
        return () => {
            document.removeEventListener("click", handleClick, true);
        };
    }, [beginNavigation]);

    const value = useMemo<NavigationFeedbackContextValue>(() => ({
        beginNavigation
    }), [beginNavigation]);

    return (
        <NavigationFeedbackContext.Provider value={value}>
            {children}
        </NavigationFeedbackContext.Provider>
    );
}

export function useNavigationFeedback() {
    return useContext(NavigationFeedbackContext);
}
