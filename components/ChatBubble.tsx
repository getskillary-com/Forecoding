import { FileText, Image as ImageIcon } from "lucide-react";
import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Message } from '@/types';

interface Props {
    message: Message;
    onOptionClick?: (value: string) => void;
}

export function ChatBubble({ message, onOptionClick }: Props) {
    const isUser = message.role === "user";
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

                <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>

            {message.options && message.options.length > 0 && (
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 max-w-[80%] animate-in fade-in slide-in-from-top-2">
                    {message.options.map((opt, idx) => (
                        <button
                            key={idx}
                            onClick={() => onOptionClick?.(opt.value)}
                            className="text-left p-3 text-sm bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-900 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors shadow-sm text-blue-700 dark:text-blue-300 font-medium"
                        >
                            {(() => {
                                const normalizedLabel = opt.label.trim();
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
                    ))}
                </div>
            )}
        </div>
    );
}
