import fs from 'node:fs/promises';
import path from 'node:path';
import {
  HarvestChangeEntry,
  HarvestRecord,
  HarvestSourceResult,
  LLMModel,
  ProviderId,
  TelemetryDataset,
} from '../shared/types.ts';
import { createSeedDataset, DATASET_VERSION } from './seedData.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'telemetry.json');

export async function loadDataset(): Promise<TelemetryDataset> {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as TelemetryDataset;
    if (
      parsed &&
      parsed.version === DATASET_VERSION &&
      Array.isArray(parsed.models) &&
      Array.isArray(parsed.benchmarks)
    ) {
      return parsed;
    }
  } catch {
    // Seed if file doesn't exist yet or version changed
  }
  const seed = createSeedDataset();
  await saveDataset(seed);
  return seed;
}

export async function saveDataset(dataset: TelemetryDataset): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(dataset, null, 2), 'utf-8');
}

interface OpenRouterModel {
  id: string;
  name?: string;
  created?: number; // Unix timestamp in seconds (publication date!)
  context_length?: number;
  top_provider?: {
    max_completion_tokens?: number | null;
  };
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

const PROVIDER_PREFIXES: Record<ProviderId, string> = {
  openai: 'openai/',
  anthropic: 'anthropic/',
  google: 'google/',
  deepseek: 'deepseek/',
  xai: 'x-ai/',
  meta: 'meta-llama/',
  mistral: 'mistralai/',
  qwen: 'qwen/',
};

function detectProviderFromOpenRouterId(id: string): ProviderId | null {
  const lower = id.toLowerCase();
  for (const [prov, prefix] of Object.entries(PROVIDER_PREFIXES)) {
    if (lower.startsWith(prefix)) return prov as ProviderId;
  }
  return null;
}

function unixToIsoDate(sec?: number): string | null {
  if (!sec || !Number.isFinite(sec) || sec < 1600000000) return null;
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

function shouldAutoImportOpenRouterModel(m: OpenRouterModel): boolean {
  const lower = m.id.toLowerCase();
  if (lower.includes(':')) return false; // skip :free, :extended, :nitro, :online variants
  const skipWords = [
    'embed',
    'whisper',
    'tts',
    'dall-e',
    'imagen',
    'audio',
    'moderation',
    'guard',
    'safeguard',
    'vision-preview',
    'instruct-v0',
    'beta',
    'nano',
    'realtime',
  ];
  if (skipWords.some((w) => lower.includes(w))) return false;
  if (!m.created || m.created < 1767225600) return false; // published >= 2026-01-01
  const pIn = parseFloat(m.pricing?.prompt ?? '0');
  const pOut = parseFloat(m.pricing?.completion ?? '0');
  if (Number.isNaN(pIn) || Number.isNaN(pOut) || (pIn === 0 && pOut === 0)) return false;
  return true;
}

function normalizeKey(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findMatchingOpenRouterModel(
  model: LLMModel,
  catalog: OpenRouterModel[]
): OpenRouterModel | undefined {
  if (model.openRouterId) {
    const exact = catalog.find(
      (c) => c.id.toLowerCase() === model.openRouterId!.toLowerCase()
    );
    if (exact) return exact;
  }

  const providerPrefix: Record<string, string[]> = {
    openai: ['openai/'],
    anthropic: ['anthropic/'],
    google: ['google/'],
    deepseek: ['deepseek/'],
    xai: ['x-ai/'],
    meta: ['meta-llama/'],
    mistral: ['mistralai/'],
    qwen: ['qwen/'],
  };

  const prefixes = providerPrefix[model.provider] ?? [];
  const sameProvider = catalog.filter((c) =>
    prefixes.some((p) => c.id.toLowerCase().startsWith(p))
  );

  // Extract meaningful tokens (model codenames & version numbers) to avoid false matches
  const cleanName = model.name.replace(/\(.*?\)/g, '').trim();
  const targetTokens = cleanName
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter((t) => t.length >= 2 && !['gpt', 'claude', 'gemini', 'grok', 'llama', 'mistral', 'qwen', 'deepseek'].includes(t));

  if (targetTokens.length === 0) return undefined;

  return sameProvider.find((c) => {
    const slug = (c.id.split('/')[1] ?? c.id).toLowerCase();
    const fullName = (c.name ?? '').toLowerCase();
    return targetTokens.every((tok) => slug.includes(tok) || fullName.includes(tok));
  });
}

async function fetchWithTimeout(url: string, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AETHER9-LLM-Telemetry-Harvester/1.0',
        Accept: 'application/json, text/plain, */*',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function harvestOpenRouter(
  dataset: TelemetryDataset,
  changes: HarvestChangeEntry[]
): Promise<HarvestSourceResult> {
  const url = 'https://openrouter.ai/api/v1/models';
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(url, 12000);
    if (!res.ok) {
      return {
        source: 'OpenRouter Live Catalog (Prix & Contexte)',
        url,
        status: 'error',
        modelsMatched: 0,
        fieldsUpdated: 0,
        newModelsDiscovered: 0,
        durationMs: Date.now() - started,
        message: `HTTP ${res.status} lors de la requête OpenRouter.`,
      };
    }

    const payload = (await res.json()) as { data?: OpenRouterModel[] };
    const catalog = payload.data ?? [];
    let matched = 0;
    let updated = 0;
    let discoveredCount = 0;
    const now = new Date().toISOString();
    const matchedOpenRouterIds = new Set<string>();

    for (const model of dataset.models) {
      if (model.status === 'upcoming') continue;
      const live = findMatchingOpenRouterModel(model, catalog);
      if (!live) continue;
      matched++;
      matchedOpenRouterIds.add(live.id.toLowerCase());
      model.lastSyncedAt = now;

      const exactDate = unixToIsoDate(live.created);
      if (exactDate && model.releaseDate.length <= 7) {
        model.releaseDate = exactDate;
      }

      if (live.pricing?.prompt && live.pricing?.completion) {
        const liveIn = Number((parseFloat(live.pricing.prompt) * 1_000_000).toFixed(4));
        const liveOut = Number((parseFloat(live.pricing.completion) * 1_000_000).toFixed(4));

        if (!Number.isNaN(liveIn) && liveIn > 0 && Math.abs(liveIn - model.inputPricePer1M) > 0.001) {
          changes.push({
            modelId: model.id,
            modelName: model.name,
            field: 'inputPricePer1M',
            oldValue: model.inputPricePer1M,
            newValue: liveIn,
            source: 'OpenRouter',
          });
          model.inputPricePer1M = liveIn;
          model.priceSource = 'openrouter-live';
          updated++;
        }

        if (!Number.isNaN(liveOut) && liveOut > 0 && Math.abs(liveOut - model.outputPricePer1M) > 0.001) {
          changes.push({
            modelId: model.id,
            modelName: model.name,
            field: 'outputPricePer1M',
            oldValue: model.outputPricePer1M,
            newValue: liveOut,
            source: 'OpenRouter',
          });
          model.outputPricePer1M = liveOut;
          model.priceSource = 'openrouter-live';
          updated++;
        }
      }

      if (
        live.context_length &&
        live.context_length >= 8192 &&
        live.context_length !== model.contextWindow
      ) {
        changes.push({
          modelId: model.id,
          modelName: model.name,
          field: 'contextWindow',
          oldValue: model.contextWindow,
          newValue: live.context_length,
          source: 'OpenRouter',
        });
        model.contextWindow = live.context_length;
        updated++;
      }
    }

    // Auto-discover newly published models from our 8 tracked providers (sorted newest first, cap 20)
    const candidates = catalog
      .filter((c) => {
        const prov = detectProviderFromOpenRouterId(c.id);
        if (!prov) return false;
        if (matchedOpenRouterIds.has(c.id.toLowerCase())) return false;
        const alreadyExists = dataset.models.some(
          (m) =>
            m.openRouterId?.toLowerCase() === c.id.toLowerCase() ||
            normalizeKey(m.name) === normalizeKey(c.name ?? '')
        );
        if (alreadyExists) return false;
        return shouldAutoImportOpenRouterModel(c);
      })
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
      .slice(0, 20);

    for (const c of candidates) {
      const prov = detectProviderFromOpenRouterId(c.id)!;
      const cleanName = (c.name ?? c.id.split('/')[1] ?? c.id)
        .replace(/^[A-Za-z0-9\s]+:\s*/, '')
        .trim();
      const inPrice = Number((parseFloat(c.pricing?.prompt ?? '0') * 1_000_000).toFixed(4));
      const outPrice = Number((parseFloat(c.pricing?.completion ?? '0') * 1_000_000).toFixed(4));
      const releaseDate = unixToIsoDate(c.created) ?? now.slice(0, 10);
      const isOpenWeight = ['deepseek', 'meta', 'qwen', 'mistral'].includes(prov);
      const estTaskCost = Number(Math.max(0.01, (inPrice * 0.04 + outPrice * 0.01)).toFixed(3));
      const slugId = `or-${c.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

      const newModel: LLMModel = {
        id: slugId,
        openRouterId: c.id,
        name: cleanName,
        provider: prov,
        generation: 'current',
        generationLabel: `Publié ${releaseDate.slice(0, 7)}`,
        tier: isOpenWeight ? 'open-weight' : inPrice >= 4 ? 'flagship' : inPrice <= 0.5 ? 'fast' : 'balanced',
        positioning: 'Nouveau modèle découvert via OpenRouter Live',
        releaseDate,
        status: 'released',
        discoveredByHarvester: true,
        openWeight: isOpenWeight,
        contextWindow: c.context_length ?? 128000,
        maxOutputTokens: c.top_provider?.max_completion_tokens ?? 32000,
        inputPricePer1M: inPrice,
        outputPricePer1M: outPrice,
        avgCostPerTaskUsd: estTaskCost,
        speedTokPerSec: 110,
        latencyTtftMs: 500,
        benchmarks: {
          arc_agi_1: { score: null },
          arc_agi_2: { score: null },
          arc_agi_3: { score: null },
          swe_bench: { score: null },
          gpqa_diamond: { score: null },
          hle: { score: null },
          frontier_math: { score: null },
          terminal_bench: { score: null },
          live_bench: { score: null },
          lmarena_elo: { score: null },
        },
        notes: `Découvert automatiquement lors du moissonnage OpenRouter (${c.id}).`,
        lastSyncedAt: now,
        priceSource: 'openrouter-live',
      };

      dataset.models.push(newModel);
      discoveredCount++;
      updated++;
      changes.push({
        modelId: newModel.id,
        modelName: newModel.name,
        field: 'nouveau_modele',
        oldValue: null,
        newValue: `${releaseDate} ($${inPrice}/$${outPrice})`,
        source: 'OpenRouter',
      });
    }

    return {
      source: 'OpenRouter Live Catalog (Prix, Contexte & Nouveaux Modèles)',
      url,
      status: 'ok',
      modelsMatched: matched,
      fieldsUpdated: updated,
      newModelsDiscovered: discoveredCount,
      durationMs: Date.now() - started,
      message: `${catalog.length} modèles scannés, ${matched} appariés, ${discoveredCount} nouveau(x) modèle(s) importé(s), ${updated} MAJ.`,
    };
  } catch (err) {
    return {
      source: 'OpenRouter Live Catalog (Prix & Contexte)',
      url,
      status: 'fallback',
      modelsMatched: 0,
      fieldsUpdated: 0,
      newModelsDiscovered: 0,
      durationMs: Date.now() - started,
      message: `Source injoignable (${err instanceof Error ? err.message : 'réseau'}). Valeurs locales conservées.`,
    };
  }
}

interface ArcEvalRow {
  modelId?: string;
  model?: string;
  name?: string;
  datasetId?: string;
  score?: number;
  costPerTask?: number;
  cost_per_task?: number;
}

async function harvestArcPrize(
  dataset: TelemetryDataset,
  changes: HarvestChangeEntry[]
): Promise<HarvestSourceResult> {
  const candidates = [
    'https://arcprize.org/media/data/leaderboard/evaluations.json',
    'https://raw.githubusercontent.com/arcprize/arc-agi-benchmarking/main/data/evaluations.json',
  ];
  const started = Date.now();

  for (const url of candidates) {
    try {
      const res = await fetchWithTimeout(url, 10000);
      if (!res.ok) continue;

      const raw = (await res.json()) as unknown;
      const rows: ArcEvalRow[] = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as { evaluations?: ArcEvalRow[] })?.evaluations)
          ? (raw as { evaluations: ArcEvalRow[] }).evaluations
          : [];

      if (rows.length === 0) continue;

      let matched = 0;
      let updated = 0;
      const now = new Date().toISOString();

      for (const model of dataset.models) {
        const key = normalizeKey(model.name);
        const hit = rows.find((r) => {
          const rKey = normalizeKey(r.modelId ?? r.model ?? r.name ?? '');
          return rKey.length > 3 && (rKey.includes(key) || key.includes(rKey));
        });
        if (!hit || typeof hit.score !== 'number') continue;

        matched++;
        const datasetTag = (hit.datasetId ?? '').toLowerCase();
        const benchId = datasetTag.includes('3')
          ? 'arc_agi_3'
          : datasetTag.includes('2')
            ? 'arc_agi_2'
            : 'arc_agi_1';

        const pctScore = hit.score <= 1 ? Number((hit.score * 100).toFixed(1)) : Number(hit.score.toFixed(1));
        const current = model.benchmarks[benchId];
        if (current && current.score !== pctScore) {
          changes.push({
            modelId: model.id,
            modelName: model.name,
            field: `${benchId}.score`,
            oldValue: current.score,
            newValue: pctScore,
            source: 'ARC Prize',
          });
          current.score = pctScore;
          current.updatedAt = now;
          updated++;
        }

        const liveCost = hit.costPerTask ?? hit.cost_per_task;
        if (typeof liveCost === 'number' && liveCost > 0 && current && current.costPerTaskUsd !== liveCost) {
          const roundedCost = Number(liveCost.toFixed(3));
          changes.push({
            modelId: model.id,
            modelName: model.name,
            field: `${benchId}.costPerTaskUsd`,
            oldValue: current.costPerTaskUsd ?? null,
            newValue: roundedCost,
            source: 'ARC Prize',
          });
          current.costPerTaskUsd = roundedCost;
          updated++;
        }
      }

      return {
        source: 'ARC Prize Leaderboard (ARC-AGI 1 / 2 / 3)',
        url,
        status: 'ok',
        modelsMatched: matched,
        fieldsUpdated: updated,
        newModelsDiscovered: rows.length,
        durationMs: Date.now() - started,
        message: `${rows.length} évaluations ARC récupérées, ${matched} appariées, ${updated} champ(s) mis à jour.`,
      };
    } catch {
      // try next candidate
    }
  }

  return {
    source: 'ARC Prize Leaderboard (ARC-AGI 1 / 2 / 3)',
    url: candidates[0],
    status: 'fallback',
    modelsMatched: dataset.models.length,
    fieldsUpdated: 0,
    newModelsDiscovered: 0,
    durationMs: Date.now() - started,
    message: 'Flux JSON distant non disponible ou format protégé ; scores ARC-AGI vérifiés locaux conservés.',
  };
}

export async function runHarvest(trigger: 'ui' | 'cli' = 'ui'): Promise<{
  dataset: TelemetryDataset;
  record: HarvestRecord;
}> {
  const started = Date.now();
  const dataset = await loadDataset();
  const changes: HarvestChangeEntry[] = [];

  const [openRouterResult, arcResult] = await Promise.all([
    harvestOpenRouter(dataset, changes),
    harvestArcPrize(dataset, changes),
  ]);

  const now = new Date().toISOString();
  dataset.lastHarvestAt = now;

  const record: HarvestRecord = {
    id: `harvest-${Date.now()}`,
    timestamp: now,
    trigger,
    durationMs: Date.now() - started,
    sources: [openRouterResult, arcResult],
    totalUpdatedFields: changes.length,
    changes,
  };

  dataset.harvestHistory = [record, ...dataset.harvestHistory].slice(0, 25);
  await saveDataset(dataset);

  return { dataset, record };
}
