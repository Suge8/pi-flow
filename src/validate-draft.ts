#!/usr/bin/env node
import { resolve } from "node:path";
import { validateDraftDir } from "./flow/validator.js";
import { localizeErrors } from "./shared/error-language.js";

const input = process.argv[2];
if (!input)
	fail(localizeErrors(["用法：node dist/validate-draft.js <.flow/F1>"]));

const dir = resolve(input);
const result = validateDraftDir(dir);
if (!result.ok) fail(result.errors);
console.log(`OK ${dir}`);

function fail(errors: string[]): never {
	console.error(errors.join("\n"));
	process.exit(1);
}
