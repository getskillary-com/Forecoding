type RoutePendingStateProps = {
    label: string;
};

export function RoutePendingState({ label }: RoutePendingStateProps) {
    return (
        <div className="flex min-h-screen items-center justify-center px-6">
            <div className="inline-flex items-center gap-3 rounded-full border border-[color:var(--border)] bg-white/82 px-4 py-2 text-sm text-slate-500 shadow-[var(--shadow-sm)] backdrop-blur-sm dark:bg-slate-900/78 dark:text-slate-300">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-500 dark:border-slate-700 dark:border-t-blue-400" />
                <span>{label}</span>
            </div>
        </div>
    );
}
