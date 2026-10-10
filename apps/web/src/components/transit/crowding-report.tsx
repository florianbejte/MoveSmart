"use client";
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
	const item = CROWDING.find((x) => x.id === report?.level);
	return (
		<section className="crowding-card" aria-label="Community crowding">
			<div className="crowding-card-title">
				<UsersRound size={17} />
				<strong>On board, right now</strong>
				<span>Community</span>
			</div>
			{item && report ? (
				<div className="crowding-card-result">
					<CrowdingArt level={item.id} />
					<div>
						<strong>{item.label}</strong>
						<p>
							{Math.max(
								0,
								Math.floor((Date.now() - report.updatedAt) / 60000),
							) || "Less than 1"}{" "}
							min ago · {report.count}{" "}
							{report.count === 1 ? "report" : "reports"}
						</p>
					</div>
				</div>
			) : (
				<p>
					{unavailable
						? "Community reports are unavailable right now."
						: "No recent reports. On this bus? Help the next rider."}
				</p>
			)}
			<button type="button" onClick={onReport}>
				<MessageCirclePlus size={17} />
				{item ? "Update crowding" : "Report crowding"}
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
					aria-label="Back to vehicle selection"
					disabled={!vehicle || sending || sent}
					onClick={() => {
						setVehicle(undefined);
						setLevel(null);
						setError("");
					}}
				>
					<ArrowLeft size={21} />
				</button>
				<span>Riders helping riders</span>
				<button
					type="button"
					aria-label="Close report"
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
					<h2 id="report-title">Thanks for the heads-up.</h2>
					<p>
						Your crowding report is shared for this trip. It expires in 15
						minutes.
					</p>
					<button className="report-submit" type="button" onClick={onClose}>
						View this bus
					</button>
				</div>
			) : (
				<>
					<div className="report-body">
						<h2 id="report-title">
							{vehicle ? "How’s the ride?" : "Which bus are you on?"}
						</h2>
						<p className="report-intro">
							{vehicle
								? "A quick update makes someone else’s journey easier."
								: "Choose the exact vehicle. Match the route, destination and vehicle number."}
						</p>
						{vehicle ? (
							<>
								<div className="report-vehicle">
									<span
										style={{
											background: serviceColor(vehicle.route, vehicle.mode),
										}}
									>
										{vehicle.route}
									</span>
									<div>
										<strong>
											{vehicle.destination || "Destination unavailable"}
										</strong>
										<small>
											{vehicle.mode === "bus" ? "Bus" : "Trolleybus"} · Vehicle{" "}
											{vehicle.number}
										</small>
									</div>
								</div>
								<fieldset
									className="crowding-choices"
									aria-label="Crowding level"
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
											<strong>{item.label}</strong>
											<small>{item.description}</small>
											<span className="choice-check">
												{level === item.id ? <Check size={14} /> : null}
											</span>
										</button>
									))}
								</fieldset>
								<p className="report-context">
									Report what you can see on this vehicle now. Community reports
									are separate from official transport data.
								</p>
								{!valid && (
									<p role="alert" className="report-error">
										This vehicle no longer has a fresh position for this trip.
										Go back and choose a live bus.
									</p>
								)}
							</>
						) : (
							<>
								<input
									className="report-search"
									aria-label="Find a bus to report"
									placeholder="Route, destination or vehicle number"
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
												style={{ background: serviceColor(v.route, v.mode) }}
											>
												{v.route}
											</span>
											<div>
												<strong>
													{v.destination || "Destination unavailable"}
												</strong>
												<small>
													Vehicle {v.number} ·{" "}
													{v.mode === "bus" ? "Bus" : "Trolleybus"}
												</small>
											</div>
											<ArrowLeft className="report-forward" size={18} />
										</button>
									))}
									{matches.length === 0 && (
										<p>No live vehicles match. Try a route number.</p>
									)}
								</div>
							</>
						)}
						{error && (
							<p role="alert" className="report-error">
								{error}
							</p>
						)}
					</div>
					<footer className="report-footer">
						<p>
							No name or location is published. One current report per device
							and trip.
						</p>
						{vehicle && (
							<button
								className="report-submit"
								type="button"
								disabled={!level || sending || !valid}
								onClick={send}
							>
								{sending ? "Sending…" : "Send report"}
								<MessageCirclePlus size={19} />
							</button>
						)}
					</footer>
				</>
			)}
		</dialog>
	);
}
