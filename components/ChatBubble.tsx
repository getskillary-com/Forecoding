import React, { memo, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText } from "lucide-react";
import { Message, MessageOption } from '@/types';

interface Props {
    message: Message;
    onOptionClick?: (option: MessageOption) => void;
    disableOptions?: boolean;
    isStreaming?: boolean;
}

const markdownBodyClassName = "max-w-none text-[15px] leading-7 break-words text-inherit [&_ol]:my-3 [&_p]:my-0 [&_p+ol]:mt-3 [&_p+p]:mt-3 [&_p+ul]:mt-3 [&_pre]:overflow-x-auto [&_ul]:my-3 [&_li]:my-1";

export const ChatBubble = memo(function ChatBubble({
    message,
    onOptionClick,
    disableOptions = false,
    isStreaming = false
}: Props) {
    const isUser = message.role === "user";
    const widthClassName = isUser
        ? "max-w-[80%]"
        : "w-full max-w-[calc(100%-2rem)] sm:max-w-[80%] xl:max-w-[48rem]";
    const [showOptions, setShowOptions] = useState(
        !isStreaming && Boolean(message.options && message.options.length > 0)
    );

    useEffect(() => {
        if (!message.options || message.options.length === 0 || isStreaming || showOptions) {
            return;
        }

        const timer = window.setTimeout(() => {
            setShowOptions(true);
        }, 180);

        return () => {
            window.clearTimeout(timer);
        };
    }, [isStreaming, message.options, showOptions]);

    return (
        <div className={`flex flex-col w-full ${isUser ? 'items-end' : 'items-start'}`}>
            <div className={widthClassName}>
                <div
                    className={`rounded-xl p-4 ${isUser
                        ? 'bg-blue-600 text-white rounded-tr-none'
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
                        <div className={`${markdownBodyClassName} whitespace-pre-wrap`}>
                            {message.content}
                            <span className="ml-1 inline-block h-5 w-0.5 animate-pulse rounded-full bg-blue-500 align-middle dark:bg-blue-300" />
                        </div>
                    ) : (
                        <div className={`${markdownBodyClassName} prose prose-slate dark:prose-invert`}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                        </div>
                    )}
                </div>

                {message.options && message.options.length > 0 && (
                    <div
                        className={`mt-3 transition-[opacity,transform] duration-500 ${
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
