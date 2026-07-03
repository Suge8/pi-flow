import { currentSessionFile } from "../shared/session.js";
import { flowOwningSession } from "./store.js";

export { currentSessionFile };

export function flowOwnerForSession(ctx: {
	cwd: string;
	sessionManager?: unknown;
}) {
	const sessionFile = currentSessionFile(ctx);
	return flowOwningSession(ctx.cwd, sessionFile);
}

export function isFlowOwnedSession(ctx: {
	cwd: string;
	sessionManager?: unknown;
}) {
	return flowOwnerForSession(ctx) !== undefined;
}
