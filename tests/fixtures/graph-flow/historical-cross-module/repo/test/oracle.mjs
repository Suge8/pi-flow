import assert from "node:assert/strict";
import { readyNodes } from "../src/graph/ready.js";
import { selectReady } from "../src/scheduler/select.js";
import { scopesOverlap } from "../src/scope/overlap.js";
import { scheduleSummary } from "../src/summary/summary.js";

const nodes = [
	{ dependsOn: [], status: "complete", scope: "src/a/**" },
	{ dependsOn: [0], status: "pending", scope: "src/a/nested/**" },
	{ dependsOn: [0], status: "pending", scope: "src/b/**" },
	{ dependsOn: [1, 2], status: "pending", scope: "src/out/**" },
];
assert.deepEqual(readyNodes(nodes), [1, 2]);
assert.equal(scopesOverlap("src/a/**", "src/a/nested/**"), true);
assert.equal(scopesOverlap("src/a/**", "src/b/**"), false);
assert.deepEqual(selectReady(nodes, 2), [1, 2]);
assert.equal(scheduleSummary(nodes, 2), "ready:1,2");
console.log("oracle ok");
