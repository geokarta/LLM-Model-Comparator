import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import swaggerUi from 'swagger-ui-express';
import { loadDataset, runHarvest, saveDataset } from './harvester.ts';
import { createSeedDataset } from './seedData.ts';
import { buildOpenApiSpec } from './openapi.ts';
import { getArchivedHarvestCount, getPersistenceMode } from './storage.ts';
import {
  clearSessionCookie,
  createApiKey,
  getAuthPublicConfig,
  getSessionUser,
  listApiKeys,
  requireAdmin,
  requireApiToken,
  revokeApiKey,
  setSessionCookie,
  verifyAdminPassword,
  verifyGoogleIdToken,
} from './auth.ts';
import { apiMonitoringMiddleware, getMonitoringSummary, recordPageView } from './analytics.ts';
import { LLMModel } from '../shared/types.ts';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const DIST_DIR = path.resolve(process.cwd(), 'dist');

app.set('trust proxy', 1);
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));
app.use(apiMonitoringMiddleware);

// Cached live FX rates (USD base) with resilient fallback
const FALLBACK_FX: Record<string, number> = {
  USD: 1,
  CAD: 1.39,
  EUR: 0.92,
  GBP: 0.79,
  CHF: 0.88,
};

let fxCache: { rates: Record<string, number>; fetchedAt: number; source: 'live' | 'fallback' } = {
  rates: { ...FALLBACK_FX },
  fetchedAt: 0,
  source: 'fallback',
};

async function getFxRates(): Promise<{ rates: Record<string, number>; source: 'live' | 'fallback' }> {
  const ONE_HOUR = 60 * 60 * 1000;
  if (Date.now() - fxCache.fetchedAt < ONE_HOUR && fxCache.fetchedAt > 0) {
    return { rates: fxCache.rates, source: fxCache.source };
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: controller.signal });
    clearTimeout(t);
    if (res.ok) {
      const json = (await res.json()) as { rates?: Record<string, number> };
      if (json.rates?.CAD) {
        fxCache = {
          rates: { ...FALLBACK_FX, ...json.rates, USD: 1 },
          fetchedAt: Date.now(),
          source: 'live',
        };
        return { rates: fxCache.rates, source: 'live' };
      }
    }
  } catch {
    // Keep fallback rates
  }
  fxCache.fetchedAt = Date.now();
  return { rates: fxCache.rates, source: fxCache.source };
}

function findModelByQuery(models: LLMModel[], query: string): LLMModel | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return (
    models.find((m) => m.id.toLowerCase() === q) ??
    models.find((m) => m.openRouterId?.toLowerCase() === q) ??
    models.find((m) => m.name.toLowerCase() === q) ??
    models.find((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
  );
}

function parseDirection(raw: unknown): 'input' | 'output' | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (['input', 'in', 'entree', 'entrée', 'prompt'].includes(s)) return 'input';
  if (['output', 'out', 'sortie', 'completion'].includes(s)) return 'output';
  return null;
}

function roundUsd(n: number): number {
  return Number(n.toFixed(6));
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'online',
    service: 'ai-model-insight',
    persistence: getPersistenceMode(),
    timestamp: new Date().toISOString(),
  });
});

// ==================== AUTH ROUTES (Task 4) ====================
app.get('/api/auth/me', (req, res) => {
  res.json({
    user: getSessionUser(req),
    config: getAuthPublicConfig(),
  });
});

app.post('/api/auth/google', async (req, res) => {
  const credential = String(req.body?.credential ?? '');
  const user = await verifyGoogleIdToken(credential);
  if (!user) {
    res.status(401).json({ error: 'Jeton Google invalide ou non vérifié.' });
    return;
  }
  setSessionCookie(res, user);
  res.json({ user });
});

app.post('/api/auth/login', (req, res) => {
  const password = String(req.body?.password ?? '');
  const user = verifyAdminPassword(password);
  if (!user) {
    res.status(401).json({ error: 'Clé administrateur invalide.' });
    return;
  }
  setSessionCookie(res, user);
  res.json({ user });
});

