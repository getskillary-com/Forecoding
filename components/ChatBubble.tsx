import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, Sparkles } from "lucide-react";
import { Message, MessageOption } from '@/types';

interface Props {
    message: Message;
    onOptionClick?: (option: MessageOption) => void;
    disableOptions?: boolean;
    isStreaming?: boolean;
}

const markdownBodyClassName = "max-w-none text-[13px] leading-5 break-words text-inherit [&_ol]:my-2 [&_p]:my-0 [&_p+ol]:mt-2 [&_p+p]:mt-2 [&_p+ul]:mt-2 [&_pre]:overflow-x-auto [&_ul]:my-2 [&_li]:my-0.5";
const STREAMING_ROW_CHAR_LIMIT = 44;
const STREAMING_ROW_HEIGHT_REM = 1.3;

function estimateStreamingRows(content: string) {
    const normalized = content.replace(/\r\n/g, "\n");
    const lines = normalized.length > 0 ? normalized.split("\n") : [""];

    return Math.max(1, lines.reduce((total, line) => {
        const visibleLength = Math.max(1, line.trimEnd().length);
        return total + Math.max(1, Math.ceil(visibleLength / STREAMING_ROW_CHAR_LIMIT));
    }, 0));
}

export const ChatBubble = memo(function ChatBubble({
    message,
    onOptionClick,
    disableOptions = false,
    isStreaming = false
}: Props) {
    const isUser = message.role === "user";
    const isSystem = !isUser && message.kind === "system";
    const widthClassName = isUser
        ? "max-w-[80%]"
        : "w-full max-w-[calc(100%-2rem)] sm:max-w-[80%] xl:max-w-[48rem]";
    const streamingRows = !isUser && isStreaming ? estimateStreamingRows(message.content) : 1;
    const showOptions = !isStreaming && Boolean(message.options && message.options.length > 0);

    return (
        <div className={`flex flex-col w-full ${isUser ? 'items-end' : 'items-start'}`}>
            <div className={widthClassName}>
                {isSystem && (
                    <div className="mb-2 inline-flex items-center gap-1 rounded-full border border-amber-200/80 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
                        <Sparkles className="h-3 w-3" />
                        <span>系统引导</span>
                    </div>
                )}
                <div
                    className={`rounded-xl p-4 ${isUser
                        ? 'bg-blue-600 text-white rounded-tr-none'
                        : isSystem
                            ? 'bg-amber-50/90 text-amber-950 border border-amber-200/80 dark:bg-amber-900/20 dark:text-amber-50 dark:border-amber-700/40 rounded-tl-none shadow-sm'
                            : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-tl-none shadow-sm'
                        }`}
                >
                    {/* Attachments Display */}
                    {message.attachments && message.attachments.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-2">
                            {message.attachments.map((att, idx) => (
                                <div key={idx} className={`flex items-center gap-2 rounded-lg p-2 text-xs ${isUser ? 'bg-blue-700/50' : 'bg-gray-100 dark:bg-gray-700'}`}>
                                    {att.type === 'image' ? (
                                        // Display image preview if it's an image
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={att.content} alt={att.name} className="h-16 w-16 rounded object-cover" />
                                    ) : (
                                        <>
                                            {att.type === 'pdf' ? <FileText className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                                            <span className="max-w-[150px] truncate">{att.name}</span>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {isStreaming && !isUser ? (
                        <div
                            className={`${markdownBodyClassName} overflow-hidden whitespace-pre-wrap transition-[max-height] duration-300 ease-out`}
                            style={{
                                minHeight: `${STREAMING_ROW_HEIGHT_REM}rem`,
                                maxHeight: `${streamingRows * STREAMING_ROW_HEIGHT_REM + 0.35}rem`
                            }}
                        >
                            {message.content}
                            <span className="ml-1 inline-block h-5 w-0.5 animate-pulse rounded-full bg-blue-500 align-middle dark:bg-blue-300" />
                        </div>
                    ) : (
                        <div className={`${markdownBodyClassName} prose prose-slate dark:prose-invert`}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                        </div>
                    )}
                </div>

                {showOptions && message.options && message.options.length > 0 && (
                    <div className="mt-3">
                        <div className={`relative overflow-hidden rounded-2xl p-3 shadow-sm ${
                            isSystem
                                ? 'border border-amber-200/80 bg-gradient-to-b from-amber-50/95 via-white to-white dark:border-amber-700/40 dark:from-amber-900/15 dark:via-slate-900 dark:to-slate-900'
                                : 'border border-blue-100/80 bg-gradient-to-b from-blue-50/95 via-white to-white dark:border-blue-900/40 dark:from-blue-950/35 dark:via-slate-900 dark:to-slate-900'
                        }`}>
                            <div className={`pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b ${
                                isSystem
                                    ? 'from-amber-200/45 via-amber-100/10 to-transparent dark:from-amber-500/10 dark:via-amber-400/5'
                                    : 'from-blue-200/45 via-blue-100/10 to-transparent dark:from-blue-500/10 dark:via-blue-400/5'
                            }`} />
                            <div className="relative grid grid-cols-1 gap-2 md:grid-cols-2">
                                {message.options.map((opt, idx) => {
                                    const isDisabled =
                                                disableOptions ||
                                                opt.stale === true ||
                                                message.questionStatus === "answered" ||
                                                message.questionStatus === "stale";
                                    const enabledClassName = isSystem
                                        ? 'bg-white/95 dark:bg-slate-800/95 border-amber-200 dark:border-amber-700/40 hover:-translate-y-0.5 hover:bg-amber-50 dark:hover:bg-amber-900/25 text-amber-800 dark:text-amber-200'
                                        : 'bg-white/95 dark:bg-slate-800/95 border-blue-200 dark:border-blue-900 hover:-translate-y-0.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-700 dark:text-blue-300';
                                    return (
                                        <button
                                            key={idx}
                                            type="button"
                                            onClick={() => onOptionClick?.(opt)}
                                            disabled={isDisabled}
                                            className={`text-left p-3 text-[13px] border rounded-xl transition-all duration-200 shadow-sm font-medium ${
                                                isDisabled
                                                    ? 'bg-gray-100 dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                                                    : enabledClassName
                                            }`}
                                        >
                                            {(() => {
                                                const normalizedLabel = (opt.label || opt.value || "").trim();
                                                const match = normalizedLabel.match(/^([A-Za-z]|\d+)[.)]\s+(.+)$/);
                                                if (!match) return normalizedLabel;

                                                const prefix = `${match[1]})`;
                                                const body = match[2].trim();
                                                return (
                                                    <>
                                                        <span className="mr-2 font-bold">{prefix}</span>
                                                        {body}
                                                    </>
                                                );
                                            })()}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
});

ChatBubble.displayName = "ChatBubble";
