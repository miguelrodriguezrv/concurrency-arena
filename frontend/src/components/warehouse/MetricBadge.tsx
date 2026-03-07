import React from "react";

export type MetricBadgeProps = {
    label: string;
    value: string | number;
    icon?: React.ReactNode;
    tooltip?: string;
    /**
     * Tailwind color class to apply to the value text (e.g. "text-emerald-400").
     * Defaults to a neutral light color matching the visual style.
     */
    colorClass?: string;
    /**
     * Additional classes to apply to the outer container for small layout tweaks.
     */
    className?: string;
};

/**
 * Compact, accessible inline metric badge used inside the Arena visualizer.
 * Keeps markup minimal so it can be dropped next to labels or inside components.
 */
export default function MetricBadge({
    label,
    value,
    icon,
    tooltip,
    colorClass = "text-zinc-100",
    className = "",
}: MetricBadgeProps) {
    const display = typeof value === "number" ? value.toString() : value;

    return (
        <div
            role="status"
            aria-label={`${label}: ${display}`}
            title={tooltip ?? `${label}: ${display}`}
            tabIndex={0}
            className={`inline-flex items-center gap-2 bg-zinc-900 border border-zinc-800 text-[11px] px-2 py-1 rounded-md ${className}`}
        >
            {icon && <span className="opacity-80">{icon}</span>}
            <span className={`font-mono leading-none ${colorClass}`}>{display}</span>
        </div>
    );
}
