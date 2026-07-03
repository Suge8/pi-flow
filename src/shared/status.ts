import type { Language } from "./config.js";
import { setStatusText } from "./ui-language.js";

export interface StatusSink {
	ui: {
		setStatus?: (key: string, value: string | undefined) => void;
	};
}

export interface ElapsedStatus {
	refresh: () => void;
	stop: () => void;
}

export function startElapsedStatus(
	ctx: StatusSink,
	key: string,
	render: (seconds: number) => string,
	options: { isActive?: () => boolean; language?: Language } = {},
): ElapsedStatus {
	let active = true;
	let seconds = 0;
	let timer: NodeJS.Timeout | undefined;
	const stop = () => {
		active = false;
		if (timer) clearInterval(timer);
	};
	const write = () => {
		if (!active) return;
		if (options.isActive && !options.isActive()) return;
		try {
			setStatusText(ctx, key, render(seconds), options.language);
		} catch (error) {
			if (!isStaleExtensionContextError(error)) throw error;
			stop();
		}
	};
	write();
	if (active) {
		timer = setInterval(() => {
			seconds += 1;
			write();
		}, 1_000);
		timer.unref?.();
	}
	return { refresh: write, stop };
}

export function setStatusSafe(
	ctx: StatusSink,
	key: string,
	value: string | undefined,
	language?: Language,
) {
	try {
		setStatusText(ctx, key, value, language);
		return true;
	} catch (error) {
		if (!isStaleExtensionContextError(error)) throw error;
		return false;
	}
}

export function clearStatus(ctx: StatusSink, key: string) {
	setStatusSafe(ctx, key, undefined);
}

function isStaleExtensionContextError(error: unknown) {
	return String(error).includes("This extension ctx is stale");
}

export function elapsedSeconds(startedAt: number) {
	return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

export function formatDuration(seconds: number) {
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	if (minutes < 60)
		return remainder === 0 ? `${minutes}m` : `${minutes}m${remainder}s`;
	const hours = Math.floor(minutes / 60);
	const hourMinutes = minutes % 60;
	return remainder === 0
		? `${hours}h${hourMinutes}m`
		: `${hours}h${hourMinutes}m${remainder}s`;
}
