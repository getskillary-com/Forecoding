
"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Lock, Plus, Sparkles, Trash2 } from "lucide-react";
import type { DesignStage, UiDesignState, UiDesignSpec, UiRequirements } from "@/types";
import { buildMinimalUiDesignSpec, validateUiDesignSpec } from "@/lib/ui-spec";

export type UiWireframeScreen = {
    name: string;
    modules: string[];
    states: string[];
    interactions: string[];
};

type UiViewMode = "wireframe" | "render" | "visual";
type UiWorkbenchMode = "spec" | UiViewMode;

type UiTheme = {
    accent: string;
    accentSoft: string;
    surface: string;
    surfaceAlt: string;
    text: string;
    muted: string;
    border: string;
    gradient: string;
};

const COLOR_KEYS = ["primary", "secondary", "background", "surface", "text"];
const STATE_KEYS = ["loading", "empty", "error", "success"] as const;

function resolveUiTheme(ui: UiRequirements, spec?: UiDesignSpec | null): UiTheme {
    const descriptor = `${ui.colorSystem.join(" ")} ${ui.visualStyle.join(" ")}`.toLowerCase();

    if (descriptor.includes("neon") || descriptor.includes("cyber") || descriptor.includes("vibrant")) {
        return {
            accent: "#22d3ee",
            accentSoft: "#0ea5e9",
            surface: "rgba(15, 23, 42, 0.92)",
            surfaceAlt: "rgba(30, 41, 59, 0.86)",
            text: "#e2e8f0",
            muted: "#94a3b8",
            border: "rgba(34, 211, 238, 0.35)",
            gradient: "linear-gradient(135deg, rgba(14, 165, 233, 0.35), rgba(34, 211, 238, 0.12))"
        };
    }

    if (descriptor.includes("pastel") || descriptor.includes("soft")) {
        return {
            accent: "#f97316",
            accentSoft: "#fb7185",
            surface: "rgba(255, 255, 255, 0.92)",
            surfaceAlt: "rgba(248, 250, 252, 0.92)",
            text: "#0f172a",
            muted: "#64748b",
            border: "rgba(251, 113, 133, 0.35)",
            gradient: "linear-gradient(135deg, rgba(251, 113, 133, 0.22), rgba(253, 186, 116, 0.22))"
        };
    }

    if (descriptor.includes("mono") || descriptor.includes("minimal") || descriptor.includes("black")) {
        return {
            accent: "#0ea5e9",
            accentSoft: "#38bdf8",
            surface: "rgba(15, 23, 42, 0.92)",
            surfaceAlt: "rgba(30, 41, 59, 0.9)",
            text: "#e2e8f0",
            muted: "#94a3b8",
            border: "rgba(148, 163, 184, 0.35)",
            gradient: "linear-gradient(135deg, rgba(15, 23, 42, 0.8), rgba(2, 6, 23, 0.85))"
        };
    }

    if (descriptor.includes("warm") || descriptor.includes("earth")) {
        return {
            accent: "#f59e0b",
            accentSoft: "#f97316",
            surface: "rgba(20, 24, 32, 0.9)",
            surfaceAlt: "rgba(31, 41, 55, 0.85)",
            text: "#f8fafc",
            muted: "#a3b1c6",
            border: "rgba(245, 158, 11, 0.3)",
            gradient: "linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(251, 146, 60, 0.18))"
        };
    }

    const fallbackTheme: UiTheme = {
        accent: "#3b82f6",
        accentSoft: "#22c55e",
        surface: "rgba(15, 23, 42, 0.92)",
        surfaceAlt: "rgba(30, 41, 59, 0.86)",
        text: "#e2e8f0",
        muted: "#94a3b8",
        border: "rgba(59, 130, 246, 0.35)",
        gradient: "linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(34, 197, 94, 0.12))"
    };
    const tokens = spec?.tokens?.colors || {};
    if (!spec || Object.keys(tokens).length === 0) return fallbackTheme;
    return {
        accent: tokens.primary || fallbackTheme.accent,
        accentSoft: tokens.secondary || fallbackTheme.accentSoft,
        surface: tokens.surface || fallbackTheme.surface,
        surfaceAlt: tokens.background || fallbackTheme.surfaceAlt,
        text: tokens.text || fallbackTheme.text,
        muted: fallbackTheme.muted,
        border: tokens.primary ? `${tokens.primary}55` : fallbackTheme.border,
        gradient: `linear-gradient(135deg, ${tokens.primary || "#3b82f6"}33, ${tokens.secondary || "#22c55e"}22)`
    };
}

