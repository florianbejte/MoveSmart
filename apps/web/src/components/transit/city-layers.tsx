"use client";

import { useMemo, useState } from "react";
import { dateLocale } from "@/lib/i18n/core";
import { useT } from "@/lib/i18n/react";
import {
	CITY_LAYERS,
	type CityFeed,
	type CityLayerId,
	EMPTY_CITY,
	eventStillRelevant,
	matchesRoutes,
} from "@/lib/transit/city";
import { MapSymbol } from "./map-symbol";
import { useTransit } from "./use-transit";

export function useCityLayers(now: number) {
	const [enabled, setEnabled] = useState<CityLayerId[]>(["incidents"]);
	const url = (id: CityLayerId) =>
		enabled.includes(id) || id === "incidents" ? `/api/city?layer=${id}` : null;
	const incidents = useTransit<CityFeed>(url("incidents"), 60000);
	const roadworks = useTransit<CityFeed>(url("roadworks"), 60000);
	const restrictions = useTransit<CityFeed>(url("restrictions"), 60000);
	const congestion = useTransit<CityFeed>(url("congestion"), 60000);
	const parking = useTransit<CityFeed>(url("parking"), 300000);
	const signals = useTransit<CityFeed>(url("signals"), 300000);
	const corridors = useTransit<CityFeed>(url("corridors"), 300000);
	const shelters = useTransit<CityFeed>(url("shelters"), 300000);
	const bikes = useTransit<CityFeed>(url("bikes"), 300000);
	const feeds = {
		bikes,
		shelters,
		incidents,
		roadworks,
		restrictions,
		congestion,
		parking,
		signals,
		corridors,
	};
	const collection = useMemo(
		() => ({
			...EMPTY_CITY,
			features: [
				incidents.data,
				roadworks.data,
				restrictions.data,
				congestion.data,
				parking.data,
				signals.data,
				corridors.data,
				shelters.data,
				bikes.data,
			]
				.flatMap((feed) => feed?.collection.features ?? [])
				.filter(
					(f) =>
						enabled.includes(f.properties.category) &&
						eventStillRelevant(f.properties, now),
				),
		}),
		[
			incidents.data,
			roadworks.data,
			restrictions.data,
			congestion.data,
			parking.data,
			signals.data,
			corridors.data,
			shelters.data,
			bikes.data,
			enabled,
			now,
		],
	);
	return {
		enabled,
		feeds,
		collection,
		toggle: (id: CityLayerId) =>
			setEnabled((old) =>
				old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
			),
	};
}
type CityState = ReturnType<typeof useCityLayers>;
const date = (value: number) =>
	new Intl.DateTimeFormat(dateLocale(), {
		timeZone: "Europe/Vilnius",
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	}).format(value);
export function CityLayers({
	city,
	routeNames,
	now,
	open,
	onOpen,
}: {
	city: CityState;
	routeNames: string[];
	now: number;
	open: boolean;
	onOpen: (value: boolean) => void;
}) {
	const t = useT();

	const delayedLayers = city.enabled.filter((id) => {
		const feed = city.feeds[id];
		return (
			!!feed.error ||
			feed.data?.stale ||
			(feed.data &&
				!["parking", "signals", "corridors", "shelters", "bikes"].includes(
					id,
				) &&
				now - feed.data.fetchedAt > 120000)
		);
	});
	const alerts =
		city.feeds.incidents.data?.collection.features.filter(
			(f) =>
				eventStillRelevant(f.properties, now) &&
				(!routeNames.length || matchesRoutes(f, routeNames)),
		) ?? [];
	const incidentFeed = city.feeds.incidents;
	const incidentDelayed =
		!!incidentFeed.error ||
		incidentFeed.data?.stale ||
		(incidentFeed.data && now - incidentFeed.data.fetchedAt > 120000);
	return (
		<section
			className="city-layers"
			data-open={open}
			aria-label={t("City data layers")}
		>
			<button
				className="city-layers-heading"
				type="button"
				aria-expanded={open}
				onClick={() => onOpen(!open)}
			>
				<span>
					{t("City layers ")}
					<small>
						{t(city.enabled.length)}
						{t(" on")}
					</small>
				</span>
				<span>{t(open ? "−" : "+")}</span>
			</button>
			{delayedLayers.length > 0 && (
				<p className="city-layer-warning" role="status">
					{t(
						delayedLayers
							.map((id) =>
								t(CITY_LAYERS.find((layer) => layer.id === id)?.label),
							)
							.join(", "),
					)}
					{t(": updates delayed; map data may be outdated.")}
				</p>
			)}
			{open && (
				<div className="city-layer-options">
					<p className="helper-text">
						{t("Choose what appears on your map. Tap any marker for details.")}
					</p>
					{CITY_LAYERS.map((layer) => {
						const feed = city.feeds[layer.id];
						const checked = city.enabled.includes(layer.id);
						const delayed =
							!!feed.error ||
							feed.data?.stale ||
							(feed.data &&
								![
									"parking",
									"signals",
									"corridors",
									"shelters",
									"bikes",
								].includes(layer.id) &&
								now - feed.data.fetchedAt > 120000);
						const count = feed.data?.collection.features.filter((f) =>
							eventStillRelevant(f.properties, now),
						).length;
						return (
							<div
								key={layer.id}
								className="city-layer-option"
								data-enabled={checked}
							>
								<label>
									<input
										type="checkbox"
										aria-label={t(layer.label)}
										checked={checked}
										onChange={() => city.toggle(layer.id)}
									/>
									<MapSymbol kind={layer.id} color={layer.color} />
									<strong>{t(layer.label)}</strong>
									<span>{t(checked && count !== undefined ? count : "")}</span>
								</label>
								{checked && (
									<>
										<details className="layer-description">
											<summary>{t("About this layer")}</summary>
											<p>{t(layer.note)}</p>
										</details>
										<small role="status">
											{t(
												delayed
													? `Refresh unavailable${feed.data ? " · saved or partial data" : ""}`
													: feed.data
														? `${count === 0 ? "No current records · " : ""}Fetched ${date(feed.data.fetchedAt)}`
														: "Loading…",
											)}
										</small>
										{delayed && (
											<button
												type="button"
												className="text-button"
												onClick={feed.retry}
											>
												{t("Retry ")}
												{t(layer.label.toLowerCase())}
											</button>
										)}
									</>
								)}
							</div>
						);
					})}
					{city.enabled.includes("parking") && (
						<p className="helper-text">
							{t("Parking: yellow · blue · red · green zones.")}
						</p>
					)}

					<a
						className="city-source"
						href="https://judu.lt/atviri-duomenys/"
						target="_blank"
						rel="noreferrer"
					>
						{t("City data: JUDU / Vilnius ↗")}
					</a>
					<a
						className="city-source"
						href="https://open.geodata.gov.lt/datasets/8a1e4b06ca714e2983b67c737c667abe_0/"
						target="_blank"
						rel="noreferrer"
					>
						{t("Shelters: PAGD / Valstybės duomenų agentūra · CC BY 4.0 ↗")}
					</a>
				</div>
			)}
			<section
				className="route-alerts"
				data-empty={!alerts.length && !incidentDelayed && !!incidentFeed.data}
				aria-label={t("Transit disruption notices")}
			>
				{incidentDelayed ? (
					<p role="status">
						{t("Transit alerts may be incomplete or outdated.")}
					</p>
				) : !incidentFeed.data ? (
					<p>{t("Checking transit alerts…")}</p>
				) : alerts.length === 0 ? (
					<p>
						{t(
							routeNames.length
								? "No published disruptions for these route numbers."
								: "No current transit disruptions published.",
						)}
					</p>
				) : (
					<details className="alert-details">
						<summary>
							{t(
								routeNames.length
									? "Alerts for these route numbers"
									: "Transit alerts",
							)}
							{t(" ")}· {t(alerts.length)}
						</summary>
						{alerts.map((f) => (
							<article key={f.properties.id}>
								<b>
									{t(
										f.properties.routes.length
											? `${f.properties.routes.join(", ")} · `
											: "",
									)}
									{t(f.properties.title)}
								</b>
								<p>{t(f.properties.description)}</p>
								<small>
									{t(f.properties.timing)}
									{t(
										f.properties.end
											? ` · until ${date(f.properties.end)}`
											: "",
									)}
								</small>
							</article>
						))}
					</details>
				)}
				{routeNames.length > 0 && alerts.length > 0 && (
					<small>
						{t(
							"The source lists route numbers without always distinguishing buses from trolleybuses.",
						)}
					</small>
				)}
			</section>
		</section>
	);
}
