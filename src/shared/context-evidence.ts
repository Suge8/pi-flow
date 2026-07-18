import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Language } from "./config.js";
import { isRecord } from "./guards.js";
import { RESULT_CARD_TYPE } from "./result-card.js";

export type ContextEvidenceProjection = "requirements" | "review";

export interface ContextEvidenceRegistry {
	find(
		provider: string,
		modelId: string,
	): { contextWindow?: number } | undefined;
}

export interface ContextEvidenceBudget {
	modelWindows: readonly { model: string; contextWindow: number }[];
	minContextWindow: number;
	initialPromptTokenLimit: number;
	systemToolReserveTokens: number;
	fixedPromptTokens: number;
	softEvidenceTokens: number;
	hardEvidenceTokens: number;
}

export interface ContextEvidenceCoverage {
	users: { included: number; total: number };
	visibleSupplements: { included: number; total: number };
	assistantFinals: { included: number; total: number };
	operations: {
		included: number;
		total: number;
		withOutput: number;
		actionOnly: number;
	};
	internalMessagesExcluded: number;
	checkCardsExcluded: number;
	compactionBoundariesIgnored: number;
	boundedOutputs: number;
}

export interface ConversationTurn {
	kind: "user" | "visible_supplement" | "assistant_final";
	at: string;
	text: string;
}

export interface ContextEvidencePacket {
	projection: ContextEvidenceProjection;
	text: string;
	conversation: readonly ConversationTurn[];
	estimatedTokens: number;
	coverage: ContextEvidenceCoverage;
	budget: ContextEvidenceBudget;
}

export type ContextEvidenceErrorCode =
	| "model_unresolved"
	| "fixed_prompt_overflow"
	| "critical_evidence_overflow";

export interface ContextEvidenceError {
	code: ContextEvidenceErrorCode;
	message: string;
	model?: string;
	requiredTokens?: number;
	availableTokens?: number;
}

export type ContextEvidenceResult =
	| { ok: true; packet: ContextEvidencePacket }
	| { ok: false; error: ContextEvidenceError };

interface ConversationFact {
	kind: "user" | "visible_supplement" | "assistant_final";
	entryId: string;
	timestamp: string;
	order: number;
	text: string;
	stopReason?: string;
}

interface ToolOperationFact {
	entryId: string;
	timestamp: string;
	order: number;
	toolCallId: string;
	toolName: string;
	arguments: Record<string, unknown>;
	result?: {
		entryId: string;
		timestamp: string;
		text: string;
		isError: boolean;
	};
}

export interface ContextEvidenceFacts {
	conversation: readonly ConversationFact[];
	operations: readonly ToolOperationFact[];
	internalMessages: number;
	checkCards: number;
	compactionBoundaries: number;
}

interface EvidenceBlock {
	id: string;
	section: "conversation" | "operations";
	order: number;
	priority: number;
	critical: boolean;
	text: string;
	turn?: ConversationTurn;
	kind?: ConversationFact["kind"];
	operationDetail?: "output" | "action";
	boundedOutputs: number;
}

const VISIBLE_USER_INPUT_TYPE = "Pi Flow 用户补充";
const INITIAL_PROMPT_TOKEN_LIMIT = 128_000;
const INITIAL_PROMPT_WINDOW_RATIO = 0.25;
const MAX_SYSTEM_TOOL_RESERVE_TOKENS = 16_000;
/** 真实三模型 A/B 锁定：16K 溢出，32K 起完整覆盖，64K/96K 不增加证据。 */
export const CONTEXT_EVIDENCE_SOFT_TOKEN_TARGET = 32_000;
const RECENT_OPERATION_CHAIN = 5;
const RECENT_VALIDATIONS = 3;
const CRITICAL_FAILURES = 4;
const TOOL_OUTPUT_TOKEN_LIMIT = 2_500;
const TOOL_ARGUMENT_TOKEN_LIMIT = 800;
const MODIFY_TOOLS = new Set(["edit", "write", "Edit", "Write", "StrReplace"]);
const READ_TOOLS = new Set(["read", "Read"]);
const VALIDATION_COMMAND =
	/(?:^|[\s;&|])(?:npm|pnpm|yarn|bun|node|npx|deno|cargo|go|pytest|python|make|gradle|mvn)[^\n]*(?:test|check|lint|build|typecheck|tsc|verify|validate)|(?:^|[\s;&|])(?:tsc|biome|eslint|vitest|jest)(?:\s|$)/iu;

