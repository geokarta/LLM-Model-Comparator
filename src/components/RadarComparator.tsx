import { useMemo } from 'react';
import type { Data, Layout } from 'plotly.js';
import { Radar as RadarIcon } from 'lucide-react';
import { BenchmarkDefinition, BenchmarkId, LLMModel, ProviderMeta } from '../../shared/types.ts';
import {
  computeEfficiencyScore,
  computePowerIndex,
  formatContext,
  formatUsd,
  normalizeScore,
} from '../../shared/metrics.ts';
import { PlotlyChart } from './PlotlyChart.tsx';
import { useI18n } from '../i18n/I18nContext.tsx';

interface RadarComparatorProps {
  pinnedModels: LLMModel[];
  benchmarks: BenchmarkDefinition[];
  providers: ProviderMeta[];
  onUnpin: (id: string) => void;
}

const RADAR_BENCH_IDS: BenchmarkId[] = [
  'arc_agi_1',
  'arc_agi_2',
  'arc_agi_3',
  'swe_bench',
  'gpqa_diamond',
  'hle',
  'frontier_math',
  'terminal_bench',
];

const SERIES_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];

export function RadarComparator({
  pinnedModels,
  benchmarks,
  providers,
  onUnpin,
}: RadarComparatorProps) {
  const { t } = useI18n();
  const providerMap = useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers]
  );

  const radarBenchmarks = useMemo(
    () => benchmarks.filter((b) => RADAR_BENCH_IDS.includes(b.id)),
    [benchmarks]
  );

  const plotData: Data[] = useMemo(() => {
    const theta = [...radarBenchmarks.map((b) => b.shortName), radarBenchmarks[0]?.shortName ?? ''];
    return pinnedModels.map((m, idx) => {
      const color = SERIES_COLORS[idx % SERIES_COLORS.length];
      const vals = radarBenchmarks.map(
        (bench) => normalizeScore(m.benchmarks[bench.id]?.score, bench) ?? 0
      );
      const r = [...vals, vals[0] ?? 0];
      return {
        type: 'scatterpolar',
        r,
        theta,
        fill: 'toself',
        fillcolor: `${color}22`,
        line: { color, width: 2 },
        marker: { size: 5, color },
        name: m.name,
        hovertemplate: `<b>${m.name}</b><br>%{theta} : <b>%{r:.1f}</b>/100<extra></extra>`,
      };
    });
  }, [radarBenchmarks, pinnedModels]);

  const layout: Partial<Layout> = useMemo(
    () => ({
      margin: { t: 28, r: 44, b: 32, l: 44 },
      polar: {
        bgcolor: 'rgba(21, 30, 44, 0.45)',
        radialaxis: {
          visible: true,
          range: [0, 100],
          gridcolor: 'rgba(148, 163, 184, 0.18)',
          linecolor: 'rgba(148, 163, 184, 0.25)',
          tickfont: { size: 10, color: '#94a3b8' },
        },
        angularaxis: {
          gridcolor: 'rgba(148, 163, 184, 0.18)',
          linecolor: 'rgba(148, 163, 184, 0.25)',
          tickfont: { size: 11, color: '#cbd5e1' },
        },
      },
      legend: {
        orientation: 'h',
        y: -0.14,
        x: 0.5,
        xanchor: 'center',
        font: { size: 11, color: '#cbd5e1' },
      },
    }),
    []
  );

  return (
    <div className="card h-100">
      <div className="card-header d-flex align-items-center justify-content-between gap-2">
        <div>
          <h3 className="card-title d-flex align-items-center gap-2 mb-0">
            <RadarIcon size={16} className="text-primary" />
            {t('radarTitle')}
          </h3>
          <div className="text-secondary small">{t('radarSubtitle')}</div>
        </div>
        <span className="badge bg-primary-lt text-primary font-mono">
          {pinnedModels.length} / 5 {t('pinnedLabel')}
        </span>
      </div>

      <div className="card-body">
        {pinnedModels.length === 0 ? (
          <div
            className="d-flex align-items-center justify-content-center text-secondary text-center p-4 rounded border border-dashed"
            style={{ height: 310 }}
          >
            Cliquez sur des modèles dans le tableau ou le graphique Pareto pour les comparer ici.
          </div>
        ) : (
          <>
            <PlotlyChart data={plotData} layout={layout} height={305} />

            <div className="row g-2 mt-1">
              {pinnedModels.map((m, idx) => {
                const color = SERIES_COLORS[idx % SERIES_COLORS.length];
                const power = computePowerIndex(m, benchmarks);
                const eff = computeEfficiencyScore(power, m.avgCostPerTaskUsd);
                const prov = providerMap.get(m.provider);
                return (
                  <div key={m.id} className="col-sm-6">
                    <div
                      className="p-2 rounded border position-relative"
                      style={{
                        backgroundColor: 'rgba(21, 30, 44, 0.7)',
                        borderLeft: `3px solid ${color}`,
                      }}
                    >
                      <button
                        className="btn-close position-absolute top-0 end-0 m-2"
                        style={{ width: 10, height: 10 }}
                        onClick={() => onUnpin(m.id)}
                        title="Retirer"
                        aria-label="Retirer"
                      />
                      <div className="fw-semibold small pe-3 text-truncate">{m.name}</div>
                      <div className="text-secondary" style={{ fontSize: '0.72rem' }}>
                        {prov?.name} · {formatContext(m.contextWindow)} ctx
                      </div>
                      <div className="d-flex justify-content-between mt-1 font-mono" style={{ fontSize: '0.73rem' }}>
                        <span style={{ color }}>PWR {power}</span>
                        <span className="text-warning">{formatUsd(m.avgCostPerTaskUsd)}/t</span>
                        <span className="text-success">EFF {eff}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
