import type {
    UiDesignSpec,
    UiDesignTokens,
    UiDesignScreen,
    UiDesignComponent,
    UiDesignFlow,
    UiRequirements
} from "@/types";

const UI_SPEC_VERSION = "ui_spec_v1" as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function slugify(value: string) {
    return (value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
}

function buildDefaultTokens(ui?: UiRequirements): UiDesignTokens {
    const primaryColor = ui?.colorSystem?.[0] || "#3b82f6";
    const secondaryColor = ui?.colorSystem?.[1] || "#22c55e";
    const fontFamily = ui?.typography?.[0] || "Inter";

    return {
        colors: {
            primary: primaryColor,
            secondary: secondaryColor,
            background: "#0f172a",
            surface: "#111827",
            text: "#f8fafc"
        },
        typography: {
            fontFamilies: [fontFamily],
            scale: {
                xs: "12px",
                sm: "14px",
                md: "16px",
                lg: "20px",
                xl: "24px"
            },
            weights: {
                regular: 400,
                medium: 500,
                semibold: 600,
                bold: 700
            }
        },
        spacing: {
            xs: "4px",
            sm: "8px",
            md: "12px",
            lg: "16px",
            xl: "24px"
        },
        radius: {
            sm: "8px",
            md: "12px",
            lg: "16px"
        },
        shadow: {
            sm: "0 4px 12px rgba(15,23,42,0.12)",
            md: "0 12px 30px rgba(15,23,42,0.18)"
        },
        motion: {
            duration: {
                fast: "120ms",
                normal: "180ms",
                slow: "240ms"
            },
            easing: {
                standard: "cubic-bezier(0.2, 0.8, 0.2, 1)",
                emphasized: "cubic-bezier(0.2, 0.7, 0.2, 1)"
            }
        },
        accessibility: {
            contrastTarget: "WCAG AA",
            focusStyle: "Visible focus ring 2px"
        }
    };
}

function normalizeScreenStates(value: unknown): UiDesignScreen["states"] {
    if (!isRecord(value)) {
        return {
            loading: "loading",
            empty: "empty",
            error: "error",
            success: "success"
        };
    }
    return {
        loading: String(value.loading || "loading"),
        empty: String(value.empty || "empty"),
        error: String(value.error || "error"),
        success: String(value.success || "success")
    };
}

function normalizeScreenLayout(value: unknown): UiDesignScreen["layout"] {
    if (!isRecord(value)) {
        return { type: "stack", sections: ["header", "content", "footer"] };
    }
    const sections = Array.isArray(value.sections)
        ? value.sections.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean)
        : [];
    return {
        type: typeof value.type === "string" && value.type.trim() ? value.type.trim() : "stack",
        sections: sections.length > 0 ? sections : ["header", "content", "footer"]
    };
}

function normalizeScreen(value: unknown, index: number, fallbackComponents: string[]): UiDesignScreen {
    const base = isRecord(value) ? value : {};
    const name = typeof base.name === "string" && base.name.trim() ? base.name.trim() : `Screen ${index + 1}`;
    const route = typeof base.route === "string" && base.route.trim()
        ? base.route.trim()
        : (index === 0 ? "/" : `/screen-${index + 1}`);
    const components = Array.isArray(base.components)
        ? base.components.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean)
        : [];

    return {
        id: typeof base.id === "string" && base.id.trim() ? base.id.trim() : slugify(name) || `screen-${index + 1}`,
        name,
        route,
        layout: normalizeScreenLayout(base.layout),
        components: components.length > 0 ? components : fallbackComponents,
        states: normalizeScreenStates(base.states),
        interactions: Array.isArray(base.interactions)
            ? base.interactions.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean)
            : []
    };
}