function normalizeCsvInput(value: string) {
    return value
        .split(/[,\n]+/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function slugify(value: string) {
    return (value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
}

export function UiDesignWorkbench({
    designStage,
    uiDesignState,
    uiDesignSpec,
    uiRequirements,
    wireframes,
    activeScreenIndex,
    focusLabel,
    densityScore,
    onSelectScreen,
    onSpecChange
}: {
    designStage: DesignStage;
    uiDesignState: UiDesignState;
    uiDesignSpec: UiDesignSpec | null;
    uiRequirements: UiRequirements;
    wireframes: UiWireframeScreen[];
    activeScreenIndex: number | null;
    focusLabel: string | null;
    densityScore: number;
    onSelectScreen: (index: number) => void;
    onSpecChange: (spec: UiDesignSpec | null) => void;
}) {
    const uiDesignActive = designStage !== "functional_architecture";
    const [mode, setMode] = useState<UiWorkbenchMode>("render");
    const screenRefs = useRef<(HTMLElement | null)[]>([]);
    const uiSpecErrors = validateUiDesignSpec(uiDesignSpec);
    const missingLabels = uiDesignState.readiness.missingLabels || [];
    const theme = resolveUiTheme(uiRequirements, uiDesignSpec);

    useEffect(() => {
        if (activeScreenIndex === null) return;
        const target = screenRefs.current[activeScreenIndex];
        if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }, [activeScreenIndex, wireframes.length]);

    const handleInitSpec = () => {
        const nextSpec = buildMinimalUiDesignSpec(uiRequirements);
        onSpecChange(nextSpec);
    };

    const updateSpec = (nextSpec: UiDesignSpec) => {
        onSpecChange(nextSpec);
    };

    const updateToken = (key: string, value: string) => {
        if (!uiDesignSpec) return;
        updateSpec({
            ...uiDesignSpec,
            tokens: {
                ...uiDesignSpec.tokens,
                colors: {
                    ...uiDesignSpec.tokens.colors,
                    [key]: value
                }
            }
        });
    };

    const updateScreen = (index: number, patch: Partial<UiDesignSpec["screens"][number]>) => {
        if (!uiDesignSpec) return;
        const next = [...uiDesignSpec.screens];
        next[index] = { ...next[index], ...patch };
        updateSpec({ ...uiDesignSpec, screens: next });
    };

    const updateScreenState = (index: number, key: typeof STATE_KEYS[number], value: string) => {
        if (!uiDesignSpec) return;
        const next = [...uiDesignSpec.screens];
        next[index] = {
            ...next[index],
            states: {
                ...next[index].states,
                [key]: value
            }
        };
        updateSpec({ ...uiDesignSpec, screens: next });
    };

    const handleAddScreen = () => {
        if (!uiDesignSpec) return;
        const index = uiDesignSpec.screens.length + 1;
        const name = `Screen ${index}`;
        const id = slugify(name) || `screen-${index}`;
        const components = uiDesignSpec.components.map((component) => component.id);
        updateSpec({
            ...uiDesignSpec,
            screens: [
                ...uiDesignSpec.screens,
                {
                    id,
                    name,
                    route: index === 1 ? "/" : `/${id}`,
                    layout: { type: "stack", sections: ["header", "content", "footer"] },
                    components: components.length > 0 ? components : ["primary-button"],
                    states: {
                        loading: "Loading state",
                        empty: "Empty state",
                        error: "Error state",
                        success: "Success state"
                    },
                    interactions: ["Primary CTA"]
                }
            ]
        });
    };

    const handleAddComponent = () => {
        if (!uiDesignSpec) return;
        const index = uiDesignSpec.components.length + 1;
        const name = `Component ${index}`;
        const id = slugify(name) || `component-${index}`;
        updateSpec({
            ...uiDesignSpec,
            components: [
                ...uiDesignSpec.components,
                {
                    id,
                    name,
                    type: "generic",
                    variants: [],
                    props: {},
                    states: []
                }
            ]
        });
    };

    const renderSpecEditor = () => {
        if (!uiDesignSpec) {
            return (
                <div className="rounded-2xl border border-dashed border-[color:var(--border)] bg-slate-50/60 p-6 text-center text-slate-500 dark:bg-slate-900/40 dark:text-slate-300">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">UI spec is not initialized.</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Create a minimal spec to begin editing structured UI data.</p>
                    <button
                        type="button"
                        onClick={handleInitSpec}
                        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                        <Plus className="h-4 w-4" />
                        Initialize UI Spec
                    </button>
                </div>
            );
        }

        return (
            <div className="space-y-6">
                {uiSpecErrors.length > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
                        <div className="flex items-center gap-2 font-semibold">
                            <AlertTriangle className="h-4 w-4" />
                            Spec validation issues
                        </div>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                            {uiSpecErrors.slice(0, 6).map((error) => (
                                <li key={error}>{error}</li>
                            ))}
                        </ul>
                    </div>
                )}

                <section className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60">
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Design Tokens</h4>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Colors</p>
                            {COLOR_KEYS.map((key) => (
                                <div key={key} className="flex items-center gap-2">
                                    <span className="w-24 text-xs text-slate-500 dark:text-slate-400">{key}</span>
                                    <input
                                        value={uiDesignSpec.tokens.colors[key] || ""}
                                        onChange={(event) => updateToken(key, event.target.value)}
                                        className="flex-1 rounded-md border border-[color:var(--border)] bg-white/80 px-2 py-1 text-xs text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-900/60 dark:text-slate-200"
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Typography</p>
                            <label className="text-xs text-slate-500 dark:text-slate-400">Font families</label>
                            <input
                                value={(uiDesignSpec.tokens.typography.fontFamilies || []).join(", ")}
                                onChange={(event) => {
                                    updateSpec({
                                        ...uiDesignSpec,
                                        tokens: {
                                            ...uiDesignSpec.tokens,
                                            typography: {
                                                ...uiDesignSpec.tokens.typography,
                                                fontFamilies: normalizeCsvInput(event.target.value)
                                            }
                                        }
                                    });
                                }}
                                className="w-full rounded-md border border-[color:var(--border)] bg-white/80 px-2 py-1 text-xs text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-900/60 dark:text-slate-200"
                            />
                            <label className="text-xs text-slate-500 dark:text-slate-400">Base size (md)</label>
                            <input
                                value={uiDesignSpec.tokens.typography.scale?.md || ""}
                                onChange={(event) => {
                                    updateSpec({
                                        ...uiDesignSpec,
                                        tokens: {
                                            ...uiDesignSpec.tokens,
                                            typography: {
                                                ...uiDesignSpec.tokens.typography,
                                                scale: {
                                                    ...uiDesignSpec.tokens.typography.scale,
                                                    md: event.target.value
                                                }
                                            }
                                        }
                                    });
                                }}
                                className="w-full rounded-md border border-[color:var(--border)] bg-white/80 px-2 py-1 text-xs text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-900/60 dark:text-slate-200"
                            />
                        </div>
                    </div>
                </section>

                <section className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60">
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Screens</h4>
                    <div className="mt-4 space-y-4">
                        {uiDesignSpec.screens.map((screen, index) => (
                            <div key={screen.id} className="rounded-xl border border-[color:var(--border)] bg-white/60 p-3 dark:bg-slate-900/50">
                                <div className="flex items-center justify-between">
                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                                        Screen {index + 1}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            updateSpec({
                                                ...uiDesignSpec,
                                                screens: uiDesignSpec.screens.filter((_, idx) => idx !== index)
                                            });
                                        }}
                                        className="rounded-md border border-transparent p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                                <div className="mt-2 grid gap-2 md:grid-cols-2">
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Name</label>
                                    <input
                                        value={screen.name}
                                        onChange={(event) => updateScreen(index, { name: event.target.value })}
                                        className="rounded-md border border-[color:var(--border)] bg-white/80 px-2 py-1 text-xs text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-900/60 dark:text-slate-200"
                                    />
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Route</label>
                                    <input
                                        value={screen.route}
                                        onChange={(event) => updateScreen(index, { route: event.target.value })}
                                        className="rounded-md border border-[color:var(--border)] bg-white/80 px-2 py-1 text-xs text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-900/60 dark:text-slate-200"
                                    />
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Components</label>
                                    <input
                                        value={screen.components.join(", ")}
                                        onChange={(event) => updateScreen(index, { components: normalizeCsvInput(event.target.value) })}
                                        className="rounded-md border border-[color:var(--border)] bg-white/80 px-2 py-1 text-xs text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-900/60 dark:text-slate-200"
                                    />
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Interactions</label>
                                    <input
                                        value={screen.interactions.join(", ")}
                                        onChange={(event) => updateScreen(index, { interactions: normalizeCsvInput(event.target.value) })}
                                        className="rounded-md border border-[color:var(--border)] bg-white/80 px-2 py-1 text-xs text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-900/60 dark:text-slate-200"
                                    />
                                </div>
                                <div className="mt-3 grid gap-2 md:grid-cols-2">
                                    {STATE_KEYS.map((key) => (
                                        <div key={key} className="flex items-center gap-2">
                                            <span className="w-20 text-xs text-slate-500 dark:text-slate-400">{key}</span>
                                            <input
                                                value={screen.states[key]}
                                                onChange={(event) => updateScreenState(index, key, event.target.value)}
                                                className="flex-1 rounded-md border border-[color:var(--border)] bg-white/80 px-2 py-1 text-xs text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-900/60 dark:text-slate-200"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={handleAddScreen}
                            className="inline-flex items-center gap-2 rounded-md border border-[color:var(--border)] px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Add Screen
                        </button>
                    </div>
                </section>

                <section className="rounded-2xl border border-[color:var(--border)] bg-white/70 p-4 dark:bg-slate-900/60">
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Components</h4>
                    <div className="mt-4 space-y-4">
                        {uiDesignSpec.components.map((component, index) => (
                            <div key={component.id} className="rounded-xl border border-[color:var(--border)] bg-white/60 p-3 dark:bg-slate-900/50">
                                <div className="flex items-center justify-between">
                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                                        Component {index + 1}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            updateSpec({
                                                ...uiDesignSpec,
                                                components: uiDesignSpec.components.filter((_, idx) => idx !== index)
                                            });
                                        }}
                                        className="rounded-md border border-transparent p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                                <div className="mt-2 grid gap-2 md:grid-cols-2">
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Name</label>
                                    <input
                                        value={component.name}
                                        onChange={(event) => {
                                            const next = [...uiDesignSpec.components];
                                            next[index] = { ...component, name: event.target.value };
                                            updateSpec({ ...uiDesignSpec, components: next });
                                        }}
                                        className="rounded-md border border-[color:var(--border)] bg-white/80 px-2 py-1 text-xs text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-900/60 dark:text-slate-200"
                                    />
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Type</label>
                                    <input
                                        value={component.type}
                                        onChange={(event) => {
                                            const next = [...uiDesignSpec.components];
                                            next[index] = { ...component, type: event.target.value };
                                            updateSpec({ ...uiDesignSpec, components: next });
                                        }}
                                        className="rounded-md border border-[color:var(--border)] bg-white/80 px-2 py-1 text-xs text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-900/60 dark:text-slate-200"
                                    />
                                    <label className="text-xs text-slate-500 dark:text-slate-400">Variants</label>
                                    <input
                                        value={component.variants.join(", ")}
                                        onChange={(event) => {
                                            const next = [...uiDesignSpec.components];
                                            next[index] = { ...component, variants: normalizeCsvInput(event.target.value) };
                                            updateSpec({ ...uiDesignSpec, components: next });
                                        }}
                                        className="rounded-md border border-[color:var(--border)] bg-white/80 px-2 py-1 text-xs text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-slate-900/60 dark:text-slate-200"
                                    />
                                </div>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={handleAddComponent}
                            className="inline-flex items-center gap-2 rounded-md border border-[color:var(--border)] px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Add Component
                        </button>
                    </div>
                </section>
            </div>
        );
    };
    const renderPreview = () => {
        const visualStyle = uiRequirements.visualStyle[0] || "Not defined";
        const colorSystem = uiRequirements.colorSystem[0] || "Not defined";
        const typography = uiRequirements.typography[0] || "Not defined";
        const responsive = uiRequirements.responsiveStrategy[0] || "Not defined";
        const isWireframe = mode === "wireframe";
        const isVisual = mode === "visual";
        const isColorMode = mode === "render" || mode === "visual";

        return (
            <>
                <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 dark:border-blue-800/40 dark:bg-blue-900/15">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-600 dark:text-blue-300">Style</p>
                        <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{visualStyle}</p>
                    </div>
                    <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 dark:border-indigo-800/40 dark:bg-indigo-900/15">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-300">Color</p>
                        <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{colorSystem}</p>
                    </div>
                    <div className="rounded-xl border border-purple-100 bg-purple-50 p-3 dark:border-purple-800/40 dark:bg-purple-900/15">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-purple-600 dark:text-purple-300">Typography</p>
                        <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{typography}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 dark:border-emerald-800/40 dark:bg-emerald-900/15">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-300">Responsive</p>
                        <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{responsive}</p>
                    </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    {wireframes.map((screen, index) => {
                        const moduleStack = screen.modules.length > 0
                            ? screen.modules
                            : ["Primary Content", "Highlights", "CTA Module", "Secondary Feed"];
                        const primaryModules = moduleStack.slice(0, 3);
                        const secondaryModules = moduleStack.slice(3, 6);
                        const visualModules = secondaryModules.length > 0 ? secondaryModules : primaryModules;

                        return (
                            <section
                                key={`${screen.name}-${index}`}
                                ref={(el) => {
                                    screenRefs.current[index] = el;
                                }}
                                onClick={() => onSelectScreen(index)}
                                className={`cursor-pointer rounded-2xl border p-4 shadow-sm transition-all ${isColorMode ? "" : "bg-white/80 dark:bg-slate-900/50"} ${activeScreenIndex === index
                                    ? "border-blue-300 ring-2 ring-blue-300/70 dark:border-blue-500/70 dark:ring-blue-500/60"
                                    : "border-[color:var(--border)] hover:border-blue-200 dark:hover:border-blue-500/40"}`}
                                style={isColorMode ? { borderColor: theme.border, background: theme.surfaceAlt } : undefined}
                            >
                                <div className="mb-3 flex items-center justify-between">
                                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100" style={isColorMode ? { color: theme.text } : undefined}>{screen.name}</h4>
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                                        Screen {index + 1}
                                    </span>
                                </div>

                                {isWireframe ? (
                                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800/45">
                                        <div className="mb-2 h-2.5 w-24 rounded bg-slate-300/80 dark:bg-slate-600/80" />
                                        <div className="mb-3 h-7 rounded-md border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900/50" />
                                        <div className="space-y-2">
                                            {moduleStack.map((module, moduleIndex) => (
                                                <div
                                                    key={`${screen.name}-module-${moduleIndex}`}
                                                    className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300"
                                                >
                                                    {module}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : isVisual ? (
                                    <div className="rounded-xl border p-3" style={{ borderColor: theme.border, background: theme.surface }}>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="h-7 w-7 rounded-lg" style={{ background: theme.accent }} />
                                                <div>
                                                    <div className="h-2.5 w-20 rounded" style={{ background: theme.muted }} />
                                                    <div className="mt-1 h-2 w-14 rounded" style={{ background: theme.muted }} />
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="h-6 w-6 rounded-full" style={{ background: theme.accentSoft }} />
                                                <div className="h-6 w-6 rounded-full" style={{ background: theme.muted }} />
                                            </div>
                                        </div>
                                        <div className="mt-3 rounded-lg p-3" style={{ background: theme.gradient }}>
                                            <div className="h-3 w-32 rounded" style={{ background: theme.surfaceAlt }} />
                                            <div className="mt-2 h-2 w-24 rounded" style={{ background: theme.surfaceAlt }} />
                                            <div className="mt-3 flex gap-2">
                                                <span className="rounded-full px-3 py-1 text-[11px] font-semibold" style={{ background: theme.accent, color: "#0b1120" }}>
                                                    Primary
                                                </span>
                                                <span className="rounded-full px-3 py-1 text-[11px] font-semibold" style={{ border: `1px solid ${theme.accent}`, color: theme.accent }}>
                                                    Secondary
                                                </span>
                                            </div>
                                        </div>
                                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                            <div className="rounded-lg border p-2" style={{ borderColor: theme.border, background: theme.surfaceAlt }}>
                                                <div className="mb-2 h-2 w-20 rounded" style={{ background: theme.muted }} />
                                                <div className="space-y-2">
                                                    {primaryModules.map((module, moduleIndex) => (
                                                        <div
                                                            key={`${screen.name}-visual-${moduleIndex}`}
                                                            className="rounded-md px-2 py-1.5 text-[11px] font-medium"
                                                            style={{ background: theme.surface, color: theme.text, border: `1px solid ${theme.border}` }}
                                                        >
                                                            {module}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="rounded-lg border p-2" style={{ borderColor: theme.border, background: theme.surfaceAlt }}>
                                                <div className="mb-2 h-2 w-16 rounded" style={{ background: theme.muted }} />
                                                <div className="grid gap-2">
                                                    {visualModules.map((module, moduleIndex) => (
                                                        <div
                                                            key={`${screen.name}-visual-alt-${moduleIndex}`}
                                                            className="rounded-md px-2 py-1.5 text-[11px] font-medium"
                                                            style={{ background: theme.surface, color: theme.text, border: `1px solid ${theme.border}` }}
                                                        >
                                                            {module}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="rounded-xl border p-3" style={{ borderColor: theme.border, background: theme.gradient }}>
                                        <div className="flex items-center justify-between">
                                            <div className="h-2.5 w-16 rounded-full" style={{ background: theme.accentSoft }} />
                                            <div className="h-2.5 w-10 rounded-full" style={{ background: theme.muted }} />
                                        </div>
                                        <div className="mt-3 rounded-lg p-3" style={{ background: theme.surface }}>
                                            <div className="h-3 w-24 rounded-full" style={{ background: theme.muted }} />
                                            <div className="mt-2 h-8 rounded-lg" style={{ border: `1px solid ${theme.border}`, background: theme.surfaceAlt }} />
                                            <div className="mt-3 grid gap-2">
                                                {moduleStack.map((module, moduleIndex) => (
                                                    <div
                                                        key={`${screen.name}-render-${moduleIndex}`}
                                                        className="rounded-md px-2 py-1.5 text-xs font-medium"
                                                        style={{ background: theme.surfaceAlt, color: theme.text, border: `1px solid ${theme.border}` }}
                                                    >
                                                        {module}
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="mt-3 flex gap-2">
                                                <span className="rounded-full px-3 py-1 text-[11px] font-semibold" style={{ background: theme.accent, color: "#0b1120" }}>
                                                    Primary
                                                </span>
                                                <span className="rounded-full px-3 py-1 text-[11px] font-semibold" style={{ border: `1px solid ${theme.accent}`, color: theme.accent }}>
                                                    Secondary
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="mt-3 space-y-1 text-[11px]" style={isColorMode ? { color: theme.muted } : undefined}>
                                    <p>
                                        <span className="font-semibold" style={isColorMode ? { color: theme.text } : undefined}>States:</span> {screen.states.join(" | ")}
                                    </p>
                                    <p>
                                        <span className="font-semibold" style={isColorMode ? { color: theme.text } : undefined}>Interactions:</span> {screen.interactions.join(" | ")}
                                    </p>
                                </div>
                            </section>
                        );
                    })}
                </div>
            </>
        );
    };

    return (
        <div className="absolute inset-0 overflow-y-auto p-6 custom-scrollbar">
            <div className="mb-5 space-y-2">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                    <Sparkles className="h-5 w-5 text-pink-500" />
                    UI Design Workbench
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                    {uiDesignActive
                        ? "UI design mode is active. Refine screens and interaction states until UI readiness reaches 100%."
                        : "UI design unlocks after requirements readiness reaches 100%."}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Stage: {designStage.replace(/_/g, " ")} | UI readiness: {uiDesignState.readiness.score}%{uiDesignState.needsResync ? " | Needs resync" : ""}
                </p>
                {focusLabel && (
                    <p className="text-xs text-slate-500 dark:text-slate-300">
                        Focus: {focusLabel}{activeScreenIndex !== null && wireframes[activeScreenIndex] ? ` -> ${wireframes[activeScreenIndex].name}` : " (no matching screen)"}
                    </p>
                )}
                {uiDesignActive && (
                    <div className="mt-2 inline-flex rounded-lg border border-[color:var(--border)] p-1 text-xs">
                        {(["spec", "wireframe", "render", "visual"] as UiWorkbenchMode[]).map((item) => (
                            <button
                                key={item}
                                onClick={() => setMode(item)}
                                className={`px-3 py-1 rounded-md font-semibold transition-colors ${mode === item
                                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                                    : "text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"}`}
                            >
                                {item === "spec" ? "Spec Editor" : item === "wireframe" ? "Wireframe" : item === "render" ? "Render" : "Visual"}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {uiDesignActive ? (
                mode === "spec" ? renderSpecEditor() : renderPreview()
            ) : (
                <div className="rounded-2xl border border-dashed border-[color:var(--border)] bg-slate-50/60 p-6 text-center text-slate-500 dark:bg-slate-900/40 dark:text-slate-300">
                    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                        <Lock className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">UI Design Mode Locked</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Requirements readiness must reach 100 to begin UI design. Current: {Math.round(densityScore)}%
                    </p>
                    {uiDesignState.needsResync && (
                        <p className="mt-2 text-xs text-amber-500">UI draft exists and needs resync after returning to functional architecture.</p>
                    )}
                    {missingLabels.length > 0 && (
                        <div className="mt-4 text-left">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Pending UI Requirements</p>
                            <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                                {missingLabels.slice(0, 6).map((label) => (
                                    <li key={label}>- {label}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
