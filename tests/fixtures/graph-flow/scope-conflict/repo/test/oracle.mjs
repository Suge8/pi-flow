import assert from "node:assert/strict";
import { alphaScore } from "../src/alpha/alpha.js";
import { betaScore } from "../src/beta/beta.js";
import { applyPolicy } from "../src/global/policy.js";
import { summarizeScores } from "../src/report/report.js";

assert.equal(applyPolicy("  MIXED Case "), "mixed case");
assert.equal(alphaScore([1, 2, 3]), 6);
assert.equal(betaScore([2, 3, 4]), 24);
assert.equal(summarizeScores([1, 2, 3], [2, 3, 4]), "alpha=6;beta=24");
console.log("oracle ok");