function normalizeComponent(value: unknown, index: number): UiDesignComponent {
    const base = isRecord(value) ? value : {};
    const name = typeof base.name === "string" && base.name.trim() ? base.name.trim() : `Component ${index + 1}`;
    return {
        id: typeof base.id === "string" && base.id.trim() ? base.id.trim() : slugify(name) || `component-${index + 1}`,
        name,
        type: typeof base.type === "string" && base.type.trim() ? base.type.trim() : "generic",
        variants: Array.isArray(base.variants)
            ? base.variants.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean)
            : [],
        props: isRecord(base.props)
            ? Object.entries(base.props).reduce<Record<string, string>>((acc, [key, val]) => {
                if (!key || val == null) return acc;
                acc[String(key)] = String(val);
                return acc;
            }, {})
            : {},
        states: Array.isArray(base.states)
            ? base.states.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean)
            : []
    };
}

function normalizeFlows(value: unknown): UiDesignFlow[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter(isRecord)
        .map((flow) => ({
            from: typeof flow.from === "string" ? flow.from.trim() : "",
            to: typeof flow.to === "string" ? flow.to.trim() : "",
            trigger: typeof flow.trigger === "string" ? flow.trigger.trim() : ""
        }))
        .filter((flow) => flow.from && flow.to && flow.trigger);
}

export function buildMinimalUiDesignSpec(ui?: UiRequirements): UiDesignSpec {
    const requirements = ui || {
        visualStyle: [],
        colorSystem: [],
        typography: [],
        keyScreens: [],
        uiComponents: [],
        responsiveStrategy: [],
        interactionMotion: [],
        statesAndFeedback: []
    };

    const screenNames = requirements.keyScreens.length > 0 ? requirements.keyScreens : ["Primary Screen"];
    const componentNames = requirements.uiComponents.length > 0 ? requirements.uiComponents : ["Primary Card", "Primary Button"];

    const components = componentNames.map((name, idx) => normalizeComponent({ name }, idx));
    const componentIds = components.map((component) => component.id);

    const defaultStates = requirements.statesAndFeedback.length > 0
        ? requirements.statesAndFeedback
        : ["loading", "empty", "error", "success"];
    const states = {
        loading: defaultStates[0] || "loading",
        empty: defaultStates[1] || "empty",
        error: defaultStates[2] || "error",
        success: defaultStates[3] || "success"
    };

    const screens = screenNames.map((name, index) => normalizeScreen({
        name,
        components: componentIds,
        states,
        interactions: requirements.interactionMotion
    }, index, componentIds));

    return {
        version: UI_SPEC_VERSION,
        tokens: buildDefaultTokens(requirements),
        screens,
        components,
        flows: []
    };
}

export function isUiDesignSpec(value: unknown): value is UiDesignSpec {
    return isRecord(value) && value.version === UI_SPEC_VERSION;
}

export function normalizeUiDesignSpec(raw: unknown, fallbackUi?: UiRequirements | null): UiDesignSpec | null {
    if (isUiDesignSpec(raw)) {
        const spec = raw as UiDesignSpec;
        return {
            version: UI_SPEC_VERSION,
            tokens: isRecord(spec.tokens) ? (spec.tokens as UiDesignTokens) : buildDefaultTokens(),
            screens: Array.isArray(spec.screens)
                ? spec.screens.map((screen, idx) => normalizeScreen(screen, idx, []))
                : [],
            components: Array.isArray(spec.components)
                ? spec.components.map((component, idx) => normalizeComponent(component, idx))
                : [],
            flows: normalizeFlows(spec.flows)
        };
    }

    if (isRecord(raw)) {
        const candidate = raw as Partial<UiDesignSpec>;
        const screens = Array.isArray(candidate.screens)
            ? candidate.screens.map((screen, idx) => normalizeScreen(screen, idx, []))
            : [];
        const components = Array.isArray(candidate.components)
            ? candidate.components.map((component, idx) => normalizeComponent(component, idx))
            : [];
        return {
            version: UI_SPEC_VERSION,
            tokens: isRecord(candidate.tokens) ? (candidate.tokens as UiDesignTokens) : buildDefaultTokens(fallbackUi || undefined),
            screens,
            components,
            flows: normalizeFlows(candidate.flows)
        };
    }

    if (fallbackUi) {
        return buildMinimalUiDesignSpec(fallbackUi);
    }

    return null;
}

