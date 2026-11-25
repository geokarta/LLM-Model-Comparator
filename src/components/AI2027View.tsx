import { useMemo, useState } from 'react';
import type { Annotations, Data, Layout, Shape } from 'plotly.js';
import {
  AlertTriangle,
  Clock,
  Compass,
  ExternalLink,
  Info,
  ShieldAlert,
  Target,
  TrendingUp,
} from 'lucide-react';
import { LLMModel, ModelGeneration, ProviderId, ProviderMeta } from '../../shared/types.ts';
import {
  ai2027CurveHours,
  ai2027DateForHours,
  estimateModelHorizonHours,
  formatHorizonHours,
  releaseDateToDecimalYear,
} from '../../shared/metrics.ts';
import { emitOrbSignal } from '../utils/orbBus.ts';
import { PlotlyChart } from './PlotlyChart.tsx';

interface AI2027ViewProps {
  models: LLMModel[];
  providers: ProviderMeta[];
  pinnedIds: string[];
}

interface Milestone {
  id: string;
  label: string;
  shortLabel: string;
  dateLabel: string;
  year: number;
  hours: number;
  color: string;
  description: string;
}

const AI2027_MILESTONES: Milestone[] = [
  {
    id: 'agent-0',
    label: 'Agent-0 · Assistant Autonome',
    shortLabel: 'Agent-0 (1h)',
    dateLabel: 'Mi-2025',
    year: 2025.5,
    hours: 1,
    color: '#94a3b8',
    description: 'Exécution autonome de tâches de code bien définies d’environ 1 heure humaine.',
  },
  {
    id: 'agent-1',
    label: 'Agent-1 · Accélérateur R&D (×2)',
    shortLabel: 'Agent-1 (4h)',
    dateLabel: 'Fin 2025',
    year: 2025.95,
    hours: 4,
    color: '#38bdf8',
    description: 'Automatise la R&D logicielle de base et double la productivité des ingénieurs.',
  },
  {
    id: 'agent-2',
    label: 'Agent-2 · Apprentissage Continu',
    shortLabel: 'Agent-2 (24h)',
    dateLabel: 'Fin 2026 / Jan 2027',
    year: 2027.0,
    hours: 24,
    color: '#a78bfa',
    description: 'Mène des expériences autonomes sur plusieurs jours ouvrés avec adaptation en ligne.',
  },
  {
    id: 'agent-3',
    label: 'Agent-3 · Superhuman Coder (SC)',
    shortLabel: 'Agent-3 · SC (80h)',
    dateLabel: 'Mars 2027',
    year: 2027.25,
    hours: 80,
    color: '#f59e0b',
    description: 'Accomplit toute tâche d’ingénierie logicielle mieux, plus vite et moins cher que les meilleurs humains.',
  },
  {
    id: 'agent-4',
    label: 'Agent-4 · Superhuman AI Researcher (SAR)',
    shortLabel: 'Agent-4 · SAR (180h)',
    dateLabel: 'Fin 2027',
    year: 2027.85,
    hours: 180,
    color: '#ef4444',
    description: 'Dépasse les meilleurs chercheurs IA en intuition scientifique et lance la boucle d’auto-amélioration.',
  },
];

interface PlottedModel {
  id: string;
  name: string;
  provider: string;
  providerColor: string;
  generation: ModelGeneration;
  generationLabel: string;
  releaseDate: string;
  x: number;
  y: number;
  curveExpectedY: number;
  equivalentYear: number;
  deltaMonths: number;
  isPinned: boolean;
  isFocused: boolean;
}

