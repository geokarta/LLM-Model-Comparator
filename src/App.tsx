import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, DollarSign, Gauge, Globe2, Trophy, Zap } from 'lucide-react';
import { BenchmarkId, LLMModel, ModelGeneration, ProviderId, TelemetryDataset } from '../shared/types.ts';
import { computeEfficiencyScore, computePowerIndex, formatUsd } from '../shared/metrics.ts';
import { ActiveTab, TopHudBar } from './components/TopHudBar.tsx';
import { ParetoChart } from './components/ParetoChart.tsx';
import { RadarComparator } from './components/RadarComparator.tsx';
import { TaskCostSimulator } from './components/TaskCostSimulator.tsx';
import { TelemetryMatrix } from './components/TelemetryMatrix.tsx';
import { BenchmarkCodex } from './components/BenchmarkCodex.tsx';
import { HarvesterConsole } from './components/HarvesterConsole.tsx';
import { AI2027View } from './components/AI2027View.tsx';
import { CostSimulatorPage } from './components/CostSimulatorPage.tsx';
import { NeuralOrb } from './components/NeuralOrb.tsx';
import { emitOrbSignal } from './utils/orbBus.ts';

type ComparisonScope = 'cross-provider' | 'intra-provider';

function getInitialTabFromPath(): ActiveTab {
  if (typeof window === 'undefined') return 'comparator';
  const p = window.location.pathname.toLowerCase();
  if (p.includes('simulator') || p.includes('simulateur')) return 'simulator';
  if (p.includes('ai2027')) return 'ai2027';
  if (p.includes('codex')) return 'codex';
  if (p.includes('harvester')) return 'harvester';
  return 'comparator';
}