export function buildContextEvidence(input: {
	entries: SessionEntry[];
	projection: ContextEvidenceProjection;
	language: Language;
	modelReferences: readonly string[];
	modelRegistry: ContextEvidenceRegistry | undefined;
	fixedPrompt: string;
}): ContextEvidenceResult {
	const budget = resolveContextEvidenceBudget(
		input.modelReferences,
		input.modelRegistry,
		input.fixedPrompt,
		input.language,
	);
	if (!budget.ok) return budget;
	return projectContextEvidence(
		extractContextEvidence(input.entries),
		input.projection,
		budget.budget,
		input.language,
	);
}

export function resolveContextEvidenceBudget(
	modelReferences: readonly string[],
	modelRegistry: ContextEvidenceRegistry | undefined,
	fixedPrompt: string,
	language: Language,
):
	| { ok: true; budget: ContextEvidenceBudget }
	| { ok: false; error: ContextEvidenceError } {
	const references = [...new Set(modelReferences)];
	for (const model of references) {
		const contextWindow = modelContextWindow(model, modelRegistry);
		if (!contextWindow)
			return {
				ok: false,
				error: {
					code: "model_unresolved",
					model,
					message:
						language === "en"
							? `Context Evidence stopped: model context window is unavailable (${model}).`
							: `上下文证据已停止：无法解析模型窗口（${model}）。`,
				},
			};
	}
	if (references.length === 0)
		return {
			ok: false,
			error: {
				code: "model_unresolved",
				message:
					language === "en"
						? "Context Evidence stopped: no target model was provided."
						: "上下文证据已停止：未提供目标模型。",
			},
		};
	const modelWindows = references.map((model) => ({
		model,
		contextWindow: modelContextWindow(model, modelRegistry) as number,
	}));
	const minContextWindow = Math.min(
		...modelWindows.map((item) => item.contextWindow),
	);
	const initialPromptTokenLimit = Math.min(
		INITIAL_PROMPT_TOKEN_LIMIT,
		Math.floor(minContextWindow * INITIAL_PROMPT_WINDOW_RATIO),
	);
	const systemToolReserveTokens = Math.min(
		MAX_SYSTEM_TOOL_RESERVE_TOKENS,
		Math.max(2_000, Math.floor(initialPromptTokenLimit * 0.15)),
	);
	const fixedPromptTokens = estimateContextTokens(fixedPrompt);
	const hardEvidenceTokens =
		initialPromptTokenLimit - systemToolReserveTokens - fixedPromptTokens;
	if (hardEvidenceTokens <= 0)
		return {
			ok: false,
			error: {
				code: "fixed_prompt_overflow",
				requiredTokens: fixedPromptTokens + systemToolReserveTokens,
				availableTokens: initialPromptTokenLimit,
				message: overflowMessage(
					"fixed",
					fixedPromptTokens + systemToolReserveTokens,
					initialPromptTokenLimit,
					language,
				),
			},
		};
	const budget: ContextEvidenceBudget = {
		modelWindows: Object.freeze(
			modelWindows.map((item) => Object.freeze(item)),
		),
		minContextWindow,
		initialPromptTokenLimit,
		systemToolReserveTokens,
		fixedPromptTokens,
		softEvidenceTokens: Math.min(
			CONTEXT_EVIDENCE_SOFT_TOKEN_TARGET,
			hardEvidenceTokens,
		),
		hardEvidenceTokens,
	};
	return { ok: true, budget: Object.freeze(budget) };
}

