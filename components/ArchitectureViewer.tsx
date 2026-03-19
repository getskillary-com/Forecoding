"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceLanguage } from "@/lib/project-language";
import { buildArchitectureDiagramInspectorSections } from "@/lib/architecture-diagram";
import type { ArchitectureDiagramModel } from "@/types";

const customStyles = `
    svg {
        background: transparent !important;
    }

    .edgePath path {
        stroke-width: 2px !important;
        filter: drop-shadow(0 0 3px rgba(148, 163, 184, 0.25)) !important;
    }

    .flowchart-link {
        stroke: #94a3b8 !important;
    }

    .cluster rect {
        fill: rgba(30, 41, 59, 0.62) !important;
        stroke: rgba(100, 116, 139, 0.58) !important;
        stroke-width: 1px !important;
        rx: 12px !important;
        ry: 12px !important;
    }

    .cluster-label {
        font-size: 11px !important;
        font-weight: 700 !important;
        letter-spacing: 0.08em !important;
        text-transform: uppercase !important;
        fill: #94a3b8 !important;
    }

    .node rect,
    .node polygon,
    .node circle,
    .node ellipse,
    .node path {
        fill: rgba(15, 23, 42, 0.94) !important;
        stroke: rgba(96, 165, 250, 0.82) !important;
        stroke-width: 2px !important;
        filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.25)) !important;
    }

    .node text,
    .node tspan,
    .label text,
    .label tspan,
    .edgeLabel text,
    .edgeLabel tspan {
        fill: #e5eefc !important;
        stroke: none !important;
        font-weight: 600 !important;
    }

    .node foreignObject div,
    .node foreignObject span,
    .label foreignObject div,
    .label foreignObject span,
    .edgeLabel foreignObject div,
    .edgeLabel foreignObject span {
        background: transparent !important;
        color: #e5eefc !important;
        box-shadow: none !important;
    }

    marker path {
        fill: #94a3b8 !important;
    }
`;

const RENDER_DEBOUNCE_MS = 120;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

type ArchitectureViewerProps = {
    code: string;
    onNodeSelect?: (node: { id: string; label: string }) => void;
    language: WorkspaceLanguage;
    diagramModel?: ArchitectureDiagramModel;
};

type HoveredNodeState = {
    id: string;
    label: string;
    x: number;
    y: number;
} | null;

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

    if (message.length > 280) {
        message = `${message.slice(0, 280)}...`;
    }

    return message;
}

function normalizeMermaidCode(input: string) {
    return input
        .replace(/```mermaid\s*/gi, "")
        .replace(/```/g, "")
        .replace(/\r/g, "")
        .replace(/<\s*\/\s*subgraph\s*>/gi, "\nend\n")
        .trim();
}

function normalizeNodeText(value: string) {
    return value.replace(/\s+/g, " ").trim();
}

function extractNodeLabel(node: Element) {
    const foreignLabel = node.querySelector("foreignObject")?.textContent || "";
    const textLabel = node.querySelector("text")?.textContent || "";
    const titleLabel = node.querySelector("title")?.textContent || "";
    return normalizeNodeText(foreignLabel || textLabel || titleLabel);
}

function extractNodeId(node: Element, fallback: string) {
    const id = node.getAttribute("id") || "";
    return normalizeNodeText(id || fallback);
}

