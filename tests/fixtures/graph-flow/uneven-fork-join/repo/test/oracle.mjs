import assert from "node:assert/strict";
import { buildLabel } from "../src/label/label.js";
import { renderReport } from "../src/report/report.js";
import { compileCatalog } from "../src/slow/catalog.js";
import { normalizeToken } from "../src/token/token.js";

assert.equal(normalizeToken("  Alpha BETA  "), "alpha-beta");
assert.equal(buildLabel("  Alpha BETA  ", 7), "alpha-beta#7");
assert.deepEqual(compileCatalog([" beta ", "alpha", "ALPHA", "gamma "]), [
	"alpha",
	"beta",
	"gamma",
]);
assert.equal(
	renderReport([" beta ", "alpha", "ALPHA"], " Build One ", 3),
	"alpha,beta | build-one#3",
);
console.log("oracle ok");
