export function cleanReportCopy(text: string) {
	const cwd = process.cwd();
	return cwd ? text.replaceAll(cwd, ".") : text;
}
