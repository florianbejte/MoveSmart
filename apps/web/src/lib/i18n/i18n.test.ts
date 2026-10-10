import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { NEEDS, PRIORITIES } from "../plan/profile";
import { CROWDING, STOP_ISSUES } from "../reports/types";
import { CITY_LAYERS } from "../transit/city";
import { getLanguage, getServerLanguage, setLanguage, translate } from "./core";
import { lithuanian, templates } from "./lt";

describe("Lithuanian and English", () => {
	test("Lithuanian is the default and English keeps the original copy", () => {
		assert.equal(getServerLanguage(), "lt");
		assert.equal(translate("Plan a trip", "lt"), "Planuoti kelionę");
		assert.equal(translate("Plan a trip", "en"), "Plan a trip");
		setLanguage("en");
		assert.equal(getLanguage(), "en");
		setLanguage("lt");
		assert.equal(getLanguage(), "lt");
	});
	test("all choices and layer explanations have translations", () => {
		for (const item of [
			...NEEDS,
			...PRIORITIES,
			...CROWDING,
			...STOP_ISSUES,
			...CITY_LAYERS,
		]) {
			for (const key of ["label", "hint", "description", "note"] as const) {
				const value = (item as unknown as Record<string, string>)[key];
				if (value) assert.notEqual(lithuanian[value], undefined, value);
			}
		}
	});
	test("dynamic labels preserve route numbers, destinations and values", () => {
		assert.equal(translate("Route 4G + 2", "lt"), "Maršrutai 4G + 2");
		assert.equal(
			translate("Bus 4G to Saulėtekis, vehicle 8013", "lt"),
			"Autobusas 4G, kryptis Saulėtekis, transporto priemonė 8013",
		);
		assert.equal(
			translate("Vinco Kudirkos aikštė", "lt"),
			"Vinco Kudirkos aikštė",
		);
		assert.equal(translate("4G", "lt"), "4G");
		assert.ok(
			translate(
				"Showing routes from this platform. Check departures for service times.",
				"lt",
			).includes("Rodomi šios stotelės"),
		);
	});
	test("multiline shelter data and compound community reports translate fully", () => {
		assert.equal(
			translate(
				"Vilniaus g. 10\nPublished capacity: 100 people\n24-hour entry: Yes\nArea: 200 m²",
				"lt",
			),
			"Vilniaus g. 10\nPaskelbta talpa: 100 žmonių\nPatekimas visą parą: Taip\nPlotas: 200 m²",
		);
		assert.equal(
			translate("Damaged shelter · Route 4G · Blocked access", "lt"),
			"Sugadintas stotelės paviljonas · Maršrutas 4G · Užblokuotas priėjimas",
		);
	});
	test("formats local prices and preserves non-text children", () => {
		assert.equal(translate("from €3.90", "lt"), "nuo 3,90 €");
		assert.equal(translate("1.2 km", "lt"), "1,2 km");
		assert.equal(translate(5, "lt"), 5);
		const object = { name: "Route 4G" };
		assert.equal(translate(object, "lt"), object);
	});
	test("translation templates preserve every interpolation", () => {
		for (const [source, target] of Object.entries(templates))
			assert.deepEqual(
				target.match(/\{\d+\}/g)?.sort(),
				source.match(/\{\d+\}/g)?.sort(),
				source,
			);
	});
});

test("all literal display messages have Lithuanian translations", async () => {
	const { readFileSync, readdirSync } = await import("node:fs");
	const { join } = await import("node:path");
	const ts = await import("typescript");
	const untranslated = new Set<string>();
	const roots = [
		new URL("../../components", import.meta.url).pathname,
		new URL("../../app/dashboard", import.meta.url).pathname,
	];
	const branded = new Set([
		"MOVE SMART · VILNIUS",
		"MOVE",
		"SMART",
		"Vilnius",
		"LT",
		"EN",
		"CO₂",
		"km/h",
		"C",
		"u",
		"(r) = T",
		"C(r) = T",
		"·T",
		"·N",
		"·Q",
		"·D",
		"·m(W)·T",
	]);
	function inspect(directory: string) {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const file = join(directory, entry.name);
			if (entry.isDirectory()) inspect(file);
			else if (/\.tsx?$/.test(file)) {
				const source = ts.createSourceFile(
					file,
					readFileSync(file, "utf8"),
					ts.ScriptTarget.Latest,
					true,
				);
				function check(value: string) {
					const key = value.trim();
					if (
						key &&
						/[a-z]/i.test(key) &&
						!branded.has(key) &&
						translate(key, "lt") === key
					)
						untranslated.add(key);
				}
				function display(node: import("typescript").Node) {
					if (ts.isStringLiteral(node)) check(node.text);
					if (ts.isConditionalExpression(node)) {
						display(node.whenTrue);
						display(node.whenFalse);
					}
				}
				function visit(node: import("typescript").Node) {
					if (
						ts.isCallExpression(node) &&
						["t", "mapText", "uiText"].includes(
							node.expression.getText(source),
						) &&
						node.arguments.length === 1
					)
						display(node.arguments[0]);
					if (ts.isJsxText(node)) check(node.text.replace(/\s+/g, " "));
					ts.forEachChild(node, visit);
				}
				visit(source);
			}
		}
	}
	roots.forEach(inspect);
	assert.deepEqual([...untranslated], []);
});
