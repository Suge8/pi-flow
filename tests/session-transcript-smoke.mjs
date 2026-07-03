import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(root, `.tmp-session-transcript-test-${runId}`);
const srcOut = join(out, "src");

rmSync(out, { recursive: true, force: true });
mkdirSync(srcOut, { recursive: true });
execFileSync(
	join(root, "node_modules/.bin/tsc"),
	["--outDir", srcOut, "--rootDir", "src", "--noEmit", "false"],
	{ cwd: root, stdio: "inherit" },
);

try {
	await compactionSummaryScenario();
	await nativeCompactionScenario();
	await assistantToolTurnOmittedScenario();
	await nonToolStopReasonRetainedScenario();
	await budgetPinsFirstUserAndKeepsLatestAssistantScenario();
	await cursorModifyToolsFilesScenario();
	console.log("session transcript smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

async function compactionSummaryScenario() {
	const { buildTranscript } = await import(
		`file://${join(srcOut, "shared", "session.js")}?t=${Date.now()}`
	);
	const transcript = buildTranscript(compactedEntries(), {
		maxUser: 1000,
		maxAssistant: 1000,
		maxTranscript: 10000,
	});
	assert(
		transcript.includes("summary before compaction"),
		`missing compaction summary:\n${transcript}`,
	);
	assert(
		transcript.includes("kept user"),
		`missing kept message:\n${transcript}`,
	);
	assert(
		!transcript.includes("old answer"),
		`leaked compacted raw history:\n${transcript}`,
	);
	assert(
		transcript.indexOf("summary before compaction") <
			transcript.indexOf("kept user"),
		`summary should precede kept transcript:\n${transcript}`,
	);
}

async function nativeCompactionScenario() {
	const { buildTranscript } = await import(
		`file://${join(srcOut, "shared", "session.js")}?t=${Date.now()}`
	);
	const transcript = buildTranscript(nativeCompactedEntries(), {
		maxUser: 1000,
		maxAssistant: 1000,
		maxTranscript: 10000,
	});
	assert(
		transcript.includes("native compact summary"),
		`missing native compact text:\n${transcript}`,
	);
	assert(
		transcript.includes("native assistant note"),
		`missing native assistant text:\n${transcript}`,
	);
	assert(
		!transcript.includes("[OpenAI native compaction checkpoint]"),
		`native shim leaked:\n${transcript}`,
	);
	assert(
		transcript.includes("kept user"),
		`missing kept message:\n${transcript}`,
	);
}

async function assistantToolTurnOmittedScenario() {
	const { buildTranscript } = await import(
		`file://${join(srcOut, "shared", "session.js")}?t=${Date.now()}`
	);
	const transcript = buildTranscript(toolTurnEntries(), {
		maxUser: 1000,
		maxAssistant: 1000,
		maxTranscript: 10000,
	});
	assert(!transcript.includes("tool turn note"), transcript);
	assert(transcript.includes("final answer"), transcript);
}

async function nonToolStopReasonRetainedScenario() {
	const { buildTranscript } = await import(
		`file://${join(srcOut, "shared", "session.js")}?t=${Date.now()}`
	);
	const transcript = buildTranscript(nonToolStopReasonEntries(), {
		maxUser: 1000,
		maxAssistant: 1000,
		maxTranscript: 10000,
	});
	assert(transcript.includes("A(length): truncated final"), transcript);
	assert(transcript.includes("A(error): failed final"), transcript);
}

async function budgetPinsFirstUserAndKeepsLatestAssistantScenario() {
	const { buildTranscript } = await import(
		`file://${join(srcOut, "shared", "session.js")}?t=${Date.now()}`
	);
	const transcript = buildTranscript(assistantDropEntries(), {
		maxUser: 1000,
		maxAssistant: 1000,
		maxTranscript: 30,
	});
	assert(transcript.includes("old user"), transcript);
	assert(!transcript.includes("old assistant"), transcript);
	assert(transcript.includes("new assistant"), transcript);
}

function compactedEntries() {
	return [
		messageEntry("1", null, userMessage("old user")),
		messageEntry("2", "1", assistantMessage("old answer")),
		messageEntry("3", "2", userMessage("kept user")),
		{
			type: "compaction",
			id: "4",
			parentId: "3",
			timestamp: "2026-01-01T00:00:03.000Z",
			summary: "summary before compaction",
			firstKeptEntryId: "3",
			tokensBefore: 123,
		},
	];
}

function nativeCompactedEntries() {
	return [
		messageEntry("1", null, userMessage("old user")),
		messageEntry("2", "1", assistantMessage("old answer")),
		messageEntry("3", "2", userMessage("kept user")),
		{
			type: "compaction",
			id: "4",
			parentId: "3",
			timestamp: "2026-01-01T00:00:03.000Z",
			summary: "[OpenAI native compaction checkpoint]",
			firstKeptEntryId: "3",
			tokensBefore: 123,
			details: {
				strategy: "openai-native-compact-v1",
				compactedWindow: [
					{
						role: "user",
						content: [{ type: "input_text", text: "native compact summary" }],
					},
					{
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: "native assistant note" }],
					},
				],
			},
		},
	];
}

