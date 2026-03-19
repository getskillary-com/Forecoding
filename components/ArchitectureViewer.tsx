
"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceLanguage } from "@/lib/project-language";
import type { ArchitecturePack, DecisionRecord, GuardrailChecklist } from "@/types";

// Custom CSS styles to inject into the SVG for enhanced visuals
const customStyles = `
    svg {
        background: transparent !important;
    }

    /* Edge label backgrounds - semi-transparent bubbles */
    .edgeLabel {
        background-color: rgba(30, 41, 59, 0.9) !important;
        padding: 4px 10px !important;
        border-radius: 6px !important;
        border: 1px solid rgba(100, 116, 139, 0.5) !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
    }
    
    .edgeLabel span {
        color: #e2e8f0 !important;
        font-size: 11px !important;
        font-weight: 500 !important;
        letter-spacing: 0.02em !important;
    }

    .edgeLabel text,
    .edgeLabel tspan {
        fill: #e2e8f0 !important;
        font-size: 11px !important;
        font-weight: 500 !important;
        letter-spacing: 0.02em !important;
    }

    .edgeLabel foreignObject div,
    .edgeLabel foreignObject span {
        background: transparent !important;
        color: #e2e8f0 !important;
    }
    
    /* Edge paths - enhanced visibility */
    .edgePath path {
        stroke-width: 2px !important;
        filter: drop-shadow(0 0 3px rgba(148, 163, 184, 0.3)) !important;
    }
    
    /* Golden path - main flow emphasis (first few edges) */
    .flowchart-link {
        stroke: #94a3b8 !important;
    }
    
    /* Subgraph styling - enhanced container */
    .cluster rect {
        fill: rgba(30, 41, 59, 0.6) !important;
        stroke: rgba(100, 116, 139, 0.6) !important;
        stroke-width: 1px !important;
        rx: 12px !important;
        ry: 12px !important;
    }
    
    /* Subgraph labels - uppercase with letter spacing */
    .cluster-label {
        font-size: 11px !important;
        font-weight: 700 !important;
        letter-spacing: 0.1em !important;
        text-transform: uppercase !important;
        fill: #94a3b8 !important;
    }
    
    /* Node styling - unified look */
    .node rect, .node polygon, .node circle, .node ellipse, .node path {
        fill: rgba(15, 23, 42, 0.92) !important;
        stroke: rgba(96, 165, 250, 0.82) !important;
        stroke-width: 2px !important;
        filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.25)) !important;
    }

    .node {
        cursor: pointer;
    }
    
    /* Node text - clear typography */
    .node .label {
        font-weight: 600 !important;
        font-size: 13px !important;
        color: #e5eefc !important;
        fill: #e5eefc !important;
    }

    .node text,
    .node tspan,
    .label text,
    .label tspan {
        fill: #e5eefc !important;
        stroke: none !important;
        font-weight: 600 !important;
        font-size: 13px !important;
    }

    .node foreignObject div,
    .node foreignObject span,
    .label foreignObject div,
    .label foreignObject span {
        background: transparent !important;
        color: #e5eefc !important;
        font-weight: 600 !important;
        font-size: 13px !important;
        line-height: 1.35 !important;
        box-shadow: none !important;
    }
    
    /* Arrowheads */
    marker path {
        fill: #94a3b8 !important;
    }
`;

const RENDER_DEBOUNCE_MS = 140;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

function formatMermaidError(err: unknown) {
    let message = "Unknown Mermaid error";

    if (typeof err === "string") {
        message = err;
    } else if (err instanceof Error) {
        message = err.message || message;
    } else if (err) {
        try {
            message = JSON.stringify(err);
        } catch {
            message = String(err);
        }
    }

    if (message.length > 300) {
        message = message.slice(0, 300) + "...";
    }

    return message;
}

function buildSafeMermaidId(raw: string) {
    const normalized = raw.trim().toLowerCase();
    const ascii = normalized
        .replace(/<[^>]+>/g, " ")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    if (ascii) return ascii;

    let hash = 0;
    for (const char of raw) {
        hash = ((hash << 5) - hash) + char.charCodeAt(0);
        hash |= 0;
    }

    return `group_${Math.abs(hash)}`;
}

