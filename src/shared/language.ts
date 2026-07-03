import { isLanguage, type Language, readConfiguredLanguage } from "./config.js";

let cachedLanguage: Language | undefined;

export type { Language };

export function runtimeLanguage(): Language {
	cachedLanguage ??= resolveRuntimeLanguage();
	return cachedLanguage;
}

export function resetRuntimeLanguageForTests() {
	cachedLanguage = undefined;
}

function resolveRuntimeLanguage(): Language {
	const envLanguage = languageFromValue(process.env.PI_FLOW_LANGUAGE);
	if (envLanguage) return envLanguage;
	const configured = readConfiguredLanguage();
	if (configured !== "auto") return configured;
	return languageFromLocale(machineLocale()) ?? "zh";
}

export function languageFromValue(value: unknown): Language | undefined {
	return isLanguage(value) ? value : undefined;
}

export function languageFromLocale(
	locale: string | undefined,
): Language | undefined {
	const normalized = normalizeLocale(locale);
	if (!normalized) return undefined;
	if (normalized.startsWith("zh")) return "zh";
	if (
		normalized === "c" ||
		normalized.startsWith("c.") ||
		normalized === "posix"
	)
		return undefined;
	return "en";
}

function machineLocale() {
	return (
		firstLocale(process.env.LC_ALL) ??
		firstLocale(process.env.LC_MESSAGES) ??
		firstLocale(process.env.LANGUAGE) ??
		firstLocale(process.env.LANG) ??
		intlLocale()
	);
}

function firstLocale(value: string | undefined) {
	return value
		?.split(/[:;]/u)
		.map((item) => item.trim())
		.find(Boolean);
}

function intlLocale() {
	try {
		return Intl.DateTimeFormat().resolvedOptions().locale;
	} catch {
		return undefined;
	}
}

function normalizeLocale(locale: string | undefined) {
	return locale?.trim().toLowerCase().replace("_", "-");
}
