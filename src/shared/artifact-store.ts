import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { isRecord } from "./guards.js";

export type ArtifactLocation<Key extends string, Artifact> = {
	id: string;
	dir: string;
	jsonPath: string;
} & { [Property in Key]: Artifact };

type ArtifactStoreOptions<Key extends string> = {
	rootDir: string;
	jsonName: string;
	idPattern: RegExp;
	idLabel: string;
	artifactKey: Key;
	artifactDirectoryMessage: string;
};

export function createArtifactStore<
	Artifact extends { errors: string[] },
	Key extends string,
>(options: ArtifactStoreOptions<Key>) {
	return new ArtifactStore<Artifact, Key>(options);
}

class ArtifactStore<Artifact extends { errors: string[] }, Key extends string> {
	constructor(private readonly options: ArtifactStoreOptions<Key>) {}

	root(cwd: string) {
		return join(cwd, this.options.rootDir);
	}

	dir(cwd: string, id: string) {
		this.assertId(id);
		this.assertRoot(cwd);
		assertPlainDirectoryIfExists(
			this.root(cwd),
			`${this.options.rootDir} 不是普通目录`,
		);
		return join(this.root(cwd), id);
	}

	jsonPath(dir: string) {
		return join(dir, this.options.jsonName);
	}

	read(dir: string): Artifact {
		const parsed = JSON.parse(
			readFileSync(this.jsonPath(dir), "utf8"),
		) as unknown;
		if (!isRecord(parsed))
			throw new Error(`${this.options.jsonName} 必须是对象`);
		return parsed as Artifact;
	}

	write(dir: string, artifact: Artifact) {
		this.assertRoot(this.cwdFromArtifactDir(dir));
		assertPlainDirectoryIfExists(
			dirname(dir),
			`${this.options.rootDir} 不是普通目录`,
		);
		assertPlainDirectoryIfExists(dir, this.options.artifactDirectoryMessage);
		mkdirSync(dir, { recursive: true });
		const next = { ...artifact, updatedAt: Date.now() } as Artifact;
		const tmp = join(dir, `${this.options.jsonName}.tmp`);
		writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
		renameSync(tmp, this.jsonPath(dir));
		return next;
	}

	listIds(cwd: string) {
		this.assertRoot(cwd);
		const rootDir = this.root(cwd);
		if (!existsSync(rootDir)) return [];
		assertPlainDirectoryIfExists(
			rootDir,
			`${this.options.rootDir} 不是普通目录`,
		);
		return readdirSync(rootDir)
			.filter((name) => this.isId(name) && isDirectory(join(rootDir, name)))
			.sort();
	}

	list(cwd: string) {
		return this.listIds(cwd)
			.map((id) => this.locationFromDisk(cwd, id))
			.filter(
				(item): item is ArtifactLocation<Key, Artifact> => item !== undefined,
			);
	}

	find(cwd: string, id: string) {
		const artifactDir = this.dir(cwd, id);
		if (existsSync(artifactDir) && !isDirectory(artifactDir)) {
			throw new Error(
				`${this.options.idLabel} 不是 ${this.options.rootDir} 下的普通目录：${id}`,
			);
		}
		const artifactJsonPath = this.jsonPath(artifactDir);
		if (!existsSync(artifactJsonPath)) return undefined;
		return this.location(
			id,
			artifactDir,
			artifactJsonPath,
			this.read(artifactDir),
		);
	}

	latest(cwd: string, include: (artifact: Artifact) => boolean = () => true) {
		return this.list(cwd)
			.filter((item) => include(item[this.options.artifactKey]))
			.sort(
				(a, b) =>
					artifactNumber(a.id) - artifactNumber(b.id) ||
					a.id.localeCompare(b.id),
			)
			.at(-1);
	}

	touchErrors(dir: string, artifact: Artifact, errors: string[]) {
		return this.write(dir, { ...artifact, errors });
	}

	private locationFromDisk(cwd: string, id: string) {
		const artifactDir = this.dir(cwd, id);
		const artifactJsonPath = this.jsonPath(artifactDir);
		if (!existsSync(artifactJsonPath)) return undefined;
		return this.location(
			id,
			artifactDir,
			artifactJsonPath,
			this.read(artifactDir),
		);
	}

	private assertRoot(cwd: string) {
		const root = this.options.rootDir.split(/[\\/]/u)[0];
		assertPlainDirectoryIfExists(join(cwd, root), `${root} 不是普通目录`);
	}

	private cwdFromArtifactDir(dir: string) {
		let cwd = dir;
		for (
			let index = 0;
			index <= this.options.rootDir.split(/[\\/]/u).length;
			index += 1
		)
			cwd = dirname(cwd);
		return cwd;
	}

	private assertId(id: string) {
		if (this.isId(id)) return;
		throw new Error(`${this.options.idLabel} 非法：${id}`);
	}

	private isId(id: string) {
		return !isAbsolute(id) && this.options.idPattern.test(id);
	}

	private location(
		id: string,
		dir: string,
		jsonPath: string,
		artifact: Artifact,
	) {
		return {
			id,
			dir,
			jsonPath,
			[this.options.artifactKey]: artifact,
		} as ArtifactLocation<Key, Artifact>;
	}
}

function artifactNumber(id: string) {
	return Number(/^(?:[A-Z])?([0-9]+)/iu.exec(id)?.[1] ?? 0);
}

function assertPlainDirectoryIfExists(path: string, message: string) {
	if (!existsSync(path)) return;
	if (!isDirectory(path)) throw new Error(`${message}：${path}`);
}

function isDirectory(path: string) {
	try {
		return lstatSync(path).isDirectory();
	} catch {
		return false;
	}
}
