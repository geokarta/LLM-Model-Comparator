import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Pin, Search, Table2 } from 'lucide-react';
import { BenchmarkDefinition, BenchmarkId, LLMModel, ModelTier, ProviderMeta } from '../../shared/types.ts';
import {
  computeEfficiencyScore,
  computePowerIndex,
  formatContext,
  formatUsd,
} from '../../shared/metrics.ts';
import { useI18n } from '../i18n/I18nContext.tsx';

interface TelemetryMatrixProps {
  models: LLMModel[];
  benchmarks: BenchmarkDefinition[];
  providers: ProviderMeta[];
  pinnedIds: string[];
  onTogglePin: (id: string) => void;
  onInspectBenchmark: (id: BenchmarkId) => void;
}

type SortKey =
  | 'power'
  | 'efficiency'
  | 'arc_agi_1'
  | 'arc_agi_2'
  | 'arc_agi_3'
  | 'swe_bench'
  | 'gpqa_diamond'
  | 'hle'
  | 'avgCostPerTaskUsd'
  | 'inputPricePer1M'
  | 'speedTokPerSec';

const TIER_META: Record<ModelTier, { label: string; cls: string }> = {
  flagship: { label: 'Flagship', cls: 'bg-blue-lt text-blue' },
  reasoning: { label: 'Reasoning', cls: 'bg-yellow-lt text-yellow' },
  balanced: { label: 'Équilibré', cls: 'bg-azure-lt text-azure' },
  fast: { label: 'Rapide', cls: 'bg-purple-lt text-purple' },
  'open-weight': { label: 'Open-Weight', cls: 'bg-green-lt text-green' },
};