export function AI2027View({ models, providers, pinnedIds }: AI2027ViewProps) {
  const [viewMode, setViewMode] = useState<'all' | 'pinned' | 'focus'>('all');
  const [providerFilter, setProviderFilter] = useState<'all' | ProviderId>('all');
  const [logScale, setLogScale] = useState<boolean>(true);
  const [focusedModelId, setFocusedModelId] = useState<string>(
    models[0]?.id ?? 'openai-gpt-6-2-astra'
  );

  const providerMap = useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers]
  );

  const curveSeries = useMemo(() => {
    const xs: number[] = [];
    const median: number[] = [];
    const upper: number[] = [];
    const lower: number[] = [];
    for (let yr = 2024.7; yr <= 2028.05; yr += 0.06) {
      const rounded = Number(yr.toFixed(2));
      const base = ai2027CurveHours(rounded);
      xs.push(rounded);
      median.push(base);
      upper.push(Number(Math.min(400, base * 1.55).toFixed(2)));
      lower.push(Number(Math.max(0.08, base * 0.62).toFixed(2)));
    }
    return { xs, median, upper, lower };
  }, []);

  const plottedModels: PlottedModel[] = useMemo(() => {
    return models
      .filter((m) => {
        if (viewMode === 'focus') return m.id === focusedModelId;
        if (viewMode === 'pinned') return pinnedIds.includes(m.id);
        if (providerFilter !== 'all' && m.provider !== providerFilter) return false;
        return true;
      })
      .map((m) => {
        const prov = providerMap.get(m.provider);
        const x = releaseDateToDecimalYear(m.releaseDate);
        const y = estimateModelHorizonHours(m);
        const curveExpectedY = ai2027CurveHours(x);
        const equivalentYear = ai2027DateForHours(y);
        const deltaMonths = Number(((equivalentYear - x) * 12).toFixed(1));
        return {
          id: m.id,
          name: m.name,
          provider: prov?.name ?? m.provider,
          providerColor: prov?.color ?? '#3b82f6',
          generation: m.generation,
          generationLabel: m.generationLabel,
          releaseDate: m.releaseDate,
          x,
          y,
          curveExpectedY,
          equivalentYear,
          deltaMonths,
          isPinned: pinnedIds.includes(m.id),
          isFocused: m.id === focusedModelId,
        };
      });
  }, [models, providerMap, viewMode, providerFilter, pinnedIds, focusedModelId]);

  const focusedSummary = useMemo(() => {
    const target =
      plottedModels.find((p) => p.id === focusedModelId) ??
      [...plottedModels].sort((a, b) => b.y - a.y)[0];
    if (!target) return null;

    const reached = [...AI2027_MILESTONES].reverse().find((ms) => target.y >= ms.hours) ?? null;
    const next = AI2027_MILESTONES.find((ms) => target.y < ms.hours) ?? null;
    const pctToSC = Math.min(100, Math.round((Math.log10(target.y + 1) / Math.log10(81)) * 100));
    const pctToSAR = Math.min(100, Math.round((Math.log10(target.y + 1) / Math.log10(181)) * 100));

    const riskZone =
      target.y >= 80
        ? { label: 'Zone Danger · Takeoff', cls: 'bg-red-lt text-red' }
        : target.y >= 24
          ? { label: 'Zone Warning · Agent-2', cls: 'bg-yellow-lt text-yellow' }
          : target.y >= 4
            ? { label: 'Zone Vigilance · R&D ×2', cls: 'bg-azure-lt text-azure' }
            : { label: 'Zone Contrôlée', cls: 'bg-green-lt text-green' };

    return { target, reached, next, pctToSC, pctToSAR, riskZone };
  }, [plottedModels, focusedModelId]);

  const plotData: Data[] = useMemo(() => {
    const upperBand: Data = {
      type: 'scatter',
      mode: 'lines',
      name: 'Corridor haut',
      x: curveSeries.xs,
      y: curveSeries.upper,
      line: { color: 'rgba(148,163,184,0.35)', width: 1, dash: 'dot' },
      hoverinfo: 'skip',
      showlegend: false,
    };

    const lowerBand: Data = {
      type: 'scatter',
      mode: 'lines',
      name: 'Corridor ±incertitude',
      x: curveSeries.xs,
      y: curveSeries.lower,
      fill: 'tonexty',
      fillcolor: 'rgba(59, 130, 246, 0.08)',
      line: { color: 'rgba(148,163,184,0.35)', width: 1, dash: 'dot' },
      hoverinfo: 'skip',
      showlegend: true,
    };

    const medianLine: Data = {
      type: 'scatter',
      mode: 'lines',
      name: 'Courbe médiane AI 2027',
      x: curveSeries.xs,
      y: curveSeries.median,
      line: { color: '#3b82f6', width: 2.6 },
      hovertemplate: 'Année %{x:.2f}<br>Horizon AI 2027 : <b>%{y:.1f} h</b><extra></extra>',
    };

    const modelsScatter: Data = {
      type: 'scatter',
      mode: 'text+markers',
      name: 'Modèles LLM',
      x: plottedModels.map((m) => m.x),
      y: plottedModels.map((m) => m.y),
      customdata: plottedModels.map((m) => m.id),
      text: plottedModels.map((m) =>
        m.isFocused || m.isPinned || viewMode === 'focus'
          ? m.name.replace(/\s*\(.*?\)/, '')
          : ''
      ),
      textposition: 'top right',
      textfont: { size: 10.5, color: '#e2e8f0' },
      marker: {
        size: plottedModels.map((m) => (m.isFocused ? 14 : m.isPinned ? 11 : 8.5)),
        color: plottedModels.map((m) => m.providerColor),
        opacity: plottedModels.map((m) => (m.generation === 'current' ? 0.96 : 0.68)),
        line: {
          color: plottedModels.map((m) => (m.isFocused ? '#ffffff' : '#151e2c')),
          width: plottedModels.map((m) => (m.isFocused ? 2.5 : 1.4)),
        },
      },
      hovertemplate: plottedModels.map(
        (m) =>
          `<b>${m.name}</b><br>` +
          `${m.provider} · ${m.generationLabel} · ${m.releaseDate}<br>` +
          `Horizon estimé : <b>${formatHorizonHours(m.y)}</b><br>` +
          `Attendu AI 2027 : ${formatHorizonHours(m.curveExpectedY)}<br>` +
          `Écart : <b>${m.deltaMonths >= 0 ? `+${m.deltaMonths} mois d’avance` : `${m.deltaMonths} mois de retard`}</b>` +
          `<extra></extra>`
      ),
    };

    return [upperBand, lowerBand, medianLine, modelsScatter];
  }, [curveSeries, plottedModels, viewMode]);

  const layout: Partial<Layout> = useMemo(() => {
    const shapes: Partial<Shape>[] = [
      // Warning zone: 24h -> 80h
      {
        type: 'rect',
        xref: 'paper',
        yref: 'y',
        x0: 0,
        x1: 1,
        y0: 24,
        y1: 80,
        fillcolor: 'rgba(245, 158, 11, 0.13)',
        line: { width: 0 },
        layer: 'below',
      },
      // Danger zone: 80h -> 400h
      {
        type: 'rect',
        xref: 'paper',
        yref: 'y',
        x0: 0,
        x1: 1,
        y0: 80,
        y1: 400,
        fillcolor: 'rgba(239, 68, 68, 0.16)',
        line: { width: 0 },
        layer: 'below',
      },
      // Milestone dashed lines
      ...AI2027_MILESTONES.map((ms) => ({
        type: 'line' as const,
        xref: 'paper' as const,
        yref: 'y' as const,
        x0: 0,
        x1: 1,
        y0: ms.hours,
        y1: ms.hours,
        line: { color: ms.color, width: 1, dash: 'dash' as const },
      })),
      // Current date vertical marker (Nov 2026)
      {
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: 2026.9,
        x1: 2026.9,
        y0: 0,
        y1: 1,
        line: { color: '#10b981', width: 1.4, dash: 'dot' },
      },
    ];

    const yCoord = (val: number) => (logScale ? Math.log10(val) : val);

    const annotations: Partial<Annotations>[] = [
      {
        xref: 'paper',
        yref: 'y',
        x: 0.01,
        y: yCoord(logScale ? 44 : 52),
        xanchor: 'left',
        text: '⚠ ZONE WARNING AI 2027 (Agent-2 → SC : R&D autonome & perte de visibilité)',
        showarrow: false,
        font: { size: 10.5, color: '#fbbf24' },
      },
      {
        xref: 'paper',
        yref: 'y',
        x: 0.01,
        y: yCoord(logScale ? 140 : 150),
        xanchor: 'left',
        text: '⛔ ZONE DANGER CRITIQUE AI 2027 (Takeoff · Auto-amélioration récursive & SAR)',
        showarrow: false,
        font: { size: 10.5, color: '#f87171' },
      },
      {
        xref: 'x',
        yref: 'paper',
        x: 2026.9,
        y: 0.99,
        xanchor: 'right',
        text: 'Aujourd’hui (Nov 2026) ',
        showarrow: false,
        font: { size: 10.5, color: '#10b981' },
      },
      ...AI2027_MILESTONES.map((ms) => ({
        xref: 'paper' as const,
        yref: 'y' as const,
        x: 0.99,
        y: yCoord(ms.hours),
        xanchor: 'right' as const,
        yanchor: 'bottom' as const,
        text: ms.shortLabel,
        showarrow: false,
        font: { size: 10, color: ms.color },
      })),
    ];

    return {
      dragmode: 'pan',
      margin: { t: 22, r: 24, b: 48, l: 78 },
      xaxis: {
        title: { text: 'Chronologie (Année)', font: { size: 11, color: '#94a3b8' } },
        range: [2024.75, 2028.0],
        gridcolor: 'rgba(148, 163, 184, 0.13)',
        dtick: 0.5,
      },
      yaxis: logScale
        ? {
            title: { text: 'Horizon autonome (heures, log)', font: { size: 11, color: '#94a3b8' } },
            type: 'log',
            range: [Math.log10(0.15), Math.log10(260)],
            tickvals: [0.25, 1, 4, 24, 80, 180],
            ticktext: ['15 min', '1 h', '4 h', '24 h (3j)', '80 h (2s)', '180 h (1m)'],
            gridcolor: 'rgba(148, 163, 184, 0.13)',
          }
        : {
            title: { text: 'Horizon autonome (heures, linéaire)', font: { size: 11, color: '#94a3b8' } },
            type: 'linear',
            range: [0, 220],
            ticksuffix: ' h',
            gridcolor: 'rgba(148, 163, 184, 0.13)',
          },
      legend: {
        orientation: 'h',
        y: 1.07,
        x: 0,
        font: { size: 11, color: '#94a3b8' },
      },
      shapes,
      annotations,
    };
  }, [logScale]);

  return (
    <div className="d-flex flex-column gap-3">
      {/* Controls Bar */}
      <div className="card">
        <div className="card-body py-3 d-flex flex-wrap align-items-center justify-content-between gap-3">
          <div>
            <h2 className="h3 mb-1 d-flex align-items-center gap-2">
              <TrendingUp size={18} className="text-primary" />
              Trajectoire &amp; Courbe de Prédiction AI 2027
            </h2>
            <div className="text-secondary small">
              Situe les modèles sur la courbe d’horizon temporel autonome (METR / AI 2027) — pan &amp; zoom libres avec Plotly.js.
            </div>
          </div>

          <div className="d-flex flex-wrap align-items-center gap-2">
            <div className="btn-group" role="group">
              <button
                className={`btn btn-sm ${viewMode === 'all' ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setViewMode('all')}
              >
                Tous ({models.length})
              </button>
              <button
                className={`btn btn-sm ${viewMode === 'pinned' ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setViewMode('pinned')}
              >
                Épinglés ({pinnedIds.length})
              </button>
              <button
                className={`btn btn-sm ${viewMode === 'focus' ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setViewMode('focus')}
              >
                Focus 1 modèle
              </button>
            </div>

            {viewMode === 'all' && (
              <select
                className="form-select form-select-sm w-auto"
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value as 'all' | ProviderId)}
              >
                <option value="all">Tous fournisseurs</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}

            <select
              className="form-select form-select-sm w-auto"
              value={focusedModelId}
              onChange={(e) => {
                setFocusedModelId(e.target.value);
                const m = models.find((x) => x.id === e.target.value);
                const prov = providers.find((p) => p.id === m?.provider);
                if (m) {
                  emitOrbSignal({
                    type: 'pin',
                    color: prov?.color ?? '#3b82f6',
                    intensity: 1.25,
                    label: `AI2027 : ${m.name}`,
                  });
                }
              }}
              aria-label="Modèle analysé"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  Focus : {m.name} ({m.generationLabel})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Diagnostic KPIs */}
      {focusedSummary && (
        <div className="row row-deck row-cards">
          <div className="col-sm-6 col-lg-3">
            <div className="card">
              <div className="card-body">
                <div className="subheader d-flex justify-content-between">
                  <span>Modèle analysé</span>
                  <Target size={15} className="text-primary" />
                </div>
                <div className="h3 mb-1 text-truncate" style={{ color: focusedSummary.target.providerColor }}>
                  {focusedSummary.target.name}
                </div>
                <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
                  <span className="text-secondary small font-mono">
                    {focusedSummary.target.releaseDate} · {focusedSummary.target.generationLabel}
                  </span>
                  <span className={`badge ${focusedSummary.riskZone.cls}`}>
                    {focusedSummary.riskZone.label}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="col-sm-6 col-lg-3">
            <div className="card">
              <div className="card-body">
                <div className="subheader d-flex justify-content-between">
                  <span>Horizon autonome estimé</span>
                  <Clock size={15} className="text-info" />
                </div>
                <div className="h3 mb-1 font-mono">
                  {formatHorizonHours(focusedSummary.target.y)}
                </div>
                <div className="text-secondary small">
                  Jalon atteint :{' '}
                  <strong className="text-body">
                    {focusedSummary.reached ? focusedSummary.reached.shortLabel : 'Pré-Agent-0'}
                  </strong>
                </div>
              </div>
            </div>
          </div>

          <div className="col-sm-6 col-lg-3">
            <div className="card">
              <div className="card-body">
                <div className="subheader d-flex justify-content-between">
                  <span>Écart vs courbe AI 2027</span>
                  <Compass size={15} className="text-warning" />
                </div>
                <div
                  className={`h3 mb-1 font-mono ${
                    focusedSummary.target.deltaMonths >= 0 ? 'text-success' : 'text-warning'
                  }`}
                >
                  {focusedSummary.target.deltaMonths >= 0
                    ? `+${focusedSummary.target.deltaMonths} mois`
                    : `${focusedSummary.target.deltaMonths} mois`}
                </div>
                <div className="text-secondary small">
                  {focusedSummary.target.deltaMonths >= 1
                    ? 'En avance sur la trajectoire médiane'
                    : focusedSummary.target.deltaMonths <= -1
                      ? 'En retrait de la courbe frontier'
                      : 'Aligné sur la trajectoire AI 2027'}
                </div>
              </div>
            </div>
          </div>

          <div className="col-sm-6 col-lg-3">
            <div className="card">
              <div className="card-body">
                <div className="subheader mb-2">Progression vers Agent-3 (SC) &amp; Agent-4</div>
                <div className="d-flex justify-content-between small font-mono mb-1">
                  <span className="text-warning">Superhuman Coder</span>
                  <span>{focusedSummary.pctToSC}%</span>
                </div>
                <div className="progress progress-sm mb-2">
                  <div className="progress-bar bg-warning" style={{ width: `${focusedSummary.pctToSC}%` }} />
                </div>
                <div className="d-flex justify-content-between small font-mono mb-1">
                  <span className="text-danger">Superhuman Researcher</span>
                  <span>{focusedSummary.pctToSAR}%</span>
                </div>
                <div className="progress progress-sm">
                  <div className="progress-bar bg-danger" style={{ width: `${focusedSummary.pctToSAR}%` }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Plotly AI 2027 Chart */}
      <div className="card">
        <div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
          <div>
            <h3 className="card-title mb-0">
              Courbe AI 2027 — Horizon Temporel Autonome (Plotly.js)
            </h3>
            <div className="text-secondary small">
              Glisser pour déplacer (pan) · Molette pour zoomer · Boîte de sélection dans la barre Plotly · Double-clic pour réinitialiser.
            </div>
          </div>

          <div className="btn-group btn-group-sm" role="group" aria-label="Échelle axe Y">
            <button
              className={`btn ${logScale ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => setLogScale(true)}
            >
              Échelle Log
            </button>
            <button
              className={`btn ${!logScale ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => setLogScale(false)}
            >
              Normal
            </button>
          </div>
        </div>

        <div className="card-body p-2">
          <PlotlyChart
            data={plotData}
            layout={layout}
            height={460}
            onPointClick={(evt) => {
              const id = evt.points?.[0]?.customdata;
              if (typeof id === 'string') {
                setFocusedModelId(id);
                const m = models.find((x) => x.id === id);
                const prov = providers.find((p) => p.id === m?.provider);
                if (m) {
                  emitOrbSignal({
                    type: 'pin',
                    color: prov?.color ?? '#3b82f6',
                    intensity: 1.3,
                    label: `AI2027 : ${m.name}`,
                  });
                }
              }
            }}
          />
        </div>

        <div className="card-footer d-flex flex-wrap justify-content-between align-items-center gap-2 small text-secondary">
          <div className="d-flex flex-wrap align-items-center gap-3">
            <span className="d-inline-flex align-items-center gap-1 text-warning">
              <AlertTriangle size={13} />
              <strong>Warning (24h–80h)</strong> : Agent-2 → Superhuman Coder
            </span>
            <span className="d-inline-flex align-items-center gap-1 text-danger">
              <ShieldAlert size={13} />
              <strong>Danger (≥ 80h)</strong> : Takeoff / Auto-amélioration
            </span>
          </div>
          <span className="font-mono">{plottedModels.length} modèle(s) affichés</span>
        </div>
      </div>

      {/* Milestones & Methodology */}
      <div className="row row-deck row-cards">
        <div className="col-lg-8">
          <div className="card h-100">
            <div className="card-header">
              <h3 className="card-title mb-0">Jalons de la feuille de route AI 2027</h3>
            </div>
            <div className="table-responsive">
              <table className="table table-vcenter card-table">
                <thead>
                  <tr>
                    <th>Jalon</th>
                    <th>Horizon prédit</th>
                    <th>Horizon autonome</th>
                    <th>Capacité clé</th>
                  </tr>
                </thead>
                <tbody>
                  {AI2027_MILESTONES.map((ms) => (
                    <tr key={ms.id}>
                      <td className="fw-semibold" style={{ color: ms.color }}>
                        {ms.label}
                      </td>
                      <td className="font-mono small">{ms.dateLabel}</td>
                      <td className="font-mono small">{formatHorizonHours(ms.hours)}</td>
                      <td className="text-secondary small">{ms.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="col-lg-4">
          <div className="card h-100">
            <div className="card-header">
              <h3 className="card-title d-flex align-items-center gap-2 mb-0">
                <Info size={15} className="text-primary" />
                Méthodologie de projection
              </h3>
            </div>
            <div className="card-body small text-secondary d-flex flex-column gap-2">
              <p className="mb-1">
                Le scénario <strong className="text-body">AI 2027</strong> (AI Futures Project) s’appuie sur la métrique{' '}
                <strong className="text-body">METR Time-Horizon</strong> : la durée de tâche humaine (en heures) qu’un agent IA résout de façon autonome à 50 % de fiabilité, doublant historiquement tous les ~6 à 7 mois avant une accélération liée à la R&amp;D automatisée.
              </p>
              <p className="mb-1">
                Chaque modèle de notre base est projeté à sa date de sortie réelle à partir d’un indice d’autonomie pondéré combinant{' '}
                <strong className="text-body">SWE-bench Verified (28 %)</strong>,{' '}
                <strong className="text-body">Terminal-Bench (22 %)</strong>,{' '}
                <strong className="text-body">ARC-AGI-3 (20 %)</strong>,{' '}
                <strong className="text-body">ARC-AGI-2 (18 %)</strong> et{' '}
                <strong className="text-body">HLE (12 %)</strong>.
              </p>
              <div className="mt-auto pt-2 d-flex flex-column gap-1">
                <a
                  href="https://ai-2027.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="link-primary d-inline-flex align-items-center gap-1"
                >
                  Scénario officiel AI-2027.com <ExternalLink size={12} />
                </a>
                <a
                  href="https://metr.org/"
                  target="_blank"
                  rel="noreferrer"
                  className="link-primary d-inline-flex align-items-center gap-1"
                >
                  Évaluations METR Time-Horizon <ExternalLink size={12} />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
