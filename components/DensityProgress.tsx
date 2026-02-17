
import React from 'react';
import { getProgressColor, getProgressLabel } from "@/lib/scoring";

interface Props {
    score: number;
}

export function DensityProgress({ score }: Props) {
    const color = getProgressColor(score);
    const label = getProgressLabel(score);
    return (
        <div className="w-full flex flex-col gap-2 p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex justify-between text-sm font-medium text-gray-700 dark:text-gray-200">
                <span>Information Density</span>
                <span className="font-bold">{score}/100</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700 overflow-hidden">
                <div
                    className={`h-2.5 rounded-full transition-all duration-500 ease-out ${color}`}
                    style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
                ></div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 italic text-right">{label}</p>
        </div>
    );
}
