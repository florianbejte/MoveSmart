"use client";

import { ChevronDown, Sigma } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/i18n/react";
import {
	FEEL_TERMS,
	type RankedOption,
	type Term,
	type Weights,
} from "@/lib/plan/options";

const COLORS: Record<Term["id"], string> = {
	ride: "#414454",
	walk: "#59c355",
	wait: "#b1b7c9",
	transfers: "#f09f86",
	crowding: "#ed2891",
	delay: "#7e2324",
	cost: "#bdd947",
	co2: "#6b6b6b",
	city: "#c3c3c3",
};

/** "How we ranked this": the rider's own C_u(r) with their weights and every term's numbers. */
export function FormulaDetails({
	option,
	weights,
	runnerUp,
}: {
	option: RankedOption;
	weights: Weights;
	runnerUp?: RankedOption;
}) {
	const uiText = useT();
	const [open, setOpen] = useState(false);
	return (
		<div className="formula-details">
			<button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
				<Sigma size={14} />
				{uiText(" How we ranked this ")}
				<ChevronDown size={14} className={open ? "flip" : ""} />
			</button>
			{open && (
				<div className="formula-panel">
					<p className="formula-note">
						{uiText(
							" We compare every option with your personal formula: the time on board plus walking, waiting, changes, crowding and delays, each weighted by your answers: ",
						)}
					</p>
					<p className="formula-equation">
						C<sub>u</sub>(r) = T<sub>{uiText("ride")}</sub> +{" "}
						<b>{weights.alpha}</b>·<b>{weights.m}</b>·T
						<sub>{uiText("walk")}</sub> + <b>{weights.beta}</b>·T
						<sub>{uiText("wait")}</sub> + <b>{weights.gamma}</b>·N
						<sub>{uiText("transfers")}</sub> + <b>{weights.delta}</b>·Q
						<sub>{uiText("crowding")}</sub> + <b>{weights.eta}</b>·D
						<sub>{uiText("delay")}</sub>
					</p>
					<p className="formula-note">
						{uiText(" Bold numbers are ")}
						<strong>{uiText("your")}</strong>
						{uiText(" weights from the questionnaire ")}
						{weights.weather.length
							? ` and today’s weather (${weights.weather.join(", ")})`
							: ""}
						{uiText(
							" . MoveSmart adds price and the city’s CO₂, so greener trips win ties. ",
						)}
					</p>
					<table>
						<tbody>
							{option.terms
								.filter((t) => FEEL_TERMS.includes(t.id))
								.map((t) => (
									<TermRow key={t.id} term={t} />
								))}
						</tbody>
						<tfoot>
							<tr>
								<td />
								<td>{uiText("Time, weighted for you")}</td>
								<td>
									{option.feels}
									{uiText(" min")}
								</td>
							</tr>
						</tfoot>
					</table>
					<p className="formula-note">
						<strong>{uiText("Also counted")}</strong>
						{uiText(" — so cheaper and greener trips rank higher: ")}
					</p>
					<table>
						<tbody>
							{option.terms
								.filter((t) => !FEEL_TERMS.includes(t.id))
								.map((t) => (
									<TermRow key={t.id} term={t} />
								))}
						</tbody>
						<tfoot>
							<tr>
								<td />
								<td>{uiText("Ranking score (lower is better)")}</td>
								<td>{option.score}</td>
							</tr>
						</tfoot>
					</table>
					{runnerUp && (
						<p className="formula-note">
							{runnerUp.score > option.score && runnerUp.promoted
								? `Scores ${runnerUp.score - option.score} points better than “${runnerUp.label}”, which we still show first because it’s much better for Vilnius.`
								: runnerUp.score > option.score
									? `Ranks ${runnerUp.score - option.score} points ahead of “${runnerUp.label}”.`
									: option.promoted
										? `“${runnerUp.label}” scores ${option.score - runnerUp.score} points better for you, but this way is much better for Vilnius — so we show it first.`
										: ""}
						</p>
					)}
				</div>
			)}
		</div>
	);
}

function TermRow({ term: t }: { term: Term }) {
	const uiText = useT();
	return (
		<tr className={t.minutes < 0.05 ? "zero" : ""}>
			<td>
				<i style={{ background: COLORS[t.id] }} />
			</td>
			<td>
				<strong>{uiText(t.label)}</strong>
				<small>{uiText(t.detail)}</small>
			</td>
			<td>{t.minutes}</td>
		</tr>
	);
}
