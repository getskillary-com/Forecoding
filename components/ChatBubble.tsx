import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { FileText } from "lucide-react";
import { Message, MessageOption } from '@/types';

interface Props {
    message: Message;
    onOptionClick?: (option: MessageOption) => void;
    disableOptions?: boolean;
    isStreaming?: boolean;
}

export function ChatBubble({
    message,
    onOptionClick,
    disableOptions = false,
    isStreaming = false
}: Props) {
    const isUser = message.role === "user";
    const [showOptions, setShowOptions] = useState(
        !isStreaming && Boolean(message.options && message.options.length > 0)
    );

    useEffect(() => {
        if (!message.options || message.options.length === 0 || isStreaming) {
            setShowOptions(false);
            return;
        }

        const timer = window.setTimeout(() => {
            setShowOptions(true);
        }, 180);

        return () => {
            window.clearTimeout(timer);
        };
    }, [isStreaming, message.options]);

    return (
        <div className={`flex flex-col w-full ${isUser ? 'items-end' : 'items-start'}`}>
            <div
                className={`max-w-[80%] p-4 rounded-xl prose dark:prose-invert ${isUser
                    ? 'bg-blue-600 text-white rounded-tr-none'
                    : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-tl-none shadow-sm'
                    }`}
            >
                {/* Attachments Display */}
                {message.attachments && message.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                        {message.attachments.map((att, idx) => (
                            <div key={idx} className={`flex items-center gap-2 p-2 rounded-lg text-xs ${isUser ? 'bg-blue-700/50' : 'bg-gray-100 dark:bg-gray-700'}`}>
                                {att.type === 'image' ? (
                                    // Display image preview if it's an image
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={att.content} alt={att.name} className="w-16 h-16 object-cover rounded" />
                                ) : (
                                    <>
                                        {att.type === 'pdf' ? <FileText className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                                        <span className="truncate max-w-[150px]">{att.name}</span>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {isStreaming && !isUser ? (
                    <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-slate-900 dark:text-slate-100">
                        {message.content}
                        <span className="ml-1 inline-block h-5 w-0.5 animate-pulse rounded-full bg-blue-500 align-middle dark:bg-blue-300" />
                    </div>
                ) : (
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                )}
            </div>

            {message.options && message.options.length > 0 && (
                <div
                    className={`mt-3 max-w-[80%] transition-all duration-500 ${
                        showOptions
                            ? 'translate-y-0 opacity-100'
                            : 'pointer-events-none translate-y-3 opacity-0'
                    }`}
                >
                    <div className="relative overflow-hidden rounded-2xl border border-blue-100/80 bg-gradient-to-b from-blue-50/95 via-white to-white p-3 shadow-sm dark:border-blue-900/40 dark:from-blue-950/35 dark:via-slate-900 dark:to-slate-900">
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-blue-200/45 via-blue-100/10 to-transparent dark:from-blue-500/10 dark:via-blue-400/5" />
                        <div className="relative grid grid-cols-1 gap-2 md:grid-cols-2">
                            {message.options.map((opt, idx) => {
                                const isDisabled =
                                    disableOptions ||
                                    opt.stale === true ||
                                    message.questionStatus === "answered" ||
                                    message.questionStatus === "stale";
                                return (
                                    <button
                                        key={idx}
                                        type="button"
                                        onClick={() => onOptionClick?.(opt)}
                                        disabled={isDisabled}
                                        className={`text-left p-3 text-sm border rounded-xl transition-all duration-200 shadow-sm font-medium ${
                                            isDisabled
                                                ? 'bg-gray-100 dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                                                : 'bg-white/95 dark:bg-slate-800/95 border-blue-200 dark:border-blue-900 hover:-translate-y-0.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-700 dark:text-blue-300'
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
                                                    <span className="font-bold mr-2">{prefix}</span>
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
    );
}
