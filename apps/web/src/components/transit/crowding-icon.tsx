"use client";
import { useT } from "@/lib/i18n/react";
import type { Crowding } from "@/lib/reports/types";

/** Go Vilnius palette: green when there is room, amber when standing, Iconic Red when packed. */
const LEVELS = [
	{ label: "Quiet", color: "#3d9a3a" },
	{ label: "Busy", color: "#f0a000" },
	{ label: "Packed", color: "#ed1c24" },
] as const;
const FROM_REPORT: Record<Crowding, number> = {
	seats: 0.15,
	standing: 0.6,
	full: 0.95,
};

export const crowdLevel = (q: number) => (q < 0.4 ? 0 : q < 0.75 ? 1 : 2);

/**
 * A row of three passengers: the more of them are coloured in, the fuller the bus. The colour
 * carries the level at a glance; the label stays available to screen readers and as a tooltip.
 */
export function CrowdingIcon({
	value,
	level,
	size = 30,
	showLabel = false,
}: {
	/** 0–1 expected crowding, or a rider report level. */
	value?: number;
	level?: Crowding;
	/** Height of a passenger figure in pixels. */
	size?: number;
	showLabel?: boolean;
}) {
	const t = useT();
	const q = value ?? (level ? FROM_REPORT[level] : 0);
	const index = crowdLevel(q);
	const { label, color } = LEVELS[index];
	const filled = index + 1;
	return (
		<span
			className="crowding-icon"
			role="img"
			aria-label={t(`Crowding: ${label}`)}
			title={t(label)}
			style={{ color }}
		>
			<svg
				width={size * 1.95}
				height={size}
				viewBox="0 0 39 20"
				aria-hidden="true"
			>
				{[0, 1, 2].map((i) => (
					<g
						key={i}
						transform={`translate(${i * 13} 0)`}
						fill={i < filled ? "currentColor" : "#d5d8e2"}
					>
						<circle cx="6" cy="4" r="3.6" />
						<path d="M0.5 20v-6.2C0.5 10.4 3 8.6 6 8.6s5.5 1.8 5.5 5.2V20z" />
					</g>
				))}
			</svg>
			{showLabel && <span className="crowding-icon-label">{t(label)}</span>}
		</span>
	);
}
