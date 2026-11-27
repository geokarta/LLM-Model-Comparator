import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Data, Layout } from 'plotly.js';
import { Calculator, Check, Code2, Copy, Play, RefreshCw } from 'lucide-react';
import { LLMModel, ProviderId, ProviderMeta } from '../../shared/types.ts';
import { PlotlyChart } from './PlotlyChart.tsx';
import { emitOrbSignal } from '../utils/orbBus.ts';

interface CostSimulatorPageProps {
  models: LLMModel[];
  providers: ProviderMeta[];
}

interface TotalCostApiResponse {
  model: {
    id: string;
    name: string;
    provider: string;
    generationLabel: string;
  };
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  pricingPer1MUsd: {
    input: number;
    output: number;
  };
  costs: {
    USD: { input: number; output: number; total: number };
    CAD: { input: number; output: number; total: number };
    requested: { currency: string; input: number; output: number; total: number };
  };
  exchangeRate: Record<string, number | string>;
}

const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'CHF'] as const;

const TOKEN_PRESETS = [
  { label: 'Prompt court (2K / 500)', input: 2000, output: 500 },
  { label: 'Revue de code (50K / 4K)', input: 50000, output: 4000 },
  { label: 'Agent SWE-bench (250K / 35K)', input: 250000, output: 35000 },
  { label: '1M Entrée / 100K Sortie', input: 1000000, output: 100000 },
];

function formatCurrencyValue(val: number, currency: string): string {
  const symbol =
    currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'CHF' ? 'CHF ' : '$';
  const suffix = currency === 'CAD' ? ' CAD' : currency === 'USD' ? ' USD' : '';
  if (val === 0) return `${symbol}0.00${suffix}`;
  if (val < 0.01) return `${symbol}${val.toFixed(5)}${suffix}`;
  if (val < 1) return `${symbol}${val.toFixed(4)}${suffix}`;
  return `${symbol}${val.toFixed(2)}${suffix}`;
}

