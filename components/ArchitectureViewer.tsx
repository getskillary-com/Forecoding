
"use client";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from "lucide-react";

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

function sanitizeMermaidCode(input: string) {
    const normalizedSource = input
        .replace(/```mermaid\s*/gi, "")
        .replace(/```/g, "")
        .replace(/\r/g, "")
        .replace(/\uFF08/g, "(")
        .replace(/\uFF09/g, ")")
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

        // Repair malformed edge separators like: A -------- B
        const fixedEdgeSeparator = line.replace(/(\b[A-Za-z][\w-]*\b)\s*-{3,}\s*(\b[A-Za-z][\w-]*\b)/g, "$1 --> $2");
        if (fixedEdgeSeparator !== line) changed = true;
        line = fixedEdgeSeparator;

        // Repair missing connectors between adjacent node declarations: A[...] B[...]
        const fixedAdjacentNodes = line.replace(/\]\s+([A-Za-z][\w-]*\s*\[)/g, "] --> $1");
        if (fixedAdjacentNodes !== line) changed = true;
        line = fixedAdjacentNodes;

        const match = line.match(/^(\s*)subgraph\s+(.+?)\s*\[(.+)\]\s*$/);
        if (match) {
            const indent = match[1] || "";
            const idPart = match[2].trim();
            const label = normalizeLabel(match[3].trim());
            if (label !== match[3].trim()) changed = true;
            return `${indent}subgraph ${idPart}["${label}"]`;
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
};

export default function ArchitectureViewer({ code, onNodeSelect }: ArchitectureViewerProps) {
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
        if (isDragging) {
            const dx = e.clientX - dragOriginRef.current.x;
            const dy = e.clientY - dragOriginRef.current.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) {
                dragMovedRef.current = true;
            }
            setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleZoomIn = () => setZoom(z => Math.min(z * 1.2, 5));
    const handleZoomOut = () => setZoom(z => Math.max(z * 0.8, 0.1));
    const handleReset = () => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    };
    const toggleExpanded = () => setIsExpanded((current) => !current);

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

    return (
        <div
            ref={viewerRef}
            className={`w-full h-full flex flex-col relative bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 shadow-inner overflow-hidden border border-slate-800/50 ${
                isExpanded
                    ? "fixed inset-0 z-[120] rounded-none border-none"
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
                        title={isExpanded ? "Restore view" : "Expand to fullscreen"}
                        aria-label={isExpanded ? "Restore view" : "Expand to fullscreen"}
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
                onMouseLeave={handleMouseUp}
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
                        <p className="font-semibold mb-1">Rendering Error</p>
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
                        <p className="text-sm font-medium tracking-wide">Waiting for architecture...</p>
                        <p className="text-xs text-slate-600 mt-1">Start describing your idea</p>
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
                        <button onClick={handleZoomIn} className="p-2.5 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors" title="Zoom In">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                        </button>
                        <div className="w-px bg-slate-700/50" />
                        <button onClick={handleZoomOut} className="p-2.5 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors" title="Zoom Out">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 12H4"></path></svg>
                        </button>
                        <div className="w-px bg-slate-700/50" />
                        <button onClick={handleReset} className="p-2.5 text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors" title="Reset View">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>
                        </button>
                    </div>

                    <button
                        onClick={handleDownload}
                        className="p-2.5 bg-slate-800/90 backdrop-blur-sm text-slate-300 rounded-lg shadow-lg hover:bg-slate-700/50 hover:text-white transition-colors border border-slate-700/50 self-end"
                        title="Download SVG"
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