function modelContextWindow(
	reference: string,
	registry: ContextEvidenceRegistry | undefined,
) {
	if (!registry) return undefined;
	const separator = reference.indexOf("/");
	if (separator <= 0 || separator === reference.length - 1) return undefined;
	let model: ReturnType<ContextEvidenceRegistry["find"]>;
	try {
		model = registry.find(
			reference.slice(0, separator),
			reference.slice(separator + 1),
		);
	} catch {
		return undefined;
	}
	return typeof model?.contextWindow === "number" &&
		Number.isFinite(model.contextWindow) &&
		model.contextWindow > 0
		? Math.floor(model.contextWindow)
		: undefined;
}

export function extractContextEvidence(
	entries: SessionEntry[],
): ContextEvidenceFacts {
	const conversation: ConversationFact[] = [];
	const operations: ToolOperationFact[] = [];
	const calls = new Map<string, ToolOperationFact>();
	const pendingResults = new Map<string, ToolOperationFact["result"]>();
	let internalMessages = 0;
	let checkCards = 0;
	let compactionBoundaries = 0;

	entries.forEach((entry, order) => {
		if (!isRecord(entry)) return;
		if (entry.type === "compaction" || entry.type === "branch_summary") {
			compactionBoundaries += 1;
			return;
		}
		if (entry.type === "custom_message") {
			const classification = classifyCustomEntry(entry);
			if (classification === "check") checkCards += 1;
			else if (classification === "internal") internalMessages += 1;
			else if (classification === "visible") {
				const text = textContent(entry.content);
				if (text.trim())
					conversation.push({
						kind: "visible_supplement",
						entryId: entryId(entry, order),
						timestamp: entryTimestamp(entry),
						order,
						text,
					});
			}
			return;
		}
		if (entry.type !== "message" || !isRecord(entry.message)) return;
		const message = entry.message;
		if (message.role === "user") {
			const text = textContent(message.content);
			if (text.trim())
				conversation.push({
					kind: "user",
					entryId: entryId(entry, order),
					timestamp: entryTimestamp(entry),
					order,
					text,
				});
			return;
		}
		if (message.role === "assistant") {
			for (const call of toolCalls(message.content)) {
				const operation: ToolOperationFact = {
					entryId: entryId(entry, order),
					timestamp: entryTimestamp(entry),
					order,
					toolCallId: String(call.id),
					toolName: String(call.name),
					arguments: isRecord(call.arguments) ? call.arguments : {},
					result: pendingResults.get(String(call.id)),
				};
				operations.push(operation);
				calls.set(operation.toolCallId, operation);
				pendingResults.delete(operation.toolCallId);
			}
			if (message.stopReason !== "toolUse") {
				const text = textContent(message.content);
				if (text.trim())
					conversation.push({
						kind: "assistant_final",
						entryId: entryId(entry, order),
						timestamp: entryTimestamp(entry),
						order,
						text,
						stopReason:
							typeof message.stopReason === "string"
								? message.stopReason
								: "stop",
					});
			}
			return;
		}
		if (message.role === "toolResult") {
			const result = {
				entryId: entryId(entry, order),
				timestamp: entryTimestamp(entry),
				text: textContent(message.content),
				isError: message.isError === true,
			};
			const call = calls.get(String(message.toolCallId));
			if (call) call.result = result;
			else pendingResults.set(String(message.toolCallId), result);
			return;
		}
		if (message.role === "bashExecution")
			operations.push(bashExecutionOperation(entry, message, order));
	});

	for (const [toolCallId, result] of pendingResults) {
		operations.push({
			entryId: result?.entryId ?? `unpaired-${toolCallId}`,
			timestamp: result?.timestamp ?? "unknown",
			order: entries.length + operations.length,
			toolCallId,
			toolName: "unknown",
			arguments: {},
			result,
		});
	}
	return Object.freeze({
		conversation: Object.freeze(
			conversation.map((fact) => Object.freeze(fact)),
		),
		operations: Object.freeze(operations.map(freezeOperation)),
		internalMessages,
		checkCards,
		compactionBoundaries,
	});
}

function classifyCustomEntry(entry: Record<string, unknown>) {
	if (entry.customType === RESULT_CARD_TYPE) return "check";
	if (entry.customType === VISIBLE_USER_INPUT_TYPE && entry.display === true)
		return "visible";
	return "internal";
}

