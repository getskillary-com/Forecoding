
"use client";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from "lucide-react";
import type { WorkspaceLanguage } from "@/lib/project-language";

// Custom CSS styles to inject into the SVG for enhanced visuals
const customStyles = `
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
    .node rect, .node polygon, .node circle, .node ellipse {
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
    }
    
    /* Code-like elements (detect by content pattern) */
    .node .label text:contains('.') {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
    }
    
    /* Arrowheads */
    marker path {
        fill: #94a3b8 !important;
    }
`;

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

type ArchitectureViewerProps = {
    code: string;
    onNodeSelect?: (node: { id: string; label: string }) => void;
    language: WorkspaceLanguage;
};

type HoveredNodeState = {
    id: string;
    label: string;
    x: number;
    y: number;
} | null;

export default function ArchitectureViewer({ code, onNodeSelect, language }: ArchitectureViewerProps) {
    const [svg, setSvg] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [warning, setWarning] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [hoveredNode, setHoveredNode] = useState<HoveredNodeState>(null);
    const dragOriginRef = useRef({ x: 0, y: 0 });
    const dragMovedRef = useRef(false);
    const mermaidRef = useRef<typeof import('mermaid').default | null>(null);
    const initializedRef = useRef(false);
    const hasRenderedRef = useRef(false);

    useEffect(() => {
        let cancelled = false;

        const initAndRender = async () => {
            if (!code || typeof document === 'undefined') return;
            let autoCorrected = false;

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
                    securityLevel: 'loose',
                    flowchart: {
                        htmlLabels: true,
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

            // Validate syntax first to avoid mermaid injecting error popups into the DOM
            let renderCode = code;
            try {
                await mermaidInstance.parse(code);
            } catch (parseError) {
                const sanitized = sanitizeMermaidCode(code);
                if (sanitized.changed) {
                    try {
                        await mermaidInstance.parse(sanitized.code);
                        renderCode = sanitized.code;
                        autoCorrected = true;
                    } catch (sanitizedError) {
                        if (cancelled) return;
                        const message = formatMermaidError(sanitizedError);
                        if (hasRenderedRef.current) {
                            setWarning(`Using last valid diagram: ${message}`);
                            return;
                        }
                        setError(message);
                        setWarning(null);
                        return;
                    }
                } else {
                    if (cancelled) return;
                    const message = formatMermaidError(parseError);
                    if (hasRenderedRef.current) {
                        setWarning(`Using last valid diagram: ${message}`);
                        return;
                    }
                    setError(message);
                    setWarning(null);
                    return;
                }
            }

            const tempElement = document.createElement('div');
            try {
                const id = `mermaid-${Date.now()}`;
                tempElement.id = id;
                document.body.appendChild(tempElement);

                const { svg: newSvg } = await mermaidInstance.render(id, renderCode);

                if (cancelled) return;

                const styledSvg = newSvg.replace(
                    '<style>',
                    `<style>${customStyles}`
                );

                setSvg(styledSvg);
                setError(null);
                setWarning(autoCorrected ? "Diagram had syntax issues and was auto-corrected." : null);
                hasRenderedRef.current = true;
            } catch (renderError) {
                if (cancelled) return;
                console.debug("Mermaid render error:", renderError);
                const message = formatMermaidError(renderError);
                if (hasRenderedRef.current) {
                    setWarning(`Using last valid diagram: ${message}`);
                    return;
                }
                setError(message);
                setWarning(null);
            } finally {
                if (document.body.contains(tempElement)) {
                    document.body.removeChild(tempElement);
                }
            }
        };

        initAndRender();

        return () => { cancelled = true; };
    }, [code]);

    useEffect(() => {
        if (!isExpanded || typeof document === "undefined") return;

        const previousOverflow = document.body.style.overflow;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setIsExpanded(false);
            }
        };

        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [isExpanded]);

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
        const paddingFactor = isExpanded ? 0.9 : 0.84;
        const fitScale = Math.min(
            (containerWidth * paddingFactor) / width,
            (containerHeight * paddingFactor) / height
        );

        const nextZoom = Number.isFinite(fitScale)
            ? Math.min(Math.max(fitScale, 0.35), 1.4)
            : 1;

        setZoom(nextZoom);
        setPan({ x: 0, y: 0 });
    }, [isExpanded]);

    useEffect(() => {
        if (!svg || error || typeof window === "undefined") return;

        const raf = window.requestAnimationFrame(() => {
            fitDiagramToViewport();
        });

        return () => {
            window.cancelAnimationFrame(raf);
        };
    }, [svg, error, isExpanded, fitDiagramToViewport]);

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

    const handleWheel = (e: React.WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const scale = e.deltaY > 0 ? 0.9 : 1.1;
            setZoom(z => Math.min(Math.max(z * scale, 0.1), 5));
        }
    };

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

    const handleZoomIn = () => setZoom(z => Math.min(z * 1.2, 5));
    const handleZoomOut = () => setZoom(z => Math.max(z * 0.8, 0.1));
    const handleReset = () => {
        setHoveredNode(null);
        fitDiagramToViewport();
    };
    const toggleExpanded = () => {
        setHoveredNode(null);
        setIsExpanded((current) => !current);
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
            ref={viewerRef}
            className={`w-full h-full flex flex-col relative bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 shadow-inner overflow-hidden border border-slate-800/50 ${
                isExpanded
                    ? "fixed inset-0 z-[140] rounded-none border-none bg-slate-950/95"
                    : "rounded-xl"
            }`}
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

            {svg && !error && (
                <div className="absolute left-4 top-4 z-20">
                    <button
                        onClick={toggleExpanded}
                        className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-700/60 bg-slate-900/90 text-slate-200 shadow-lg backdrop-blur-sm transition-colors hover:bg-slate-800 hover:text-white"
                        title={isExpanded
                            ? (language === "zh" ? "恢复视图" : "Restore view")
                            : (language === "zh" ? "全屏展开" : "Expand to fullscreen")}
                        aria-label={isExpanded
                            ? (language === "zh" ? "恢复视图" : "Restore view")
                            : (language === "zh" ? "全屏展开" : "Expand to fullscreen")}
                    >
                        {isExpanded ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
                    </button>
                </div>
            )}

            <div
                className="flex-1 overflow-hidden relative cursor-grab active:cursor-grabbing"
                ref={containerRef}
                onWheel={handleWheel}
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





