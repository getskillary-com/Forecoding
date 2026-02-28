export type DataBackendMode = "dual" | "firebase_primary" | "firebase_only";

const MODES = new Set<DataBackendMode>(["dual", "firebase_primary", "firebase_only"]);

export function getDataBackendMode(): DataBackendMode {
    const raw = (process.env.DATA_BACKEND_MODE || "firebase_only")
        .trim()
        .toLowerCase() as DataBackendMode;
    return MODES.has(raw) ? raw : "firebase_only";
}

export function isFirebaseModeEnabled() {
    const mode = getDataBackendMode();
    return mode === "dual" || mode === "firebase_primary" || mode === "firebase_only";
}
