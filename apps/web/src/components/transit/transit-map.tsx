"use client";

import * as maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { freshVehicle } from "@/lib/transit/core";
import { serviceColor } from "@/lib/transit/service-colors";
import type {
	Position,
	Stop,
	TransitRoute,
	TripDetail,
	Vehicle,
} from "@/lib/transit/types";
import "maplibre-gl/dist/maplibre-gl.css";
import { ENV } from "@/env";

import {
	CITY_LAYERS,
	type CityCollection,
	type CityLayerId,
} from "@/lib/transit/city";
import { cityPopupContent } from "./city-popup";
import { mapSymbolImage } from "./map-symbol";

type Props = {
	city: CityCollection;
	cityDelayed: CityLayerId[];
	onCityPin: () => void;
	stale: boolean;
	now: number;
	vehicles: Vehicle[];
	stops: Stop[];
	trip?: TripDetail;
	tripColor: string;
	routes: TransitRoute[];
	selectedId?: string;
	location: Position | null;
	focus: (Position & { key: number }) | null;
	onVehicle: (id: string) => void;
	onStop: (id: string) => void;
	onCenter: (position: Position) => void;
};
export default function TransitMap(props: Props) {
	const container = useRef<HTMLElement>(null);
	const map = useRef<maplibregl.Map | null>(null);
	const markers = useRef(new Map<string, maplibregl.Marker>());
	const userMarker = useRef<maplibregl.Marker | null>(null);
	const handlers = useRef(props);
	const cityPopup = useRef<{
		popup: maplibregl.Popup;
		id: string;
		pinned: boolean;
		contentKey: string;
	} | null>(null);
	const [ready, setReady] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		handlers.current = props;
	});
	useEffect(() => {
		if (!container.current) return;
		setReady(false);
		let instance: maplibregl.Map;
		try {
			maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
			instance = new maplibregl.Map({
				container: container.current,
				center: [25.2797, 54.6872],
				zoom: 13,
				maxZoom: 19,
				minZoom: 8,
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
							paint: { "raster-saturation": -0.72, "raster-contrast": -0.08 },
						},
					],
				},
			});
		} catch {
			setError(
				"Your browser could not start the map. Enable WebGL or try another browser. Stops and departures are still available.",
			);
			return;
		}
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") cityPopup.current?.popup.remove();
		};
		instance.getContainer().addEventListener("keydown", closeOnEscape);
		map.current = instance;
		instance.addControl(
			new maplibregl.NavigationControl({ showCompass: false }),
			"top-right",
		);
		instance.addControl(
			new maplibregl.AttributionControl({ compact: false }),
			"bottom-right",
		);
		instance.on("error", () =>
			setError(
				"Some map tiles could not load. Live transit data is still available; check your connection.",
			),
		);
		instance.on("idle", () => {
			if (instance.areTilesLoaded()) setError(null);
		});
		instance.on("load", () => {
			for (const layer of CITY_LAYERS)
				instance.addImage(
					`symbol-${layer.id}`,
					mapSymbolImage(layer.id, layer.color),
					{ pixelRatio: 2 },
				);
			instance.addImage("symbol-stop", mapSymbolImage("stop", "#495c79"), {
				pixelRatio: 2,
			});
			instance.addImage(
				"symbol-selected-stop",
				mapSymbolImage("stop", "#204bcc", true),
				{ pixelRatio: 2 },
			);
			instance.addSource("city", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] },
				attribution:
					'© <a href="https://judu.lt/atviri-duomenys/" target="_blank" rel="noopener noreferrer">JUDU / Vilnius</a> · <a href="https://open.geodata.gov.lt/datasets/8a1e4b06ca714e2983b67c737c667abe_0/">Shelters: PAGD / VDA (CC BY 4.0)</a>',
			});
			instance.addLayer({
				id: "city-fill",
				type: "fill",
				source: "city",
				filter: ["==", ["geometry-type"], "Polygon"],
				paint: { "fill-color": ["get", "color"], "fill-opacity": 0.18 },
			});
			instance.addLayer({
				id: "city-line",
				type: "line",
				source: "city",
				filter: ["!=", ["geometry-type"], "Point"],
				paint: {
					"line-color": ["get", "color"],
					"line-width": [
						"case",
						["==", ["get", "category"], "congestion"],
						4,
						2,
					],
					"line-opacity": 0.7,
				},
			});
			instance.addLayer({
				id: "city-point",
				type: "symbol",
				source: "city",
				filter: ["==", ["geometry-type"], "Point"],
				layout: {
					"icon-image": ["concat", "symbol-", ["get", "category"]],
					"icon-size": [
						"interpolate",
						["linear"],
						["zoom"],
						10,
						0.65,
						15,
						0.9,
						18,
						1,
					],
					"icon-allow-overlap": false,
					"icon-padding": 5,
				},
			});
			const dismissHover = () => {
				if (!cityPopup.current?.pinned) cityPopup.current?.popup.remove();
			};
			const showCity = (e: maplibregl.MapMouseEvent, pinned: boolean) => {
				if (!pinned && cityPopup.current?.pinned) return;
				const target = e.originalEvent.target;
				if (target instanceof Element && target.closest(".maplibregl-popup"))
					return;
				if (
					(target instanceof Element && target.closest(".vehicle-pin")) ||
					instance.queryRenderedFeatures(e.point, {
						layers: ["selected-stop", "stops-points"],
					}).length
				) {
					if (pinned) cityPopup.current?.popup.remove();
					else dismissHover();
					return;
				}
				const hit = instance.queryRenderedFeatures(e.point, {
					layers: ["city-point", "city-line", "city-fill"],
				})[0];
				const feature = handlers.current.city.features.find(
					(f) => f.properties.id === hit?.properties.id,
				);
				if (!feature) {
					if (pinned) cityPopup.current?.popup.remove();
					else dismissHover();
					instance.getCanvas().style.cursor = "";
					return;
				}
				instance.getCanvas().style.cursor = "pointer";
				if (!pinned && cityPopup.current?.id === feature.properties.id) return;
				cityPopup.current?.popup.remove();
				const stale = handlers.current.cityDelayed.includes(
					feature.properties.category,
				);
				const popup = new maplibregl.Popup({
					closeButton: pinned,
					closeOnClick: false,
					focusAfterOpen: false,
					maxWidth: "280px",
					offset: 14,
					className: `city-map-popup ${pinned ? "is-pinned" : "is-preview"}`,
				})
					.setLngLat(
						feature.geometry.type === "Point"
							? [
									feature.geometry.coordinates[0],
									feature.geometry.coordinates[1],
								]
							: e.lngLat,
					)
					.setDOMContent(cityPopupContent(feature, pinned, stale))
					.addTo(instance);
				if (pinned) handlers.current.onCityPin();
				cityPopup.current = {
					popup,
					id: feature.properties.id,
					pinned,
					contentKey: JSON.stringify([feature.properties, stale]),
				};
				popup.on("close", () => {
					if (cityPopup.current?.popup === popup) cityPopup.current = null;
				});
				if (pinned) {
					// Pin before moving: map motion should dismiss previews, not this detail.
					instance.flyTo({
						center: popup.getLngLat(),
						zoom: Math.max(instance.getZoom(), 16),
						offset: window.matchMedia("(min-width: 900px)").matches
							? [180, 80]
							: [0, 80],
						duration: window.matchMedia("(prefers-reduced-motion: reduce)")
							.matches
							? 0
							: 800,
					});
				}
			};
			instance.on("click", (e) => showCity(e, true));
			instance.on("mousemove", (e) => {
				if (!e.originalEvent.buttons) showCity(e, false);
			});
			instance.on("mouseout", dismissHover);
			instance.on("movestart", dismissHover);
			instance.addSource("route", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] },
			});
			instance.addLayer({
				id: "route-outline",
				type: "line",
				source: "route",
				paint: { "line-color": "#ffffff", "line-width": 9 },
			});
			instance.addLayer({
				id: "route-line",
				type: "line",
				source: "route",
				paint: {
					"line-color": ["get", "color"],
					"line-width": 5,
					"line-opacity": 0.85,
				},
			});
			instance.addSource("stops", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] },
			});
			instance.addLayer({
				id: "stops-points",
				type: "symbol",
				source: "stops",
				minzoom: 12,
				layout: {
					"icon-image": "symbol-stop",
					"icon-size": ["interpolate", ["linear"], ["zoom"], 12, 0.65, 16, 0.9],
					"icon-allow-overlap": false,
					"icon-padding": 4,
				},
			});
			instance.addLayer({
				id: "selected-stop",
				type: "symbol",
				source: "stops",
				filter: ["==", ["get", "id"], ""],
				layout: {
					"icon-image": "symbol-selected-stop",
					"icon-size": 1.1,
					"icon-allow-overlap": true,
				},
			});
			instance.on("click", ["selected-stop", "stops-points"], (e) => {
				const id = e.features?.[0]?.properties?.id;
				if (id) handlers.current.onStop(String(id));
			});
			instance.on("mouseenter", "stops-points", () => {
				instance.getCanvas().style.cursor = "pointer";
			});
			instance.on("mouseleave", "stops-points", () => {
				instance.getCanvas().style.cursor = "";
			});
			setReady(true);
		});
		instance.on("moveend", () => {
			const center = instance.getCenter();
			handlers.current.onCenter({ lat: center.lat, lon: center.lng });
		});
		const observer = new ResizeObserver(() => instance.resize());
		observer.observe(container.current);
		return () => {
			instance.getContainer().removeEventListener("keydown", closeOnEscape);
			cityPopup.current?.popup.remove();
			observer.disconnect();
			instance.remove();
			map.current = null;
			markers.current.clear();
			userMarker.current = null;
		};
	}, []);
	useEffect(() => {
		if (!ready || !map.current) return;
		(
			map.current.getSource("city") as maplibregl.GeoJSONSource | undefined
		)?.setData(props.city);
		const active = cityPopup.current;
		if (active) {
			const feature = props.city.features.find(
				(f) => f.properties.id === active.id,
			);
			if (!feature) active.popup.remove();
			else {
				const stale = props.cityDelayed.includes(feature.properties.category);
				const key = JSON.stringify([feature.properties, stale]);
				if (key !== active.contentKey) {
					active.popup.setDOMContent(
						cityPopupContent(feature, active.pinned, stale),
					);
					active.contentKey = key;
				}
			}
		}
	}, [ready, props.city, props.cityDelayed]);
	useEffect(() => {
		if (!ready || !map.current) return;
		const source = map.current.getSource("stops") as maplibregl.GeoJSONSource;
		source?.setData({
			type: "FeatureCollection",
			features: props.stops.map((s) => ({
				type: "Feature",
				properties: { id: s.id },
				geometry: { type: "Point", coordinates: [s.lon, s.lat] },
			})),
		});
	}, [ready, props.stops]);
	useEffect(() => {
		if (ready && map.current?.getLayer("selected-stop"))
			map.current.setFilter("selected-stop", [
				"==",
				["get", "id"],
				props.selectedId ?? "",
			]);
	}, [ready, props.selectedId]);
	useEffect(() => {
		if (!ready || !map.current) return;
		const source = map.current.getSource("route") as maplibregl.GeoJSONSource;
		source?.setData({
			type: "FeatureCollection",
			features:
				props.trip && props.trip.coordinates.length > 1
					? [
							{
								type: "Feature",
								properties: { color: props.tripColor },
								geometry: {
									type: "LineString",
									coordinates: props.trip.coordinates,
								},
							},
						]
					: [],
		});
	}, [ready, props.trip, props.tripColor]);
	useEffect(() => {
		if (!ready || !map.current) return;
		const ids = new Set(props.vehicles.map((v) => v.id));
		for (const [id, marker] of markers.current)
			if (!ids.has(id)) {
				marker.remove();
				markers.current.delete(id);
			}
		for (const vehicle of props.vehicles) {
			let marker = markers.current.get(vehicle.id);
			if (!marker) {
				const button = document.createElement("button");
				button.type = "button";
				button.addEventListener("click", () =>
					handlers.current.onVehicle(vehicle.id),
				);
				marker = new maplibregl.Marker({ element: button })
					.setLngLat([vehicle.lon, vehicle.lat])
					.addTo(map.current);
				markers.current.set(vehicle.id, marker);
			}
			marker.setLngLat([vehicle.lon, vehicle.lat]);
			const button = marker.getElement();
			// Keep MapLibre's positioning/anchor classes when refreshing live data.
			button.classList.add("vehicle-pin");
			button.classList.toggle("bus", vehicle.mode === "bus");
			button.classList.toggle("trolleybus", vehicle.mode === "trolleybus");
			button.classList.toggle(
				"stale",
				!freshVehicle(vehicle, props.now) || props.stale,
			);
			button.classList.toggle("selected", props.selectedId === vehicle.id);
			button.style.background = serviceColor(
				vehicle.route,
				vehicle.mode,
				props.routes.find((r) => r.id === vehicle.routeId)?.color,
			);
			button.style.color = "white";
			button.textContent = vehicle.route;
			button.setAttribute(
				"aria-label",
				`${vehicle.mode === "bus" ? "Bus" : "Trolleybus"} ${vehicle.route} to ${vehicle.destination}, vehicle ${vehicle.number}`,
			);
			button.title = `${vehicle.route} → ${vehicle.destination}`;
			button.style.setProperty("--heading", `${vehicle.heading}deg`);
		}
	}, [
		ready,
		props.vehicles,
		props.selectedId,
		props.stale,
		props.now,
		props.routes,
	]);
	useEffect(() => {
		if (!ready || !map.current) return;
		if (!props.location) {
			userMarker.current?.remove();
			userMarker.current = null;
			return;
		}
		if (!userMarker.current) {
			const element = document.createElement("div");
			element.className = "user-location";
			element.setAttribute("aria-label", "Your location");
			userMarker.current = new maplibregl.Marker({ element })
				.setLngLat([props.location.lon, props.location.lat])
				.addTo(map.current);
		}
		userMarker.current.setLngLat([props.location.lon, props.location.lat]);
	}, [ready, props.location]);
	useEffect(() => {
		if (ready && props.focus)
			map.current?.flyTo({
				center: [props.focus.lon, props.focus.lat],
				offset: window.matchMedia("(min-width: 900px)").matches
					? [180, 0]
					: [0, 0],
				zoom: 15,
				duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
					? 0
					: 800,
			});
	}, [ready, props.focus]);
	return (
		<>
			<section
				ref={container}
				className="transit-map"
				aria-label="Live Vilnius transit map"
			/>
			{error && (
				<div className="map-error" role="status">
					{error}
				</div>
			)}
		</>
	);
}
