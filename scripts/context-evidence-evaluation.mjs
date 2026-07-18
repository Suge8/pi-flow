const BLOCK_HEADER = /^\[[^\]\n]+\] \[(?:entry|call):[^\]\n]+\][^\n]*$/gmu;
const BLOCK_LOCATOR = /\[((?:entry|call):[A-Za-z0-9._:-]+)\]/gu;

export function scoreStructuredOutput(output, benchmark, evidenceText) {
	const parsed = parseJsonObject(output);
	const leakedInternal = benchmark.expected.forbidden.some((value) =>
		output.includes(value),
	);
	if (!hasEvaluationArrays(parsed))
		return emptyScore(leakedInternal, "contract:invalid-json");
	const evidenceIndex = indexEvidence(evidenceText);
	const requirements = scoreItems(
		parsed.requirements,
		benchmark.rubric.requirements,
		benchmark.expected.requirements,
		benchmark.expected.evidence,
		evidenceIndex,
		"requirement",
	);
	const defects = scoreItems(
		parsed.defects,
		benchmark.rubric.defects,
		benchmark.expected.defects,
		benchmark.expected.evidence,
		evidenceIndex,
		"defect",
	);
	const falsePositiveIds = [
		...requirements.falsePositiveIds,
		...defects.falsePositiveIds,
	];
	const groundingErrorIds = [
		...requirements.groundingErrorIds,
		...defects.groundingErrorIds,
	];
	return {
		requirements: requirements.hits.length,
		defects: defects.hits.length,
		falsePositives: falsePositiveIds.length,
		groundingErrors: groundingErrorIds.length,
		leakedInternal,
		requirementIds: requirements.hits,
		defectIds: defects.hits,
		falsePositiveIds,
		groundingErrorIds,
	};
}

export function isStructuredEvaluationOutput(output) {
	return hasEvaluationArrays(parseJsonObject(output));
}

function hasEvaluationArrays(value) {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Array.isArray(value.requirements) &&
		Array.isArray(value.defects)
	);
}

export function emptyScore(leakedInternal = false, reason = "run:error") {
	return {
		requirements: 0,
		defects: 0,
		falsePositives: 1,
		groundingErrors: 0,
		leakedInternal,
		requirementIds: [],
		defectIds: [],
		falsePositiveIds: [reason],
		groundingErrorIds: [],
	};
}

export function summarizeSamples(runs, benchmark, models, sampleCount) {
	const majority = Math.floor(sampleCount / 2) + 1;
	const modelMetrics = models.map((model) => {
		const samples = runs.filter((run) => run.model === model);
		const requirementIds = majorityIds(
			samples.flatMap((run) => run.metrics.requirementIds ?? []),
			majority,
		).filter((id) => benchmark.expected.requirements.includes(id));
		const defectIds = majorityIds(
			samples.flatMap((run) => run.metrics.defectIds ?? []),
			majority,
		).filter((id) => benchmark.expected.defects.includes(id));
		const falsePositiveIds = majorityIds(
			samples.flatMap((run) => run.metrics.falsePositiveIds ?? []),
			majority,
		);
		const groundingErrorIds = majorityIds(
			samples.flatMap((run) => run.metrics.groundingErrorIds ?? []),
			majority,
		);
		const sampleFalsePositives = samples.map(
			(run) => run.metrics.falsePositives,
		);
		return {
			model,
			successfulSamples: samples.filter((run) => !run.error).length,
			requirements: requirementIds.length,
			defects: defectIds.length,
			falsePositives: median(sampleFalsePositives),
			groundingErrors: groundingErrorIds.length,
			internalLeaks: samples.filter((run) => run.metrics.leakedInternal).length,
			requirementIds,
			defectIds,
			falsePositiveIds,
			groundingErrorIds,
			sampleFalsePositives,
			promptTokens: median(
				samples.map((run) => run.promptTokens ?? run.inputTokens),
			),
			elapsedMs: median(samples.map((run) => run.elapsedMs)),
		};
	});
	return {
		majority,
		models: modelMetrics,
		aggregate: aggregateModelMetrics(modelMetrics),
	};
}

export function qualityNonRegression(candidate, baseline) {
	return baseline.models.every((baselineModel) => {
		const current = candidate.models.find(
			(model) => model.model === baselineModel.model,
		);
		return (
			current &&
			current.successfulSamples >= candidate.majority &&
			current.requirements >= baselineModel.requirements &&
			current.defects >= baselineModel.defects &&
			current.internalLeaks === 0
		);
	});
}

