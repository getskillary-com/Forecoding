
export const SCORING_WEIGHTS = {
    role: 0.2,
    flow: 0.3,
    tech: 0.3,
    constraints: 0.2,
};

export const THRESHOLD_READY = 80;

export function getProgressColor(score: number): string {
    if (score < 50) return "bg-red-500";
    if (score < 80) return "bg-yellow-500";
    return "bg-green-500";
}

export function getProgressLabel(score: number): string {
    if (score < 50) return "Low Readiness (Need more detail)";
    if (score < 80) return "Medium Readiness (Getting closer)";
    return "High Readiness (Ready to Launch)";
}
