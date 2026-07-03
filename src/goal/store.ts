import { join } from "node:path";
import { createArtifactStore } from "../shared/artifact-store.js";
import type { GoalArtifactLocation, GoalArtifactState } from "./types.js";

const GOAL_ID_PATTERN = /^G[1-9]\d*-[a-z0-9-]+$/u;

const goalStore = createArtifactStore<GoalArtifactState, "goal">({
	rootDir: ".flow/goals",
	jsonName: "goal.json",
	idPattern: GOAL_ID_PATTERN,
	idLabel: "目标 id",
	artifactKey: "goal",
	artifactDirectoryMessage: "目标目录不是普通目录",
});

export function goalRoot(cwd: string) {
	return goalStore.root(cwd);
}

export function goalDir(cwd: string, id: string) {
	return goalStore.dir(cwd, id);
}

export function goalJsonPath(dir: string) {
	return goalStore.jsonPath(dir);
}

export function goalPlanPath(dir: string) {
	return join(dir, "plan.md");
}

export function readGoalArtifact(dir: string): GoalArtifactState {
	return goalStore.read(dir);
}

export function writeGoalArtifact(dir: string, goal: GoalArtifactState) {
	return goalStore.write(dir, goal);
}

export function listGoalIds(cwd: string) {
	return goalStore.listIds(cwd);
}

export function listGoalArtifacts(cwd: string): GoalArtifactLocation[] {
	return goalStore.list(cwd);
}

export function findGoalArtifact(cwd: string, id: string) {
	return goalStore.find(cwd, id);
}

export function latestGoalArtifact(
	cwd: string,
	include: (goal: GoalArtifactState) => boolean = () => true,
) {
	return goalStore.latest(cwd, include);
}

export function touchGoalErrors(
	dir: string,
	goal: GoalArtifactState,
	errors: string[],
) {
	return goalStore.touchErrors(dir, goal, errors);
}
