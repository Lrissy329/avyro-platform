export type ReviewCategoryKey =
  | "cleanliness"
  | "accuracy"
  | "communication"
  | "location"
  | "value";

export type ReviewCategory = {
  key: ReviewCategoryKey;
  label: string;
  score: number;
};

export type ReviewSummary = {
  overall: number;
  total: number;
  label: string | null;
  categories: ReviewCategory[];
};

const CATEGORY_LABELS: Record<ReviewCategoryKey, string> = {
  cleanliness: "Cleanliness",
  accuracy: "Accuracy",
  communication: "Communication",
  location: "Location",
  value: "Value",
};

const clampScore = (value: number) => Math.min(10, Math.max(0, value));

export const formatReviewLabel = (score: number): string | null => {
  if (score < 8) return null;
  if (score >= 9.5) return "Exceptional";
  if (score >= 9.0) return "Excellent";
  if (score >= 8.5) return "Great";
  return "Good";
};

export const computeOverallScore = (scores: Record<ReviewCategoryKey, number>): number => {
  const entries = Object.entries(scores) as Array<[ReviewCategoryKey, number]>;
  const raw = entries.length
    ? entries.reduce((sum, [, value]) => sum + clampScore(value), 0) / entries.length
    : 0;
  return Number(raw.toFixed(1));
};

export const buildReviewSummary = (
  scores: Record<ReviewCategoryKey, number>,
  total: number
): ReviewSummary => {
  const categories = (Object.keys(CATEGORY_LABELS) as ReviewCategoryKey[]).map((key) => ({
    key,
    label: CATEGORY_LABELS[key],
    score: clampScore(scores[key]),
  }));
  const overall = computeOverallScore(scores);
  return {
    overall,
    total,
    label: formatReviewLabel(overall),
    categories,
  };
};

export const getFallbackReviewSummary = (): ReviewSummary =>
  buildReviewSummary(
    {
      cleanliness: 9.4,
      accuracy: 9.1,
      communication: 9.5,
      location: 8.9,
      value: 9.0,
    },
    25
  );

export const formatReviewSummaryLine = (summary: ReviewSummary): string => {
  const parts = [`${summary.overall.toFixed(1)}`];
  if (summary.label) parts.push(summary.label);
  parts.push(`${summary.total} reviews`);
  return parts.join(" · ");
};

export const formatReviewSummaryLineFromScore = (
  overall: number,
  total: number
): string => {
  const label = formatReviewLabel(overall);
  const parts = [`${overall.toFixed(1)}`];
  if (label) parts.push(label);
  parts.push(`${total} reviews`);
  return parts.join(" · ");
};
