import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTestDist } from "./prepare-dist.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(tmpdir(), `pi-flow-agent-progress-test-${runId}`);
const srcOut = join(out, "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");
prepareTestDist(root, srcOut, [
	"--ignoreConfig",
	"--outDir",
	srcOut,
	"--rootDir",
	"src",
	"--noEmit",
	"false",
	"--target",
	"ES2022",
	"--module",
	"NodeNext",
	"--moduleResolution",
	"NodeNext",
	"--types",
	"node",
	"--strict",
	"--skipLibCheck",
	"src/shared/agent-progress.ts",
]);

try {
	const progressModule = await import(
		`file://${join(srcOut, "shared/agent-progress.js")}?t=${Date.now()}`
	);
	const {
		activeProgressSnapshot,
		emptyAgentProgress,
		onProgressChanged,
		openProgressScope,
		silentProgressMinutes,
		updateAgentProgress,
	} = progressModule;

	const initial = emptyAgentProgress(1_000);
	assert(!initial.hasReceivedEvent, "empty progress started as observed");
	let progress = updateAgentProgress(initial, {
		at: 1_050,
		event: { type: "agent_start" },
	});
	assert(
		progress.hasReceivedEvent && progress.status === "thinking",
		"first structured event did not mark progress as observed",
	);
	progress = updateAgentProgress(progress, {
		at: 1_100,
		event: {
			type: "tool_execution_start",
			toolCallId: "read-1",
			toolName: "read",
			args: { path: "package.json" },
		},
	});
	progress = updateAgentProgress(progress, {
		at: 1_200,
		event: {
			type: "tool_execution_start",
			toolCallId: "bash-1",
			toolName: "bash",
			args: { command: "echo verification-ok" },
		},
	});
	progress = updateAgentProgress(progress, {
		at: 1_400,
		event: {
			type: "tool_execution_end",
			toolCallId: "read-1",
			toolName: "read",
			isError: false,
		},
	});
	assert(initial.currentTool === null, "reducer mutated its input");
	assert(
		progress.currentTool === "bash",
		"parallel tool end cleared active tool",
	);
	assert(
		progress.currentToolArgs === "echo verification-ok",
		"command args missing",
	);
	assert(
		progress.currentToolStartMs === 1_200,
		"active tool start time missing",
	);
	assert(progress.toolCallCount === 2, "tool calls were not counted at start");
	assert(
		progress.recentTools[0]?.tool === "read" &&
			progress.recentTools[0]?.args === "package.json" &&
			progress.recentTools[0]?.startMs === 1_100 &&
			progress.recentTools[0]?.endMs === 1_400 &&
			progress.recentTools[0]?.isError === false,
		"completed tool history is incomplete",
	);
	progress = updateAgentProgress(progress, {
		at: 1_500,
		event: {
			type: "tool_execution_end",
			toolCallId: "bash-1",
			toolName: "bash",
			isError: true,
		},
	});
	progress = updateAgentProgress(progress, {
		at: 1_600,
		event: {
			type: "message_end",
			message: {
				role: "assistant",
				usage: { totalTokens: 9_045, cost: { total: 0.0234375 } },
			},
		},
	});
	progress = updateAgentProgress(progress, {
		at: 1_700,
		event: {
			type: "message_end",
			message: {
				role: "assistant",
				usage: { totalTokens: 455, cost: { total: 0.0015625 } },
			},
		},
	});
	assert(
		progress.currentTool === null && progress.status === "thinking",
		"tool did not settle",
	);
	assert(progress.tokens === 9_500, "message tokens were not accumulated");
	assert(progress.cost === 0.025, "message cost was not accumulated");
	assert(progress.lastEventAt === 1_700, "last event time was not updated");

	for (let index = 0; index < 5; index += 1) {
		progress = updateAgentProgress(progress, {
			at: 2_000 + index * 2,
			event: {
				type: "tool_execution_start",
				toolCallId: `tool-${index}`,
				toolName: `tool${index}`,
				args: {},
			},
		});
		progress = updateAgentProgress(progress, {
			at: 2_001 + index * 2,
			event: {
				type: "tool_execution_end",
				toolCallId: `tool-${index}`,
				toolName: `tool${index}`,
				isError: false,
			},
		});
	}
	assert(
		progress.recentTools.length === 5,
		"recent tool history exceeded its cap",
	);
	assert(
		progress.recentTools[0]?.tool === "tool0",
		"recent history kept stale entries",
	);
	assert(
		silentProgressMinutes(progress, progress.lastEventAt + 179_999) ===
			undefined &&
			silentProgressMinutes(progress, progress.lastEventAt + 180_000) === 3,
		"three-minute silent threshold is incorrect",
	);

	const originalNow = Date.now;
	let now = 10_000;
	Date.now = () => now;
	const snapshots = [];
	const unsubscribe = onProgressChanged((snapshot) => snapshots.push(snapshot));
	const scope = openProgressScope("parallel", "F19 parallel");
	const reference = scope.register("G1", "First goal");
	now = 10_500;
	scope.feed("G1", {
		type: "tool_execution_start",
		toolCallId: "store-read",
		toolName: "read",
		args: { path: "README.md" },
	});
	assert(
		reference.current.currentTool === "read",
		"scope did not update its agent reference",
	);
	assert(
		activeProgressSnapshot().scopes[0]?.agents[0]?.progress.currentTool ===
			"read",
		"active snapshot did not expose scope progress",
	);
	scope.close();
	const notificationsAfterClose = snapshots.length;
	now = 11_000;
	scope.feed("G1", { type: "message_end", message: {} });
	assert(
		snapshots.length === notificationsAfterClose,
		"closed scope still notified listeners",
	);
	assert(
		activeProgressSnapshot().scopes.length === 0,
		"closed scope remained active",
	);
	unsubscribe();
	Date.now = originalNow;

	console.log("agent progress smoke: ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
