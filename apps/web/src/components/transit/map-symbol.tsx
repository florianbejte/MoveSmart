import type { CityLayerId } from "@/lib/transit/city";

export type MapSymbolKind = CityLayerId | "stop" | "community";
// The same vector paths are used in the map atlas, layer switches and legend.
const paths: Record<MapSymbolKind, string[]> = {
	community: ["M3 3h18v14H9l-6 4z", "M7 8h10", "M7 12h6"],
	stop: [
		"M6 3h12v15H6z",
		"M8 6h8v5H8z",
		"M8 14h1",
		"M15 14h1",
		"M8 18v3",
		"M16 18v3",
	],
	shelters: [
		"M12 3 21 7v6c0 5-9 9-9 9S3 18 3 13V7z",
		"M7 13l5-4 5 4",
		"M8 12v6h8v-6",
		"M11 18v-4h2v4",
	],
	signals: ["M8 2h8v18H8z", "M12 20v3", "M11 6h2", "M11 11h2", "M11 16h2"],
	roadworks: ["M5 20 10 3h4l5 17z", "M3 21h18", "M8 10h8", "M6 16h12"],
	restrictions: ["M7 3h10l4 4v10l-4 4H7l-4-4V7z", "M7 12h10"],
	incidents: ["M12 3 22 21H2z", "M12 9v5", "M12 17v1"],
	congestion: [
		"M3 10h18v9H3z",
		"M5 10l2-6h10l2 6",
		"M6 14h2",
		"M16 14h2",
		"M5 19v2",
		"M19 19v2",
	],
	parking: ["M7 21V3h6a6 6 0 0 1 0 12H7"],
	corridors: ["M3 8h17l-4-4", "M21 16H4l4 4"],
};

export function MapSymbol({
	kind,
	color,
}: {
	kind: MapSymbolKind;
	color: string;
}) {
	return (
		<svg
			className="map-symbol"
			viewBox="0 0 32 32"
			width="24"
			height="24"
			aria-hidden="true"
		>
			<rect
				x="1"
				y="1"
				width="30"
				height="30"
				rx="8"
				fill="white"
				stroke={color}
				strokeWidth="2"
			/>
			<g
				transform="translate(5 5) scale(.92)"
				fill="none"
				stroke={color}
				strokeWidth="1.9"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				{paths[kind].map((d) => (
					<path key={d} d={d} />
				))}
			</g>
		</svg>
	);
}

export function mapSymbolImage(
	kind: MapSymbolKind,
	color: string,
	selected = false,
) {
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = 64;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Map icons could not be drawn");
	ctx.scale(2, 2);
	ctx.beginPath();
	ctx.roundRect(1, 1, 30, 30, 8);
	ctx.fillStyle = selected ? color : "#ffffff";
	ctx.fill();
	ctx.strokeStyle = selected ? "#ffffff" : color;
	ctx.lineWidth = 2;
	ctx.stroke();
	ctx.translate(5, 5);
	ctx.scale(0.92, 0.92);
	ctx.lineWidth = 1.9;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	for (const d of paths[kind]) ctx.stroke(new Path2D(d));
	return ctx.getImageData(0, 0, 64, 64);
}
