import { strict as assert } from "node:assert";
import { test } from "node:test";
import { serviceColor } from "./service-colors";

test("official colours cover overlapping bus numbers and special services", () => {
	assert.equal(serviceColor("4", "bus"), "#0073AC");
	assert.equal(serviceColor("4", "trolleybus"), "#DC3131");
	for (const route of ["1G", "6G", "3G-A"])
		assert.equal(serviceColor(route, "bus"), "#008000");
	assert.equal(serviceColor("N9", "bus"), "#000000");
	assert.equal(serviceColor("L1", "other"), "#00A59B");
	assert.equal(serviceColor("4", "bus", "#123456"), "#123456");
	assert.equal(serviceColor("4", "bus", "invalid"), "#0073AC");
});