export function parseUiDesignSpecBlock(raw: string): UiDesignSpec | null {
    const source = (raw || "")
        .trim()
        .replace(/^```[a-zA-Z0-9_-]*\n?/g, "")
        .replace(/```$/g, "")
        .trim();
    if (!source) return null;

    const parseCandidate = (text: string): UiDesignSpec | null => {
        try {
            const parsed = JSON.parse(text) as unknown;
            return normalizeUiDesignSpec(parsed, null);
        } catch {
            return null;
        }
    };

    const direct = parseCandidate(source);
    if (direct) return direct;

    const match = source.match(/\{[\s\S]*\}/);
    if (match?.[0]) {
        return parseCandidate(match[0]);
    }

    return null;
}

export function validateUiDesignSpec(spec: UiDesignSpec | null): string[] {
    if (!spec) return ["UI spec is missing."];
    if (spec.version !== UI_SPEC_VERSION) return ["UI spec version is invalid."];

    const errors: string[] = [];
    if (!spec.tokens || !spec.tokens.colors || Object.keys(spec.tokens.colors || {}).length === 0) {
        errors.push("Design tokens are missing color definitions.");
    }

    if (!Array.isArray(spec.screens) || spec.screens.length === 0) {
        errors.push("At least one screen is required.");
    } else {
        spec.screens.forEach((screen, index) => {
            if (!screen.id || !screen.name) {
                errors.push(`Screen ${index + 1} must include id and name.`);
            }
            if (!screen.route) {
                errors.push(`Screen ${screen.name || index + 1} must include a route.`);
            }
            if (!screen.layout || !screen.layout.type || !screen.layout.sections?.length) {
                errors.push(`Screen ${screen.name || index + 1} must define layout type and sections.`);
            }
            if (!Array.isArray(screen.components) || screen.components.length === 0) {
                errors.push(`Screen ${screen.name || index + 1} must reference at least one component.`);
            }
            if (!screen.states || !screen.states.loading || !screen.states.empty || !screen.states.error || !screen.states.success) {
                errors.push(`Screen ${screen.name || index + 1} must include loading/empty/error/success states.`);
            }
            if (!Array.isArray(screen.interactions) || screen.interactions.length === 0) {
                errors.push(`Screen ${screen.name || index + 1} should list at least one interaction.`);
            }
        });
    }

    if (!Array.isArray(spec.components) || spec.components.length === 0) {
        errors.push("At least one component is required.");
    } else {
        spec.components.forEach((component, index) => {
            if (!component.id || !component.name || !component.type) {
                errors.push(`Component ${index + 1} must include id, name, and type.`);
            }
        });
    }

    return errors;
}

export function deriveUiRequirements(spec: UiDesignSpec | null): UiRequirements {
    if (!spec) {
        return {
            visualStyle: [],
            colorSystem: [],
            typography: [],
            keyScreens: [],
            uiComponents: [],
            responsiveStrategy: [],
            interactionMotion: [],
            statesAndFeedback: []
        };
    }

    const colorSystem = Object.entries(spec.tokens?.colors || {}).map(([key, value]) => `${key}: ${value}`);
    const typography = [
        ...(spec.tokens?.typography?.fontFamilies || []),
        ...Object.keys(spec.tokens?.typography?.scale || {})
    ];
    const keyScreens = spec.screens.map((screen) => screen.name);
    const uiComponents = spec.components.map((component) => component.name);
    const interactionMotion = spec.screens.flatMap((screen) => screen.interactions || []);
    const statesAndFeedback = spec.screens.flatMap((screen) => Object.values(screen.states || {}));

    return {
        visualStyle: ["Defined via spec"],
        colorSystem,
        typography,
        keyScreens,
        uiComponents,
        responsiveStrategy: ["Defined via spec"],
        interactionMotion,
        statesAndFeedback
    };
}