export default function App() {
  const [dataset, setDataset] = useState<TelemetryDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>(getInitialTabFromPath);
  const [scope, setScope] = useState<ComparisonScope>('cross-provider');
  const [generationFilter, setGenerationFilter] = useState<'all' | ModelGeneration>('all');
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('openai');
  const [pinnedIds, setPinnedIds] = useState<string[]>([
    'openai-gpt-6-2-astra',
    'google-gemini-4-carbon',
    'anthropic-claude-fable-5-2',
    'deepseek-v4-pro',
  ]);
  const [highlightedBenchmark, setHighlightedBenchmark] = useState<BenchmarkId | null>(null);
  const [isHarvesting, setIsHarvesting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
  }, []);

  const fetchTelemetry = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/telemetry');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as TelemetryDataset;
      setDataset(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de joindre le serveur API');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTelemetry();
  }, [fetchTelemetry]);

  const handleHarvest = async () => {
    setIsHarvesting(true);
    emitOrbSignal({
      type: 'harvest-start',
      color: '#10b981',
      intensity: 1.8,
      label: 'Synchronisation...',
    });
    try {
      const res = await fetch('/api/harvest', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        dataset: TelemetryDataset;
        record: { totalUpdatedFields: number; durationMs: number };
      };
      setDataset(data.dataset);
      emitOrbSignal({
        type: 'harvest-done',
        color: '#10b981',
        intensity: 1.6,
        label: `+${data.record.totalUpdatedFields} MAJ`,
      });
      showToast(
        `Moissonnage terminé en ${data.record.durationMs}ms — ${data.record.totalUpdatedFields} valeur(s) actualisée(s).`
      );
    } catch (err) {
      emitOrbSignal({ type: 'harvest-done', color: '#ef4444', intensity: 1.3, label: 'Erreur sync' });
      showToast(`Erreur moissonnage : ${err instanceof Error ? err.message : 'réseau'}`);
    } finally {
      setIsHarvesting(false);
    }
  };

  const handleReset = async () => {
    const res = await fetch('/api/reset', { method: 'POST' });
    if (res.ok) {
      const data = (await res.json()) as { dataset: TelemetryDataset };
      setDataset(data.dataset);
      showToast('Base réinitialisée sur les valeurs de référence 2026.');
    }
  };

  const handleUpdateModel = async (modelId: string, patch: Partial<LLMModel>) => {
    const res = await fetch(`/api/models/${modelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = (await res.json()) as { dataset: TelemetryDataset };
      setDataset(data.dataset);
      emitOrbSignal({
        type: 'calibrate',
        color: '#10b981',
        intensity: 1.2,
        label: 'Calibration sauvée',
      });
      showToast('Calibration du modèle enregistrée.');
    }
  };

  const handleScopeChange = (nextScope: ComparisonScope, prov?: ProviderId) => {
    setScope(nextScope);
    if (prov) setSelectedProvider(prov);

    if (dataset && nextScope === 'intra-provider') {
      const targetProv = prov ?? selectedProvider;
      const provMeta = dataset.providers.find((p) => p.id === targetProv);
      const sameProvIds = dataset.models
        .filter((m) => m.provider === targetProv)
        .map((m) => m.id)
        .slice(0, 5);
      setPinnedIds(sameProvIds);
      emitOrbSignal({
        type: 'scope',
        color: provMeta?.color ?? '#3b82f6',
        intensity: 1.3,
        label: provMeta?.name ?? targetProv,
      });
    } else if (dataset && nextScope === 'cross-provider') {
      setPinnedIds([
        'openai-gpt-6-2-astra',
        'google-gemini-4-carbon',
        'anthropic-claude-fable-5-2',
        'deepseek-v4-pro',
      ]);
      emitOrbSignal({
        type: 'scope',
        color: '#3b82f6',
        intensity: 1.2,
        label: 'Multi-fournisseurs',
      });
    }
  };

  const togglePin = (id: string) => {
    const targetModel = dataset?.models.find((m) => m.id === id);
    const provMeta = dataset?.providers.find((p) => p.id === targetModel?.provider);
    setPinnedIds((prev) => {
      const removing = prev.includes(id);
      if (targetModel) {
        emitOrbSignal({
          type: 'pin',
          color: provMeta?.color ?? '#3b82f6',
          intensity: removing ? 0.8 : 1.35,
          label: targetModel.name,
        });
      }
      if (removing) return prev.filter((x) => x !== id);
      if (prev.length >= 5) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const scopedModels = useMemo(() => {
    if (!dataset) return [];
    return dataset.models.filter((m) => {
      if (scope === 'intra-provider' && m.provider !== selectedProvider) return false;
      if (generationFilter !== 'all' && m.generation !== generationFilter) return false;
      return true;
    });
  }, [dataset, scope, selectedProvider, generationFilter]);

  const pinnedModels = useMemo(() => {
    if (!dataset) return [];
    return pinnedIds
      .map((id) => dataset.models.find((m) => m.id === id))
      .filter((m): m is LLMModel => Boolean(m));
  }, [dataset, pinnedIds]);

  const kpis = useMemo(() => {
    if (!dataset || scopedModels.length === 0) return null;
    const scored = scopedModels.map((m) => {
      const power = computePowerIndex(m, dataset.benchmarks);
      const eff = computeEfficiencyScore(power, m.avgCostPerTaskUsd);
      return { m, power, eff };
    });

    const topPower = [...scored].sort((a, b) => b.power - a.power)[0];
    const topEff = [...scored].sort((a, b) => b.eff - a.eff)[0];
    const topArc3 = [...scored].sort(
      (a, b) => (b.m.benchmarks.arc_agi_3?.score ?? 0) - (a.m.benchmarks.arc_agi_3?.score ?? 0)
    )[0];
    const cheapest = [...scored].sort((a, b) => a.m.avgCostPerTaskUsd - b.m.avgCostPerTaskUsd)[0];

    return { topPower, topEff, topArc3, cheapest };
  }, [dataset, scopedModels]);

  if (loading) {
    return (
      <div className="page page-center">
        <div className="container container-slim py-4 text-center">
          <div className="spinner-border text-primary mb-3" role="status" />
          <div className="text-secondary">Chargement des benchmarks LLM...</div>
        </div>
      </div>
    );
  }

  if (error || !dataset) {
    return (
      <div className="page page-center">
        <div className="container-tight py-4">
          <div className="card">
            <div className="card-body text-center">
              <h3 className="text-danger">Erreur de connexion API</h3>
              <p className="text-secondary">{error ?? 'Données indisponibles.'}</p>
              <button className="btn btn-primary" onClick={fetchTelemetry}>
                Réessayer
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const activeProviderMeta = dataset.providers.find((p) => p.id === selectedProvider);

  return (
    <div className="page">
      <TopHudBar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          const nextPath = tab === 'comparator' ? '/' : `/${tab}`;
          if (window.location.pathname !== nextPath) {
            window.history.pushState({}, '', nextPath);
          }
          emitOrbSignal({
            type: 'tab',
            color:
              tab === 'harvester'
                ? '#10b981'
                : tab === 'codex'
                  ? '#8b5cf6'
                  : tab === 'ai2027'
                    ? '#f59e0b'
                    : tab === 'simulator'
                      ? '#06b6d4'
                      : '#3b82f6',
            intensity: 1.0,
            label:
              tab === 'comparator'
                ? 'Comparateur'
                : tab === 'simulator'
                  ? 'Simulateur Coût'
                  : tab === 'ai2027'
                    ? 'Courbe AI 2027'
                    : tab === 'codex'
                      ? 'Codex'
                      : 'Moissonneur',
          });
        }}
        lastHarvestAt={dataset.lastHarvestAt}
        modelCount={dataset.models.length}
        benchmarkCount={dataset.benchmarks.length}
        isHarvesting={isHarvesting}
        onTriggerHarvest={handleHarvest}
        lastDeltaCount={dataset.harvestHistory[0]?.totalUpdatedFields ?? 0}
      />

      <div className="page-wrapper">
        <div className="page-body">
          <div className="container-xl">
            {toast && (
              <div className="alert alert-success alert-dismissible mb-3" role="alert">
                <div className="d-flex">{toast}</div>
              </div>
            )}

            {activeTab === 'comparator' && (
              <div className="d-flex flex-column gap-3">
                {/* Scope Switcher */}
                <div className="card">
                  <div className="card-body py-3 d-flex flex-wrap align-items-center justify-content-between gap-3">
                    <div className="d-flex flex-wrap align-items-center gap-2">
                      <div className="btn-group" role="group">
                        <button
                          className={`btn btn-sm ${scope === 'cross-provider' ? 'btn-primary' : 'btn-outline-secondary'}`}
                          onClick={() => handleScopeChange('cross-provider')}
                        >
                          <Globe2 size={14} className="me-1" />
                          Multi-fournisseurs
                        </button>
                        <button
                          className={`btn btn-sm ${scope === 'intra-provider' ? 'btn-primary' : 'btn-outline-secondary'}`}
                          onClick={() => handleScopeChange('intra-provider')}
                        >
                          <Building2 size={14} className="me-1" />
                          Même fournisseur
                        </button>
                      </div>

                      <div className="btn-group" role="group" aria-label="Filtre de génération">
                        <button
                          className={`btn btn-sm ${generationFilter === 'all' ? 'btn-secondary' : 'btn-outline-secondary'}`}
                          onClick={() => setGenerationFilter('all')}
                        >
                          2 Gén. (N &amp; N-1)
                        </button>
                        <button
                          className={`btn btn-sm ${generationFilter === 'current' ? 'btn-secondary' : 'btn-outline-secondary'}`}
                          onClick={() => setGenerationFilter('current')}
                        >
                          Gén. N
                        </button>
                        <button
                          className={`btn btn-sm ${generationFilter === 'previous' ? 'btn-secondary' : 'btn-outline-secondary'}`}
                          onClick={() => setGenerationFilter('previous')}
                        >
                          Gén. N-1
                        </button>
                      </div>
                    </div>

                    {scope === 'intra-provider' ? (
                      <div className="d-flex flex-wrap gap-1">
                        {dataset.providers.map((p) => {
                          const count = dataset.models.filter((m) => m.provider === p.id).length;
                          const active = selectedProvider === p.id;
                          return (
                            <button
                              key={p.id}
                              className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline-secondary'}`}
                              onClick={() => handleScopeChange('intra-provider', p.id)}
                            >
                              {p.name} <span className="badge bg-dark-lt ms-1">{count}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-secondary small">
                        Comparaison transversale : puissance, positionnement et coût par tâche
                      </div>
                    )}
                  </div>
                </div>

                {scope === 'intra-provider' && activeProviderMeta && (
                  <div
                    className="card"
                    style={{ borderLeft: `4px solid ${activeProviderMeta.color}` }}
                  >
                    <div className="card-body py-2 d-flex flex-wrap justify-content-between align-items-center gap-2">
                      <div>
                        <span className="fw-bold">{activeProviderMeta.name}</span>
                        <span className="text-secondary small ms-2">{activeProviderMeta.headquarters}</span>
                        <div className="text-secondary small">{activeProviderMeta.philosophy}</div>
                      </div>
                      <span className="badge bg-primary-lt text-primary">
                        {scopedModels.length} modèle{scopedModels.length > 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                )}

                {/* KPI Summary Cards */}
                {kpis && (
                  <div className="row row-deck row-cards">
                    <div className="col-sm-6 col-lg-3">
                      <div className="card">
                        <div className="card-body">
                          <div className="d-flex align-items-center justify-content-between mb-2">
                            <div className="subheader">Leader puissance</div>
                            <Trophy size={16} className="text-primary" />
                          </div>
                          <div className="h3 mb-1 text-truncate">{kpis.topPower.m.name}</div>
                          <div className="text-secondary small font-mono">
                            Score {kpis.topPower.power}/100 · {formatUsd(kpis.topPower.m.avgCostPerTaskUsd)}/t
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="col-sm-6 col-lg-3">
                      <div className="card">
                        <div className="card-body">
                          <div className="d-flex align-items-center justify-content-between mb-2">
                            <div className="subheader">Meilleure efficience</div>
                            <Gauge size={16} className="text-success" />
                          </div>
                          <div className="h3 mb-1 text-truncate">{kpis.topEff.m.name}</div>
                          <div className="text-success small font-mono">
                            EFF {kpis.topEff.eff} · PWR {kpis.topEff.power} · {formatUsd(kpis.topEff.m.avgCostPerTaskUsd)}/t
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="col-sm-6 col-lg-3">
                      <div className="card">
                        <div className="card-body">
                          <div className="d-flex align-items-center justify-content-between mb-2">
                            <div className="subheader">Record ARC-AGI-3</div>
                            <Zap size={16} className="text-purple" />
                          </div>
                          <div className="h3 mb-1 text-truncate">{kpis.topArc3.m.name}</div>
                          <div className="text-secondary small font-mono">
                            {kpis.topArc3.m.benchmarks.arc_agi_3?.score?.toFixed(1)}% ·{' '}
                            {formatUsd(kpis.topArc3.m.benchmarks.arc_agi_3?.costPerTaskUsd)}/t
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="col-sm-6 col-lg-3">
                      <div className="card">
                        <div className="card-body">
                          <div className="d-flex align-items-center justify-content-between mb-2">
                            <div className="subheader">Coût minimal / tâche</div>
                            <DollarSign size={16} className="text-warning" />
                          </div>
                          <div className="h3 mb-1 text-truncate">{kpis.cheapest.m.name}</div>
                          <div className="text-warning small font-mono">
                            {formatUsd(kpis.cheapest.m.avgCostPerTaskUsd)}/t · {kpis.cheapest.m.speedTokPerSec} tok/s
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Pareto & Radar */}
                <div className="row row-deck row-cards">
                  <div className="col-lg-6">
                    <ParetoChart
                      models={scopedModels}
                      benchmarks={dataset.benchmarks}
                      providers={dataset.providers}
                      pinnedIds={pinnedIds}
                      onTogglePin={togglePin}
                    />
                  </div>
                  <div className="col-lg-6">
                    <RadarComparator
                      pinnedModels={pinnedModels}
                      benchmarks={dataset.benchmarks}
                      providers={dataset.providers}
                      onUnpin={togglePin}
                    />
                  </div>
                </div>

                {/* Task Cost Simulator */}
                <TaskCostSimulator models={scopedModels} providers={dataset.providers} />

                {/* Full Matrix */}
                <TelemetryMatrix
                  models={scopedModels}
                  benchmarks={dataset.benchmarks}
                  providers={dataset.providers}
                  pinnedIds={pinnedIds}
                  onTogglePin={togglePin}
                  onInspectBenchmark={(id) => {
                    setHighlightedBenchmark(id);
                    setActiveTab('codex');
                  }}
                />
              </div>
            )}

            {activeTab === 'simulator' && (
              <CostSimulatorPage
                models={dataset.models}
                providers={dataset.providers}
              />
            )}

            {activeTab === 'ai2027' && (
              <AI2027View
                models={dataset.models}
                providers={dataset.providers}
                pinnedIds={pinnedIds}
              />
            )}

            {activeTab === 'codex' && (
              <BenchmarkCodex
                benchmarks={dataset.benchmarks}
                models={dataset.models}
                providers={dataset.providers}
                highlightedId={highlightedBenchmark}
              />
            )}

            {activeTab === 'harvester' && (
              <HarvesterConsole
                dataset={dataset}
                isHarvesting={isHarvesting}
                onTriggerHarvest={handleHarvest}
                onResetDataset={handleReset}
                onUpdateModel={handleUpdateModel}
              />
            )}
          </div>
        </div>
      </div>

      <NeuralOrb
        isHarvesting={isHarvesting}
        pinnedCount={pinnedIds.length}
        accentColor={
          scope === 'intra-provider' && activeProviderMeta
            ? activeProviderMeta.color
            : '#3b82f6'
        }
      />
    </div>
  );
}
