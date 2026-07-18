export const ACTIVITY_SPINNER_FRAMES = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏",
] as const;

export const ACTIVITY_SPINNER_TOKEN = "\uE000";
export const ACTIVITY_SPINNER_INTERVAL_MS = 100;

export interface ActivitySpinnerText {
	message?: string;
	title?: string;
	rows?: readonly string[];
	hint?: string;
}

export function activitySpinnerLine(label: string) {
	return `${ACTIVITY_SPINNER_TOKEN} ${label}`;
}

export function hasActivitySpinner(message: ActivitySpinnerText) {
	return [
		message.message,
		message.title,
		message.hint,
		...(message.rows ?? []),
	].some((line) => line?.includes(ACTIVITY_SPINNER_TOKEN));
}

export function renderActivitySpinners(line: string) {
	if (!line.includes(ACTIVITY_SPINNER_TOKEN)) return line;
	return line.replaceAll(ACTIVITY_SPINNER_TOKEN, currentActivitySpinnerFrame());
}

function currentActivitySpinnerFrame() {
	const index =
		Math.floor(Date.now() / ACTIVITY_SPINNER_INTERVAL_MS) %
		ACTIVITY_SPINNER_FRAMES.length;
	return ACTIVITY_SPINNER_FRAMES[index];
}
