import { strict as assert } from "node:assert";
import { test } from "node:test";
import { reportOrigin } from "./origin";

const host = "florians-macbook-pro.bigscale-ide.ts.net";
test("accepts public HTTPS reports behind the internal HTTP listener", () => {
	const request = new Request("http://localhost:3002/api/reports", {
		headers: { host, origin: `https://${host}` },
	});
	assert.equal(reportOrigin(request)?.protocol, "https:");
});
test("accepts local development with its exact port", () => {
	assert.ok(
		reportOrigin(
			new Request("http://localhost:3001/api/reports", {
				headers: { origin: "http://localhost:3001" },
			}),
		),
	);
});
test("rejects foreign, missing, opaque, malformed and wrong-port origins", () => {
	for (const origin of [
		undefined,
		"null",
		"https://evil.example",
		`https://${host}:444`,
		`https://${host}/path`,
		`https://${host}.evil.example`,
	]) {
		assert.equal(
			reportOrigin(
				new Request("http://localhost:3002/api/reports", {
					headers: {
						host,
						...(origin ? { origin } : {}),
						"x-forwarded-host": "evil.example",
					},
				}),
			),
			null,
		);
	}
});
test("rejects HTTP origins on direct HTTPS requests", () => {
	assert.equal(
		reportOrigin(
			new Request(`https://${host}/api/reports`, {
				headers: { origin: `http://${host}` },
			}),
		),
		null,
	);
});