export function selectPlateau(
	candidates,
	baselineAggregate,
	expectedRequirementCount,
) {
	const qualifying = candidates.filter(
		(candidate) => candidate.status === "evaluated" && candidate.qualifies,
	);
	if (qualifying.length === 0) return undefined;
	const bestDefects = Math.max(
		...qualifying.map((candidate) => candidate.aggregate.defects),
	);
	return qualifying
		.filter(
			(candidate) =>
				candidate.aggregate.requirements === expectedRequirementCount &&
				candidate.aggregate.defects === bestDefects &&
				candidate.aggregate.internalLeaks === 0 &&
				candidate.aggregate.falsePositives <=
					baselineAggregate.falsePositives &&
				improved(candidate.aggregate, baselineAggregate),
		)
		.sort((left, right) => left.tokenLimit - right.tokenLimit)[0];
}

function scoreItems(
	items,
	rubric,
	expectedIds,
	evidenceRules,
	evidenceIndex,
	kind,
) {
	const allowed = new Set(rubric.map((item) => item.id));
	const expected = new Set(expectedIds);
	const hits = new Set();
	const falsePositiveIds = new Set();
	const groundingErrorIds = new Set();
	items.forEach((item, index) => {
		if (!isEvaluationItem(item)) {
			falsePositiveIds.add(`${kind}:malformed:${index}`);
			return;
		}
		const id = item.id.trim();
		if (!allowed.has(id) || !expected.has(id)) {
			falsePositiveIds.add(`${kind}:${id}`);
			return;
		}
		if (!supportsEvidence(item.evidence, evidenceRules[id], evidenceIndex)) {
			groundingErrorIds.add(`${kind}:${id}`);
			return;
		}
		hits.add(id);
	});
	return {
		hits: [...hits].sort(),
		falsePositiveIds: [...falsePositiveIds].sort(),
		groundingErrorIds: [...groundingErrorIds].sort(),
	};
}

function isEvaluationItem(item) {
	return (
		item !== null &&
		typeof item === "object" &&
		!Array.isArray(item) &&
		typeof item.id === "string" &&
		item.id.trim() &&
		Array.isArray(item.evidence)
	);
}

function supportsEvidence(citations, rule, evidenceIndex) {
	if (!Array.isArray(rule?.groups) || rule.groups.length === 0) return false;
	return rule.groups.every((group) =>
		group.some((option) =>
			citations.some((citation) =>
				matchesEvidence(citation, option, evidenceIndex),
			),
		),
	);
}

function matchesEvidence(citation, option, evidenceIndex) {
	if (
		citation === null ||
		typeof citation !== "object" ||
		Array.isArray(citation) ||
		citation.locator !== option.locator ||
		typeof citation.quote !== "string" ||
		!citation.quote.trim()
	)
		return false;
	const block = evidenceIndex.get(option.locator);
	return (
		typeof block === "string" &&
		block.includes(citation.quote) &&
		option.anchors.some((anchor) => citation.quote.includes(anchor))
	);
}

function indexEvidence(text) {
	const source = typeof text === "string" ? text : "";
	const headers = [...source.matchAll(BLOCK_HEADER)];
	const index = new Map();
	for (let offset = 0; offset < headers.length; offset += 1) {
		const start = headers[offset].index;
		const end = headers[offset + 1]?.index ?? source.length;
		const block = source.slice(start, end).trim();
		for (const match of block.matchAll(BLOCK_LOCATOR))
			index.set(match[1], block);
	}
	return index;
}

function majorityIds(ids, threshold) {
	const counts = new Map();
	for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
	return [...counts]
		.filter(([, count]) => count >= threshold)
		.map(([id]) => id)
		.sort();
}

function aggregateModelMetrics(models) {
	return {
		requirements: sum(models, "requirements"),
		defects: sum(models, "defects"),
		falsePositives: sum(models, "falsePositives"),
		groundingErrors: sum(models, "groundingErrors"),
		internalLeaks: sum(models, "internalLeaks"),
		promptTokens: sum(models, "promptTokens"),
		elapsedMs: sum(models, "elapsedMs"),
	};
}

function sum(values, key) {
	return values.reduce((total, value) => total + (value[key] ?? 0), 0);
}

function median(values) {
	const numbers = values
		.filter(Number.isFinite)
		.sort((left, right) => left - right);
	if (numbers.length === 0) return 0;
	return numbers[Math.floor(numbers.length / 2)];
}

function improved(candidate, baseline) {
	return (
		candidate.defects > baseline.defects ||
		candidate.falsePositives < baseline.falsePositives ||
		candidate.promptTokens < baseline.promptTokens ||
		candidate.elapsedMs < baseline.elapsedMs
	);
}

function parseJsonObject(output) {
	const start = output.indexOf("{");
	const end = output.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	try {
		return JSON.parse(output.slice(start, end + 1));
	} catch {
		return undefined;
	}
}