export default function ArchitectureViewer({
    code,
    onNodeSelect,
    language,
    diagramModel
}: ArchitectureViewerProps) {
    const [svg, setSvg] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [hoveredNode, setHoveredNode] = useState<HoveredNodeState>(null);
    const [showInspector, setShowInspector] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const dragOriginRef = useRef({ x: 0, y: 0 });
    const dragMovedRef = useRef(false);
    const zoomRef = useRef(1);
    const panRef = useRef({ x: 0, y: 0 });
    const mermaidRef = useRef<typeof import("mermaid").default | null>(null);
    const initializedRef = useRef(false);
    const renderRequestIdRef = useRef(0);

    const inspectorSections = useMemo(
        () => diagramModel ? buildArchitectureDiagramInspectorSections(diagramModel) : [],
        [diagramModel]
    );
    const canInspect = inspectorSections.length > 0;

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

        const renderDiagram = async () => {
            if (typeof document === "undefined") return;
            const normalizedCode = normalizeMermaidCode(code);
            if (!normalizedCode) {
                setSvg("");
                setError(null);
                return;
            }

            if (!mermaidRef.current) {
                const mod = await import("mermaid");
                mermaidRef.current = mod.default;
            }

            const mermaidInstance = mermaidRef.current;
            if (!initializedRef.current) {
                mermaidInstance.initialize({
                    startOnLoad: false,
                    theme: "base",
                    securityLevel: "strict",
                    flowchart: {
                        htmlLabels: false,
                        curve: "basis",
                        padding: 20,
                        nodeSpacing: 50,
                        rankSpacing: 60,
                        useMaxWidth: false
                    },
                    themeVariables: {
                        primaryColor: "#3b82f6",
                        primaryTextColor: "#ffffff",
                        primaryBorderColor: "#2563eb",
                        lineColor: "#94a3b8",
                        secondaryColor: "#8b5cf6",
                        secondaryTextColor: "#ffffff",
                        secondaryBorderColor: "#7c3aed",
                        tertiaryColor: "#10b981",
                        tertiaryTextColor: "#ffffff",
                        tertiaryBorderColor: "#059669",
                        background: "transparent",
                        mainBkg: "#1e293b",
                        nodeBorder: "#475569",
                        clusterBkg: "rgba(30, 41, 59, 0.6)",
                        clusterBorder: "rgba(100, 116, 139, 0.6)",
                        titleColor: "#f1f5f9",
                        edgeLabelBackground: "rgba(30, 41, 59, 0.95)",
                        fontFamily: "\"Inter\", ui-sans-serif, system-ui, -apple-system, sans-serif",
                        fontSize: "14px"
                    }
                });
                initializedRef.current = true;
            }

            const tempElement = document.createElement("div");
            try {
                await mermaidInstance.parse(normalizedCode);
                const id = `mermaid-${requestId}-${Date.now()}`;
                tempElement.id = id;
                document.body.appendChild(tempElement);
                const { svg: renderedSvg } = await mermaidInstance.render(id, normalizedCode);

                if (cancelled || requestId !== renderRequestIdRef.current) return;

                const styledSvg = renderedSvg.replace("<style>", `<style>${customStyles}`);
                setSvg(styledSvg);
                setError(null);
            } catch (renderError) {
                if (cancelled || requestId !== renderRequestIdRef.current) return;
                setSvg("");
                setError(formatMermaidError(renderError));
            } finally {
                if (document.body.contains(tempElement)) {
                    document.body.removeChild(tempElement);
                }
            }
        };

        const timeoutId = window.setTimeout(() => {
            void renderDiagram();
        }, RENDER_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
        };
    }, [code]);

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
                // Ignore SVG bbox failures and fall back to explicit dimensions.
            }
        }

        if (!width || !height) {
            width = Number.parseFloat(svgElement.getAttribute("width") || "0") || width;
            height = Number.parseFloat(svgElement.getAttribute("height") || "0") || height;
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

        if (Math.abs(nextZoom - currentZoom) < 0.0001) return;

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

    const handleWheel = useCallback((event: WheelEvent) => {
        if (!svg || error || showInspector) return;
        event.preventDefault();
        setHoveredNode(null);
        const scale = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
        zoomAroundPoint(event.clientX, event.clientY, scale);
    }, [error, showInspector, svg, zoomAroundPoint]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        container.addEventListener("wheel", handleWheel, { passive: false });
        return () => {
            container.removeEventListener("wheel", handleWheel);
        };
    }, [handleWheel]);

    const handleMouseDown = (event: React.MouseEvent) => {
        if (!svg || showInspector) return;
        setIsDragging(true);
        setDragStart({ x: event.clientX - pan.x, y: event.clientY - pan.y });
        dragOriginRef.current = { x: event.clientX, y: event.clientY };
        dragMovedRef.current = false;
    };

    const handleMouseMove = (event: React.MouseEvent) => {
        const target = event.target as Element | null;
        const nodeElement = target?.closest(".node");

        if (!isDragging && nodeElement && containerRef.current && !showInspector) {
            const label = extractNodeLabel(nodeElement);
            const id = extractNodeId(nodeElement, label || "node");
            if (label) {
                const rect = containerRef.current.getBoundingClientRect();
                setHoveredNode({
                    id,
                    label,
                    x: event.clientX - rect.left + 16,
                    y: event.clientY - rect.top + 16
                });
            } else {
                setHoveredNode(null);
            }
        } else if (!isDragging) {
            setHoveredNode(null);
        }

        if (isDragging) {
            const dx = event.clientX - dragOriginRef.current.x;
            const dy = event.clientY - dragOriginRef.current.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) {
                dragMovedRef.current = true;
            }
            setHoveredNode(null);
            setPan({ x: event.clientX - dragStart.x, y: event.clientY - dragStart.y });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleSvgClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (!onNodeSelect || showInspector) return;
        if (dragMovedRef.current) {
            dragMovedRef.current = false;
            return;
        }

        const target = event.target as Element | null;
        if (!target) return;
        const nodeElement = target.closest(".node");
        if (!nodeElement) return;

        const label = extractNodeLabel(nodeElement);
        if (!label) return;
        const id = extractNodeId(nodeElement, label);
        onNodeSelect({ id, label });
    }, [onNodeSelect, showInspector]);

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
        const blob = new Blob([svg], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `architecture-${Date.now()}.svg`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
    };

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
        <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
            <div
                className="pointer-events-none absolute inset-0 opacity-[0.03]"
                style={{
                    backgroundImage: `
                        linear-gradient(rgba(148, 163, 184, 0.5) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(148, 163, 184, 0.5) 1px, transparent 1px)
                    `,
                    backgroundSize: "40px 40px"
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
                        className="mermaid-container absolute left-1/2 top-1/2 origin-center transition-transform duration-75 ease-out"
                        style={{
                            transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`
                        }}
                        onClick={handleSvgClick}
                        dangerouslySetInnerHTML={{ __html: svg }}
                    />
                ) : error ? (
                    <div className="absolute inset-0 flex items-center justify-center p-6">
                        <div className="max-w-xl rounded-3xl border border-red-500/25 bg-slate-950/90 p-6 text-center shadow-2xl backdrop-blur">
                            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-red-400/25 bg-red-500/10 text-red-300">
                                <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-red-300/80">
                                {language === "zh" ? "Mermaid 渲染失败" : "Mermaid render failed"}
                            </p>
                            <p className="mt-3 text-base font-semibold text-slate-50">
                                {language === "zh"
                                    ? "当前架构图没有被自动替换。"
                                    : "The architecture diagram was not auto-replaced."}
                            </p>
                            <p className="mt-2 text-sm leading-6 text-slate-300">{error}</p>
                            {canInspect ? (
                                <button
                                    type="button"
                                    onClick={() => setShowInspector(true)}
                                    className="mt-5 rounded-2xl border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-200 transition-colors hover:bg-sky-500/20"
                                >
                                    {language === "zh" ? "查看结构数据" : "View structure data"}
                                </button>
                            ) : null}
                        </div>
                    </div>
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 pointer-events-none">
                        <div className="relative">
                            <svg className="mb-4 h-16 w-16 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                            </svg>
                            <div className="absolute inset-0 animate-ping">
                                <svg className="h-16 w-16 opacity-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                                </svg>
                            </div>
                        </div>
                        <p className="text-sm font-medium tracking-wide">
                            {language === "zh" ? "等待架构内容..." : "Waiting for architecture..."}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                            {language === "zh" ? "从你的想法开始描述" : "Start describing your idea"}
                        </p>
                    </div>
                )}

                {svg && hoveredNode && !isDragging && !showInspector && (
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

                {showInspector && canInspect && (
                    <div className="absolute inset-0 z-20 overflow-auto bg-slate-950/96 px-5 py-5 backdrop-blur-sm">
                        <div className="mx-auto flex max-w-6xl flex-col gap-4">
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-400/25 bg-slate-950/80 px-4 py-3 text-sm text-slate-200 shadow-xl">
                                <div>
                                    <div className="text-[11px] uppercase tracking-[0.18em] text-sky-300/75">
                                        {language === "zh" ? "结构检查面板" : "Structure inspector"}
                                    </div>
                                    <div className="mt-1 font-medium text-slate-50">
                                        {language === "zh"
                                            ? "这里展示的是驱动 Mermaid 的结构化架构数据。"
                                            : "This panel shows the structured architecture data that drives Mermaid."}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowInspector(false)}
                                    className="rounded-xl border border-slate-700/70 bg-slate-900/80 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800"
                                >
                                    {language === "zh" ? "关闭" : "Close"}
                                </button>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                {inspectorSections.map((section) => (
                                    <div
                                        key={section.id}
                                        className="rounded-3xl border border-slate-800/80 bg-slate-950/75 p-4 shadow-2xl shadow-slate-950/30 backdrop-blur"
                                    >
                                        <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-sky-300/75">
                                            {section.title}
                                        </div>
                                        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 px-3 py-3 text-sm font-semibold leading-6 text-slate-50">
                                            {section.summary}
                                        </div>
                                        <div className="mt-3 space-y-3">
                                            {section.items.map((item) => (
                                                <div
                                                    key={`${section.id}-${item}`}
                                                    className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-sm leading-6 text-slate-100"
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
                )}
            </div>

            {(svg || canInspect) && (
                <div className="absolute bottom-4 right-4 flex flex-col gap-2">
                    {canInspect ? (
                        <button
                            type="button"
                            onClick={() => setShowInspector((current) => !current)}
                            className="rounded-lg border border-slate-700/50 bg-slate-800/90 px-3 py-2 text-xs font-semibold text-slate-200 shadow-lg backdrop-blur-sm transition-colors hover:bg-slate-700/70"
                        >
                            {showInspector
                                ? language === "zh" ? "返回图视图" : "Back to diagram"
                                : language === "zh" ? "查看结构" : "View structure"}
                        </button>
                    ) : null}

                    {svg && !error ? (
                        <>
                            <div className="flex overflow-hidden rounded-lg border border-slate-700/50 bg-slate-800/90 shadow-lg backdrop-blur-sm">
                                <button
                                    onClick={handleZoomIn}
                                    className="p-2.5 text-slate-300 transition-colors hover:bg-slate-700/50 hover:text-white"
                                    title={language === "zh" ? "放大" : "Zoom In"}
                                >
                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                    </svg>
                                </button>
                                <div className="w-px bg-slate-700/50" />
                                <button
                                    onClick={handleZoomOut}
                                    className="p-2.5 text-slate-300 transition-colors hover:bg-slate-700/50 hover:text-white"
                                    title={language === "zh" ? "缩小" : "Zoom Out"}
                                >
                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 12H4" />
                                    </svg>
                                </button>
                                <div className="w-px bg-slate-700/50" />
                                <button
                                    onClick={handleReset}
                                    className="p-2.5 text-slate-300 transition-colors hover:bg-slate-700/50 hover:text-white"
                                    title={language === "zh" ? "重置视图" : "Reset View"}
                                >
                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                                    </svg>
                                </button>
                            </div>

                            <button
                                onClick={handleDownload}
                                className="self-end rounded-lg border border-slate-700/50 bg-slate-800/90 p-2.5 text-slate-300 shadow-lg backdrop-blur-sm transition-colors hover:bg-slate-700/50 hover:text-white"
                                title={language === "zh" ? "下载 SVG" : "Download SVG"}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" x2="12" y1="15" y2="3" />
                                </svg>
                            </button>
                        </>
                    ) : null}
                </div>
            )}

            {svg && !error && zoom !== 1 && (
                <div className="absolute bottom-4 left-4 rounded-lg border border-slate-700/50 bg-slate-800/90 px-3 py-1.5 text-xs font-mono text-slate-400 backdrop-blur-sm">
                    {Math.round(zoom * 100)}%
                </div>
            )}
        </div>
    );
}
