
"use client";
import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { MermaidAPI } from 'mermaid';

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
    const lines = input.split("\n");
    let changed = false;

    const sanitizedLines = lines.map((line) => {
        const match = line.match(/^(\s*)subgraph\s+(.+?)\s*\[(.+)\]\s*$/);
        if (!match) return line;

        const indent = match[1] || "";
        const idPart = match[2].trim();
        let label = match[3].trim();

        // Mermaid is sensitive to parentheses in subgraph labels; normalize them away.
        const cleaned = label.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
        if (cleaned !== label) changed = true;
        label = cleaned.replace(/"/g, "'");

        return `${indent}subgraph ${idPart}["${label}"]`;
    });

    return {
        changed,
        code: sanitizedLines.join("\n")
    };
}

export default function ArchitectureViewer({ code }: { code: string }) {
    const [svg, setSvg] = useState('');
    const [error, setError] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const mermaidRef = useRef<typeof import('mermaid').default | null>(null);
    const initializedRef = useRef(false);

    useEffect(() => {
        let cancelled = false;

        const initAndRender = async () => {
            if (!code || typeof document === 'undefined') return;

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
                    } catch (sanitizedError) {
                        if (!cancelled) setError(formatMermaidError(sanitizedError));
                        return;
                    }
                } else {
                    if (!cancelled) setError(formatMermaidError(parseError));
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
            } catch (renderError) {
                if (cancelled) return;
                console.debug("Mermaid render error:", renderError);
                setError(formatMermaidError(renderError));
            } finally {
                if (document.body.contains(tempElement)) {
                    document.body.removeChild(tempElement);
                }
            }
        };

        initAndRender();

        return () => { cancelled = true; };
    }, [code]);

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
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDragging) {
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

    return (
        <div className="w-full h-full flex flex-col relative bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 rounded-xl shadow-inner overflow-hidden border border-slate-800/50">
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
                className="flex-1 overflow-hidden relative cursor-grab active:cursor-grabbing"
                ref={containerRef}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                {error ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 pointer-events-none">
                        <svg className="w-12 h-12 mb-2 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                        <p className="font-semibold mb-1">Rendering Error</p>
                        <p className="text-xs opacity-80 max-w-xs text-center">{error}</p>
                    </div>
                ) : svg ? (
                    <div
                        className="absolute top-1/2 left-1/2 origin-center transition-transform duration-75 ease-out mermaid-container"
                        style={{
                            transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
                        }}
                        dangerouslySetInnerHTML={{ __html: svg }}
                    />
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

