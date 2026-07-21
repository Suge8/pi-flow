// 评测 RPC 入口：把 RpcClient 的 `node <cli>` 转成宿主 `pi` 进程。
// 与 worker 的 background.command 共用同一二进制与 ~/.pi auth，避免包内 cli 缺 oauth。
import { spawn } from "node:child_process";

const command = process.env.PI_FLOW_EVAL_HOST_COMMAND || "pi";
const child = spawn(command, process.argv.slice(2), {
	stdio: ["pipe", "pipe", "pipe"],
	env: process.env,
	detached: process.platform !== "win32",
});

process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

const forward = (signal) => {
	if (!child.pid) return;
	if (process.platform === "win32") {
		child.kill(signal);
		return;
	}
	try {
		process.kill(-child.pid, signal);
	} catch {
		try {
			child.kill(signal);
		} catch {
			/* ignore */
		}
	}
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
	process.on(signal, () => forward(signal));

child.on("error", (error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
child.on("exit", (code, signal) => {
	if (signal) process.exit(1);
	process.exit(code ?? 1);
});
