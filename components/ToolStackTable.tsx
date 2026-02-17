
"use client";

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
    content: string;
}

export function ToolStackTable({ content }: Props) {
    return (
        <div className="w-full overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
            <h3 className="text-lg font-semibold mb-4">Recommended Tool Stack</h3>
            <div className="prose dark:prose-invert max-w-none">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                        table: ({ ...props }) => <table className="w-full border-collapse text-left text-sm" {...props} />,
                        thead: ({ ...props }) => <thead className="bg-gray-50 dark:bg-gray-700/50" {...props} />,
                        tr: ({ ...props }) => <tr className="border-b border-gray-100 dark:border-gray-700 last:border-0" {...props} />,
                        th: ({ ...props }) => <th className="px-4 py-3 font-semibold text-gray-900 dark:text-gray-100" {...props} />,
                        td: ({ ...props }) => <td className="px-4 py-3 text-gray-600 dark:text-gray-300" {...props} />,
                    }}
                >
                    {content}
                </ReactMarkdown>
            </div>
        </div>
    );
}