export function TelemetryMatrix({
  models,
  benchmarks,
  providers,
  pinnedIds,
  onTogglePin,
  onInspectBenchmark,
}: TelemetryMatrixProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | ModelTier>('all');
  const [openWeightOnly, setOpenWeightOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('power');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const providerMap = useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers]
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'avgCostPerTaskUsd' || key === 'inputPricePer1M' ? 'asc' : 'desc');
    }
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const enriched = models
      .filter((m) => {
        if (tierFilter !== 'all' && m.tier !== tierFilter) return false;
        if (openWeightOnly && !m.openWeight) return false;
        if (q) {
          const prov = providerMap.get(m.provider)?.name.toLowerCase() ?? '';
          return (
            m.name.toLowerCase().includes(q) ||
            prov.includes(q) ||
            m.positioning.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .map((m) => {
        const power = computePowerIndex(m, benchmarks);
        const efficiency = computeEfficiencyScore(power, m.avgCostPerTaskUsd);
        return { model: m, power, efficiency };
      });

    enriched.sort((a, b) => {
      const getVal = (item: typeof a): number => {
        switch (sortKey) {
          case 'power':
            return item.power;
          case 'efficiency':
            return item.efficiency;
          case 'avgCostPerTaskUsd':
            return item.model.avgCostPerTaskUsd;
          case 'inputPricePer1M':
            return item.model.inputPricePer1M;
          case 'speedTokPerSec':
            return item.model.speedTokPerSec;
          default:
            return item.model.benchmarks[sortKey]?.score ?? -1;
        }
      };
      const diff = getVal(a) - getVal(b);
      return sortDir === 'desc' ? -diff : diff;
    });

    return enriched;
  }, [models, benchmarks, providerMap, search, tierFilter, openWeightOnly, sortKey, sortDir]);

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col ? (
      sortDir === 'desc' ? (
        <ArrowDown size={12} className="ms-1 text-primary" />
      ) : (
        <ArrowUp size={12} className="ms-1 text-primary" />
      )
    ) : null;

  return (
    <div className="card">
      <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div>
          <h3 className="card-title d-flex align-items-center gap-2 mb-0">
            <Table2 size={16} className="text-primary" />
            {t('matrixTitle')} ({rows.length})
          </h3>
          <div className="text-secondary small">{t('matrixSubtitle')}</div>
        </div>

        <div className="d-flex flex-wrap gap-2 align-items-center">
          <div className="input-icon">
            <span className="input-icon-addon">
              <Search size={14} />
            </span>
            <input
              type="text"
              className="form-control form-control-sm"
              placeholder={t('searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="form-select form-select-sm w-auto"
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value as 'all' | ModelTier)}
          >
            <option value="all">{t('allTiers')}</option>
            <option value="flagship">Flagship</option>
            <option value="reasoning">Reasoning</option>
            <option value="balanced">Équilibré</option>
            <option value="fast">Rapide</option>
            <option value="open-weight">Open-Weight</option>
          </select>

          <button
            className={`btn btn-sm ${openWeightOnly ? 'btn-success' : 'btn-outline-secondary'}`}
            onClick={() => setOpenWeightOnly((v) => !v)}
          >
            Open-Weight
          </button>
        </div>
      </div>

      <div className="table-responsive">
        <table className="table table-vcenter card-table table-hover">
          <thead>
            <tr>
              <th style={{ width: 34 }}>Pin</th>
              <th>Modèle &amp; Positionnement</th>
              <th className="cursor-pointer" onClick={() => toggleSort('power')}>
                Puissance <SortIcon col="power" />
              </th>
              <th className="cursor-pointer" onClick={() => toggleSort('arc_agi_1')}>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onInspectBenchmark('arc_agi_1');
                  }}
                  title="Explication ARC-AGI-1"
                  style={{ textDecoration: 'underline dotted' }}
                >
                  ARC-1
                </span>
                <SortIcon col="arc_agi_1" />
              </th>
              <th className="cursor-pointer" onClick={() => toggleSort('arc_agi_2')}>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onInspectBenchmark('arc_agi_2');
                  }}
                  title="Explication ARC-AGI-2"
                  style={{ textDecoration: 'underline dotted' }}
                >
                  ARC-2
                </span>
                <SortIcon col="arc_agi_2" />
              </th>
              <th className="cursor-pointer" onClick={() => toggleSort('arc_agi_3')}>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onInspectBenchmark('arc_agi_3');
                  }}
                  title="Explication ARC-AGI-3"
                  style={{ textDecoration: 'underline dotted' }}
                >
                  ARC-3
                </span>
                <SortIcon col="arc_agi_3" />
              </th>
              <th className="cursor-pointer" onClick={() => toggleSort('swe_bench')}>
                SWE-B <SortIcon col="swe_bench" />
              </th>
              <th className="cursor-pointer" onClick={() => toggleSort('hle')}>
                HLE <SortIcon col="hle" />
              </th>
              <th className="cursor-pointer" onClick={() => toggleSort('gpqa_diamond')}>
                GPQA <SortIcon col="gpqa_diamond" />
              </th>
              <th className="cursor-pointer" onClick={() => toggleSort('avgCostPerTaskUsd')}>
                Coût/Tâche <SortIcon col="avgCostPerTaskUsd" />
              </th>
              <th className="cursor-pointer" onClick={() => toggleSort('inputPricePer1M')}>
                API ($/1M) <SortIcon col="inputPricePer1M" />
              </th>
              <th className="cursor-pointer" onClick={() => toggleSort('speedTokPerSec')}>
                Débit / Ctx <SortIcon col="speedTokPerSec" />
              </th>
              <th className="cursor-pointer" onClick={() => toggleSort('efficiency')}>
                Efficience <SortIcon col="efficiency" />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ model, power, efficiency }) => {
              const prov = providerMap.get(model.provider);
              const isPinned = pinnedIds.includes(model.id);
              const arc2 = model.benchmarks.arc_agi_2;
              const arc3 = model.benchmarks.arc_agi_3;
              const tier = TIER_META[model.tier];

              return (
                <tr
                  key={model.id}
                  className={`cursor-pointer ${isPinned ? 'pinned-row' : ''}`}
                  onClick={() => onTogglePin(model.id)}
                >
                  <td>
                    <Pin
                      size={14}
                      className={isPinned ? 'text-primary' : 'text-secondary'}
                      fill={isPinned ? 'currentColor' : 'none'}
                    />
                  </td>
                  <td>
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <span
                        className="rounded-circle d-inline-block"
                        style={{
                          width: 8,
                          height: 8,
                          backgroundColor: prov?.color ?? '#3b82f6',
                          flexShrink: 0,
                        }}
                      />
                      <span className="fw-semibold">{model.name}</span>
                      <span
                        className={`badge ${
                          model.generation === 'current'
                            ? 'bg-cyan-lt text-cyan'
                            : 'bg-secondary-lt text-secondary'
                        }`}
                        title={
                          model.generation === 'current'
                            ? 'Dernière génération (N)'
                            : 'Génération précédente (N-1)'
                        }
                      >
                        {model.generationLabel}
                      </span>
                      <span className={`badge ${tier.cls}`}>{tier.label}</span>
                    </div>
                    <div className="text-secondary small">
                      <span style={{ color: prov?.color }}>{prov?.name}</span> · {model.positioning}
                    </div>
                  </td>

                  <td style={{ minWidth: 94 }}>
                    <div className="font-mono fw-semibold text-primary">{power.toFixed(1)}</div>
                    <div className="progress progress-sm mt-1">
                      <div className="progress-bar bg-primary" style={{ width: `${power}%` }} />
                    </div>
                  </td>

                  <td className="font-mono">
                    <div>{model.benchmarks.arc_agi_1?.score?.toFixed(1) ?? '—'}%</div>
                    {model.benchmarks.arc_agi_1?.costPerTaskUsd != null && (
                      <div className="text-secondary" style={{ fontSize: '0.7rem' }}>
                        {formatUsd(model.benchmarks.arc_agi_1.costPerTaskUsd)}/t
                      </div>
                    )}
                  </td>

                  <td className="font-mono">
                    <div className={`fw-semibold ${(arc2?.score ?? 0) >= 90 ? 'text-success' : ''}`}>
                      {arc2?.score?.toFixed(1) ?? '—'}%
                    </div>
                    {arc2?.costPerTaskUsd != null && (
                      <div className="text-warning" style={{ fontSize: '0.7rem' }}>
                        {formatUsd(arc2.costPerTaskUsd)}/t
                      </div>
                    )}
                  </td>

                  <td className="font-mono">
                    <div className={`fw-semibold ${(arc3?.score ?? 0) >= 90 ? 'text-primary' : ''}`}>
                      {arc3?.score?.toFixed(1) ?? '—'}%
                    </div>
                    {arc3?.costPerTaskUsd != null && (
                      <div className="text-warning" style={{ fontSize: '0.7rem' }}>
                        {formatUsd(arc3.costPerTaskUsd)}/t
                      </div>
                    )}
                  </td>

                  <td className="font-mono">{model.benchmarks.swe_bench?.score?.toFixed(1) ?? '—'}%</td>
                  <td className="font-mono">{model.benchmarks.hle?.score?.toFixed(1) ?? '—'}%</td>
                  <td className="font-mono">{model.benchmarks.gpqa_diamond?.score?.toFixed(1) ?? '—'}%</td>

                  <td className="font-mono fw-semibold text-warning">
                    {formatUsd(model.avgCostPerTaskUsd)}
                  </td>

                  <td className="font-mono" style={{ fontSize: '0.75rem' }}>
                    <div>In: {formatUsd(model.inputPricePer1M)}</div>
                    <div className="text-secondary">Out: {formatUsd(model.outputPricePer1M)}</div>
                  </td>

                  <td className="font-mono" style={{ fontSize: '0.75rem' }}>
                    <div className="text-success">{model.speedTokPerSec} tok/s</div>
                    <div className="text-secondary">{formatContext(model.contextWindow)}</div>
                  </td>

                  <td className="font-mono fw-semibold">
                    <span
                      className={
                        efficiency >= 55
                          ? 'text-success'
                          : efficiency >= 42
                            ? 'text-primary'
                            : 'text-warning'
                      }
                    >
                      {efficiency.toFixed(1)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
