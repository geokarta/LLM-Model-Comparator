export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'xai'
  | 'meta'
  | 'mistral'
  | 'qwen';

export type ModelTier = 'flagship' | 'reasoning' | 'balanced' | 'fast' | 'open-weight';

export type BenchmarkId =
  | 'arc_agi_1'
  | 'arc_agi_2'
  | 'arc_agi_3'
  | 'swe_bench'
  | 'gpqa_diamond'
  | 'hle'
  | 'frontier_math'
  | 'terminal_bench'
  | 'live_bench'
  | 'lmarena_elo';

export interface BenchmarkDefinition {
  id: BenchmarkId;
  name: string;
  shortName: string;
  category: 'Raisonnement Abstrait' | 'Agentique & Code' | 'Science & Maths' | 'Général & Humain';
  unit: '%' | 'Elo';
  min: number;
  max: number;
  weight: number; // weight in composite power index
  hasCostPerTask?: boolean;
  saturationLevel: 'Faible (Frontière)' | 'Modérée' | 'Élevée';
  summary: string;
  whatItMeasures: string;
  whyItMatters: string;
  methodology: string;
  sourceName: string;
  sourceUrl: string;
}

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  shortName: string;
  color: string;
  accentBg: string;
  headquarters: string;
  philosophy: string;
}

export interface BenchmarkScore {
  score: number | null; // % (0-100) or Elo
  costPerTaskUsd?: number | null; // e.g. ARC-AGI-2 or ARC-AGI-3 cost per task
  verified?: boolean;
  updatedAt?: string;
}

export type ModelGeneration = 'current' | 'previous';

export interface LLMModel {
  id: string;
  openRouterId?: string;
  name: string;
  provider: ProviderId;
  generation: ModelGeneration;
  generationLabel: string; // e.g. "GPT-6", "GPT-5", "Gemini 4", "Gemini 3"
  tier: ModelTier;
  positioning: string;
  releaseDate: string; // YYYY-MM
  openWeight: boolean;
  contextWindow: number; // tokens
  maxOutputTokens: number;
  inputPricePer1M: number; // USD
  outputPricePer1M: number; // USD
  avgCostPerTaskUsd: number; // Standard multi-step benchmark task cost estimate
  speedTokPerSec: number; // output tokens / sec
  latencyTtftMs: number; // time to first token ms
  benchmarks: Record<BenchmarkId, BenchmarkScore>;
  notes: string;
  lastSyncedAt?: string;
  priceSource?: 'seed' | 'openrouter-live' | 'manual';
}

export interface HarvestSourceResult {
  source: string;
  url: string;
  status: 'ok' | 'partial' | 'fallback' | 'error';
  modelsMatched: number;
  fieldsUpdated: number;
  newModelsDiscovered: number;
  durationMs: number;
  message: string;
}

export interface HarvestChangeEntry {
  modelId: string;
  modelName: string;
  field: string;
  oldValue: string | number | null;
  newValue: string | number | null;
  source: string;
}

export interface HarvestRecord {
  id: string;
  timestamp: string;
  trigger: 'ui' | 'cli' | 'startup';
  durationMs: number;
  sources: HarvestSourceResult[];
  totalUpdatedFields: number;
  changes: HarvestChangeEntry[];
}

export interface TelemetryDataset {
  version: string;
  lastHarvestAt: string;
  providers: ProviderMeta[];
  benchmarks: BenchmarkDefinition[];
  models: LLMModel[];
  harvestHistory: HarvestRecord[];
}
