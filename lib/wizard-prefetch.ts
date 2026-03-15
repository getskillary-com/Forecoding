let wizardWarmPromise: Promise<void> | null = null;
let warmupHandle: number | null = null;

type IdleCallbackHandle = number;
type IdleCallbackDeadline = {
    didTimeout: boolean;
    timeRemaining: () => number;
};

type WindowWithIdleCallback = Window & {
    requestIdleCallback?: (
        callback: (deadline: IdleCallbackDeadline) => void,
        options?: { timeout: number }
    ) => IdleCallbackHandle;
    cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
};

function getWindowWithIdleCallback(): WindowWithIdleCallback | null {
    if (typeof window === "undefined") return null;
    return window as WindowWithIdleCallback;
}

export function warmWizardModules() {
    if (typeof window === "undefined") {
        return Promise.resolve();
    }

    if (wizardWarmPromise) return wizardWarmPromise;

    wizardWarmPromise = Promise.all([
        import("@/components/ArchitectureViewer"),
        import("@/components/FileTreeDisplay"),
        import("mermaid")
    ]).then(() => undefined).catch(() => undefined);

    return wizardWarmPromise;
}

export function scheduleWizardWarmup() {
    const browserWindow = getWindowWithIdleCallback();
    if (!browserWindow || warmupHandle !== null || wizardWarmPromise) return;

    const runWarmup = () => {
        warmupHandle = null;
        void warmWizardModules();
    };

    if (browserWindow.requestIdleCallback) {
        warmupHandle = browserWindow.requestIdleCallback(
            () => runWarmup(),
            { timeout: 1200 }
        );
        return;
    }

    warmupHandle = window.setTimeout(runWarmup, 180);
}