function bashExecutionOperation(
	entry: Record<string, unknown>,
	message: Record<string, unknown>,
	order: number,
): ToolOperationFact {
	const id = entryId(entry, order);
	return {
		entryId: id,
		timestamp: entryTimestamp(entry),
		order,
		toolCallId: `bash-execution:${id}`,
		toolName: "bash",
		arguments: { command: String(message.command ?? "") },
		result: {
			entryId: id,
			timestamp: entryTimestamp(entry),
			text: String(message.output ?? ""),
			isError:
				message.cancelled === true ||
				(typeof message.exitCode === "number" && message.exitCode !== 0),
		},
	};
}

function freezeOperation(operation: ToolOperationFact) {
	return Object.freeze({
		...operation,
		arguments: Object.freeze({ ...operation.arguments }),
		...(operation.result ? { result: Object.freeze(operation.result) } : {}),
	});
}

export function projectContextEvidence(
	facts: ContextEvidenceFacts,
	projection: ContextEvidenceProjection,
	budget: ContextEvidenceBudget,
	language: Language,
): ContextEvidenceResult {
	const blocks = evidenceBlocks(facts, projection, language);
	const critical = blocks.filter((block) => block.critical);
	const selected = new Map(critical.map((block) => [block.id, block]));
	let coverage = coverageFor(facts, selected);
	let text = formatPacket(projection, selected, coverage, language);
	let requiredTokens = estimateContextTokens(text);
	if (requiredTokens > budget.hardEvidenceTokens)
		return {
			ok: false,
			error: {
				code: "critical_evidence_overflow",
				requiredTokens,
				availableTokens: budget.hardEvidenceTokens,
				message: overflowMessage(
					"critical",
					requiredTokens,
					budget.hardEvidenceTokens,
					language,
				),
			},
		};

	const optional = blocks
		.filter((block) => !block.critical)
		.sort(
			(left, right) =>
				left.priority - right.priority || right.order - left.order,
		);
	for (const block of optional) {
		selected.set(block.id, block);
		coverage = coverageFor(facts, selected);
		const candidate = formatPacket(projection, selected, coverage, language);
		const candidateTokens = estimateContextTokens(candidate);
		if (
			candidateTokens <= budget.softEvidenceTokens &&
			candidateTokens <= budget.hardEvidenceTokens
		) {
			text = candidate;
			requiredTokens = candidateTokens;
			continue;
		}
		selected.delete(block.id);
	}
	coverage = coverageFor(facts, selected);
	text = formatPacket(projection, selected, coverage, language);
	requiredTokens = estimateContextTokens(text);
	const packet: ContextEvidencePacket = {
		projection,
		text,
		conversation: selectedConversation(selected),
		estimatedTokens: requiredTokens,
		coverage: deepFreezeCoverage(coverage),
		budget,
	};
	return { ok: true, packet: Object.freeze(packet) };
}

function evidenceBlocks(
	facts: ContextEvidenceFacts,
	projection: ContextEvidenceProjection,
	language: Language,
) {
	const blocks = facts.conversation.map((fact) =>
		conversationBlock(fact, language),
	);
	if (projection === "review")
		blocks.push(...operationBlocks(facts.operations, language));
	return blocks;
}

function conversationBlock(
	fact: ConversationFact,
	language: Language,
): EvidenceBlock {
	const label = conversationLabel(fact, language);
	return {
		id: `conversation:${fact.entryId}`,
		section: "conversation",
		order: fact.order,
		priority: fact.kind === "assistant_final" ? 2 : 0,
		critical: fact.kind !== "assistant_final",
		text: `[${fact.timestamp}] [entry:${fact.entryId}] [${label}]\n${fact.text}`,
		turn: Object.freeze({
			kind: fact.kind,
			at: fact.timestamp,
			text: fact.text,
		}),
		kind: fact.kind,
		boundedOutputs: 0,
	};
}

function transcriptLabel(kind: ConversationTurn["kind"], language: Language) {
	if (language === "en") {
		if (kind === "user") return "User";
		if (kind === "visible_supplement") return "User addition";
		return "Assistant reply";
	}
	if (kind === "user") return "用户";
	if (kind === "visible_supplement") return "用户补充";
	return "助手回复";
}