function sanitizeMermaidCode(input: string) {
    const normalizedSource = input
        .replace(/```mermaid\s*/gi, "")
        .replace(/```/g, "")
        .replace(/\r/g, "")
        .replace(/\uFF08/g, "(")
        .replace(/\uFF09/g, ")")
        .replace(/<\s*\/\s*subgraph\s*>/gi, "\nend\n")
        .trim();

    const lines = normalizedSource.split("\n");
    let changed = false;
    let hasGraphHeader = false;

    const normalizeLabel = (raw: string) => {
        const cleaned = raw
            .replace(/\\n/g, "<br/>")
            .replace(/--?>/g, " to ")
            .replace(/<--?/g, " from ")
            .replace(/[()]/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/"/g, "'");
        return cleaned;
    };

    const sanitizedLines = lines.map((line) => {
        if (/^\s*(graph|flowchart)\b/i.test(line)) {
            hasGraphHeader = true;
        }

        const normalizedKeywordCase = line
            .replace(/^(\s*)SUBGRAPH\b/g, "$1subgraph")
            .replace(/^(\s*)END\b/g, "$1end");
        if (normalizedKeywordCase !== line) changed = true;
        line = normalizedKeywordCase;

        // Repair malformed edge separators like: A -------- B
        const fixedEdgeSeparator = line.replace(/(\b[A-Za-z][\w-]*\b)\s*-{3,}\s*(\b[A-Za-z][\w-]*\b)/g, "$1 --> $2");
        if (fixedEdgeSeparator !== line) changed = true;
        line = fixedEdgeSeparator;

        // Repair missing connectors between adjacent node declarations: A[...] B[...]
        const fixedAdjacentNodes = line.replace(/\]\s+([A-Za-z][\w-]*\s*\[)/g, "] --> $1");
        if (fixedAdjacentNodes !== line) changed = true;
        line = fixedAdjacentNodes;

        const fixedInlineSubgraph = line
            .replace(/(["\]\)])\s*(subgraph\b)/gi, "$1\n$2")
            .replace(/(["\]\)])\s*(end\b)/gi, "$1\n$2");
        if (fixedInlineSubgraph !== line) changed = true;
        line = fixedInlineSubgraph;

        const normalizedInlineKeywordCase = line
            .replace(/(^|\n)(\s*)SUBGRAPH\b/g, "$1$2subgraph")
            .replace(/(^|\n)(\s*)END\b/g, "$1$2end");
        if (normalizedInlineKeywordCase !== line) changed = true;
        line = normalizedInlineKeywordCase;

        const match = line.match(/^(\s*)subgraph\s+(.+?)\s*\[(.+)\]\s*$/);
        if (match) {
            const indent = match[1] || "";
            const idPart = match[2].trim();
            const label = normalizeLabel(match[3].trim());
            if (label !== match[3].trim()) changed = true;
            return `${indent}subgraph ${idPart}["${label}"]`;
        }

        const plainSubgraphMatch = line.match(/^(\s*)subgraph\s+(.+?)\s*$/);
        if (plainSubgraphMatch) {
            const indent = plainSubgraphMatch[1] || "";
            const rawTitle = plainSubgraphMatch[2].trim();
            const cleanedTitle = normalizeLabel(
                rawTitle
                    .replace(/^["']|["']$/g, "")
                    .replace(/<[^>]+>/g, " ")
                    .trim()
            );
            const safeId = buildSafeMermaidId(cleanedTitle || rawTitle);
            changed = true;
            return `${indent}subgraph ${safeId}["${cleanedTitle || rawTitle}"]`;
        }

        // Normalize labels in node declarations, so parser is less fragile with punctuation/newlines.
        const normalizedNodes = line.replace(/([A-Za-z][\w-]*)\s*\[(.+?)\]/g, (_, nodeId: string, rawLabel: string) => {
            const label = normalizeLabel(rawLabel);
            if (label !== rawLabel) changed = true;
            return `${nodeId}["${label}"]`;
        });
        if (normalizedNodes !== line) changed = true;
        line = normalizedNodes;

        return line;
    });

    if (!hasGraphHeader) {
        changed = true;
        sanitizedLines.unshift("graph TD");
    }

    return {
        changed,
        code: sanitizedLines.join("\n")
    };
}

function normalizeNodeText(value: string) {
    return value.replace(/\s+/g, " ").trim();
}

function extractNodeLabel(node: Element) {
    const foreignLabel = node.querySelector("foreignObject")?.textContent || "";
    const textLabel = node.querySelector("text")?.textContent || "";
    const titleLabel = node.querySelector("title")?.textContent || "";
    const label = normalizeNodeText(foreignLabel || textLabel || titleLabel);
    return label;
}

function extractNodeId(node: Element, fallback: string) {
    const id = node.getAttribute("id") || "";
    return normalizeNodeText(id || fallback);
}

type FallbackSection = {
    title: string;
    items: string[];
};

function clipDiagramLabel(value: string, maxChars: number) {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars - 3)}...`;
}

function sanitizeFallbackLabel(value: string, maxChars: number = 92) {
    return clipDiagramLabel(
        value
            .replace(/<[^>]+>/g, " ")
            .replace(/[`"]/g, "'")
            .replace(/[{}\[\]|]/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        maxChars
    );
}

function normalizeFallbackItems(items: string[], maxItems: number = 6) {
    const seen = new Set<string>();
    return items
        .map((item) => sanitizeFallbackLabel(item))
        .filter((item) => item.length > 0)
        .filter((item) => {
            const key = item.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, maxItems);
}

function buildFallbackSections(
    architecturePack?: ArchitecturePack,
    decisionRecords: DecisionRecord[] = [],
    guardrailChecklist?: GuardrailChecklist,
    language: WorkspaceLanguage = "en"
): FallbackSection[] {
    if (!architecturePack) return [];

    const isZh = language === "zh";
    const businessItems = normalizeFallbackItems([
        architecturePack.businessContext.productGoal
            ? `${isZh ? "产品目标" : "Product goal"}: ${architecturePack.businessContext.productGoal}`
            : "",
        architecturePack.platformStrategy.primaryPlatform
            ? `${isZh ? "首发平台" : "Primary platform"}: ${architecturePack.platformStrategy.primaryPlatform}`
            : "",
        ...architecturePack.businessContext.targetUsers.map((item) => `${isZh ? "目标用户" : "User"}: ${item}`),
        ...architecturePack.businessContext.constraints.slice(0, 2).map((item) => `${isZh ? "约束" : "Constraint"}: ${item}`),
        ...architecturePack.businessContext.risks.slice(0, 2).map((item) => `${isZh ? "风险" : "Risk"}: ${item}`)
    ], 8);

    const structureItems = normalizeFallbackItems([
        ...architecturePack.boundedContexts.map((item) => `${item.name}: ${item.responsibility}`),
        ...architecturePack.moduleResponsibilities.map((item) => `${item.module}: ${item.responsibility}`)
    ], 8);

    const dataItems = normalizeFallbackItems([
        ...architecturePack.dataOwnership.map((item) => `${item.data} -> ${item.owner}`),
        ...architecturePack.integrationContracts.map((item) => `${item.name}: ${item.producer} -> ${item.consumer}`)
    ], 8);

    const deliveryItems = normalizeFallbackItems([
        ...architecturePack.nonFunctionalRequirements.map((item) => `${item.category}: ${item.requirement}`),
        ...decisionRecords.slice(0, 3).map((item) => item.decision || item.title),
        ...(guardrailChecklist?.implementationOrder || []).slice(0, 3),
        ...(guardrailChecklist?.testStrategy || []).slice(0, 2)
    ], 8);

    return [
        {
            title: isZh ? "业务背景" : "Business context",
            items: businessItems
        },
        {
            title: isZh ? "核心结构" : "Core structure",
            items: structureItems
        },
        {
            title: isZh ? "数据与集成" : "Data and integrations",
            items: dataItems
        },
        {
            title: isZh ? "交付护栏" : "Delivery guardrails",
            items: deliveryItems
        }
    ].filter((section) => section.items.length > 0);
}

function buildFallbackDiagramCode(sections: FallbackSection[]) {
    if (sections.length === 0) return "";

    const lines = ["graph TD"];
    let nodeCounter = 0;
    let previousAnchorId: string | null = null;

    sections.forEach((section, sectionIndex) => {
        const sectionId = `sg_${sectionIndex}`;
        const sectionTitle = sanitizeFallbackLabel(section.title, 36);
        lines.push(`subgraph ${sectionId}["${sectionTitle}"]`);

        let firstNodeId: string | null = null;
        let previousNodeId: string | null = null;

        section.items.forEach((item) => {
            const nodeId = `n_${nodeCounter++}`;
            const label = sanitizeFallbackLabel(item, 88);
            lines.push(`  ${nodeId}["${label}"]`);
            if (!firstNodeId) firstNodeId = nodeId;
            if (previousNodeId) {
                lines.push(`  ${previousNodeId} --> ${nodeId}`);
            }
            previousNodeId = nodeId;
        });

        lines.push("end");

        if (previousAnchorId && firstNodeId) {
            lines.push(`${previousAnchorId} --> ${firstNodeId}`);
        }

        previousAnchorId = previousNodeId || previousAnchorId;
    });

    return lines.join("\n");
}

type ArchitectureViewerProps = {
    code: string;
    onNodeSelect?: (node: { id: string; label: string }) => void;
    language: WorkspaceLanguage;
    architecturePack?: ArchitecturePack;
    decisionRecords?: DecisionRecord[];
    guardrailChecklist?: GuardrailChecklist;
};

type HoveredNodeState = {
    id: string;
    label: string;
    x: number;
    y: number;
} | null;

export default function ArchitectureViewer({
    code,
    onNodeSelect,
    language,
    architecturePack,
    decisionRecords = [],
    guardrailChecklist
}: ArchitectureViewerProps) {
    const [svg, setSvg] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [warning, setWarning] = useState<string | null>(null);
    const [fallbackReason, setFallbackReason] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [hoveredNode, setHoveredNode] = useState<HoveredNodeState>(null);
    const dragOriginRef = useRef({ x: 0, y: 0 });
    const dragMovedRef = useRef(false);
    const zoomRef = useRef(1);
    const panRef = useRef({ x: 0, y: 0 });
    const mermaidRef = useRef<typeof import('mermaid').default | null>(null);
    const initializedRef = useRef(false);
    const hasRenderedRef = useRef(false);
    const renderRequestIdRef = useRef(0);
    const fallbackSections = useMemo(
        () => buildFallbackSections(architecturePack, decisionRecords, guardrailChecklist, language),
        [architecturePack, decisionRecords, guardrailChecklist, language]
    );
    const fallbackDiagramCode = useMemo(
        () => buildFallbackDiagramCode(fallbackSections),
        [fallbackSections]
    );
    const hasFallbackContent = fallbackSections.length > 0;

    useEffect(() => {
        zoomRef.current = zoom;
    }, [zoom]);

    useEffect(() => {
        panRef.current = pan;
    }, [pan]);

    useEffect(() => {
        let cancelled = false;
        const requestId = renderRequestIdRef.current + 1;
        renderRequestIdRef.current = requestId;

        const initAndRender = async () => {
            if ((!code && !fallbackDiagramCode) || typeof document === 'undefined') return;
            let autoCorrected = false;
            let usedStructuredFallback = false;

            // Dynamically import mermaid (avoids SSR issues)
            if (!mermaidRef.current) {
                const mod = await import('mermaid');
                mermaidRef.current = mod.default;
            }

            const mermaidInstance = mermaidRef.current;

            // Initialize only once
            if (!initializedRef.current) {
                mermaidInstance.initialize({
                    startOnLoad: false,
                    theme: 'base',
                    securityLevel: 'strict',
                    flowchart: {
                        htmlLabels: false,
                        curve: 'basis',
                        padding: 20,
                        nodeSpacing: 50,
                        rankSpacing: 60,
                        useMaxWidth: false,
                    },
                    themeVariables: {
                        primaryColor: '#3b82f6',
                        primaryTextColor: '#ffffff',
                        primaryBorderColor: '#2563eb',
                        lineColor: '#94a3b8',
                        secondaryColor: '#8b5cf6',
                        secondaryTextColor: '#ffffff',
                        secondaryBorderColor: '#7c3aed',
                        tertiaryColor: '#10b981',
                        tertiaryTextColor: '#ffffff',
                        tertiaryBorderColor: '#059669',
                        background: 'transparent',
                        mainBkg: '#1e293b',
                        nodeBorder: '#475569',
                        clusterBkg: 'rgba(30, 41, 59, 0.6)',
                        clusterBorder: 'rgba(100, 116, 139, 0.6)',
                        titleColor: '#f1f5f9',
                        edgeLabelBackground: 'rgba(30, 41, 59, 0.95)',
                        fontFamily: '"Inter", ui-sans-serif, system-ui, -apple-system, sans-serif',
                        fontSize: '14px',
                    }
                });
                initializedRef.current = true;
            }

            // Always sanitize first so we fix escaped newlines and malformed subgraphs
            // before Mermaid gets a chance to render unstable HTML labels or partial syntax.
            const sanitized = sanitizeMermaidCode(code || fallbackDiagramCode);
            const candidates = Array.from(
                new Set([sanitized.code, code.trim(), fallbackDiagramCode].filter(Boolean))
            );
            let renderCode = candidates[0] || code || fallbackDiagramCode;
            let parseFailure: unknown = null;

            for (const candidate of candidates) {
                try {
                    await mermaidInstance.parse(candidate);
                    renderCode = candidate;
                    usedStructuredFallback = Boolean(fallbackDiagramCode) && candidate === fallbackDiagramCode && candidate !== code.trim();
                    autoCorrected = candidate !== code.trim() && !usedStructuredFallback;
                    parseFailure = null;
                    break;
                } catch (candidateError) {
                    parseFailure = candidateError;
                }
            }

            if (parseFailure) {
                if (cancelled || requestId !== renderRequestIdRef.current) return;
                const message = formatMermaidError(parseFailure);
                if (hasRenderedRef.current) {
                    setWarning(`Using last valid diagram: ${message}`);
                    return;
                }
                if (hasFallbackContent) {
                    setSvg('');
                    setError(null);
                    setWarning(null);
                    setFallbackReason(message);
                    return;
                }
                setFallbackReason(null);
                setError(message);
                setWarning(null);
                return;
            }

            const tempElement = document.createElement('div');
            try {
                const id = `mermaid-${requestId}-${Date.now()}`;
                tempElement.id = id;
                document.body.appendChild(tempElement);

                const { svg: newSvg } = await mermaidInstance.render(id, renderCode);

                if (cancelled || requestId !== renderRequestIdRef.current) return;

                const styledSvg = newSvg.replace(
                    '<style>',
                    `<style>${customStyles}`
                );

                setSvg(styledSvg);
                setError(null);
                setFallbackReason(null);
                setWarning(
                    usedStructuredFallback
                        ? (language === "zh"
                            ? "已切换到基于结构化架构数据生成的稳定视图。"
                            : "Switched to a stable view generated from structured architecture data.")
                        : autoCorrected
                            ? "Diagram had syntax issues and was auto-corrected."
                            : null
                );
                hasRenderedRef.current = true;
            } catch (renderError) {
                if (cancelled || requestId !== renderRequestIdRef.current) return;
                console.debug("Mermaid render error:", renderError);
                const message = formatMermaidError(renderError);
                if (hasRenderedRef.current) {
                    setWarning(`Using last valid diagram: ${message}`);
                    return;
                }
                if (hasFallbackContent) {
                    setSvg('');
                    setError(null);
                    setWarning(null);
                    setFallbackReason(message);
                    return;
                }
                setFallbackReason(null);
                setError(message);
                setWarning(null);
            } finally {
                if (document.body.contains(tempElement)) {
                    document.body.removeChild(tempElement);
                }
            }
        };

        const timeoutId = window.setTimeout(() => {
            void initAndRender();
        }, RENDER_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
        };
    }, [code, fallbackDiagramCode, hasFallbackContent, language]);

    const fitDiagramToViewport = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;

        const svgElement = container.querySelector("svg") as SVGSVGElement | null;
        if (!svgElement) return;

        let width = svgElement.viewBox?.baseVal?.width || 0;
        let height = svgElement.viewBox?.baseVal?.height || 0;

        if ((!width || !height) && typeof svgElement.getBBox === "function") {
            try {
                const bounds = svgElement.getBBox();
                width = bounds.width || width;
                height = bounds.height || height;
            } catch {
                // Ignore getBBox failures and fall back to explicit dimensions below.
            }
        }

        if (!width || !height) {
            const explicitWidth = Number.parseFloat(svgElement.getAttribute("width") || "0");
            const explicitHeight = Number.parseFloat(svgElement.getAttribute("height") || "0");
            width = explicitWidth || width;
            height = explicitHeight || height;
        }

        if (!width || !height) {
            setZoom(1);
            setPan({ x: 0, y: 0 });
            return;
        }

        const containerWidth = Math.max(container.clientWidth, 1);
        const containerHeight = Math.max(container.clientHeight, 1);
        const paddingFactor = 0.84;
        const fitScale = Math.min(
            (containerWidth * paddingFactor) / width,
            (containerHeight * paddingFactor) / height
        );

        const nextZoom = Number.isFinite(fitScale)
            ? Math.min(Math.max(fitScale, 0.35), 1.4)
            : 1;

        setZoom(nextZoom);
        setPan({ x: 0, y: 0 });
    }, []);

    useEffect(() => {
        if (!svg || error || typeof window === "undefined") return;

        const raf = window.requestAnimationFrame(() => {
            fitDiagramToViewport();
        });

        return () => {
            window.cancelAnimationFrame(raf);
        };
    }, [svg, error, fitDiagramToViewport]);

    useEffect(() => {
        if (!svg || error || typeof window === "undefined") return;

        const handleResize = () => {
            window.requestAnimationFrame(() => {
                fitDiagramToViewport();
            });
        };

        window.addEventListener("resize", handleResize);

        return () => {
            window.removeEventListener("resize", handleResize);
        };
    }, [svg, error, fitDiagramToViewport]);

    const updateViewport = useCallback((nextZoom: number, nextPan: { x: number; y: number }) => {
        zoomRef.current = nextZoom;
        panRef.current = nextPan;
        setZoom(nextZoom);
        setPan(nextPan);
    }, []);

    const zoomAroundPoint = useCallback((clientX: number, clientY: number, scaleFactor: number) => {
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const currentZoom = zoomRef.current;
        const currentPan = panRef.current;
        const nextZoom = Math.min(Math.max(currentZoom * scaleFactor, MIN_ZOOM), MAX_ZOOM);

        if (Math.abs(nextZoom - currentZoom) < 0.0001) {
            return;
        }

        const pointerX = clientX - rect.left;
        const pointerY = clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const zoomRatio = nextZoom / currentZoom;
        const nextPan = {
            x: pointerX - centerX - (pointerX - centerX - currentPan.x) * zoomRatio,
            y: pointerY - centerY - (pointerY - centerY - currentPan.y) * zoomRatio
        };

        updateViewport(nextZoom, nextPan);
    }, [updateViewport]);

    const handleWheel = useCallback((e: WheelEvent) => {
        if (!svg || error) return;

        e.preventDefault();
        setHoveredNode(null);

        const scale = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        zoomAroundPoint(e.clientX, e.clientY, scale);
    }, [error, svg, zoomAroundPoint]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        container.addEventListener("wheel", handleWheel, { passive: false });
        return () => {
            container.removeEventListener("wheel", handleWheel);
        };
    }, [handleWheel]);

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        dragOriginRef.current = { x: e.clientX, y: e.clientY };
        dragMovedRef.current = false;
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        const target = e.target as Element | null;
        const nodeEl = target?.closest(".node");

        if (!isDragging && nodeEl && containerRef.current) {
            const label = extractNodeLabel(nodeEl);
            const id = extractNodeId(nodeEl, label || "node");
            if (label) {
                const rect = containerRef.current.getBoundingClientRect();
                setHoveredNode({
                    id,
                    label,
                    x: e.clientX - rect.left + 16,
                    y: e.clientY - rect.top + 16
                });
            } else {
                setHoveredNode(null);
            }
        } else if (!isDragging) {
            setHoveredNode(null);
        }

        if (isDragging) {
            const dx = e.clientX - dragOriginRef.current.x;
            const dy = e.clientY - dragOriginRef.current.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) {
                dragMovedRef.current = true;
            }
            setHoveredNode(null);
            setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleZoomIn = () => {
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        zoomAroundPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.2);
    };
    const handleZoomOut = () => {
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        zoomAroundPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.8);
    };
    const handleReset = () => {
        setHoveredNode(null);
        fitDiagramToViewport();
    };

    const handleDownload = () => {
        if (!svg) return;
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `architecture-${Date.now()}.svg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleSvgClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (!onNodeSelect) return;
        if (dragMovedRef.current) {
            dragMovedRef.current = false;
            return;
        }

        const target = event.target as Element | null;
        if (!target) return;
        const nodeEl = target.closest(".node");
        if (!nodeEl) return;

        const label = extractNodeLabel(nodeEl);
        if (!label) return;
        const id = extractNodeId(nodeEl, label);
        onNodeSelect({ id, label });
    }, [onNodeSelect]);

    const tooltipStyle = hoveredNode
        ? {
            left: Math.max(12, Math.min(
                hoveredNode.x,
                (containerRef.current?.clientWidth ?? 280) - 280
            )),
            top: Math.max(12, Math.min(
                hoveredNode.y,
                (containerRef.current?.clientHeight ?? 140) - 96
            ))
        }
        : undefined;

    return (
        <div
            className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950"
        >
            {/* Subtle grid overlay for depth */}
            <div
                className="absolute inset-0 opacity-[0.03] pointer-events-none"
                style={{
                    backgroundImage: `
                        linear-gradient(rgba(148, 163, 184, 0.5) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(148, 163, 184, 0.5) 1px, transparent 1px)
                    `,
                    backgroundSize: '40px 40px'
                }}
            />

            <div
                className="relative min-h-0 flex-1 overflow-hidden cursor-grab active:cursor-grabbing"
                ref={containerRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => {
                    handleMouseUp();
                    setHoveredNode(null);
                }}
            >
                {svg ? (
                    <div
                        className="absolute top-1/2 left-1/2 origin-center transition-transform duration-75 ease-out mermaid-container"
                        style={{
                            transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
                        }}
                        onClick={handleSvgClick}
                        dangerouslySetInnerHTML={{ __html: svg }}
                    />
                ) : hasFallbackContent ? (
                    <div className="absolute inset-0 overflow-auto px-5 py-5">
                        <div className="mx-auto flex h-full max-w-6xl flex-col gap-4">
                            <div className="rounded-2xl border border-sky-400/25 bg-slate-950/80 px-4 py-3 text-sm text-slate-200 shadow-xl backdrop-blur">
                                <div className="text-[11px] uppercase tracking-[0.18em] text-sky-300/75">
                                    {language === "zh" ? "稳定视图" : "Stable view"}
                                </div>
                                <div className="mt-1 font-medium text-slate-50">
                                    {language === "zh"
                                        ? "当前展示的是基于结构化架构数据生成的稳定架构视图。"
                                        : "This is a stable architecture view generated from structured architecture data."}
                                </div>
                                {fallbackReason ? (
                                    <div className="mt-2 text-xs text-slate-400">
                                        {language === "zh" ? "Mermaid 原始渲染失败：" : "Original Mermaid render failed: "} {fallbackReason}
                                    </div>
                                ) : null}
                            </div>

                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                {fallbackSections.map((section) => (
                                    <div
                                        key={section.title}
                                        className="rounded-3xl border border-slate-800/80 bg-slate-950/75 p-4 shadow-2xl shadow-slate-950/30 backdrop-blur"
                                    >
                                        <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-sky-300/75">
                                            {section.title}
                                        </div>
                                        <div className="space-y-3">
                                            {section.items.map((item) => (
                                                <div
                                                    key={item}
                                                    className="rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-3 text-sm leading-6 text-slate-100"
                                                >
                                                    {item}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : error ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 pointer-events-none">
                        <svg className="w-12 h-12 mb-2 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                        <p className="font-semibold mb-1">{language === "zh" ? "渲染错误" : "Rendering Error"}</p>
                        <p className="text-xs opacity-80 max-w-xs text-center">{error}</p>
                    </div>
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 pointer-events-none">
                        <div className="relative">
                            <svg className="w-16 h-16 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"></path></svg>
                            <div className="absolute inset-0 animate-ping">
                                <svg className="w-16 h-16 opacity-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"></path></svg>
                            </div>
                        </div>
                        <p className="text-sm font-medium tracking-wide">{language === "zh" ? "等待架构内容..." : "Waiting for architecture..."}</p>
                        <p className="text-xs text-slate-600 mt-1">{language === "zh" ? "从你的想法开始描述" : "Start describing your idea"}</p>
                    </div>
                )}

                {svg && hoveredNode && !isDragging && (
                    <div
                        className="pointer-events-none absolute z-30 max-w-[260px] rounded-2xl border border-sky-400/30 bg-slate-950/95 px-3 py-2 text-xs font-medium leading-5 text-slate-100 shadow-2xl backdrop-blur-md"
                        style={tooltipStyle}
                    >
                        <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-sky-300/75">
                            {language === "zh" ? "模块详情" : "Module"}
                        </div>
                        <div className="break-words text-sm text-slate-50">{hoveredNode.label}</div>
                    </div>
                )}

                {svg && warning && (
                    <div className="absolute top-3 left-3 right-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 backdrop-blur-sm">
                        {warning}
                    </div>
                )}
            </div>

            {svg && !error && (
                <div className="absolute bottom-4 right-4 flex flex-col gap-2">
                    <div className="flex bg-slate-800/90 backdrop-blur-sm rounded-lg shadow-lg border border-slate-700/50 overflow-hidden">
                        <button onClick={handleZoomIn} className="p-2.5 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors" title={language === "zh" ? "放大" : "Zoom In"}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                        </button>
                        <div className="w-px bg-slate-700/50" />
                        <button onClick={handleZoomOut} className="p-2.5 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors" title={language === "zh" ? "缩小" : "Zoom Out"}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 12H4"></path></svg>
                        </button>
                        <div className="w-px bg-slate-700/50" />
                        <button onClick={handleReset} className="p-2.5 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors" title={language === "zh" ? "重置视图" : "Reset View"}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>
                        </button>
                    </div>

                    <button
                        onClick={handleDownload}
                        className="p-2.5 bg-slate-800/90 backdrop-blur-sm text-slate-300 rounded-lg shadow-lg hover:bg-slate-700/50 hover:text-white transition-colors border border-slate-700/50 self-end"
                        title={language === "zh" ? "下载 SVG" : "Download SVG"}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></svg>
                    </button>
                </div>
            )}

            {/* Zoom indicator */}
            {svg && !error && zoom !== 1 && (
                <div className="absolute bottom-4 left-4 bg-slate-800/90 backdrop-blur-sm px-3 py-1.5 rounded-lg text-xs font-mono text-slate-400 border border-slate-700/50">
                    {Math.round(zoom * 100)}%
                </div>
            )}
        </div>
    );
}





