"use client";

import {
	ArrowLeft,
	ArrowRight,
	Bike,
	Car,
	Check,
	CloudRain,
	Footprints,
	Ticket,
	X,
	Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	DEFAULT_PROFILE,
	NEEDS,
	PRIORITIES,
	type Profile,
	persona,
} from "@/lib/plan/profile";

const STEPS = ["Who", "Have", "Matters", "Walking", "Ready"] as const;
const WALK_LIMITS = [5, 10, 15, 25];
const CARES = {
	speed: "speed",
	comfort: "comfort",
	cost: "low cost",
	eco: "low emissions",
	certainty: "reliability",
} as const;

/** Five short questions that turn into the rider's travel profile. */
export function Onboarding({
	initial,
	onDone,
	onSkip,
	doneLabel = "Plan my trips",
}: {
	initial: Profile | null;
	onDone: (profile: Profile) => void;
	/** Closing without finishing; when editing, this cancels without saving. */
	onSkip: () => void;
	doneLabel?: string;
}) {
	const [step, setStep] = useState(0);
	const [p, setP] = useState<Profile>(initial ?? DEFAULT_PROFILE);
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		dialog.current?.showModal();
	}, []);
	const toggle = <T,>(list: T[], item: T) =>
		list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
	const last = step === STEPS.length - 1;
	return (
		<dialog
			ref={dialog}
			className="onboarding"
			aria-labelledby="onboarding-title"
			onCancel={(e) => {
				e.preventDefault();
				onSkip();
			}}
		>
			<div className="onboarding-top">
				<ol className="onboarding-steps" aria-label="Progress">
					{STEPS.map((s, i) => (
						<li
							key={s}
							className={i <= step ? "done" : ""}
							aria-current={i === step ? "step" : undefined}
						>
							<span className="sr-only">{s}</span>
						</li>
					))}
				</ol>
				<button
					type="button"
					className="onboarding-close"
					aria-label="Skip for now"
					onClick={onSkip}
				>
					<X size={18} />
				</button>
			</div>
			{step === 0 && (
				<section>
					<span className="flow-eyebrow">
						Step {step + 1} of {STEPS.length} · Your travel preferences
					</span>
					<h2 id="onboarding-title">Who’s usually travelling?</h2>
					<p>
						We’ll suggest the way that suits you — bus, walk, bike, scooter or
						car. Pick any that apply.
					</p>
					<div className="choice-grid">
						<Choice
							selected={!p.needs.length}
							onClick={() => setP({ ...p, needs: [] })}
							label="Just me"
							hint="No special needs"
						/>
						{NEEDS.map((n) => (
							<Choice
								key={n.id}
								selected={p.needs.includes(n.id)}
								onClick={() => setP({ ...p, needs: toggle(p.needs, n.id) })}
								label={n.label}
								hint={n.hint}
							/>
						))}
					</div>
				</section>
			)}
			{step === 1 && (
				<section>
					<span className="flow-eyebrow">
						Step {step + 1} of {STEPS.length} · Your travel preferences
					</span>
					<h2 id="onboarding-title">What can you use?</h2>
					<p>We only suggest what you actually have.</p>
					<div className="choice-grid">
						<Choice
							icon={<Car size={20} />}
							selected={p.hasCar}
							onClick={() => setP({ ...p, hasCar: !p.hasCar })}
							label="A car"
							hint="We’ll compare it honestly"
						/>
						<Choice
							icon={<Bike size={20} />}
							selected={p.hasBike}
							onClick={() => setP({ ...p, hasBike: !p.hasBike })}
							label="My own bike"
						/>
						<Choice
							icon={<Zap size={20} />}
							selected={p.sharedOk}
							onClick={() => setP({ ...p, sharedOk: !p.sharedOk })}
							label="Shared bikes & scooters"
							hint="Bolt, CityBee and others"
						/>
						<Choice
							icon={<Ticket size={20} />}
							selected={p.hasPass}
							onClick={() => setP({ ...p, hasPass: !p.hasPass })}
							label="A transit pass"
							hint="Rides cost nothing extra"
						/>
					</div>
				</section>
			)}
			{step === 2 && (
				<section>
					<span className="flow-eyebrow">
						Step {step + 1} of {STEPS.length} · Your travel preferences
					</span>
					<h2 id="onboarding-title">What matters most?</h2>
					<p>Choose up to two. They decide how we rank your options.</p>
					<div className="choice-grid">
						{PRIORITIES.map((x) => (
							<Choice
								key={x.id}
								selected={p.priorities.includes(x.id)}
								onClick={() => {
									const next = toggle(p.priorities, x.id).slice(-2);
									setP({ ...p, priorities: next.length ? next : [x.id] });
								}}
								label={x.label}
								hint={x.hint}
							/>
						))}
					</div>
				</section>
			)}
			{step === 3 && (
				<section>
					<span className="flow-eyebrow">
						Step {step + 1} of {STEPS.length} · Your travel preferences
					</span>
					<h2 id="onboarding-title">How far will you walk?</h2>
					<p>Longer walks get a penalty when we compare routes.</p>
					<fieldset className="walk-limits">
						<legend className="sr-only">Longest comfortable walk</legend>
						{WALK_LIMITS.map((m) => (
							<button
								type="button"
								key={m}
								aria-pressed={p.walkLimit === m}
								onClick={() => setP({ ...p, walkLimit: m })}
							>
								<Footprints size={16} />
								{m === 25 ? "20+ min" : `${m} min`}
							</button>
						))}
					</fieldset>
					<Choice
						icon={<CloudRain size={20} />}
						selected={p.weatherSensitive}
						onClick={() =>
							setP({ ...p, weatherSensitive: !p.weatherSensitive })
						}
						label="Rain and cold change my plans"
						hint="Weather counts double for you"
					/>
				</section>
			)}
			{last && (
				<section className="onboarding-summary">
					<span className="flow-eyebrow">
						Step {step + 1} of {STEPS.length} · Your travel preferences
					</span>
					<h2 id="onboarding-title">{persona(p)}</h2>
					<p>
						Every trip is ranked for you using live buses, weather and your
						answers. Your profile stays on this device.
					</p>
					<ul>
						<li>
							<Check size={15} />
							{p.needs.length
								? NEEDS.filter((n) => p.needs.includes(n.id))
										.map((n) => n.label)
										.join(", ")
								: "Travelling light"}
						</li>
						<li>
							<Check size={15} />
							Cares about {p.priorities.map((x) => CARES[x]).join(" and ")}
						</li>
						<li>
							<Check size={15} />
							Walks up to {p.walkLimit === 25 ? "20+" : p.walkLimit} min
						</li>
					</ul>
				</section>
			)}
			<div className="onboarding-actions">
				{step > 0 ? (
					<button
						type="button"
						className="onboarding-back"
						onClick={() => setStep(step - 1)}
					>
						<ArrowLeft size={16} />
						Back
					</button>
				) : (
					<button type="button" className="onboarding-back" onClick={onSkip}>
						{initial ? "Cancel" : "Skip"}
					</button>
				)}
				<button
					type="button"
					className="onboarding-next"
					onClick={() => (last ? onDone(p) : setStep(step + 1))}
				>
					{last ? doneLabel : "Next"}
					<ArrowRight size={16} />
				</button>
			</div>
		</dialog>
	);
}

function Choice({
	selected,
	onClick,
	label,
	hint,
	icon,
}: {
	selected: boolean;
	onClick: () => void;
	label: string;
	hint?: string;
	icon?: React.ReactNode;
}) {
	return (
		<button
			type="button"
			className="choice"
			aria-pressed={selected}
			onClick={onClick}
		>
			{icon && <span className="choice-icon">{icon}</span>}
			<span className="choice-text">
				<strong>{label}</strong>
				{hint && <small>{hint}</small>}
			</span>
			<span className="choice-check" aria-hidden="true">
				{selected && <Check size={14} />}
			</span>
		</button>
	);
}