function conversationLabel(fact: ConversationFact, language: Language) {
	if (fact.kind === "user")
		return language === "en" ? "source:user" : "来源：用户";
	if (fact.kind === "visible_supplement")
		return language === "en"
			? "source:visible user supplement"
			: "来源：可见用户补充";
	const reason = fact.stopReason === "stop" ? "" : `, stop:${fact.stopReason}`;
	return language === "en"
		? `source:assistant final claim${reason}`
		: `来源：assistant 最终声明${reason}`;
}

function operationBlocks(
	operations: readonly ToolOperationFact[],
	language: Language,
): EvidenceBlock[] {
	const settled = operations.filter((operation) => operation.result);
	const recent = new Set(
		settled
			.slice(-RECENT_OPERATION_CHAIN)
			.map((operation) => operation.toolCallId),
	);
	const validations = new Set(
		operations
			.filter(isValidationOperation)
			.slice(-RECENT_VALIDATIONS)
			.map((operation) => operation.toolCallId),
	);
	const failures = operations.filter((operation) => operation.result?.isError);
	const criticalFailures = new Set(
		failures.slice(-CRITICAL_FAILURES).map((operation) => operation.toolCallId),
	);
	return operations.map((operation) => {
		const modifies = MODIFY_TOOLS.has(operation.toolName);
		const failed = operation.result?.isError === true;
		const includeOutput =
			failed ||
			(!modifies &&
				(recent.has(operation.toolCallId) ||
					validations.has(operation.toolCallId)));
		const formatted = formatOperation(operation, includeOutput, language);
		return {
			id: `operation:${operation.toolCallId}:${operation.order}`,
			section: "operations",
			order: operation.order,
			priority: failed
				? 0
				: validations.has(operation.toolCallId)
					? 1
					: recent.has(operation.toolCallId)
						? 2
						: 3,
			critical:
				modifies ||
				criticalFailures.has(operation.toolCallId) ||
				validations.has(operation.toolCallId) ||
				recent.has(operation.toolCallId),
			text: formatted.text,
			operationDetail: includeOutput ? "output" : "action",
			boundedOutputs: formatted.bounded ? 1 : 0,
		};
	});
}

function isValidationOperation(operation: ToolOperationFact) {
	if (operation.toolName !== "bash") return false;
	const command = operation.arguments.command;
	return typeof command === "string" && VALIDATION_COMMAND.test(command);
}

function formatOperation(
	operation: ToolOperationFact,
	includeOutput: boolean,
	language: Language,
) {
	const status = operation.result
		? operation.result.isError
			? language === "en"
				? "failed"
				: "失败"
			: language === "en"
				? "succeeded"
				: "成功"
		: language === "en"
			? "result missing"
			: "缺少结果";
	const lines = [
		`[${operation.timestamp}] [call:${operation.toolCallId}] [tool:${operation.toolName}] [${status}]`,
		`${language === "en" ? "Action" : "动作"}: ${formatToolAction(operation)}`,
	];
	let bounded = false;
	if (operation.result && includeOutput) {
		const clipped = boundTextByTokens(
			operation.result.text,
			TOOL_OUTPUT_TOKEN_LIMIT,
		);
		bounded = clipped.bounded;
		lines.push(
			`${language === "en" ? "Result" : "结果"} [entry:${operation.result.entryId}]:\n${clipped.text || (language === "en" ? "(empty)" : "（空）")}`,
		);
	} else if (
		operation.result &&
		(READ_TOOLS.has(operation.toolName) || operation.toolName === "bash")
	) {
		lines.push(
			language === "en"
				? "Result: succeeded; older output omitted by value policy."
				: "结果：成功；旧输出已按价值策略省略。",
		);
	}
	return { text: lines.join("\n"), bounded };
}

