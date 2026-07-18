import { mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTestDist } from "./prepare-dist.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(tmpdir(), `pi-flow-context-evidence-test-${runId}`);
const srcOut = join(out, "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(srcOut, { recursive: true });
symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");
prepareTestDist(root, srcOut);

try {
	const evidence = await import(
		`file://${join(srcOut, "shared/context-evidence.js")}?t=${Date.now()}`
	);
	compressionIndependentScenario(evidence);
	requirementsProjectionScenario(evidence);
	reviewProjectionScenario(evidence);
	failedModificationOutputScenario(evidence);
	formattedTextScenario(evidence);
	budgetScenario(evidence);
	overflowScenario(evidence);
	duplicateConversationScenario(evidence);
	rawTextAndImmutabilityScenario(evidence);
	console.log("context evidence smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

function compressionIndependentScenario(evidence) {
	const plain = evidence.extractContextEvidence(fixture("no-compaction.json"));
	const standard = evidence.extractContextEvidence(
		fixture("standard-compaction.json"),
	);
	const native = evidence.extractContextEvidence(
		fixture("native-opaque-compaction.json"),
	);
	assertDeepEqual(
		withoutOrder(plain.conversation),
		withoutOrder(standard.conversation),
	);
	assertDeepEqual(
		withoutOrder(plain.conversation),
		withoutOrder(native.conversation),
	);
	assertDeepEqual(
		withoutOrder(plain.operations),
		withoutOrder(standard.operations),
	);
	assertDeepEqual(
		withoutOrder(plain.operations),
		withoutOrder(native.operations),
	);
	assert(plain.compactionBoundaries === 0, "plain fixture has a boundary");
	assert(
		standard.compactionBoundaries === 1,
		"standard boundary not classified",
	);
	assert(native.compactionBoundaries === 1, "native boundary not classified");
}

function requirementsProjectionScenario(evidence) {
	const result = evidence.buildContextEvidence({
		entries: fixture("native-opaque-compaction.json"),
		projection: "requirements",
		language: "zh",
		modelReferences: ["test/planner"],
		modelRegistry: registry({ "test/planner": 200_000 }),
		fixedPrompt: "计划协议",
	});
	assert(result.ok, result.error?.message);
	const packet = result.packet;
	const transcript = evidence.formatTranscript(packet.conversation, "zh");
	assert(packet.text.includes("[来源：用户]"), packet.text);
	assert(packet.text.includes("[来源：可见用户补充]"), packet.text);
	assert(packet.text.includes("assistant 最终声明"), packet.text);
	assert(transcript.includes("用户 · 2026-06-01"), transcript);
	assert(transcript.includes("用户补充 ·"), transcript);
	assert(transcript.includes("助手回复 ·"), transcript);
	assert(!transcript.includes("Coverage："), transcript);
	assert(!transcript.includes("[entry:"), transcript);
	assert(
		packet.conversation.every(
			(turn) =>
				typeof turn.kind === "string" &&
				typeof turn.at === "string" &&
				typeof turn.text === "string",
		),
		JSON.stringify(packet.conversation),
	);
	assert(packet.text.includes('```json\n{\n  "id"'), packet.text);
	assert(!packet.text.includes("Operation evidence"), packet.text);
	assert(!packet.text.includes("操作证据："), packet.text);
	for (const forbidden of [
		"INTERNAL_SENTINEL_DO_NOT_LEAK",
		"CHECK_CONTROL_SENTINEL",
		"OPAQUE_CIPHERTEXT_MUST_NOT_LEAK",
		"NATIVE_WINDOW_SENTINEL",
		"OpenAI native compaction checkpoint",
	])
		assert(!packet.text.includes(forbidden), `leaked ${forbidden}`);
	assert(packet.coverage.internalMessagesExcluded === 1, packet.text);
	assert(packet.coverage.checkCardsExcluded === 1, packet.text);
	assert(packet.coverage.compactionBoundariesIgnored === 1, packet.text);
}

function reviewProjectionScenario(evidence) {
	const result = evidence.buildContextEvidence({
		entries: fixture("standard-compaction.json"),
		projection: "review",
		language: "en",
		modelReferences: ["test/reviewer-a", "test/reviewer-b"],
		modelRegistry: registry({
			"test/reviewer-a": 1_000_000,
			"test/reviewer-b": 200_000,
		}),
		fixedPrompt: "review protocol and goal",
	});
	assert(result.ok, result.error?.message);
	const { packet } = result;
	assert(packet.text.includes("call:call-test-fail"), packet.text);
	assert(packet.text.includes("TAIL_FAILURE_MARKER"), packet.text);
	assert(packet.text.includes("[bounded middle omitted]"), packet.text);
	assert(packet.text.includes("LATEST_VALIDATION_OK"), packet.text);
	assert(packet.text.includes("src/import-orders.ts"), packet.text);
	assert(packet.text.includes("tests/import-orders.test.ts"), packet.text);
	assert(packet.text.includes("call:call-read-old"), packet.text);
	assert(!packet.text.includes("END_OLD_READ_OUTPUT"), packet.text);
	assert(!packet.text.includes("Updated src/import-orders.ts"), packet.text);
	assert(
		!packet.text.includes("Wrote tests/import-orders.test.ts"),
		packet.text,
	);
	assert(packet.coverage.operations.included === 7, packet.text);
	assert(packet.coverage.operations.withOutput >= 3, packet.text);
	assert(packet.coverage.operations.actionOnly >= 2, packet.text);
	assert(packet.coverage.boundedOutputs >= 1, packet.text);
	assert(packet.budget.minContextWindow === 200_000, packet.text);
}

function failedModificationOutputScenario(evidence) {
	const tools = ["edit", "write", "Edit", "Write", "StrReplace"];
	const entries = [
		{
			type: "message",
			id: "modify-calls",
			timestamp: "2026-01-01T00:00:00.000Z",
			message: {
				role: "assistant",
				content: tools.map((name, index) => ({
					type: "toolCall",
					id: `modify-${index}`,
					name,
					arguments: { path: `src/failed-${index}.ts` },
				})),
				stopReason: "toolUse",
			},
		},
		...tools.map((name, index) => {
			const marker = name.toUpperCase();
			return {
				type: "message",
				id: `modify-result-${index}`,
				timestamp: `2026-01-01T00:00:0${index + 1}.000Z`,
				message: {
					role: "toolResult",
					toolCallId: `modify-${index}`,
					toolName: name,
					content: [
						{
							type: "text",
							text: `${marker}_FAILURE_HEAD\n${"x".repeat(12_000)}\n${marker}_FAILURE_TAIL`,
						},
					],
					isError: true,
				},
			};
		}),
	];
	const result = evidence.projectContextEvidence(
		evidence.extractContextEvidence(entries),
		"review",
		manualBudget(30_000),
		"en",
	);
	assert(result.ok, result.error?.message);
	for (const [index, name] of tools.entries()) {
		const marker = name.toUpperCase();
		assert(result.packet.text.includes(`[tool:${name}]`), result.packet.text);
		assert(
			result.packet.text.includes(`${marker}_FAILURE_HEAD`) &&
				result.packet.text.includes(`${marker}_FAILURE_TAIL`) &&
				result.packet.text.includes(`src/failed-${index}.ts`),
			result.packet.text,
		);
	}
	assert(
		result.packet.coverage.operations.withOutput === tools.length,
		result.packet.text,
	);
	assert(
		result.packet.coverage.operations.actionOnly === 0,
		result.packet.text,
	);
	assert(
		result.packet.coverage.boundedOutputs === tools.length,
		result.packet.text,
	);
}

function formattedTextScenario(evidence) {
	const result = evidence.projectContextEvidence(
		evidence.extractContextEvidence(fixture("formatted-text.json")),
		"requirements",
		manualBudget(20_000),
		"zh",
	);
	assert(result.ok, result.error?.message);
	assert(
		result.packet.text.includes(
			'```json\n{\n  "alpha": 1,\n  "beta": [2, 3]\n}\n```\n\n第二段。',
		),
		result.packet.text,
	);
	assert(
		result.packet.text.includes("```ts\nconst value = 1;\n```"),
		result.packet.text,
	);
}

function budgetScenario(evidence) {
	const resolved = evidence.resolveContextEvidenceBudget(
		["test/large", "test/small"],
		registry({ "test/large": 1_000_000, "test/small": 372_000 }),
		"x".repeat(1_000),
		"en",
	);
	assert(resolved.ok, resolved.error?.message);
	assert(resolved.budget.minContextWindow === 372_000, "wrong minimum window");
	assert(resolved.budget.initialPromptTokenLimit === 93_000, "25% cap failed");
	assert(resolved.budget.softEvidenceTokens === 32_000, "soft target changed");
	assert(
		resolved.budget.hardEvidenceTokens < 93_000 &&
			resolved.budget.hardEvidenceTokens > 32_000,
		"fixed/system budget was not reserved",
	);
	const capped = evidence.resolveContextEvidenceBudget(
		["test/huge"],
		registry({ "test/huge": 1_000_000 }),
		"",
		"en",
	);
	assert(capped.ok, capped.error?.message);
	assert(capped.budget.initialPromptTokenLimit === 128_000, "128K cap failed");
	const missing = evidence.resolveContextEvidenceBudget(
		["test/missing"],
		registry({}),
		"",
		"zh",
	);
	assert(
		!missing.ok && missing.error.code === "model_unresolved",
		"missing model accepted",
	);
}

function overflowScenario(evidence) {
	const facts = evidence.extractContextEvidence(fixture("long-message.json"));
	const overflow = evidence.projectContextEvidence(
		facts,
		"requirements",
		manualBudget(1_000),
		"zh",
	);
	assert(
		!overflow.ok && overflow.error.code === "critical_evidence_overflow",
		"long critical source was silently clipped",
	);
	assert(
		overflow.error.requiredTokens > overflow.error.availableTokens,
		overflow.error.message,
	);
	assert(overflow.error.message.includes("未静默裁剪"), overflow.error.message);
}

function duplicateConversationScenario(evidence) {
	const entries = [
		userEntry("repeat-1", "2026-01-01T00:00:00.000Z", "继续"),
		userEntry("repeat-2", "2026-01-01T00:01:00.000Z", "继续"),
	];
	const result = evidence.projectContextEvidence(
		evidence.extractContextEvidence(entries),
		"requirements",
		manualBudget(5_000),
		"zh",
	);
	assert(result.ok, result.error?.message);
	const { packet } = result;
	assert(packet.coverage.users.included === 2, packet.text);
	assert(packet.coverage.users.total === 2, packet.text);
	assert(packet.text.includes("[entry:repeat-1]"), packet.text);
	assert(packet.text.includes("[entry:repeat-2]"), packet.text);
	assert(
		packet.text.indexOf("[entry:repeat-1]") <
			packet.text.indexOf("[entry:repeat-2]"),
		packet.text,
	);
	assert(
		packet.text.split("\n").filter((line) => line === "继续").length === 2,
		packet.text,
	);
	const transcript = evidence.formatTranscript(packet.conversation, "zh");
	assert(
		transcript.split("\n").filter((line) => line === "继续").length === 2,
		transcript,
	);
}

function rawTextAndImmutabilityScenario(evidence) {
	const userText = [
		"Use api_key=super-secret-value.",
		"-----BEGIN TEST PRIVATE KEY-----",
		"private-key-body",
		"-----END TEST PRIVATE KEY-----",
	].join("\n");
	const command = "curl -H 'Authorization: Bearer abcdefghijklmnop' /health";
	const output = "request failed with sk-abcdefghijklmnop";
	const entries = [
		userEntry("secret-user", "2026-01-01T00:00:00.000Z", userText),
		{
			type: "message",
			id: "secret-call",
			timestamp: "2026-01-01T00:00:01.000Z",
			message: {
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "call-secret",
						name: "bash",
						arguments: { command },
					},
				],
				stopReason: "toolUse",
			},
		},
		{
			type: "message",
			id: "secret-result",
			timestamp: "2026-01-01T00:00:02.000Z",
			message: {
				role: "toolResult",
				toolCallId: "call-secret",
				toolName: "bash",
				content: [{ type: "text", text: output }],
				isError: true,
			},
		},
	];
	const result = evidence.projectContextEvidence(
		evidence.extractContextEvidence(entries),
		"review",
		manualBudget(5_000),
		"en",
	);
	assert(result.ok, result.error?.message);
	for (const original of [userText, command, output]) {
		assert(result.packet.text.includes(original), result.packet.text);
	}
	const transcript = evidence.formatTranscript(
		result.packet.conversation,
		"en",
	);
	assert(transcript.includes(userText), transcript);
	assert(!result.packet.text.includes("[REDACTED"), result.packet.text);
	assert(Object.isFrozen(result.packet), "packet is mutable");
	assert(
		Object.isFrozen(result.packet.conversation),
		"conversation is mutable",
	);
	assert(
		result.packet.conversation.every(Object.isFrozen),
		"conversation turn is mutable",
	);
	assert(Object.isFrozen(result.packet.coverage), "coverage is mutable");
	assert(Object.isFrozen(result.packet.budget), "budget is mutable");
}

function userEntry(id, timestamp, text) {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp,
		message: {
			role: "user",
			content: [{ type: "text", text }],
			timestamp: 0,
		},
	};
}

function fixture(name) {
	return JSON.parse(
		readFileSync(join(root, "tests/fixtures/context-evidence", name), "utf8"),
	);
}

function registry(windows) {
	return {
		find(provider, modelId) {
			const contextWindow = windows[`${provider}/${modelId}`];
			return contextWindow ? { contextWindow } : undefined;
		},
	};
}

function manualBudget(hardEvidenceTokens) {
	return Object.freeze({
		modelWindows: Object.freeze([
			Object.freeze({ model: "test/manual", contextWindow: 1_000_000 }),
		]),
		minContextWindow: 1_000_000,
		initialPromptTokenLimit: hardEvidenceTokens,
		systemToolReserveTokens: 0,
		fixedPromptTokens: 0,
		softEvidenceTokens: hardEvidenceTokens,
		hardEvidenceTokens,
	});
}

function withoutOrder(value) {
	return JSON.parse(JSON.stringify(value), (key, item) =>
		key === "order" ? undefined : item,
	);
}

function assertDeepEqual(actual, expected) {
	assert(
		JSON.stringify(actual) === JSON.stringify(expected),
		`${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
	);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
