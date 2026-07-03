export type ReviewHistoryResult = "passed" | "failed" | "error";

export interface ReviewHistoryEntry {
	round: number;
	result: ReviewHistoryResult;
	summary: string;
	details?: string;
}