function formatToolAction(operation: ToolOperationFact) {
	const path = toolPath(operation.arguments);
	if (MODIFY_TOOLS.has(operation.toolName)) return path || "(path unavailable)";
	if (operation.toolName === "bash")
		return String(operation.arguments.command ?? "(command unavailable)");
	if (path) {
		const range = ["offset", "limit"]
			.filter((key) => operation.arguments[key] !== undefined)
			.map((key) => `${key}=${String(operation.arguments[key])}`)
			.join(", ");
		return range ? `${path} (${range})` : path;
	}
	const serialized = JSON.stringify(operation.arguments, null, 2);
	return boundTextByTokens(serialized, TOOL_ARGUMENT_TOKEN_LIMIT).text;
}

function toolPath(argumentsValue: Record<string, unknown>) {
	for (const key of [
		"path",
		"file_path",
		"filePath",
		"file",
		"target",
		"directory",
		"cwd",
	]) {
		const value = argumentsValue[key];
		if (typeof value === "string" && value.trim()) return value;
	}
	return "";
}

function coverageFor(
	facts: ContextEvidenceFacts,
	selected: ReadonlyMap<string, EvidenceBlock>,
): ContextEvidenceCoverage {
	const blocks = [...selected.values()];
	const included = (kind: ConversationFact["kind"]) =>
		blocks.filter((block) => block.kind === kind).length;
	const total = (kind: ConversationFact["kind"]) =>
		facts.conversation.filter((fact) => fact.kind === kind).length;
	const operations = blocks.filter((block) => block.section === "operations");
	return {
		users: { included: included("user"), total: total("user") },
		visibleSupplements: {
			included: included("visible_supplement"),
			total: total("visible_supplement"),
		},
		assistantFinals: {
			included: included("assistant_final"),
			total: total("assistant_final"),
		},
		operations: {
			included: operations.length,
			total: facts.operations.length,
			withOutput: operations.filter(
				(block) => block.operationDetail === "output",
			).length,
			actionOnly: operations.filter(
				(block) => block.operationDetail === "action",
			).length,
		},
		internalMessagesExcluded: facts.internalMessages,
		checkCardsExcluded: facts.checkCards,
		compactionBoundariesIgnored: facts.compactionBoundaries,
		boundedOutputs: blocks.reduce(
			(sum, block) => sum + block.boundedOutputs,
			0,
		),
	};
}

function selectedConversation(selected: ReadonlyMap<string, EvidenceBlock>) {
	return Object.freeze(
		[...selected.values()]
			.filter((block) => block.turn)
			.sort((left, right) => left.order - right.order)
			.map((block) => block.turn as ConversationTurn),
	);
}

export function formatTranscript(
	turns: readonly ConversationTurn[],
	language: Language,
) {
	return turns
		.map(
			(turn) =>
				`${transcriptLabel(turn.kind, language)} · ${turn.at}\n${turn.text}`,
		)
		.join("\n\n");
}

function formatPacket(
	projection: ContextEvidenceProjection,
	selected: ReadonlyMap<string, EvidenceBlock>,
	coverage: ContextEvidenceCoverage,
	language: Language,
) {
	const blocks = [...selected.values()];
	const conversation = blocks
		.filter((block) => block.section === "conversation")
		.sort((left, right) => left.order - right.order)
		.map((block) => block.text)
		.join("\n\n");
	const operations = blocks
		.filter((block) => block.section === "operations")
		.sort((left, right) => left.order - right.order)
		.map((block) => block.text)
		.join("\n\n");
	if (language === "en")
		return [
			"Source: raw getBranch() events; compaction and branch summaries were not consumed.",
			`Projection: ${projection}`,
			`Coverage: user ${ratio(coverage.users)}; visible supplements ${ratio(coverage.visibleSupplements)}; assistant finals ${ratio(coverage.assistantFinals)}; operations ${coverage.operations.included}/${coverage.operations.total} (output ${coverage.operations.withOutput}, action-only ${coverage.operations.actionOnly}); internal and check-control messages excluded; compaction boundaries ignored ${coverage.compactionBoundariesIgnored}; bounded outputs ${coverage.boundedOutputs}.`,
			`Conversation evidence:\n${conversation || "(none)"}`,
			...(projection === "review"
				? [`Operation evidence:\n${operations || "(none)"}`]
				: []),
		].join("\n\n");
	return [
		"来源：原始 getBranch() 事件；未消费 compaction 或 branch summary。",
		`投影：${projection}`,
		`Coverage：用户 ${ratio(coverage.users)}；可见用户补充 ${ratio(coverage.visibleSupplements)}；assistant 最终声明 ${ratio(coverage.assistantFinals)}；操作 ${coverage.operations.included}/${coverage.operations.total}（带输出 ${coverage.operations.withOutput}，仅动作 ${coverage.operations.actionOnly}）；内部消息与检查控制卡已排除；已忽略压缩边界 ${coverage.compactionBoundariesIgnored}；有界输出 ${coverage.boundedOutputs}。`,
		`对话证据：\n${conversation || "（无）"}`,
		...(projection === "review"
			? [`操作证据：\n${operations || "（无）"}`]
			: []),
	].join("\n\n");
}

