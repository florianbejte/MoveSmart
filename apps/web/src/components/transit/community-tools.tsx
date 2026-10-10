"use client";
import {
	BusFront,
	Check,
	Construction,
	FileQuestion,
	MapPin,
	ShieldAlert,
	Star,
	ThumbsUp,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { reportForDeparture } from "@/lib/reports/departures";

export { reportForDeparture };

import { submitCommunity } from "@/lib/reports/client";
import {
	CROWDING,
	type CrowdingSummary,
	STOP_ISSUES,
	type StopIssueKind,
	type StopIssueSummary,
} from "@/lib/reports/types";
import { distance, freshVehicle } from "@/lib/transit/core";
import type { Stop, TransitRoute, Vehicle } from "@/lib/transit/types";
import "./community-tools.css";
export function DepartureCrowding({
	report,
	now,
}: {
	report?: CrowdingSummary;
	now: number;
}) {
	const item = CROWDING.find((c) => c.id === report?.level);
	return item && report ? (
		<small className="departure-crowding" style={{ color: item.color }}>
			Community · {item.label} ·{" "}
			{Math.max(1, Math.floor((now - report.updatedAt) / 60000))}m ago
		</small>
	) : null;
}
export function ConfirmReport({
	body,
	onDone,
	label = "Still accurate",
	disabled = false,
}: {
	body: unknown;
	onDone: () => void;
	label?: string;
	disabled?: boolean;
}) {
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState("");
	return (
		<div className="confirm-report">
			<button
				type="button"
				disabled={pending || disabled}
				onClick={async () => {
					setPending(true);
					setMessage("");
					try {
						await submitCommunity(body);
						setMessage("Thanks—confirmation saved.");
						onDone();
					} catch (e) {
						setMessage(e instanceof Error ? e.message : "Unable to confirm.");
					} finally {
						setPending(false);
					}
				}}
			>
				<ThumbsUp size={14} />
				{pending ? "Saving…" : label}
			</button>
			{message && <p role="status">{message}</p>}
		</div>
	);
}
export function StopCommunity({
	stop,
	issues,
	now,
	onReport,
	onRefresh,
	unavailable,
}: {
	stop: Stop;
	issues: StopIssueSummary[];
	now: number;
	onReport: () => void;
	onRefresh: () => void;
	unavailable: boolean;
}) {
	const active = issues.filter(
		(r) => r.stopId === stop.id && r.expiresAt > now,
	);
	return (
		<section className="stop-community" aria-label="Community stop reports">
			<div className="community-section-title">
				<strong>From the community</strong>
				<button type="button" onClick={onReport}>
					Report an issue
				</button>
			</div>
			{unavailable ? (
				<p>Reports are temporarily unavailable.</p>
			) : active.length === 0 ? (
				<p>No recent stop reports.</p>
			) : (
				active.map((r) => (
					<article key={r.id}>
						<strong>
							{STOP_ISSUES.find((x) => x.id === r.kind)?.label}
							{r.route ? ` · Route ${r.route}` : ""}
						</strong>
						<small>
							{Math.max(1, Math.floor((now - r.updatedAt) / 60000))} min ago ·{" "}
							{r.count} {r.count === 1 ? "report" : "reports"} · expires{" "}
							{new Date(r.expiresAt).toLocaleTimeString("en-GB", {
								timeZone: "Europe/Vilnius",
								hour: "2-digit",
								minute: "2-digit",
							})}
						</small>
						<ConfirmReport
							body={{ confirmId: r.id }}
							onDone={onRefresh}
							label={
								r.kind.startsWith("passed-")
									? "I saw this too"
									: "Still accurate"
							}
						/>
					</article>
				))
			)}
		</section>
	);
}
export function StopReportDialog({
	stop,
	vehicles,
	now,
	onClose,
	onSent,
}: {
	stop: Stop;
	vehicles: Vehicle[];
	now: number;
	onClose: () => void;
	onSent: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [kind, setKind] = useState<StopIssueKind | null>(null);
	const [vehicleId, setVehicleId] = useState("");
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState("");
	const [sent, setSent] = useState(false);
	const [reviewing, setReviewing] = useState(false);
	useEffect(() => {
		const el = dialog.current;
		el?.showModal();
		return () => el?.close();
	}, []);
	const passed = !!kind?.startsWith("passed-");
	const candidates = vehicles.filter(
		(v) =>
			v.tripId &&
			v.routeId &&
			stop.routeIds.includes(v.routeId) &&
			freshVehicle(v, now) &&
			distance(v, stop) <= 1000,
	);
	const vehicle = candidates.find((v) => v.id === vehicleId);
	const icons = [
		Construction,
		ShieldAlert,
		FileQuestion,
		MapPin,
		BusFront,
		BusFront,
	];
	return (
		<dialog
			ref={dialog}
			className="report-dialog"
			aria-labelledby="stop-report-title"
			onCancel={(e) => {
				e.preventDefault();
				if (!pending) onClose();
			}}
		>
			<header className="report-header">
				<span>Community report · Stop {stop.id}</span>
				<button
					type="button"
					aria-label="Close stop report"
					disabled={pending}
					onClick={onClose}
				>
					<X />
				</button>
			</header>
			<div className="report-body">
				<h2 id="stop-report-title">
					{sent
						? "Thanks for helping."
						: reviewing
							? "Ready to share?"
							: "What happened here?"}
				</h2>
				<p className="report-intro">
					{stop.name} · {stop.description}
				</p>
				{sent ? (
					<p role="status">Your report is now shared with other riders.</p>
				) : (
					<>
						<fieldset
							hidden={reviewing}
							className="stop-issue-choices"
							aria-label="Issue type"
						>
							{STOP_ISSUES.map((item, index) => {
								const Icon = icons[index];
								return (
									<button
										type="button"
										key={item.id}
										aria-pressed={kind === item.id}
										disabled={pending}
										onClick={() => setKind(item.id)}
									>
										<Icon size={25} />
										<strong>{item.label}</strong>
									</button>
								);
							})}
						</fieldset>
						{reviewing && (
							<div className="report-review">
								<strong>
									{STOP_ISSUES.find((item) => item.id === kind)?.label}
								</strong>
								<p>{stop.name}</p>
								{vehicle && (
									<p>
										Route {vehicle.route} · Vehicle {vehicle.number}
									</p>
								)}
								<button
									type="button"
									className="text-button"
									disabled={pending}
									onClick={() => setReviewing(false)}
								>
									Change report
								</button>
							</div>
						)}
						{passed && !reviewing && (
							<label className="passed-vehicle">
								Which bus passed this stop?
								<select
									value={vehicleId}
									onChange={(e) => setVehicleId(e.target.value)}
									disabled={pending}
								>
									<option value="">Choose the vehicle</option>
									{candidates.map((v) => (
										<option key={v.id} value={v.id}>
											{v.route} → {v.destination} · Vehicle {v.number}
										</option>
									))}
								</select>
								<small>
									Live buses serving this route within 1 km. The exact trip and
									platform are checked when you send.
								</small>
								{!candidates.length && (
									<p>No eligible buses nearby right now.</p>
								)}
							</label>
						)}
						<p className="report-context">
							{passed
								? "Bus-passed reports expire after 30 minutes."
								: "Stop issues expire after 24 hours unless confirmed again."}{" "}
							This is a community observation, not an official service alert.
						</p>
					</>
				)}
				{message && (
					<p className="report-error" role="alert">
						{message}
					</p>
				)}
			</div>
			<footer className="report-footer">
				<button
					type="button"
					className="report-submit"
					disabled={pending || (!sent && (!kind || (passed && !vehicle)))}
					onClick={async () => {
						if (sent) {
							onClose();
							return;
						}
						if (!reviewing) {
							setReviewing(true);
							return;
						}
						setPending(true);
						setMessage("");
						try {
							await submitCommunity({
								kind,
								stopId: stop.id,
								vehicleId: vehicle?.id,
								tripId: vehicle?.tripId,
							});
							setSent(true);
							onSent();
						} catch (e) {
							setMessage(e instanceof Error ? e.message : "Unable to send.");
						} finally {
							setPending(false);
						}
					}}
				>
					{pending
						? "Sending…"
						: sent
							? "Done"
							: reviewing
								? "Send report"
								: "Review report"}
					<Check size={18} />
				</button>
			</footer>
		</dialog>
	);
}
const KEY = "movesmart-favourites-v1";
type Saved = { stops: string[]; routes: string[] };
function decodeSaved(raw: string | null): Saved {
	try {
		const value = JSON.parse(raw ?? "{}");
		const list = (v: unknown) =>
			Array.isArray(v)
				? [
						...new Set(v.filter((id): id is string => typeof id === "string")),
					].slice(0, 200)
				: [];
		return { stops: list(value.stops), routes: list(value.routes) };
	} catch {
		return { stops: [], routes: [] };
	}
}
export function useFavourites() {
	const [saved, setSaved] = useState<Saved>({ stops: [], routes: [] });
	const [error, setError] = useState("");
	useEffect(() => {
		const load = () => {
			try {
				setSaved(decodeSaved(localStorage.getItem(KEY)));
			} catch {
				setError("This browser cannot store favourites.");
			}
		};
		load();
		window.addEventListener("storage", load);
		return () => window.removeEventListener("storage", load);
	}, []);
	return {
		saved,
		error,
		toggle: (type: keyof Saved, id: string) => {
			try {
				const current = decodeSaved(localStorage.getItem(KEY));
				const next = {
					...current,
					[type]: current[type].includes(id)
						? current[type].filter((x) => x !== id)
						: [...current[type], id].slice(-200),
				};
				localStorage.setItem(KEY, JSON.stringify(next));
				setSaved(next);
				setError("");
			} catch {
				setError("Could not save favourites in this browser.");
			}
		},
	};
}
export function FavouriteButton({
	active,
	onClick,
	label,
}: {
	active: boolean;
	onClick: () => void;
	label: string;
}) {
	return (
		<button
			className="favourite-button"
			type="button"
			aria-pressed={active}
			onClick={onClick}
		>
			<Star size={16} fill={active ? "currentColor" : "none"} />
			{active ? "Saved" : "Save"} {label}
		</button>
	);
}
export function SavedPanel({
	saved,
	stops,
	routes,
	onStop,
	onRoute,
	onRemove,
	onExplore,
}: {
	saved: Saved;
	stops: Stop[];
	routes: TransitRoute[];
	onStop: (id: string) => void;
	onRoute: (id: string) => void;
	onRemove: (type: keyof Saved, id: string) => void;
	onExplore: () => void;
}) {
	return (
		<section className="saved-panel" aria-label="Favourite stops and routes">
			<h2>Your shortcuts</h2>
			<p>Saved on this browser.</p>
			{!saved.stops.length && !saved.routes.length && (
				<div className="saved-empty">
					<Star size={36} />
					<h3>Keep your everyday stops close</h3>
					<p>Tap the star on a stop or route to find it here next time.</p>
					<button type="button" className="report-submit" onClick={onExplore}>
						Find nearby stops
					</button>
				</div>
			)}
			{(["stops", "routes"] as const)
				.filter((type) => saved[type].length > 0)
				.map((type) => (
					<div key={type}>
						<h3>
							{type === "stops" ? "Stops" : "Routes"} · {saved[type].length}
						</h3>
						{saved[type].map((id) => {
							const item =
								type === "stops"
									? stops.find((s) => s.id === id)
									: routes.find((r) => r.id === id);
							return (
								<div className="saved-item" key={id}>
									<button
										type="button"
										disabled={!item}
										onClick={() =>
											type === "stops" ? onStop(id) : onRoute(id)
										}
									>
										{type === "stops" ? (
											<MapPin size={17} />
										) : (
											<BusFront size={17} />
										)}
										<span>
											<strong>
												{item?.name ?? "Unavailable in current feed"}
											</strong>
											<small>
												{item &&
													("description" in item
														? item.description
														: item.title)}
											</small>
										</span>
									</button>
									<button
										type="button"
										aria-label={`Remove ${item?.name ?? id} from favourites`}
										onClick={() => onRemove(type, id)}
									>
										<X size={16} />
									</button>
								</div>
							);
						})}
					</div>
				))}
		</section>
	);
}
