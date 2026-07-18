import { connect, createServer } from "node:net";

const LOCK_HOST = "127.0.0.1";
const LOCK_PORT = 49328;
const LOCK_TIMEOUT_MS = 10 * 60_000;

export async function acquireReportPortTestLock() {
	const acquired = await tryAcquire();
	if (acquired) return acquired;
	await waitForRelease();
	return acquireReportPortTestLock();
}

function tryAcquire() {
	return new Promise((resolve, reject) => {
		const sockets = new Set();
		const server = createServer((socket) => {
			sockets.add(socket);
			socket.unref();
			socket.once("close", () => sockets.delete(socket));
		});
		server.unref();
		server.once("error", (error) => {
			if (error?.code === "EADDRINUSE") resolve(undefined);
			else reject(error);
		});
		server.listen(LOCK_PORT, LOCK_HOST, () => {
			resolve(async () => {
				const closed = new Promise((resolveClose) =>
					server.close(resolveClose),
				);
				for (const socket of sockets) socket.destroy();
				await closed;
			});
		});
	});
}

function waitForRelease() {
	return new Promise((resolve, reject) => {
		const socket = connect(LOCK_PORT, LOCK_HOST);
		const timeout = setTimeout(() => {
			socket.destroy();
			reject(new Error("Timed out waiting for the report-port test lock"));
		}, LOCK_TIMEOUT_MS);
		const finish = () => {
			clearTimeout(timeout);
			socket.destroy();
			resolve();
		};
		socket.once("close", finish);
		socket.once("error", (error) => {
			if (error?.code === "ECONNREFUSED") finish();
			else {
				clearTimeout(timeout);
				reject(error);
			}
		});
	});
}