function ratio(value: { included: number; total: number }) {
	return `${value.included}/${value.total}`;
}

function deepFreezeCoverage(coverage: ContextEvidenceCoverage) {
	Object.freeze(coverage.users);
	Object.freeze(coverage.visibleSupplements);
	Object.freeze(coverage.assistantFinals);
	Object.freeze(coverage.operations);
	return Object.freeze(coverage);
}

function overflowMessage(
	kind: "fixed" | "critical",
	required: number,
	available: number,
	language: Language,
) {
	if (language === "en")
		return kind === "fixed"
			? `Context Evidence stopped: protocol and reserved Pi overhead require about ${required} tokens, above the ${available}-token initial prompt limit.`
			: `Context Evidence stopped: critical source text requires about ${required} tokens, above the ${available}-token dynamic limit. Critical evidence was not silently truncated.`;
	return kind === "fixed"
		? `上下文证据已停止：协议与 Pi 预留空间估算需要 ${required} tokens，超过初始 prompt 上限 ${available}。`
		: `上下文证据已停止：关键来源原文估算需要 ${required} tokens，超过动态上限 ${available}；系统未静默裁剪关键证据。`;
}

export function estimateContextTokens(text: string) {
	let units = 0;
	for (const character of text) {
		if (/\s/u.test(character)) units += 0.25;
		else if ((character.codePointAt(0) ?? 0) <= 0x7f) units += 0.5;
		else units += 1;
	}
	return Math.ceil(units);
}

function boundTextByTokens(text: string, limit: number) {
	if (estimateContextTokens(text) <= limit) return { text, bounded: false };
	const characters = [...text];
	let headEnd = Math.floor(characters.length * 0.6);
	let tailStart = Math.floor(characters.length * 0.8);
	let bounded = `${characters.slice(0, headEnd).join("")}\n… [bounded middle omitted] …\n${characters.slice(tailStart).join("")}`;
	while (
		estimateContextTokens(bounded) > limit &&
		headEnd > 1 &&
		tailStart < characters.length
	) {
		headEnd = Math.floor(headEnd * 0.85);
		tailStart = Math.ceil(tailStart + (characters.length - tailStart) * 0.15);
		bounded = `${characters.slice(0, headEnd).join("")}\n… [bounded middle omitted] …\n${characters.slice(tailStart).join("")}`;
	}
	return { text: bounded, bounded: true };
}

function toolCalls(content: unknown) {
	return (Array.isArray(content) ? content : []).filter(
		(part): part is Record<string, unknown> =>
			isRecord(part) &&
			part.type === "toolCall" &&
			typeof part.id === "string" &&
			typeof part.name === "string",
	);
}

function textContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part) =>
				isRecord(part) && part.type === "text" && typeof part.text === "string",
		)
		.map((part) => String((part as Record<string, unknown>).text))
		.join("\n");
}

function entryId(entry: Record<string, unknown>, order: number) {
	return typeof entry.id === "string" ? entry.id : `entry-${order + 1}`;
}

function entryTimestamp(entry: Record<string, unknown>) {
	return typeof entry.timestamp === "string" ? entry.timestamp : "unknown";
}