export function CostSimulatorPage({ models, providers }: CostSimulatorPageProps) {
  const [selectedModelId, setSelectedModelId] = useState<string>(
    models[0]?.id ?? 'openai-gpt-6-2-astra'
  );
  const [inputTokens, setInputTokens] = useState<number>(50000);
  const [outputTokens, setOutputTokens] = useState<number>(4000);
  const [currency, setCurrency] = useState<string>('CAD');
  const [runsCount, setRunsCount] = useState<number>(100);
  const [compareProvider, setCompareProvider] = useState<'all' | ProviderId>('all');
  const [barLogScale, setBarLogScale] = useState<boolean>(false);

  const [apiResult, setApiResult] = useState<TotalCostApiResponse | null>(null);
  const [singleApiPreview, setSingleApiPreview] = useState<string | null>(null);
  const [singleDirection, setSingleDirection] = useState<'input' | 'output'>('input');
  const [loadingApi, setLoadingApi] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const providerMap = useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers]
  );

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';

  const fetchCostFromApi = useCallback(async () => {
    if (!selectedModelId) return;
    setLoadingApi(true);
    try {
      const qs = new URLSearchParams({
        model: selectedModelId,
        inputTokens: String(Math.max(0, inputTokens)),
        outputTokens: String(Math.max(0, outputTokens)),
        currency,
      });
      const res = await fetch(`/api/ui/cost/total?${qs.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as TotalCostApiResponse;
        setApiResult(data);
      }
    } finally {
      setLoadingApi(false);
    }
  }, [selectedModelId, inputTokens, outputTokens, currency]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCostFromApi();
    }, 120);
    return () => clearTimeout(timer);
  }, [fetchCostFromApi]);

  const handleTestSingleEndpoint = async () => {
    const tokens = singleDirection === 'input' ? inputTokens : outputTokens;
    const qs = new URLSearchParams({
      model: selectedModelId,
      tokens: String(tokens),
      direction: singleDirection,
      currency,
    });
    const res = await fetch(`/api/ui/cost/token?${qs.toString()}`);
    const data = await res.json();
    setSingleApiPreview(JSON.stringify(data, null, 2));
    emitOrbSignal({ type: 'simulate', color: '#10b981', intensity: 1.1, label: 'API /cost/token OK' });
  };

  const copyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  // Multi-model comparison using the live FX rate returned by API
  const fxRateForCurrency = useMemo(() => {
    const key = `USD_TO_${currency}`;
    const raw = apiResult?.exchangeRate?.[key];
    return typeof raw === 'number' ? raw : currency === 'CAD' ? 1.39 : 1;
  }, [apiResult, currency]);

  const comparisonRows = useMemo(() => {
    return models
      .filter((m) => compareProvider === 'all' || m.provider === compareProvider)
      .map((m) => {
        const inUsd = (inputTokens / 1_000_000) * m.inputPricePer1M;
        const outUsd = (outputTokens / 1_000_000) * m.outputPricePer1M;
        const totalUsd = inUsd + outUsd;
        const totalCur = totalUsd * fxRateForCurrency;
        return { model: m, totalUsd, totalCur };
      })
      .sort((a, b) => a.totalUsd - b.totalUsd);
  }, [models, compareProvider, inputTokens, outputTokens, fxRateForCurrency]);

  const barData: Data[] = useMemo(() => {
    const top = comparisonRows.slice(0, 20);
    return [
      {
        type: 'bar',
        orientation: 'h',
        y: top.map((r) => r.model.name),
        x: top.map((r) => Number(r.totalCur.toFixed(5))),
        marker: {
          color: top.map((r) =>
            r.model.id === selectedModelId
              ? '#f59e0b'
              : (providerMap.get(r.model.provider)?.color ?? '#3b82f6')
          ),
        },
        hovertemplate: top.map(
          (r) =>
            `<b>${r.model.name}</b><br>` +
            `Coût (${currency}) : <b>${formatCurrencyValue(r.totalCur, currency)}</b><br>` +
            `Coût (USD) : ${formatCurrencyValue(r.totalUsd, 'USD')}<br>` +
            `Pour ${runsCount.toLocaleString('fr-FR')} exéc. : <b>${formatCurrencyValue(r.totalCur * runsCount, currency)}</b>` +
            `<extra></extra>`
        ),
      },
    ];
  }, [comparisonRows, selectedModelId, providerMap, currency, runsCount]);

  const barLayout: Partial<Layout> = useMemo(
    () => ({
      dragmode: 'pan',
      margin: { t: 16, r: 24, b: 44, l: 175 },
      xaxis: {
        title: {
          text: `Coût par requête (${currency}${barLogScale ? ', log' : ''})`,
          font: { size: 11, color: '#94a3b8' },
        },
        type: barLogScale ? 'log' : 'linear',
        gridcolor: 'rgba(148, 163, 184, 0.13)',
      },
      yaxis: {
        autorange: 'reversed',
        tickfont: { size: 11, color: '#cbd5e1' },
      },
    }),
    [currency, barLogScale]
  );

  const singleEndpointUrl = `${origin}/api/cost/token?model=${encodeURIComponent(selectedModelId)}&tokens=${
    singleDirection === 'input' ? inputTokens : outputTokens
  }&direction=${singleDirection}&currency=${currency}`;

  const totalEndpointUrl = `${origin}/api/cost/total?model=${encodeURIComponent(
    selectedModelId
  )}&inputTokens=${inputTokens}&outputTokens=${outputTokens}&currency=${currency}`;

  const usdTotal = apiResult?.costs.USD.total ?? 0;
  const cadTotal = apiResult?.costs.CAD.total ?? 0;
  const reqTotal = apiResult?.costs.requested.total ?? 0;

  return (
    <div className="d-flex flex-column gap-3">
      {/* Header + Form */}
      <div className="card">
        <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
          <div>
            <h2 className="card-title d-flex align-items-center gap-2 mb-0">
              <Calculator size={18} className="text-primary" />
              Simulateur de Coût par Tokens &amp; Devises (USD / CAD)
            </h2>
            <div className="text-secondary small">
              Calculez le coût exact pour un modèle et un volume de tokens donnés, puis comparez avec tout le marché.
            </div>
          </div>

          <div className="d-flex flex-wrap gap-1">
            {TOKEN_PRESETS.map((p) => (
              <button
                key={p.label}
                className="btn btn-sm btn-outline-secondary"
                onClick={() => {
                  setInputTokens(p.input);
                  setOutputTokens(p.output);
                  emitOrbSignal({ type: 'simulate', color: '#3b82f6', intensity: 1.0, label: p.label });
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label">Modèle LLM</label>
              <select
                className="form-select"
                value={selectedModelId}
                onChange={(e) => {
                  setSelectedModelId(e.target.value);
                  const m = models.find((x) => x.id === e.target.value);
                  const prov = providers.find((p) => p.id === m?.provider);
                  if (m) {
                    emitOrbSignal({
                      type: 'pin',
                      color: prov?.color ?? '#3b82f6',
                      intensity: 1.1,
                      label: m.name,
                    });
                  }
                }}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.provider.toUpperCase()} · {m.generationLabel})
                  </option>
                ))}
              </select>
            </div>

            <div className="col-sm-6 col-md-2">
              <label className="form-label">Tokens Entrée</label>
              <input
                type="number"
                min={0}
                step={1000}
                className="form-control font-mono"
                value={inputTokens}
                onChange={(e) => setInputTokens(Math.max(0, Number(e.target.value)))}
              />
            </div>

            <div className="col-sm-6 col-md-2">
              <label className="form-label">Tokens Sortie</label>
              <input
                type="number"
                min={0}
                step={500}
                className="form-control font-mono"
                value={outputTokens}
                onChange={(e) => setOutputTokens(Math.max(0, Number(e.target.value)))}
              />
            </div>

            <div className="col-sm-6 col-md-2">
              <label className="form-label">Devise</label>
              <select
                className="form-select font-mono"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-sm-6 col-md-2">
              <label className="form-label">Volume (requêtes)</label>
              <input
                type="number"
                min={1}
                step={10}
                className="form-control font-mono"
                value={runsCount}
                onChange={(e) => setRunsCount(Math.max(1, Number(e.target.value)))}
              />
            </div>
          </div>
        </div>
      </div>

      {/* KPI Results */}
      <div className="row row-deck row-cards">
        <div className="col-sm-6 col-lg-3">
          <div className="card">
            <div className="card-body">
              <div className="subheader">Coût Total (USD)</div>
              <div className="h2 mb-1 font-mono text-primary">
                {loadingApi ? '...' : formatCurrencyValue(usdTotal, 'USD')}
              </div>
              <div className="text-secondary small font-mono">
                In {formatCurrencyValue(apiResult?.costs.USD.input ?? 0, 'USD')} · Out{' '}
                {formatCurrencyValue(apiResult?.costs.USD.output ?? 0, 'USD')}
              </div>
            </div>
          </div>
        </div>

        <div className="col-sm-6 col-lg-3">
          <div className="card">
            <div className="card-body">
              <div className="subheader">Coût Total (CAD)</div>
              <div className="h2 mb-1 font-mono text-success">
                {loadingApi ? '...' : formatCurrencyValue(cadTotal, 'CAD')}
              </div>
              <div className="text-secondary small font-mono">
                Taux 1 USD = {apiResult?.exchangeRate?.USD_TO_CAD ?? 1.39} CAD (
                {String(apiResult?.exchangeRate?.source ?? 'live')})
              </div>
            </div>
          </div>
        </div>

        <div className="col-sm-6 col-lg-3">
          <div className="card">
            <div className="card-body">
              <div className="subheader">Devise sélectionnée ({currency})</div>
              <div className="h2 mb-1 font-mono text-warning">
                {loadingApi ? '...' : formatCurrencyValue(reqTotal, currency)}
              </div>
              <div className="text-secondary small font-mono">
                {(inputTokens + outputTokens).toLocaleString('fr-FR')} tokens au total
              </div>
            </div>
          </div>
        </div>

        <div className="col-sm-6 col-lg-3">
          <div className="card">
            <div className="card-body">
              <div className="subheader">Projection ({runsCount.toLocaleString('fr-FR')} req.)</div>
              <div className="h2 mb-1 font-mono">
                {formatCurrencyValue(reqTotal * runsCount, currency)}
              </div>
              <div className="text-secondary small font-mono">
                Soit {formatCurrencyValue(usdTotal * runsCount, 'USD')}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Comparative Bar Chart */}
      <div className="card">
        <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
          <div>
            <h3 className="card-title mb-0">
              Comparaison des coûts pour {inputTokens.toLocaleString('fr-FR')} entrée +{' '}
              {outputTokens.toLocaleString('fr-FR')} sortie ({currency})
            </h3>
            <div className="text-secondary small">
              Modèle sélectionné mis en surbrillance en ambre · Top 20 les plus économiques affichés.
            </div>
          </div>
          <div className="d-flex flex-wrap align-items-center gap-2">
            <select
              className="form-select form-select-sm w-auto"
              value={compareProvider}
              onChange={(e) => setCompareProvider(e.target.value as 'all' | ProviderId)}
            >
              <option value="all">Tous les fournisseurs</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <div className="btn-group btn-group-sm" role="group" aria-label="Échelle coût">
              <button
                className={`btn ${!barLogScale ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setBarLogScale(false)}
              >
                Normal
              </button>
              <button
                className={`btn ${barLogScale ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setBarLogScale(true)}
              >
                Échelle Log
              </button>
            </div>
          </div>
        </div>
        <div className="card-body p-2">
          <PlotlyChart data={barData} layout={barLayout} height={460} />
        </div>
      </div>

      {/* REST API Documentation & Live Tester */}
      <div className="card">
        <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
          <div>
            <h3 className="card-title d-flex align-items-center gap-2 mb-0">
              <Code2 size={16} className="text-primary" />
              Endpoints REST API protégés par Token (GET &amp; POST)
            </h3>
            <div className="text-secondary small">
              Passez votre token via le header <code className="font-mono">X-API-Key: &lt;token&gt;</code> ou{' '}
              <code className="font-mono">Authorization: Bearer &lt;token&gt;</code> (généré dans Admin &amp; Monitoring).
            </div>
          </div>
          <div className="d-flex flex-wrap gap-1">
            <a
              href="/api/docs"
              target="_blank"
              rel="noreferrer"
              className="btn btn-sm btn-primary font-mono"
            >
              Swagger UI (/api/docs)
            </a>
            <a
              href="/api/openapi.json"
              target="_blank"
              rel="noreferrer"
              className="btn btn-sm btn-outline-secondary font-mono"
            >
              OpenAPI JSON
            </a>
            <a
              href="/api/models"
              target="_blank"
              rel="noreferrer"
              className="btn btn-sm btn-outline-secondary font-mono"
            >
              GET /api/models
            </a>
            <a
              href="/api/providers"
              target="_blank"
              rel="noreferrer"
              className="btn btn-sm btn-outline-secondary font-mono"
            >
              GET /api/providers
            </a>
            <a
              href="/api/providers/openai/models"
              target="_blank"
              rel="noreferrer"
              className="btn btn-sm btn-outline-secondary font-mono"
            >
              GET /api/providers/:id/models
            </a>
            <a
              href={`/api/cost/batch?models=${encodeURIComponent(
                models
                  .slice(0, 3)
                  .map((m) => m.id)
                  .join(',')
              )}&inputTokens=${inputTokens}&outputTokens=${outputTokens}&currency=${currency}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-sm btn-outline-primary font-mono"
            >
              GET /api/cost/batch
            </a>
          </div>
        </div>

        <div className="card-body">
          <div className="row g-3">
            {/* Endpoint 1 */}
            <div className="col-lg-6">
              <div className="p-3 rounded border h-100" style={{ backgroundColor: 'rgba(21,30,44,0.55)' }}>
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <span className="badge bg-blue-lt text-blue font-mono">1. GET / POST /api/cost/token</span>
                  <div className="btn-group btn-group-sm">
                    <button
                      className={`btn ${singleDirection === 'input' ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={() => setSingleDirection('input')}
                    >
                      Entrée
                    </button>
                    <button
                      className={`btn ${singleDirection === 'output' ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={() => setSingleDirection('output')}
                    >
                      Sortie
                    </button>
                  </div>
                </div>
                <p className="text-secondary small mb-2">
                  Retourne le coût pour <strong>1 modèle</strong>, un nombre de tokens et le sens (<code>input</code> ou <code>output</code>).
                </p>

                <div className="d-flex gap-2 mb-2">
                  <input
                    type="text"
                    readOnly
                    className="form-control form-control-sm font-mono"
                    value={singleEndpointUrl}
                  />
                  <button
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => copyText('single', singleEndpointUrl)}
                    title="Copier l'URL"
                  >
                    {copiedKey === 'single' ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                  </button>
                  <button
                    className="btn btn-sm btn-primary d-inline-flex align-items-center gap-1"
                    onClick={handleTestSingleEndpoint}
                  >
                    <Play size={13} /> Tester
                  </button>
                </div>

                {singleApiPreview && (
                  <pre
                    className="p-2 rounded border font-mono mb-0"
                    style={{ fontSize: '0.72rem', maxHeight: 220, overflow: 'auto', backgroundColor: '#111926' }}
                  >
                    {singleApiPreview}
                  </pre>
                )}
              </div>
            </div>

            {/* Endpoint 2 */}
            <div className="col-lg-6">
              <div className="p-3 rounded border h-100" style={{ backgroundColor: 'rgba(21,30,44,0.55)' }}>
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <span className="badge bg-green-lt text-green font-mono">2. GET / POST /api/cost/total</span>
                  <button
                    className="btn btn-sm btn-outline-success d-inline-flex align-items-center gap-1"
                    onClick={fetchCostFromApi}
                  >
                    <RefreshCw size={12} className={loadingApi ? 'spin' : ''} /> Actualiser
                  </button>
                </div>
                <p className="text-secondary small mb-2">
                  Retourne le coût détaillé et total en <strong>USD</strong>, <strong>CAD</strong> et dans la <strong>devise demandée</strong> pour <code>inputTokens</code> + <code>outputTokens</code>.
                </p>

                <div className="d-flex gap-2 mb-2">
                  <input
                    type="text"
                    readOnly
                    className="form-control form-control-sm font-mono"
                    value={totalEndpointUrl}
                  />
                  <button
                    className="btn btn-sm btn-outline-secondary"
                    onClick={() => copyText('total', totalEndpointUrl)}
                    title="Copier l'URL"
                  >
                    {copiedKey === 'total' ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                  </button>
                </div>

                {apiResult && (
                  <pre
                    className="p-2 rounded border font-mono mb-0"
                    style={{ fontSize: '0.72rem', maxHeight: 220, overflow: 'auto', backgroundColor: '#111926' }}
                  >
                    {JSON.stringify(apiResult, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
