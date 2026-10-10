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
import type { CommunityCollection } from "@/lib/reports/map";
import {
	CITY_LAYERS,
	type CityCollection,
	type CityLayerId,
} from "@/lib/transit/city";
import { cityPopupContent } from "./city-popup";
import { mapSymbolImage } from "./map-symbol";
import type { PlanPath } from "./trip-planner";
import { vehiclePopupContent } from "./vehicle-popup";

type Props = {
	community: CommunityCollection;
	city: CityCollection;
	cityDelayed: CityLayerId[];
	onCityPin: () => void;
	stale: boolean;
	now: number;
	vehicles: Vehicle[];
	stops: Stop[];
	selectedStop?: Stop;
	trip?: TripDetail;
	stopTrips?: TripDetail[];
	tripColor: string;
	routes: TransitRoute[];
	selectedId?: string;
	location: Position | null;
	focus: (Position & { key: number }) | null;
	onVehicle: (id: string) => void;
	onStop: (id: string) => void;
	onCenter: (position: Position) => void;
	plan: PlanPath | null;
};
const EMPTY_PLAN = { type: "FeatureCollection" as const, features: [] };
export default function TransitMap(props: Props) {
	const container = useRef<HTMLElement>(null);
	const map = useRef<maplibregl.Map | null>(null);
	const markers = useRef(new Map<string, maplibregl.Marker>());
	const vehiclePopup = useRef<{ id: string; popup: maplibregl.Popup } | null>(
		null,
	);
	const communityPreview = useRef<maplibregl.Popup | null>(null);
	const communityPreviewId = useRef<string | null>(null);
	const tripStopPreview = useRef<maplibregl.Popup | null>(null);
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
		let focusTimer: ReturnType<typeof setTimeout> | undefined;
		let pendingCityFocus: (() => void) | null = null;
		const focusAfterLayout = () => {
			clearTimeout(focusTimer);
			focusTimer = setTimeout(() => {
				const focus = pendingCityFocus;
				pendingCityFocus = null;
				focus?.();
			}, 150);
		};
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
			if (event.key === "Escape") {
				cityPopup.current?.popup.remove();
				vehiclePopup.current?.popup.remove();
			}
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
			instance.addImage(
				"symbol-community",
				mapSymbolImage("community", "#7343aa"),
				{ pixelRatio: 2 },
			);
			for (const layer of CITY_LAYERS)
				instance.addImage(
					`symbol-${layer.id}`,
					mapSymbolImage(layer.id, layer.color),
					{ pixelRatio: 2 },
				);
			instance.addImage("symbol-stop", mapSymbolImage("stop", "#414454"), {
				pixelRatio: 2,
			});
			instance.addImage(
				"symbol-selected-stop",
				mapSymbolImage("stop", "#ed1c24", true),
				{ pixelRatio: 2 },
			);
			instance.addSource("city", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] },
				attribution:
					'© <a href="https://judu.lt/atviri-duomenys/" target="_blank" rel="noopener noreferrer">JUDU / Vilnius</a> · <a href="https://open.geodata.gov.lt/datasets/8a1e4b06ca714e2983b67c737c667abe_0/">Shelters: PAGD / VDA (CC BY 4.0)</a> · <a href="https://gis.ktvis.lt/arcgis/rest/services/LAKD/Nac_taku_pletra/MapServer/11">Paths: KTVIS</a>',
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
						["in", ["get", "category"], ["literal", ["congestion", "bikes"]]],
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
				if (
					instance.getLayer("community-points") &&
					instance.queryRenderedFeatures(e.point, {
						layers: ["community-points"],
					}).length
				)
					return;
				if (target instanceof Element && target.closest(".maplibregl-popup"))
					return;
				if (
					(target instanceof Element && target.closest(".vehicle-pin")) ||
					instance.queryRenderedFeatures(e.point, {
						layers: ["selected-stop", "stops-points", "trip-stops-points"],
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
					// Closing the sheet resizes the map. Wait for layout to settle before flying.
					pendingCityFocus = () => {
						if (cityPopup.current?.popup !== popup) return;
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
					};
					focusAfterLayout();
				}
			};
			instance.on("click", (e) => showCity(e, true));
			instance.on("mousemove", (e) => {
				if (!e.originalEvent.buttons) showCity(e, false);
			});
			instance.on("mouseout", dismissHover);
			instance.on("movestart", dismissHover);
			instance.on("movestart", () => vehiclePopup.current?.popup.remove());
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
			instance.addSource("stop-routes", { type: "geojson", data: EMPTY_PLAN });
			instance.addLayer({
				id: "stop-routes-outline",
				type: "line",
				source: "stop-routes",
				paint: { "line-color": "#fff", "line-width": 7, "line-opacity": 0.85 },
			});
			instance.addLayer({
				id: "stop-routes-lines",
				type: "line",
				source: "stop-routes",
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": ["get", "color"],
					"line-width": 4,
					"line-opacity": 0.85,
				},
			});
			// Places to avoid near the planned trip, sized in metres at any zoom.
			instance.addSource("avoid", { type: "geojson", data: EMPTY_PLAN });
			const metresPerPixel = (z: number) =>
				(156543 * Math.cos((54.69 * Math.PI) / 180)) / 2 ** z;
			instance.addLayer({
				id: "avoid-zones",
				type: "circle",
				source: "avoid",
				paint: {
					"circle-radius": [
						"interpolate",
						["exponential", 2],
						["zoom"],
						10,
						["/", ["get", "radius"], metresPerPixel(10)],
						18,
						["/", ["get", "radius"], metresPerPixel(18)],
					],
					"circle-color": ["case", ["get", "avoid"], "#ed1c24", "#f0a000"],
					"circle-opacity": 0.16,
					"circle-stroke-color": [
						"case",
						["get", "avoid"],
						"#ed1c24",
						"#d08a00",
					],
					"circle-stroke-width": 2,
				},
			});
			// The planned trip: walking legs dashed, rides solid, with start and end markers.
			instance.addSource("plan", { type: "geojson", data: EMPTY_PLAN });
			instance.addLayer({
				id: "plan-outline",
				type: "line",
				source: "plan",
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": "#ffffff",
					"line-width": ["match", ["get", "kind"], "walk", 7, 10],
				},
				filter: ["==", ["geometry-type"], "LineString"],
			});
			instance.addLayer({
				id: "plan-ride",
				type: "line",
				source: "plan",
				layout: { "line-cap": "round", "line-join": "round" },
				paint: { "line-color": ["get", "color"], "line-width": 6 },
				filter: ["==", ["get", "kind"], "ride"],
			});
			instance.addLayer({
				id: "plan-walk",
				type: "line",
				source: "plan",
				layout: { "line-cap": "round", "line-join": "round" },
				paint: {
					"line-color": ["get", "color"],
					"line-width": 4,
					"line-dasharray": [0.1, 2],
				},
				filter: ["==", ["get", "kind"], "walk"],
			});
			instance.addLayer({
				id: "plan-ends",
				type: "circle",
				source: "plan",
				filter: ["==", ["geometry-type"], "Point"],
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
			instance.addSource("trip-stops", { type: "geojson", data: EMPTY_PLAN });
			instance.addLayer({
				id: "trip-stops-points",
				type: "circle",
				source: "trip-stops",
				paint: {
					"circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 7],
					"circle-color": "#ffffff",
					"circle-stroke-color": ["get", "color"],
					"circle-stroke-width": 3,
				},
			});
			instance.on("click", "trip-stops-points", (e) => {
				const id = e.features?.[0]?.properties?.id;
				tripStopPreview.current?.remove();
				if (id) handlers.current.onStop(String(id));
			});
			instance.on("mouseenter", "trip-stops-points", (e) => {
				const f = e.features?.[0];
				if (f?.geometry.type !== "Point") return;
				vehiclePopup.current?.popup.remove();
				communityPreview.current?.remove();
				if (!cityPopup.current?.pinned) cityPopup.current?.popup.remove();
				tripStopPreview.current?.remove();
				const content = document.createElement("div");
				content.setAttribute("role", "tooltip");
				content.textContent = `${f.properties.sequence}. ${f.properties.name} · Click for departures`;
				tripStopPreview.current = new maplibregl.Popup({
					closeButton: false,
					closeOnClick: false,
					focusAfterOpen: false,
					offset: 12,
					className: "city-map-popup is-preview",
				})
					.setLngLat([f.geometry.coordinates[0], f.geometry.coordinates[1]])
					.setDOMContent(content)
					.addTo(instance);
				instance.getCanvas().style.cursor = "pointer";
			});
			instance.on("mouseleave", "trip-stops-points", () => {
				tripStopPreview.current?.remove();
				instance.getCanvas().style.cursor = "";
			});
			instance.on("movestart", () => tripStopPreview.current?.remove());
			instance.addSource("community", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] },
			});
			instance.addLayer({
				id: "community-points",
				type: "symbol",
				source: "community",
				layout: {
					"icon-image": "symbol-community",
					"icon-size": 0.9,
					"icon-offset": [0, -32],
					"icon-allow-overlap": false,
					"icon-padding": 3,
				},
			});
			instance.on("click", "community-points", (e) => {
				const p = e.features?.[0]?.properties;
				if (!p) return;
				communityPreview.current?.remove();
				cityPopup.current?.popup.remove();
				if (p.target === "stop") handlers.current.onStop(String(p.id));
				else handlers.current.onVehicle(String(p.id));
			});
			instance.on("mousemove", "community-points", (e) => {
				const p = e.features?.[0]?.properties;
				const geometry = e.features?.[0]?.geometry;
				if (!p || geometry?.type !== "Point" || e.originalEvent.buttons) return;
				const key = `${p.target}:${p.id}`;
				if (
					communityPreviewId.current === key &&
					communityPreview.current?.isOpen()
				)
					return;
				communityPreview.current?.remove();
				vehiclePopup.current?.popup.remove();
				communityPreviewId.current = key;
				if (!cityPopup.current?.pinned) cityPopup.current?.popup.remove();
				const root = document.createElement("article");
				root.className = "city-map-detail";
				root.setAttribute("role", "tooltip");
				for (const [tag, text] of [
					["span", "Community report"],
					["h3", String(p.title)],
					["p", String(p.description)],
					[
						"small",
						`${p.count} reports · ${Math.max(1, Math.floor((handlers.current.now - Number(p.updatedAt)) / 60000))} min ago`,
					],
					["small", "Click to view or confirm"],
				]) {
					const node = document.createElement(tag);
					node.textContent = text;
					root.append(node);
				}
				communityPreview.current = new maplibregl.Popup({
					closeButton: false,
					closeOnClick: false,
					focusAfterOpen: false,
					offset: 40,
					maxWidth: "280px",
					className: "city-map-popup is-preview",
				})
					.setLngLat([geometry.coordinates[0], geometry.coordinates[1]])
					.setDOMContent(root)
					.addTo(instance);
				instance.getCanvas().style.cursor = "pointer";
			});
			instance.on("mouseleave", "community-points", () => {
				communityPreview.current?.remove();
				instance.getCanvas().style.cursor = "";
			});
			instance.on("movestart", () => communityPreview.current?.remove());
			setReady(true);
		});
		instance.on("moveend", () => {
			const center = instance.getCenter();
			handlers.current.onCenter({ lat: center.lat, lon: center.lng });
		});
		const observer = new ResizeObserver(() => {
			instance.resize();
			if (pendingCityFocus) focusAfterLayout();
		});
		observer.observe(container.current);
		return () => {
			clearTimeout(focusTimer);
			pendingCityFocus = null;
			instance.getContainer().removeEventListener("keydown", closeOnEscape);
			cityPopup.current?.popup.remove();
			vehiclePopup.current?.popup.remove();
			communityPreview.current?.remove();
			tripStopPreview.current?.remove();
			observer.disconnect();
			instance.remove();
			map.current = null;
			markers.current.clear();
			userMarker.current = null;
		};
	}, []);
	useEffect(() => {
		if (!ready || !map.current) return;
		(map.current.getSource("community") as maplibregl.GeoJSONSource)?.setData(
			props.community,
		);
		const preview = communityPreview.current;
		if (preview?.isOpen()) {
			const feature = props.community.features.find(
				(f) =>
					`${f.properties.target}:${f.properties.id}` ===
					communityPreviewId.current,
			);
			if (feature)
				preview.setLngLat([
					feature.geometry.coordinates[0],
					feature.geometry.coordinates[1],
				]);
			else preview.remove();
		}
	}, [ready, props.community]);

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
		// Keep the inspected stop on the map even outside the active search,
		// route, mode or GPS-nearby filter. The highlighted layer ignores collisions.
		const stops =
			props.selectedStop &&
			!props.stops.some((s) => s.id === props.selectedStop?.id)
				? [...props.stops, props.selectedStop]
				: props.stops;
		source?.setData({
			type: "FeatureCollection",
			features: stops.map((s) => ({
				type: "Feature",
				properties: { id: s.id },
				geometry: { type: "Point", coordinates: [s.lon, s.lat] },
			})),
		});
	}, [ready, props.stops, props.selectedStop]);
	useEffect(() => {
		if (ready && map.current?.getLayer("selected-stop"))
			map.current.setFilter("selected-stop", [
				"==",
				["get", "id"],
				props.selectedStop?.id ?? "",
			]);
	}, [ready, props.selectedStop]);
	useEffect(() => {
		if (!ready || !map.current?.getLayer("stops-points")) return;
		tripStopPreview.current?.remove();
		(map.current.getSource("trip-stops") as maplibregl.GeoJSONSource)?.setData({
			type: "FeatureCollection",
			features: (props.trip?.stops ?? []).map((stop, index) => ({
				type: "Feature",
				properties: {
					id: stop.id,
					name: stop.name,
					sequence: index + 1,
					color: props.tripColor || "#414454",
				},
				geometry: { type: "Point", coordinates: [stop.lon, stop.lat] },
			})),
		});
		map.current.setFilter("stops-points", [
			"!",
			[
				"in",
				["get", "id"],
				["literal", (props.trip?.stops ?? []).map((s) => s.id)],
			],
		]);
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
		(map.current.getSource("stop-routes") as maplibregl.GeoJSONSource)?.setData(
			{
				type: "FeatureCollection",
				features: (props.stopTrips ?? [])
					.filter((t) => t.coordinates.length > 1)
					.map((t) => {
						const r = props.routes.find((r) => r.id === t.routeId);
						return {
							type: "Feature",
							properties: {
								color: serviceColor(r?.name ?? "", r?.mode, r?.color),
							},
							geometry: { type: "LineString", coordinates: t.coordinates },
						};
					}),
			},
		);
	}, [ready, props.stopTrips, props.routes]);
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
				const hidePreview = () => {
					if (vehiclePopup.current?.id === vehicle.id)
						vehiclePopup.current.popup.remove();
				};
				const showPreview = () => {
					const current = handlers.current;
					const latest = current.vehicles.find((v) => v.id === vehicle.id);
					if (!latest || !map.current || map.current.isMoving()) return;
					vehiclePopup.current?.popup.remove();
					communityPreview.current?.remove();
					if (!cityPopup.current?.pinned) cityPopup.current?.popup.remove();
					const popup = new maplibregl.Popup({
						closeButton: false,
						closeOnClick: false,
						focusAfterOpen: false,
						offset: 22,
						maxWidth: "280px",
						className: "city-map-popup is-preview vehicle-map-popup",
					})
						.setLngLat([latest.lon, latest.lat])
						.setDOMContent(
							vehiclePopupContent(latest, current.now, current.stale),
						)
						.addTo(map.current);
					vehiclePopup.current = { id: latest.id, popup };
					popup.on("close", () => {
						if (vehiclePopup.current?.popup === popup)
							vehiclePopup.current = null;
					});
				};
				button.addEventListener("pointerenter", (event) => {
					if (event.pointerType !== "touch") showPreview();
				});
				button.addEventListener("pointerleave", hidePreview);
				button.addEventListener("focus", showPreview);
				button.addEventListener("blur", hidePreview);
				button.addEventListener("click", () => {
					hidePreview();
					handlers.current.onVehicle(vehicle.id);
				});
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
			// Custom hover preview replaces the browser title tooltip.
			button.style.setProperty("--heading", `${vehicle.heading}deg`);
		}
		const preview = vehiclePopup.current;
		if (preview) {
			const latest = props.vehicles.find((v) => v.id === preview.id);
			if (!latest) preview.popup.remove();
			else
				preview.popup
					.setLngLat([latest.lon, latest.lat])
					.setDOMContent(vehiclePopupContent(latest, props.now, props.stale));
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: the key changes whenever the drawn path does.
	useEffect(() => {
		if (!ready || !map.current) return;
		const plan = props.plan;
		(map.current.getSource("avoid") as maplibregl.GeoJSONSource)?.setData({
			type: "FeatureCollection",
			features: (plan?.avoid ?? []).map((z) => ({
				type: "Feature" as const,
				properties: { radius: z.radius, avoid: z.avoid, title: z.title },
				geometry: { type: "Point" as const, coordinates: [z.lon, z.lat] },
			})),
		});
		(map.current.getSource("plan") as maplibregl.GeoJSONSource)?.setData(
			plan
				? {
						type: "FeatureCollection",
						features: [
							...plan.segments
								.filter((s) => s.coordinates.length > 1)
								.map((s) => ({
									type: "Feature" as const,
									properties: { kind: s.kind, color: s.color },
									geometry: {
										type: "LineString" as const,
										coordinates: s.coordinates,
									},
								})),
							...(["from", "to"] as const).map((end) => ({
								type: "Feature" as const,
								properties: { end },
								geometry: {
									type: "Point" as const,
									coordinates: [plan[end].lon, plan[end].lat],
								},
							})),
						],
					}
				: EMPTY_PLAN,
		);
		if (!plan) return;
		const bounds = new maplibregl.LngLatBounds();
		for (const s of plan.segments)
			for (const c of s.coordinates) bounds.extend(c);
		bounds.extend([plan.from.lon, plan.from.lat]);
		bounds.extend([plan.to.lon, plan.to.lat]);
		const wide = window.matchMedia("(min-width: 900px)").matches;
		map.current.fitBounds(bounds, {
			padding: wide
				? { top: 90, bottom: 90, left: 420, right: 80 }
				: { top: 70, bottom: 40, left: 40, right: 70 },
			maxZoom: 16,
			duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
				? 0
				: 800,
		});
	}, [ready, props.plan?.key, props.plan?.segments]);
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
