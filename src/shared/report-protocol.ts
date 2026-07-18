import { createHmac, timingSafeEqual } from "node:crypto";
import type { ReportConfig } from "./config.js";

export const REPORT_PROTOCOL = 1;
export const REPORT_SERVICE = "pi-flow-report";

export interface ReportHealth {
	service: typeof REPORT_SERVICE;
	protocol: typeof REPORT_PROTOCOL;
	pid: number;
	bind: string;
	port: number;
}

export interface ReportEndpoint {
	protocol: typeof REPORT_PROTOCOL;
	pid: number;
	bind: string;
	port: number;
	startedAt: number;
}

export interface ReportRegistrationRequest {
	cwd: string;
	path: string;
}

export interface ReportRegistration {
	cap: string;
	localUrl: string;
	publicUrl: string;
}

export interface ReportDaemonStart {
	type: "start";
	protocol: typeof REPORT_PROTOCOL;
	config: ReportConfig;
	runtimeDir: string;
}

export function parseReportHealth(value: unknown): ReportHealth | undefined {
	if (!exactRecord(value, ["service", "protocol", "pid", "bind", "port"]))
		return undefined;
	if (value.service !== REPORT_SERVICE || value.protocol !== REPORT_PROTOCOL)
		return undefined;
	if (!positiveInteger(value.pid) || typeof value.bind !== "string")
		return undefined;
	if (!validPort(value.port)) return undefined;
	return value as unknown as ReportHealth;
}

export function parseReportEndpoint(
	value: unknown,
): ReportEndpoint | undefined {
	if (!exactRecord(value, ["protocol", "pid", "bind", "port", "startedAt"]))
		return undefined;
	if (value.protocol !== REPORT_PROTOCOL || !positiveInteger(value.pid))
		return undefined;
	if (typeof value.bind !== "string" || !validPort(value.port))
		return undefined;
	if (typeof value.startedAt !== "number" || !Number.isFinite(value.startedAt))
		return undefined;
	return value as unknown as ReportEndpoint;
}

export function parseReportRegistrationRequest(
	value: unknown,
): ReportRegistrationRequest | undefined {
	if (!exactRecord(value, ["cwd", "path"])) return undefined;
	if (typeof value.cwd !== "string" || typeof value.path !== "string")
		return undefined;
	if (!value.cwd || !value.path) return undefined;
	return value as unknown as ReportRegistrationRequest;
}

export function parseReportRegistration(
	value: unknown,
): ReportRegistration | undefined {
	if (!exactRecord(value, ["cap", "localUrl", "publicUrl"])) return undefined;
	if (
		typeof value.cap !== "string" ||
		typeof value.localUrl !== "string" ||
		typeof value.publicUrl !== "string" ||
		!isCapability(value.cap)
	)
		return undefined;
	try {
		new URL(value.localUrl);
		new URL(value.publicUrl);
	} catch {
		return undefined;
	}
	return value as unknown as ReportRegistration;
}

export function parseReportDaemonStart(
	value: unknown,
): ReportDaemonStart | undefined {
	if (!exactRecord(value, ["type", "protocol", "config", "runtimeDir"]))
		return undefined;
	if (
		value.type !== "start" ||
		value.protocol !== REPORT_PROTOCOL ||
		typeof value.runtimeDir !== "string" ||
		!value.runtimeDir ||
		!parseReportConfig(value.config)
	)
		return undefined;
	return value as unknown as ReportDaemonStart;
}

export function reportCapability(key: Buffer, realPath: string) {
	return createHmac("sha256", key).update(realPath).digest("base64url");
}

export function isCapability(value: string) {
	return /^[A-Za-z0-9_-]{43}$/u.test(value);
}

export function bearerMatches(header: string | undefined, key: Buffer) {
	if (!header?.startsWith("Bearer ")) return false;
	let supplied: Buffer;
	try {
		supplied = Buffer.from(header.slice(7), "base64url");
	} catch {
		return false;
	}
	return supplied.length === key.length && timingSafeEqual(supplied, key);
}

export function reportClientHost(bind: string) {
	if (bind === "0.0.0.0") return "127.0.0.1";
	if (bind === "::") return "::1";
	return bind;
}

export function reportBaseUrl(bind: string, port: number) {
	const host = reportClientHost(bind);
	return `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
}

function parseReportConfig(value: unknown): value is ReportConfig {
	if (!exactRecord(value, ["bind", "port", "publicBaseUrl"])) return false;
	return (
		typeof value.bind === "string" &&
		validPort(value.port) &&
		(value.publicBaseUrl === null || typeof value.publicBaseUrl === "string")
	);
}

function exactRecord(
	value: unknown,
	keys: string[],
): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return false;
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === expected[index])
	);
}

function positiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function validPort(value: unknown): value is number {
	return positiveInteger(value) && value <= 65535;
}
