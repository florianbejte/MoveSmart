"use client";

import * as maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { ENV } from "@/env";
import type { Position, Vehicle } from "@/lib/transit/types";

type Segment = {
	kind: "walk" | "ride";
	color: string;
	coordinates: number[][];
};
const EMPTY = { type: "FeatureCollection" as const, features: [] };

/** Map for a shared trip: the route, the traveller's live position and their bus. */
export default function SharedTripMap({
	path,
	from,
	to,
	position,
	buses,
	follow,
}: {
	path: Segment[];
	from: Position;
	to: Position;
	position: (Position & { accuracy: number }) | null;
	buses: Vehicle[];
	follow: boolean;
}) {
	const container = useRef<HTMLElement>(null);
	const map = useRef<maplibregl.Map | null>(null);
	const person = useRef<maplibregl.Marker | null>(null);
	const busMarkers = useRef(new Map<string, maplibregl.Marker>());
	const [ready, setReady] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the map is created once.
	useEffect(() => {
		if (!container.current) return;
		maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
		const instance = new maplibregl.Map({
			container: container.current,
			center: [to.lon, to.lat],
			zoom: 13,
			attributionControl: false,
			style: {
				version: 8,
				sources: {
					osm: {
						type: "raster",
						tiles: [
							ENV.NEXT_PUBLIC_MAP_TILE_URL ||
								"https://tile.openstreetmap.org/{z}/{x}/{y}.png",
						],
						tileSize: 256,
						maxzoom: 19,
						attribution:
							ENV.NEXT_PUBLIC_MAP_ATTRIBUTION ||
							'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
					},
				},
				layers: [
					{
						id: "osm",
						type: "raster",
						source: "osm",
						paint: { "raster-saturation": -0.55 },
					},
				],
			},
		});
		instance.addControl(
			new maplibregl.NavigationControl({ showCompass: false }),
			"top-right",
		);
		instance.addControl(
			new maplibregl.AttributionControl({ compact: true }),
			"bottom-right",
		);
		instance.on("load", () => {
			instance.addSource("route", { type: "geojson", data: EMPTY });
			instance.addLayer({
				id: "route-outline",
				type: "line",
				source: "route",
				layout: { "line-cap": "round", "line-join": "round" },
				paint: { "line-color": "#ffffff", "line-width": 10 },
			});
			instance.addLayer({
				id: "route-ride",
				type: "line",
				source: "route",
				filter: ["==", ["get", "kind"], "ride"],
				layout: { "line-cap": "round", "line-join": "round" },
				paint: { "line-color": ["get", "color"], "line-width": 6 },
			});
			instance.addLayer({
				id: "route-walk",
				type: "line",
				source: "route",
				filter: ["==", ["get", "kind"], "walk"],
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": ["get", "color"],
					"line-width": 4,
					"line-dasharray": [0.1, 2],
				},
			});
			instance.addSource("ends", { type: "geojson", data: EMPTY });
			instance.addLayer({
				id: "ends",
				type: "circle",
				source: "ends",
				paint: {
					"circle-radius": 8,
					"circle-color": ["match", ["get", "end"], "to", "#ed1c24", "#ffffff"],
					"circle-stroke-color": [
						"match",
						["get", "end"],
						"to",
						"#ffffff",
						"#414454",
					],
					"circle-stroke-width": 3,
				},
			});
			setReady(true);
		});
		map.current = instance;
		const observer = new ResizeObserver(() => instance.resize());
		observer.observe(container.current);
		return () => {
			observer.disconnect();
			instance.remove();
			map.current = null;
			person.current = null;
			busMarkers.current.clear();
		};
	}, []);
	// Route and endpoints, fitted once when they arrive.
	// biome-ignore lint/correctness/useExhaustiveDependencies: path only changes when the trip does.
	useEffect(() => {
		if (!ready || !map.current) return;
		(map.current.getSource("route") as maplibregl.GeoJSONSource).setData({
			type: "FeatureCollection",
			features: path.map((s) => ({
				type: "Feature",
				properties: { kind: s.kind, color: s.color },
				geometry: { type: "LineString", coordinates: s.coordinates },
			})),
		});
		(map.current.getSource("ends") as maplibregl.GeoJSONSource).setData({
			type: "FeatureCollection",
			features: (["from", "to"] as const).map((end) => {
				const p = end === "from" ? from : to;
				return {
					type: "Feature",
					properties: { end },
					geometry: { type: "Point", coordinates: [p.lon, p.lat] },
				};
			}),
		});
		const bounds = new maplibregl.LngLatBounds(
			[from.lon, from.lat],
			[from.lon, from.lat],
		);
		bounds.extend([to.lon, to.lat]);
		for (const s of path)
			for (const c of s.coordinates) bounds.extend(c as [number, number]);
		map.current.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 0 });
	}, [ready, path.length]);
	// The traveller: a pulsing dot that the map follows if asked.
	useEffect(() => {
		if (!ready || !map.current) return;
		if (!position) {
			person.current?.remove();
			person.current = null;
			return;
		}
		if (!person.current) {
			const el = document.createElement("div");
			el.className = "shared-person";
			el.setAttribute("aria-label", "Live location");
			person.current = new maplibregl.Marker({ element: el })
				.setLngLat([position.lon, position.lat])
				.addTo(map.current);
		}
		person.current.setLngLat([position.lon, position.lat]);
		if (follow)
			map.current.easeTo({
				center: [position.lon, position.lat],
				duration: 800,
			});
	}, [ready, position, follow]);
	// The bus (or buses) on this trip.
	useEffect(() => {
		if (!ready || !map.current) return;
		const ids = new Set(buses.map((b) => b.id));
		for (const [id, marker] of busMarkers.current)
			if (!ids.has(id)) {
				marker.remove();
				busMarkers.current.delete(id);
			}
		for (const bus of buses) {
			let marker = busMarkers.current.get(bus.id);
			if (!marker) {
				const el = document.createElement("div");
				el.className = "shared-bus";
				marker = new maplibregl.Marker({ element: el })
					.setLngLat([bus.lon, bus.lat])
					.addTo(map.current);
				busMarkers.current.set(bus.id, marker);
			}
			marker.setLngLat([bus.lon, bus.lat]);
			marker.getElement().textContent = bus.route;
		}
	}, [ready, buses]);
	return (
		<section
			ref={container}
			className="shared-map"
			aria-label="Live trip map"
		/>
	);
}
