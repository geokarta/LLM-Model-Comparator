import { BenchmarkDefinition, BenchmarkId, LLMModel } from './types.ts';

/**
 * Normalize a benchmark score onto a 0..100 scale.
 */
export function normalizeScore(
  score: number | null | undefined,
  bench: BenchmarkDefinition
): number | null {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  if (bench.unit === 'Elo') {
    const clamped = Math.max(bench.min, Math.min(bench.max, score));
    return ((clamped - bench.min) / (bench.max - bench.min)) * 100;
  }
  return Math.max(0, Math.min(100, score));
}

/**
 * Compute weighted Composite Power Index (0..100) across all available benchmarks.
 */
export function computePowerIndex(
  model: LLMModel,
  benchmarks: BenchmarkDefinition[],
  activeBenchmarkIds?: BenchmarkId[]
): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const bench of benchmarks) {
    if (activeBenchmarkIds && !activeBenchmarkIds.includes(bench.id)) continue;
    const entry = model.benchmarks[bench.id];
    const norm = normalizeScore(entry?.score, bench);
    if (norm !== null) {
      weightedSum += norm * bench.weight;
      totalWeight += bench.weight;
    }
  }

  if (totalWeight === 0) return 0;
  return Number((weightedSum / totalWeight).toFixed(1));
}

/**
 * Compute blended API price per 1M tokens (3:1 input/output standard ratio).
 */
export function computeBlendedPricePer1M(model: LLMModel): number {
  return Number(((model.inputPricePer1M * 3 + model.outputPricePer1M) / 4).toFixed(2));
}

/**
 * Simulate custom task cost given prompt tokens, completion tokens, and agentic turns.
 */
export function simulateTaskCost(
  model: LLMModel,
  inputTokensPerTurn: number,
  outputTokensPerTurn: number,
  turns: number
): number {
  // In multi-turn agentic tasks, context accumulates roughly linearly
  let totalInput = 0;
  let totalOutput = 0;
  for (let t = 0; t < turns; t++) {
    totalInput += inputTokensPerTurn + t * Math.round(outputTokensPerTurn * 0.65);
    totalOutput += outputTokensPerTurn;
  }
  const cost =
    (totalInput / 1_000_000) * model.inputPricePer1M +
    (totalOutput / 1_000_000) * model.outputPricePer1M;
  return Number(cost.toFixed(4));
}

/**
 * Compute Efficiency Index (Power Index per log-scaled cost) — higher is better.
 */
export function computeEfficiencyScore(powerIndex: number, costPerTaskUsd: number): number {
  const safeCost = Math.max(costPerTaskUsd, 0.01);
  // Scales smoothly so both ultra-cheap strong models and frontier value models stand out
  const score = powerIndex / (1 + Math.log10(1 + safeCost * 12));
  return Number(score.toFixed(1));
}

/**
 * Determine which points lie on the Pareto Frontier (maximize Y=score, minimize X=cost).
 */
export function computeParetoIds(
  points: Array<{ id: string; cost: number; score: number }>
): Set<string> {
  const sorted = [...points].sort((a, b) => a.cost - b.cost || b.score - a.score);
  const pareto = new Set<string>();
  let maxScoreSoFar = -Infinity;

  for (const pt of sorted) {
    if (pt.score > maxScoreSoFar) {
      pareto.add(pt.id);
      maxScoreSoFar = pt.score;
    }
  }
  return pareto;
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  return `${Math.round(tokens / 1000)}K`;
}

/**
 * Convert YYYY-MM release date to decimal year (e.g. "2026-10" -> 2026.79).
 */
export function releaseDateToDecimalYear(ym: string): number {
  const [yStr, mStr] = ym.split('-');
  const y = Number(yStr) || 2026;
  const m = Number(mStr) || 6;
  return Number((y + (m - 0.5) / 12).toFixed(3));
}

/**
 * AI 2027 reference curve: predicted autonomous METR time-horizon (in hours, 50% reliability)
 * for any given decimal year (2024.5 .. 2028.0).
 * Anchors:
 *   2024.5 -> 0.25h (15 min)
 *   2025.5 -> 1.0h  (Agent-0)
 *   2025.9 -> 3.0h  (Agent-1 early)
 *   2026.5 -> 10.0h
 *   2027.0 -> 28.0h (Agent-2)
 *   2027.25 -> 80.0h (Agent-3 Superhuman Coder)
 *   2027.85 -> 200.0h (Agent-4 Superhuman AI Researcher)
 */
export function ai2027CurveHours(year: number): number {
  const baseDoublingMonths = 6.2;
  // Base exponential from 2025.0 = 0.5h
  const monthsSince2025 = (year - 2025.0) * 12;
  let hours = 0.5 * Math.pow(2, monthsSince2025 / baseDoublingMonths);
  // AI R&D takeoff acceleration kicks in smoothly from late 2026 onward
  if (year > 2026.6) {
    const accel = Math.pow(year - 2026.6, 1.85) * 1.45;
    hours *= Math.pow(2, accel);
  }
  return Number(Math.max(0.08, Math.min(400, hours)).toFixed(2));
}

/**
 * Invert the AI 2027 curve: given an autonomous time-horizon in hours,
 * return the decimal year on the AI 2027 curve where that horizon is predicted.
 */
export function ai2027DateForHours(hours: number): number {
  let lo = 2023.5;
  let hi = 2028.5;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (ai2027CurveHours(mid) < hours) lo = mid;
    else hi = mid;
  }
  return Number(((lo + hi) / 2).toFixed(2));
}

/**
 * Estimate a model's autonomous METR time-horizon (in hours, 50% reliability)
 * from its agentic & abstract reasoning benchmarks (SWE-bench, Terminal-Bench, ARC-AGI-2/3, HLE).
 */
export function estimateModelHorizonHours(model: LLMModel): number {
  const swe = model.benchmarks.swe_bench?.score ?? 50;
  const term = model.benchmarks.terminal_bench?.score ?? 45;
  const arc2 = model.benchmarks.arc_agi_2?.score ?? 30;
  const arc3 = model.benchmarks.arc_agi_3?.score ?? 10;
  const hle = model.benchmarks.hle?.score ?? 15;

  // Weighted agentic autonomy index (0..100)
  const autonomyIndex =
    swe * 0.28 +
    term * 0.22 +
    arc2 * 0.18 +
    arc3 * 0.20 +
    Math.min(100, hle * 1.45) * 0.12;

  // Map autonomyIndex (35..95) onto exponential time horizon (~0.25h .. ~48h)
  const exp = (autonomyIndex - 52) / 9.2;
  const hours = Math.pow(2, exp);
  return Number(Math.max(0.15, Math.min(120, hours)).toFixed(2));
}

export function formatHorizonHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 8) return `${hours.toFixed(1)} h`;
  if (hours < 40) return `${hours.toFixed(1)} h (~${(hours / 8).toFixed(1)} j)`;
  if (hours < 160) return `${Math.round(hours)} h (~${(hours / 40).toFixed(1)} sem.)`;
  return `${Math.round(hours)} h (~${(hours / 160).toFixed(1)} mois)`;
}

