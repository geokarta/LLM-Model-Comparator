import { useMemo, useState } from 'react';
import type { Data, Layout } from 'plotly.js';
import { Crosshair } from 'lucide-react';
import { BenchmarkDefinition, BenchmarkId, LLMModel, ProviderMeta } from '../../shared/types.ts';
import {
  computeBlendedPricePer1M,
  computeParetoIds,
  computePowerIndex,
  formatUsd,
  normalizeScore,
} from '../../shared/metrics.ts';
import { PlotlyChart } from './PlotlyChart.tsx';

interface ParetoChartProps {
  models: LLMModel[];
  benchmarks: BenchmarkDefinition[];
  providers: ProviderMeta[];
  pinnedIds: string[];
  onTogglePin: (id: string) => void;
}

type YMetric = 'power_index' | BenchmarkId;
type XMetric = 'avg_task_cost' | 'arc2_cost' | 'arc3_cost' | 'blended_1m';

interface ChartPoint {
  id: string;
  name: string;
  provider: string;
  providerColor: string;
  tier: string;
  x: number;
  y: number;
  rawYLabel: string;
  isPareto: boolean;
  isPinned: boolean;
  speed: number;
}

export function ParetoChart({
  models,
  benchmarks,
  providers,
  pinnedIds,
  onTogglePin,
}: ParetoChartProps) {
  const [yMetric, setYMetric] = useState<YMetric>('power_index');
  const [xMetric, setXMetric] = useState<XMetric>('avg_task_cost');
  const [logScale, setLogScale] = useState(true);

  const providerMap = useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers]
  );

  const selectedBench = useMemo(
    () => benchmarks.find((b) => b.id === yMetric),
    [benchmarks, yMetric]
  );

  const points: ChartPoint[] = useMemo(() => {
    const raw = models
      .map((m) => {
        const prov = providerMap.get(m.provider);
        let yVal: number | null = null;
        let rawYLabel = '';

        if (yMetric === 'power_index') {
          yVal = computePowerIndex(m, benchmarks);
          rawYLabel = `${yVal} / 100`;
        } else if (selectedBench) {
          const score = m.benchmarks[yMetric]?.score;
          yVal = normalizeScore(score, selectedBench);
          rawYLabel =
            score !== null && score !== undefined
              ? selectedBench.unit === 'Elo'
                ? `${score} Elo`
                : `${score}%`
              : '—';
        }

        let xVal: number | null = null;
        if (xMetric === 'avg_task_cost') xVal = m.avgCostPerTaskUsd;
        else if (xMetric === 'arc2_cost') xVal = m.benchmarks.arc_agi_2?.costPerTaskUsd ?? m.avgCostPerTaskUsd;
        else if (xMetric === 'arc3_cost') xVal = m.benchmarks.arc_agi_3?.costPerTaskUsd ?? m.avgCostPerTaskUsd;
        else xVal = computeBlendedPricePer1M(m);

        if (yVal === null || xVal === null || xVal <= 0) return null;

        const point: ChartPoint = {
          id: m.id,
          name: m.name,
          provider: prov?.name ?? m.provider,
          providerColor: prov?.color ?? '#3b82f6',
          tier: m.tier,
          x: xVal,
          y: Number(yVal.toFixed(1)),
          rawYLabel,
          isPareto: false,
          isPinned: pinnedIds.includes(m.id),
          speed: m.speedTokPerSec,
        };
        return point;
      })
      .filter((p): p is ChartPoint => p !== null);

    const paretoSet = computeParetoIds(
      raw.map((p) => ({ id: p.id, cost: p.x, score: p.y }))
    );

    return raw.map((p) => ({ ...p, isPareto: paretoSet.has(p.id) }));
  }, [models, benchmarks, providerMap, yMetric, selectedBench, xMetric, pinnedIds]);

  const xLabel =
    xMetric === 'avg_task_cost'
      ? 'Coût moyen / tâche ($ USD)'
      : xMetric === 'arc2_cost'
        ? 'Coût / tâche ARC-AGI-2 ($ USD)'
        : xMetric === 'arc3_cost'
          ? 'Coût / tâche ARC-AGI-3 ($ USD)'
          : 'Prix API mixte ($ / 1M tokens)';

  const yLabel = yMetric === 'power_index' ? 'Indice Puissance (0–100)' : (selectedBench?.name ?? 'Score');

  const plotData: Data[] = useMemo(() => {
    const paretoPts = [...points]
      .filter((p) => p.isPareto)
      .sort((a, b) => a.x - b.x);

    const frontierLine: Data = {
      type: 'scatter',
      mode: 'lines',
      name: 'Frontière de Pareto',
      x: paretoPts.map((p) => p.x),
      y: paretoPts.map((p) => p.y),
      line: { color: '#10b981', width: 1.6, dash: 'dot' },
      hoverinfo: 'skip',
      showlegend: true,
    };

    const scatterModels: Data = {
      type: 'scatter',
      mode: 'text+markers',
      name: 'Modèles',
      x: points.map((p) => p.x),
      y: points.map((p) => p.y),
      customdata: points.map((p) => p.id),
      text: points.map((p) =>
        p.isPareto || p.isPinned ? p.name.replace(/\s*\(.*?\)/, '') : ''
      ),
      textposition: 'top right',
      textfont: { size: 10, color: '#e2e8f0' },
      marker: {
        size: points.map((p) => (p.isPinned ? 13 : p.isPareto ? 11 : 8.5)),
        color: points.map((p) => p.providerColor),
        line: {
          color: points.map((p) =>
            p.isPinned ? '#ffffff' : p.isPareto ? '#10b981' : '#151e2c'
          ),
          width: points.map((p) => (p.isPinned ? 2.2 : p.isPareto ? 2 : 1.2)),
        },
        opacity: 0.92,
      },
      hovertemplate: points.map(
        (p) =>
          `<b>${p.name}</b><br>` +
          `${p.provider} · ${p.tier}<br>` +
          `Score : <b>${p.rawYLabel}</b><br>` +
          `Coût : <b>${formatUsd(p.x)}</b><br>` +
          `Débit : ${p.speed} tok/s` +
          `${p.isPareto ? '<br><span style="color:#10b981">★ Frontière de Pareto</span>' : ''}` +
          `<extra></extra>`
      ),
      showlegend: false,
    };

    return [frontierLine, scatterModels];
  }, [points]);

  const layout: Partial<Layout> = useMemo(
    () => ({
      dragmode: 'pan',
      margin: { t: 18, r: 24, b: 48, l: 54 },
      xaxis: {
        title: { text: xLabel, font: { size: 11, color: '#94a3b8' } },
        type: logScale ? 'log' : 'linear',
        tickprefix: '$',
        gridcolor: 'rgba(148, 163, 184, 0.13)',
        zerolinecolor: 'rgba(148, 163, 184, 0.2)',
      },
      yaxis: {
        title: { text: yLabel, font: { size: 11, color: '#94a3b8' } },
        gridcolor: 'rgba(148, 163, 184, 0.13)',
        zerolinecolor: 'rgba(148, 163, 184, 0.2)',
        range: [Math.max(0, Math.min(...points.map((p) => p.y), 40) - 6), 103],
      },
      legend: {
        orientation: 'h',
        y: 1.08,
        x: 0,
        font: { size: 11, color: '#94a3b8' },
      },
    }),
    [xLabel, yLabel, logScale, points]
  );

  return (
    <div className="card h-100">
      <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div>
          <h3 className="card-title d-flex align-items-center gap-2 mb-0">
            <Crosshair size={16} className="text-primary" />
            Positionnement &amp; Frontière de Pareto
          </h3>
          <div className="text-secondary small">
            Glisser pour déplacer (pan) · Molette pour zoomer · Double-clic pour réinitialiser · Clic sur un point pour épingler.
          </div>
        </div>

        <div className="d-flex flex-wrap gap-2 align-items-center">
          <select
            className="form-select form-select-sm w-auto"
            value={yMetric}
            onChange={(e) => setYMetric(e.target.value as YMetric)}
            aria-label="Métrique verticale"
          >
            <option value="power_index">Y : Indice Global</option>
            {benchmarks.map((b) => (
              <option key={b.id} value={b.id}>
                Y : {b.name}
              </option>
            ))}
          </select>

          <select
            className="form-select form-select-sm w-auto"
            value={xMetric}
            onChange={(e) => setXMetric(e.target.value as XMetric)}
            aria-label="Métrique horizontale"
          >
            <option value="avg_task_cost">X : Coût / Tâche</option>
            <option value="arc2_cost">X : Coût ARC-AGI-2</option>
            <option value="arc3_cost">X : Coût ARC-AGI-3</option>
            <option value="blended_1m">X : Prix API ($/1M)</option>
          </select>

          <div className="btn-group btn-group-sm" role="group" aria-label="Échelle axe X">
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
      </div>

      <div className="card-body p-2">
        <PlotlyChart
          data={plotData}
          layout={layout}
          height={355}
          onPointClick={(evt) => {
            const id = evt.points?.[0]?.customdata;
            if (typeof id === 'string') onTogglePin(id);
          }}
        />
      </div>
    </div>
  );
}
