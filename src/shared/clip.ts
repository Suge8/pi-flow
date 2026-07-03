export function clipText(text: string, maxLength: number, ellipsis = "…") {
	if (maxLength <= 0) return "";
	if (text.length <= maxLength) return text;
	if (maxLength <= ellipsis.length) return text.slice(0, maxLength);
	return `${text.slice(0, maxLength - ellipsis.length)}${ellipsis}`;
}

export function clipSummary(text: string) {
	return clipText(text.replace(/\s+/g, " ").trim(), 55);
}