function toolTurnEntries() {
	return [
		messageEntry("1", null, userMessage("please inspect")),
		messageEntry("2", "1", assistantMessage("tool turn note", "toolUse")),
		messageEntry("3", "2", assistantMessage("final answer")),
	];
}

function assistantDropEntries() {
	return [
		messageEntry("1", null, userMessage("old user")),
		messageEntry("2", "1", assistantMessage("old assistant")),
		messageEntry("3", "2", userMessage("kept user")),
		messageEntry("4", "3", assistantMessage("new assistant")),
	];
}

function nonToolStopReasonEntries() {
	return [
		messageEntry("1", null, userMessage("please finish")),
		messageEntry("2", "1", assistantMessage("truncated final", "length")),
		messageEntry("3", "2", assistantMessage("failed final", "error")),
	];
}

function messageEntry(id, parentId, message) {
	return {
		type: "message",
		id,
		parentId,
		timestamp: new Date(message.timestamp).toISOString(),
		message,
	};
}

function userMessage(text) {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.parse("2026-01-01T00:00:01.000Z"),
	};
}

function assistantMessage(text, stopReason = "stop") {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		provider: "test",
		model: "test-model",
		stopReason,
		timestamp: Date.parse("2026-01-01T00:00:02.000Z"),
	};
}

async function cursorModifyToolsFilesScenario() {
	const { buildFilesSection } = await import(
		`file://${join(srcOut, "shared", "session.js")}?t=${Date.now()}`
	);
	const entries = [
		messageEntry("a1", "u1", {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "c1",
					name: "StrReplace",
					arguments: { path: "src/goal.ts" },
				},
				{
					type: "toolCall",
					id: "c2",
					name: "Write",
					arguments: { file_path: "src/new.ts" },
				},
				{
					type: "toolCall",
					id: "c3",
					name: "edit",
					arguments: { path: "src/auditor.ts" },
				},
			],
			provider: "test",
			model: "test",
			stopReason: "toolUse",
			timestamp: Date.parse("2026-01-01T00:00:02.000Z"),
		}),
	];
	const section = buildFilesSection(entries);
	assert(section.includes("修改文件:"), section);
	assert(section.includes("引用文件:"), section);
	assert(!section.includes("Modified files:"), section);
	assert(section.includes("src/auditor.ts"), section);
	assert(section.includes("src/goal.ts"), section);
	assert(section.includes("src/new.ts"), section);
	const modifiedBlock = section.split("引用文件:")[0];
	assert(!modifiedBlock.includes("未检测到"), modifiedBlock);
	const englishSection = buildFilesSection([], "en");
	assert(englishSection.includes("Modified files:"), englishSection);
	assert(englishSection.includes("Referenced files:"), englishSection);
	assert(englishSection.includes("None detected"), englishSection);
	assert(!englishSection.includes("未检测到"), englishSection);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