app.post('/api/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ==================== ANALYTICS & ADMIN ROUTES (Tasks 5 & 6) ====================
app.post('/api/analytics/pageview', async (req, res) => {
  try {
    const page = String(req.body?.page ?? 'comparator');
    const lang = String(req.body?.lang ?? 'fr');
    await recordPageView(req, page, lang);
    res.json({ ok: true });
  } catch {
    res.json({ ok: false });
  }
});

app.get('/api/admin/keys', requireAdmin, async (_req, res) => {
  try {
    const keys = await listApiKeys();
    res.json({ keys });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur lecture clés API' });
  }
});

app.post('/api/admin/keys', requireAdmin, async (req, res) => {
  try {
    const name = String(req.body?.name ?? 'API Client');
    const created = await createApiKey(name);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur création clé API' });
  }
});

app.delete('/api/admin/keys/:id', requireAdmin, async (req, res) => {
  try {
    const ok = await revokeApiKey(String(req.params.id));
    if (!ok) {
      res.status(404).json({ error: 'Clé introuvable.' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur révocation clé API' });
  }
});

app.get('/api/admin/monitoring', requireAdmin, async (_req, res) => {
  try {
    const [summary, archivedHarvests, keys] = await Promise.all([
      getMonitoringSummary(),
      getArchivedHarvestCount(),
      listApiKeys(),
    ]);
    res.json({
      persistence: getPersistenceMode(),
      archivedHarvests,
      activeApiKeys: keys.filter((k) => !k.revoked).length,
      summary,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur lecture monitoring' });
  }
});

// OpenAPI 3.0.3 JSON specification
app.get('/api/openapi.json', (req, res) => {
  const proto = req.get('x-forwarded-proto') ?? req.protocol;
  const host = req.get('host') ?? `localhost:${PORT}`;
  res.json(buildOpenApiSpec(`${proto}://${host}`));
});

// Interactive Swagger UI
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(null, {
    swaggerOptions: {
      url: '/api/openapi.json',
      docExpansion: 'list',
      defaultModelsExpandDepth: 1,
    },
    customSiteTitle: 'LLM Comparator — Documentation Swagger API',
    customCss: `
      .swagger-ui .topbar { display: none; }
      body { background: #f8fafc; }
    `,
  })
);

app.get('/swagger', (_req, res) => {
  res.redirect('/api/docs');
});

// List all models (Token-protected REST API)
app.get('/api/models', requireApiToken, async (req, res) => {
  try {
    const dataset = await loadDataset();
    const providerParam = String(req.query.provider ?? req.query.company ?? '').trim().toLowerCase();
    const genParam = String(req.query.generation ?? '').trim().toLowerCase();

    let list = dataset.models;
    if (providerParam) {
      const matchedProv = dataset.providers.find(
        (p) =>
          p.id.toLowerCase() === providerParam ||
          p.shortName.toLowerCase() === providerParam ||
          p.name.toLowerCase().includes(providerParam)
      );
      if (!matchedProv) {
        res.status(404).json({
          error: `Compagnie introuvable : "${providerParam}". Consultez GET /api/providers.`,
        });
        return;
      }
      list = list.filter((m) => m.provider === matchedProv.id);
    }
    if (genParam === 'current' || genParam === 'previous') {
      list = list.filter((m) => m.generation === genParam);
    }

    res.json({
      count: list.length,
      models: list,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur lecture modèles' });
  }
});

// List all providers / companies
async function handleListProviders(_req: express.Request, res: express.Response) {
  try {
    const dataset = await loadDataset();
    const providers = dataset.providers.map((p) => {
      const provModels = dataset.models.filter((m) => m.provider === p.id);
      const generations = Array.from(new Set(provModels.map((m) => m.generationLabel)));
      return {
        ...p,
        modelCount: provModels.length,
        generations,
      };
    });
    res.json({ count: providers.length, providers });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur lecture compagnies' });
  }
}

app.get('/api/providers', requireApiToken, handleListProviders);
app.get('/api/companies', requireApiToken, handleListProviders);

// List all models for a specific provider / company
async function handleProviderModels(req: express.Request, res: express.Response) {
  try {
    const dataset = await loadDataset();
    const query = String(req.params.provider ?? '').trim().toLowerCase();
    const provider = dataset.providers.find(
      (p) =>
        p.id.toLowerCase() === query ||
        p.shortName.toLowerCase() === query ||
        p.name.toLowerCase().includes(query)
    );
    if (!provider) {
      res.status(404).json({
        error: `Compagnie introuvable : "${req.params.provider}". Compagnies disponibles : ${dataset.providers
          .map((p) => p.id)
          .join(', ')}.`,
      });
      return;
    }

    const genParam = String(req.query.generation ?? '').trim().toLowerCase();
    let models = dataset.models.filter((m) => m.provider === provider.id);
    if (genParam === 'current' || genParam === 'previous') {
      models = models.filter((m) => m.generation === genParam);
    }

    res.json({
      provider,
      count: models.length,
      models,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur lecture modèles compagnie' });
  }
}

app.get('/api/providers/:provider/models', requireApiToken, handleProviderModels);
app.get('/api/companies/:provider/models', requireApiToken, handleProviderModels);

// REST API #3: Batch total cost (input + output) for a list of models in USD, CAD, and requested currency
async function handleBatchTokenCost(req: express.Request, res: express.Response) {
  try {
    const src = req.method === 'POST' ? req.body : req.query;
    const rawModels = src.models ?? src.modelIds;
    const inputTokens = Number(src.inputTokens ?? src.input_tokens ?? src.in ?? 0);
    const outputTokens = Number(src.outputTokens ?? src.output_tokens ?? src.out ?? 0);
    const currency = String(src.currency ?? 'CAD').trim().toUpperCase();

    if (!Number.isFinite(inputTokens) || inputTokens < 0 || !Number.isFinite(outputTokens) || outputTokens < 0) {
      res.status(400).json({
        error: 'Paramètres invalides : inputTokens et outputTokens doivent être des nombres >= 0.',
      });
      return;
    }

    const dataset = await loadDataset();
    let targetModels: LLMModel[] = [];
    const notFound: string[] = [];

    if (!rawModels || String(rawModels).trim().toLowerCase() === 'all') {
      targetModels = dataset.models;
    } else {
      const requestedList: string[] = Array.isArray(rawModels)
        ? rawModels.map((x) => String(x).trim()).filter(Boolean)
        : String(rawModels)
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean);

      if (requestedList.length === 0) {
        res.status(400).json({
          error: 'Paramètre requis : models (tableau JSON en POST ou liste séparée par virgules en GET).',
        });
        return;
      }

      const seen = new Set<string>();
      for (const q of requestedList) {
        const hit = findModelByQuery(dataset.models, q);
        if (!hit) {
          notFound.push(q);
        } else if (!seen.has(hit.id)) {
          seen.add(hit.id);
          targetModels.push(hit);
        }
      }
    }

    if (targetModels.length === 0) {
      res.status(404).json({
        error: 'Aucun modèle trouvé pour la liste fournie.',
        notFound,
      });
      return;
    }

    const { rates, source: fxSource } = await getFxRates();
    const requestedRate = rates[currency];
    if (!requestedRate) {
      res.status(400).json({
        error: `Devise non supportée : "${currency}". Exemples supportés : USD, CAD, EUR, GBP, CHF.`,
      });
      return;
    }
    const cadRate = rates.CAD ?? FALLBACK_FX.CAD;

    const results = targetModels
      .map((model) => {
        const inputUsd = roundUsd((inputTokens / 1_000_000) * model.inputPricePer1M);
        const outputUsd = roundUsd((outputTokens / 1_000_000) * model.outputPricePer1M);
        const totalUsd = roundUsd(inputUsd + outputUsd);

        return {
          model: {
            id: model.id,
            name: model.name,
            provider: model.provider,
            generationLabel: model.generationLabel,
          },
          pricingPer1MUsd: {
            input: model.inputPricePer1M,
            output: model.outputPricePer1M,
          },
          costs: {
            USD: { input: inputUsd, output: outputUsd, total: totalUsd },
            CAD: {
              input: roundUsd(inputUsd * cadRate),
              output: roundUsd(outputUsd * cadRate),
              total: roundUsd(totalUsd * cadRate),
            },
            requested: {
              currency,
              input: roundUsd(inputUsd * requestedRate),
              output: roundUsd(outputUsd * requestedRate),
              total: roundUsd(totalUsd * requestedRate),
            },
          },
        };
      })
      .sort((a, b) => a.costs.USD.total - b.costs.USD.total);

    const sumUsd = roundUsd(results.reduce((acc, r) => acc + r.costs.USD.total, 0));

    res.json({
      tokens: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      },
      currency,
      exchangeRate: {
        USD_TO_CAD: Number(cadRate.toFixed(4)),
        [`USD_TO_${currency}`]: Number(requestedRate.toFixed(4)),
        source: fxSource,
      },
      count: results.length,
      notFound,
      summary: {
        cheapest: results[0]?.model.id ?? null,
        mostExpensive: results[results.length - 1]?.model.id ?? null,
        combinedTotalUsd: sumUsd,
        combinedTotalCad: roundUsd(sumUsd * cadRate),
        combinedTotalRequested: roundUsd(sumUsd * requestedRate),
      },
      results,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur calcul coût batch' });
  }
}

app.get('/api/cost/batch', requireApiToken, handleBatchTokenCost);
app.post('/api/cost/batch', requireApiToken, handleBatchTokenCost);
app.get('/api/cost/compare', requireApiToken, handleBatchTokenCost);
app.post('/api/cost/compare', requireApiToken, handleBatchTokenCost);

// REST API #1: Single-direction token cost (GET or POST /api/cost/token)
async function handleSingleTokenCost(req: express.Request, res: express.Response) {
  try {
    const src = req.method === 'POST' ? req.body : req.query;
    const modelQuery = String(src.model ?? src.modelId ?? '');
    const tokens = Number(src.tokens);
    const direction = parseDirection(src.direction ?? src.type ?? src.side);
    const currency = String(src.currency ?? 'USD').trim().toUpperCase();

    if (!modelQuery) {
      res.status(400).json({ error: 'Paramètre requis manquant : model (id ou nom du modèle).' });
      return;
    }
    if (!Number.isFinite(tokens) || tokens < 0) {
      res.status(400).json({ error: 'Paramètre invalide : tokens doit être un nombre >= 0.' });
      return;
    }
    if (!direction) {
      res.status(400).json({ error: 'Paramètre invalide : direction doit être "input" ou "output" (ou "entree"/"sortie").' });
      return;
    }

    const dataset = await loadDataset();
    const model = findModelByQuery(dataset.models, modelQuery);
    if (!model) {
      res.status(404).json({
        error: `Modèle introuvable : "${modelQuery}". Consultez GET /api/models pour la liste des identifiants.`,
      });
      return;
    }

    const { rates, source: fxSource } = await getFxRates();
    const rate = rates[currency];
    if (!rate) {
      res.status(400).json({
        error: `Devise non supportée : "${currency}". Exemples supportés : USD, CAD, EUR, GBP, CHF.`,
      });
      return;
    }

    const unitPricePer1MUsd = direction === 'input' ? model.inputPricePer1M : model.outputPricePer1M;
    const costUsd = roundUsd((tokens / 1_000_000) * unitPricePer1MUsd);
    const cadRate = rates.CAD ?? FALLBACK_FX.CAD;
    const costCad = roundUsd(costUsd * cadRate);
    const costInRequestedCurrency = roundUsd(costUsd * rate);

    res.json({
      model: {
        id: model.id,
        name: model.name,
        provider: model.provider,
        generationLabel: model.generationLabel,
      },
      direction,
      tokens,
      unitPricePer1MUsd,
      costUsd,
      costCad,
      currency,
      cost: costInRequestedCurrency,
      exchangeRate: {
        USD_TO_CAD: Number(cadRate.toFixed(4)),
        [`USD_TO_${currency}`]: Number(rate.toFixed(4)),
        source: fxSource,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur calcul coût' });
  }
}

app.get('/api/cost/token', requireApiToken, handleSingleTokenCost);
app.post('/api/cost/token', requireApiToken, handleSingleTokenCost);
// Internal web UI simulator routes (allows interactive simulator page for public visitors)
app.get('/api/ui/cost/token', handleSingleTokenCost);
app.get('/api/ui/cost/total', handleTotalTokenCost);

// REST API #2: Total cost for input + output tokens in USD, CAD, and requested currency (GET or POST /api/cost/total)
async function handleTotalTokenCost(req: express.Request, res: express.Response) {
  try {
    const src = req.method === 'POST' ? req.body : req.query;
    const modelQuery = String(src.model ?? src.modelId ?? '');
    const inputTokens = Number(src.inputTokens ?? src.input_tokens ?? src.in ?? 0);
    const outputTokens = Number(src.outputTokens ?? src.output_tokens ?? src.out ?? 0);
    const currency = String(src.currency ?? 'CAD').trim().toUpperCase();

    if (!modelQuery) {
      res.status(400).json({ error: 'Paramètre requis manquant : model (id ou nom du modèle).' });
      return;
    }
    if (!Number.isFinite(inputTokens) || inputTokens < 0 || !Number.isFinite(outputTokens) || outputTokens < 0) {
      res.status(400).json({ error: 'Paramètres invalides : inputTokens et outputTokens doivent être des nombres >= 0.' });
      return;
    }

    const dataset = await loadDataset();
    const model = findModelByQuery(dataset.models, modelQuery);
    if (!model) {
      res.status(404).json({
        error: `Modèle introuvable : "${modelQuery}". Consultez GET /api/models pour la liste des identifiants.`,
      });
      return;
    }

    const { rates, source: fxSource } = await getFxRates();
    const requestedRate = rates[currency];
    if (!requestedRate) {
      res.status(400).json({
        error: `Devise non supportée : "${currency}". Exemples supportés : USD, CAD, EUR, GBP, CHF.`,
      });
      return;
    }

    const cadRate = rates.CAD ?? FALLBACK_FX.CAD;
    const inputCostUsd = roundUsd((inputTokens / 1_000_000) * model.inputPricePer1M);
    const outputCostUsd = roundUsd((outputTokens / 1_000_000) * model.outputPricePer1M);
    const totalCostUsd = roundUsd(inputCostUsd + outputCostUsd);

    const inputCostCad = roundUsd(inputCostUsd * cadRate);
    const outputCostCad = roundUsd(outputCostUsd * cadRate);
    const totalCostCad = roundUsd(totalCostUsd * cadRate);

    const totalCostCurrency = roundUsd(totalCostUsd * requestedRate);

    res.json({
      model: {
        id: model.id,
        name: model.name,
        provider: model.provider,
        generationLabel: model.generationLabel,
      },
      tokens: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      },
      pricingPer1MUsd: {
        input: model.inputPricePer1M,
        output: model.outputPricePer1M,
      },
      costs: {
        USD: {
          input: inputCostUsd,
          output: outputCostUsd,
          total: totalCostUsd,
        },
        CAD: {
          input: inputCostCad,
          output: outputCostCad,
          total: totalCostCad,
        },
        requested: {
          currency,
          input: roundUsd(inputCostUsd * requestedRate),
          output: roundUsd(outputCostUsd * requestedRate),
          total: totalCostCurrency,
        },
      },
      exchangeRate: {
        USD_TO_CAD: Number(cadRate.toFixed(4)),
        [`USD_TO_${currency}`]: Number(requestedRate.toFixed(4)),
        source: fxSource,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur calcul coût total' });
  }
}

app.get('/api/cost/total', requireApiToken, handleTotalTokenCost);
app.post('/api/cost/total', requireApiToken, handleTotalTokenCost);

// Get full telemetry dataset
app.get('/api/telemetry', async (_req, res) => {
  try {
    const dataset = await loadDataset();
    res.json(dataset);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur lecture télémétrie' });
  }
});

// Trigger live harvest (Admin only)
app.post('/api/harvest', requireAdmin, async (_req, res) => {
  try {
    const { dataset, record } = await runHarvest('ui');
    res.json({ dataset, record });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur moissonnage' });
  }
});

// Update a model's benchmark scores or pricing manually (Admin only)
app.patch('/api/models/:id', requireAdmin, async (req, res) => {
  try {
    const dataset = await loadDataset();
    const idx = dataset.models.findIndex((m) => m.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Modèle introuvable' });
      return;
    }

    const patch = req.body as Partial<LLMModel>;
    const existing = dataset.models[idx];
    const updated: LLMModel = {
      ...existing,
      ...patch,
      id: existing.id,
      benchmarks: {
        ...existing.benchmarks,
        ...(patch.benchmarks ?? {}),
      },
      lastSyncedAt: new Date().toISOString(),
      priceSource: patch.inputPricePer1M !== undefined || patch.outputPricePer1M !== undefined ? 'manual' : existing.priceSource,
    };

    dataset.models[idx] = updated;
    await saveDataset(dataset);
    res.json({ model: updated, dataset });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur mise à jour modèle' });
  }
});

// Add a custom model (Admin only)
app.post('/api/models', requireAdmin, async (req, res) => {
  try {
    const dataset = await loadDataset();
    const incoming = req.body as LLMModel;
    if (!incoming?.id || !incoming?.name || !incoming?.provider) {
      res.status(400).json({ error: 'Champs requis manquants (id, name, provider).' });
      return;
    }
    const exists = dataset.models.some((m) => m.id === incoming.id);
    if (exists) {
      res.status(409).json({ error: 'Un modèle avec cet identifiant existe déjà.' });
      return;
    }
    dataset.models.push({ ...incoming, lastSyncedAt: new Date().toISOString(), priceSource: 'manual' });
    await saveDataset(dataset);
    res.status(201).json({ dataset });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur création modèle' });
  }
});

// Reset to baseline seed (Admin only)
app.post('/api/reset', requireAdmin, async (_req, res) => {
  try {
    const seed = createSeedDataset();
    await saveDataset(seed);
    res.json({ dataset: seed });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur réinitialisation' });
  }
});

// Serve built frontend in production (Cloud Run / single-container mode)
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[AETHER-9 API] Télémétrie active sur http://0.0.0.0:${PORT}`);
});
