"use client";
import { useT } from "@/lib/i18n/react";

import "./crowding-report.css";
import {
	Armchair,
	ArrowLeft,
	Check,
	CheckCheck,
	MessageCirclePlus,
	UserRound,
	UsersRound,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	CROWDING,
	type Crowding,
	type CrowdingSummary,
} from "@/lib/reports/types";
import { freshVehicle } from "@/lib/transit/core";
import { serviceColor } from "@/lib/transit/service-colors";
import type { Vehicle } from "@/lib/transit/types";

export function CrowdingArt({ level }: { level: Crowding }) {
	const _t = useT();

	const Icon =
		level === "seats"
			? Armchair
			: level === "standing"
				? UserRound
				: UsersRound;
	return (
		<span className={`crowding-art ${level}`}>
			<Icon size={40} strokeWidth={1.8} />
		</span>
	);
}
export function CrowdingCard({
	report,
	unavailable,
	onReport,
}: {
	report?: CrowdingSummary;
	unavailable: boolean;
	onReport: () => void;
}) {
	const t = useT();

	const item = CROWDING.find((x) => x.id === report?.level);
	return (
		<section className="crowding-card" aria-label={t("Community crowding")}>
			<div className="crowding-card-title">
				<UsersRound size={17} />
				<strong>{t("On board, right now")}</strong>
				<span>{t("Community")}</span>
			</div>
			{item && report ? (
				<div className="crowding-card-result">
					<CrowdingArt level={item.id} />
					<div>
						<strong>{t(item.label)}</strong>
						<p>
							{t(
								Math.max(
									0,
									Math.floor((Date.now() - report.updatedAt) / 60000),
								) || "Less than 1",
							)}
							{t(" ")}
							{t("min ago · ")}
							{t(report.count)}
							{t(" ")}
							{t(report.count === 1 ? "report" : "reports")}
						</p>
					</div>
				</div>
			) : (
				<p>
					{t(
						unavailable
							? "Community reports are unavailable right now."
							: "No recent reports. On this bus? Help the next rider.",
					)}
				</p>
			)}
			<button type="button" onClick={onReport}>
				<MessageCirclePlus size={17} />
				{t(item ? "Update crowding" : "Report crowding")}
			</button>
		</section>
	);
}
export function CrowdingReport({
	initialVehicle,
	vehicles,
	now,
	onClose,
	onSent,
}: {
	initialVehicle?: Vehicle;
	vehicles: Vehicle[];
	now: number;
	onClose: () => void;
	onSent: (vehicle: Vehicle) => void;
}) {
	const t = useT();

	const dialog = useRef<HTMLDialogElement>(null);
	const [vehicle, setVehicle] = useState<Vehicle | undefined>(initialVehicle);
	const [level, setLevel] = useState<Crowding | null>(null);
	const [query, setQuery] = useState("");
	const [sending, setSending] = useState(false);
	const [error, setError] = useState("");
	const [sent, setSent] = useState(false);
	useEffect(() => {
		const element = dialog.current;
		element?.showModal();
		return () => element?.close();
	}, []);
	const valid =
		!!vehicle?.tripId &&
		vehicles.some(
			(v) =>
				v.id === vehicle.id &&
				v.tripId === vehicle.tripId &&
				freshVehicle(v, now),
		);
	const matches = vehicles
		.filter(
			(v) =>
				v.tripId &&
				freshVehicle(v, now) &&
				`${v.route} ${v.destination} ${v.number}`
					.toLocaleLowerCase()
					.includes(query.toLocaleLowerCase()),
		)
		.slice(0, 24);
	async function send() {
		if (!vehicle || !level || !valid || sending) return;
		setSending(true);
		setError("");
		try {
			const response = await fetch("/api/reports", {
				method: "POST",
				signal: AbortSignal.timeout(15000),
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					vehicleId: vehicle.id,
					tripId: vehicle.tripId,
					level,
				}),
			});
			const result = await response.json();
			if (!response.ok)
				throw new Error(result.error || "Unable to send report.");
			setSent(true);
			onSent(vehicle);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Unable to send report.");
		} finally {
			setSending(false);
		}
	}
	return (
		<dialog
			ref={dialog}
			className="report-dialog"
			aria-labelledby="report-title"
			onCancel={(e) => {
				e.preventDefault();
				if (!sending) onClose();
			}}
		>
			<header className="report-header">
				<button
					type="button"
					aria-label={t("Back to vehicle selection")}
					disabled={!vehicle || sending || sent}
					onClick={() => {
						setVehicle(undefined);
						setLevel(null);
						setError("");
					}}
				>
					<ArrowLeft size={21} />
				</button>
				<span>{t("Riders helping riders")}</span>
				<button
					type="button"
					aria-label={t("Close report")}
					disabled={sending}
					onClick={onClose}
				>
					<X size={22} />
				</button>
			</header>
			{sent ? (
				<div className="report-success">
					<span className="report-success-mark">
						<CheckCheck size={46} />
					</span>
					<h2 id="report-title">{t("Thanks for the heads-up.")}</h2>
					<p>
						{t(
							"Your crowding report is shared for this trip. It expires in 15 minutes.",
						)}
					</p>
					<button className="report-submit" type="button" onClick={onClose}>
						{t("View this bus")}
					</button>
				</div>
			) : (
				<>
					<div className="report-body">
						<span className="flow-eyebrow">
							{t(
								vehicle ? "Step 2 of 2 · Occupancy" : "Step 1 of 2 · Your bus",
							)}
						</span>
						<h2 id="report-title">
							{t(vehicle ? "How’s the ride?" : "Which bus are you on?")}
						</h2>
						<p className="report-intro">
							{t(
								vehicle
									? "A quick update makes someone else’s journey easier."
									: "Choose the exact vehicle. Match the route, destination and vehicle number.",
							)}
						</p>
						{vehicle ? (
							<>
								<div className="report-vehicle">
									<span
										style={{
											background: serviceColor(vehicle.route, vehicle.mode),
										}}
									>
										{t(vehicle.route)}
									</span>
									<div>
										<strong>
											{t(vehicle.destination || "Destination unavailable")}
										</strong>
										<small>
											{t(vehicle.mode === "bus" ? "Bus" : "Trolleybus")}
											{t(" · Vehicle")}
											{t(" ")}
											{t(vehicle.number)}
										</small>
									</div>
								</div>
								<fieldset
									className="crowding-choices"
									aria-label={t("Crowding level")}
								>
									{CROWDING.map((item) => (
										<button
											key={item.id}
											type="button"
											aria-pressed={level === item.id}
											disabled={sending}
											onClick={() => setLevel(item.id)}
										>
											<CrowdingArt level={item.id} />
											<strong>{t(item.label)}</strong>
											<small>{t(item.description)}</small>
											<span className="choice-check">
												{level === item.id ? <Check size={14} /> : null}
											</span>
										</button>
									))}
								</fieldset>
								<p className="report-context">
									{t(
										"Report what you can see on this vehicle now. Community reports are separate from official transport data.",
									)}
								</p>
								{!valid && (
									<p role="alert" className="report-error">
										{t(
											"This vehicle no longer has a fresh position for this trip. Go back and choose a live bus.",
										)}
									</p>
								)}
							</>
						) : (
							<>
								<input
									className="report-search"
									aria-label={t("Find a bus to report")}
									placeholder={t("Route, destination or vehicle number")}
									value={query}
									onChange={(e) => setQuery(e.target.value)}
								/>
								<div className="report-vehicle-list">
									{matches.map((v) => (
										<button
											type="button"
											key={v.id}
											onClick={() => setVehicle(v)}
										>
											<span
												style={{
													background: serviceColor(v.route, v.mode),
												}}
											>
												{t(v.route)}
											</span>
											<div>
												<strong>
													{t(v.destination || "Destination unavailable")}
												</strong>
												<small>
													{t("Vehicle ")}
													{t(v.number)} ·{t(" ")}
													{t(v.mode === "bus" ? "Bus" : "Trolleybus")}
												</small>
											</div>
											<ArrowLeft className="report-forward" size={18} />
										</button>
									))}
									{matches.length === 0 && (
										<p>{t("No live vehicles match. Try a route number.")}</p>
									)}
								</div>
							</>
						)}
						{error && (
							<p role="alert" className="report-error">
								{t(error)}
							</p>
						)}
					</div>
					<footer className="report-footer">
						<p>
							{t(
								"No name or location is published. One current report per device and trip.",
							)}
						</p>
						{vehicle && (
							<button
								className="report-submit"
								type="button"
								disabled={!level || sending || !valid}
								onClick={send}
							>
								{t(sending ? "Sending…" : "Send report")}
								<MessageCirclePlus size={19} />
							</button>
						)}
					</footer>
				</>
			)}
		</dialog>
	);
}
