import type { Feature } from "geojson";
import { type CityFeed, type CityLayerId, normaliseCityFeature } from "./city";

const BASE =
	"https://arcgis.sviesoforai.lt/arcgis/rest/services/VIS/Vilnius_sde_dynamic/MapServer";
const SIGNALS =
	"https://arcgis.sisp.lt/arcgis/rest/services/Hosted/Sankryžos_ir_koridoriai_(view_only)/FeatureServer";
const EVENTS =
	"objectid,placedescription,eventdescription,eventperformfromdate,eventperformtodate,eventshowfromdate,eventshowtodate,visible,repeatable,repeatableshow,pt_routes,pt_routes_affected,pt_additional_info";
type Source = { url: string; fields: string };
const event = (id: number): Source => ({
	url: `${BASE}/${id}`,
	fields: EVENTS,
});
const SOURCES: Record<CityLayerId, Source[]> = {
	shelters: [
		{
			url: "https://services-eu1.arcgis.com/rHAjZpbf6qHK8UCL/arcgis/rest/services/Priedangų_tinklas_Lietuvoje_(TEST)/FeatureServer/0",
			fields:
				"object_id,pavadinimas,gatve,namo_numeris,gyvenviete,savivaldybe,gyventoju_skaicius,plotas,pritaikyta_asmenims_su_negalia,patekimas_visa_para,darbo_valandos,pastabos,atnaujinimo_data",
		},
	],
	incidents: [event(22), event(23)],
	roadworks: [event(6), event(7)],
	restrictions: [event(9), event(10)],
	congestion: [
		event(12),
		{
			url: `${BASE}/13`,
			fields:
				"objectid,event_description,place_description,visible,event_perform_from_date,event_perform_to_date,event_show_from_date,event_show_to_date",
		},
		event(14),
		{ url: `${BASE}/24`, fields: "objectid,pavadinimas,apkrovimas" },
	],
	parking: [{ url: `${BASE}/26`, fields: "objectid,zona" }],
	signals: [
		{
			url: `${SIGNALS}/1`,
			fields: "objectid,numeris,pavadinima,valdymo_metodas",
		},
	],
	corridors: [{ url: `${SIGNALS}/2`, fields: "objectid,kor_pavad,korid_nr" }],
};
type Cached = { features: Feature[]; fetchedAt: number };
const cache = new Map<string, Cached>();
const pending = new Map<string, Promise<Cached>>();
const failedUntil = new Map<string, number>();
async function query(url: string, params: Record<string, string>) {
	const response = await fetch(`${url}/query?${new URLSearchParams(params)}`, {
		cache: "no-store",
		signal: AbortSignal.timeout(20000),
	});
	if (!response.ok) throw new Error(`City feed HTTP ${response.status}`);
	const data = await response.json();
	if (data.error) throw new Error("City source query failed");
	return data;
}
async function fetchSource(source: Source, ttl: number): Promise<Cached> {
	const saved = cache.get(source.url);
	if (saved && Date.now() - saved.fetchedAt < ttl) return saved;
	if ((failedUntil.get(source.url) ?? 0) > Date.now())
		throw new Error("City source retry pending");
	const inFlight = pending.get(source.url);
	if (inFlight) return inFlight;
	const work = (async () => {
		const ids = await query(source.url, {
			f: "json",
			where: "1=1",
			returnIdsOnly: "true",
		});
		if (ids.objectIds === null) ids.objectIds = [];
		if (
			!Array.isArray(ids.objectIds) ||
			!ids.objectIds.every(
				(id: unknown) => typeof id === "number" && Number.isInteger(id),
			)
		)
			throw new Error("Invalid city feature IDs");
		const features: Feature[] = [];
		// Bounded ID batches avoid transfer limits and long URLs rejected by ArcGIS hosting.
		for (let index = 0; index < ids.objectIds.length; index += 200) {
			const data = await query(source.url, {
				f: "geojson",
				objectIds: ids.objectIds.slice(index, index + 200).join(","),
				outFields: source.fields,
				outSR: "4326",
				returnGeometry: "true",
			});
			if (
				!Array.isArray(data.features) ||
				data.exceededTransferLimit ||
				data.properties?.exceededTransferLimit
			)
				throw new Error("Incomplete city feature batch");
			features.push(...data.features);
		}
		const result = { features, fetchedAt: Date.now() };
		cache.set(source.url, result);
		return result;
	})();
	pending.set(source.url, work);
	try {
		return await work;
	} catch (error) {
		failedUntil.set(source.url, Date.now() + 30000);
		throw error;
	} finally {
		pending.delete(source.url);
	}
}
export async function getCityLayer(category: CityLayerId): Promise<CityFeed> {
	const sources = SOURCES[category];
	const ttl = ["parking", "signals", "corridors", "shelters"].includes(category)
		? 6 * 60 * 60 * 1000
		: 60000;
	const results = await Promise.allSettled(
		sources.map((source) => fetchSource(source, ttl)),
	);
	let unavailable = 0;
	const available = results.flatMap((result, index) => {
		const source = sources[index];
		if (!source) return [];
		if (result.status === "fulfilled")
			return [{ ...result.value, source: source.url }];
		unavailable++;
		const saved = cache.get(source.url);
		return saved ? [{ ...saved, source: source.url }] : [];
	});
	if (!available.length) throw new Error("City layer unavailable");
	const now = Date.now();
	return {
		collection: {
			type: "FeatureCollection",
			features: available.flatMap((item) =>
				item.features
					.map((f) => normaliseCityFeature(f, category, item.source, now))
					.filter((f) => f !== null),
			),
		},
		fetchedAt: Math.min(...available.map((item) => item.fetchedAt)),
		stale: unavailable > 0,
		unavailable,
	};
}
