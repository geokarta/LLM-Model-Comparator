import { useEffect, useMemo, useRef, useState } from 'react';
import { DataSet } from 'vis-data';
import { Timeline } from 'vis-timeline/standalone';
import 'vis-timeline/styles/vis-timeline-graph2d.min.css';
import {
  Calendar,
  Clock,
  Focus,
  Pin,
  RefreshCw,
  RotateCcw,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { BenchmarkDefinition, LLMModel, ProviderId, ProviderMeta } from '../../shared/types.ts';
import { computePowerIndex, formatContext, formatUsd } from '../../shared/metrics.ts';
import { emitOrbSignal } from '../utils/orbBus.ts';

interface TimelinePageProps {
  models: LLMModel[];
  providers: ProviderMeta[];
  benchmarks: BenchmarkDefinition[];
  isHarvesting: boolean;
  isAdmin: boolean;
  onTriggerHarvest: () => void;
}

type CompanyFilterMode = 'all' | 'single' | 'pinned';

function parseReleaseDate(dateStr: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(`${dateStr}T12:00:00Z`);
  }
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    return new Date(`${dateStr}-15T12:00:00Z`);
  }
  const parsed = new Date(dateStr);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function formatDisplayDate(dateStr: string): string {
  const d = parseReleaseDate(dateStr);
  return d.toLocaleDateString('fr-FR', {
    day: dateStr.length >= 10 ? '2-digit' : undefined,
    month: 'short',
    year: 'numeric',
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function TimelinePage({
  models,
  providers,
  benchmarks,
  isHarvesting,
  isAdmin,
  onTriggerHarvest,
}: TimelinePageProps) {
  const [filterMode, setFilterMode] = useState<CompanyFilterMode>('all');
  const [singleProvider, setSingleProvider] = useState<ProviderId>('openai');
  const [pinnedProviders, setPinnedProviders] = useState<ProviderId[]>([
    'openai',
    'google',
    'anthropic',
  ]);
  const [showUpcoming, setShowUpcoming] = useState<boolean>(true);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(models[0]?.id ?? null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<Timeline | null>(null);

  const providerMap = useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers]
  );

  const togglePinnedProvider = (id: ProviderId) => {
    setPinnedProviders((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const activeProviders = useMemo(() => {
    if (filterMode === 'all') return providers;
    if (filterMode === 'single') return providers.filter((p) => p.id === singleProvider);
    return providers.filter((p) => pinnedProviders.includes(p.id));
  }, [providers, filterMode, singleProvider, pinnedProviders]);

  const activeProviderIds = useMemo(
    () => new Set(activeProviders.map((p) => p.id)),
    [activeProviders]
  );

  const visibleModels = useMemo(() => {
    return models
      .filter((m) => {
        if (!activeProviderIds.has(m.provider)) return false;
        if (!showUpcoming && m.status === 'upcoming') return false;
        return true;
      })
      .sort(
        (a, b) =>
          parseReleaseDate(b.releaseDate).getTime() - parseReleaseDate(a.releaseDate).getTime()
      );
  }, [models, activeProviderIds, showUpcoming]);

  const harvestedCount = useMemo(
    () => models.filter((m) => m.discoveredByHarvester).length,
    [models]
  );

  const upcomingCount = useMemo(
    () => models.filter((m) => m.status === 'upcoming').length,
    [models]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const groups = new DataSet(
      activeProviders.map((p, idx) => ({
        id: p.id,
        order: idx,
        content: `<div style="display:flex;align-items:center;gap:7px;padding:2px 4px;">
          <span style="width:9px;height:9px;border-radius:50%;background:${p.color};display:inline-block;flex-shrink:0;"></span>
          <span>${escapeHtml(p.name)}</span>
        </div>`,
      }))
    );

    const items = new DataSet(
      visibleModels.map((m) => {
        const prov = providerMap.get(m.provider);
        const color = prov?.color ?? '#3b82f6';
        const isUpcoming = m.status === 'upcoming';
        const isHarvested = Boolean(m.discoveredByHarvester);
        const dateLabel = formatDisplayDate(m.releaseDate);
        const tag = isUpcoming
          ? `<span style="font-size:10px;color:#fbbf24;font-weight:600;margin-left:5px;">FUTUR</span>`
          : isHarvested
            ? `<span style="font-size:10px;color:#34d399;font-weight:600;margin-left:5px;">LIVE</span>`
            : '';

        return {
          id: m.id,
          group: m.provider,
          start: parseReleaseDate(m.releaseDate),
          type: 'box',
          className: isUpcoming
            ? 'timeline-item-upcoming'
            : isHarvested
              ? 'timeline-item-harvested'
              : '',
          style: `border-left: 3px solid ${color} !important;`,
          content: `<div style="line-height:1.25;">
            <div style="font-weight:600;font-size:12px;color:#e2e8f0;white-space:nowrap;">
              ${escapeHtml(m.name)}${tag}
            </div>
            <div style="font-family:JetBrains Mono,monospace;font-size:10px;color:#94a3b8;margin-top:2px;">
              ${escapeHtml(dateLabel)} · ${escapeHtml(m.generationLabel)}
            </div>
          </div>`,
          title: `${m.name} (${prov?.name ?? m.provider}) — Publié le ${dateLabel}`,
        };
      })
    );

    const now = new Date();
    const startWindow = new Date(now.getFullYear() - 1, now.getMonth() - 3, 1);
    const endWindow = new Date(now.getFullYear(), now.getMonth() + 6, 1);

    if (timelineRef.current) {
      timelineRef.current.destroy();
      timelineRef.current = null;
    }

    const tl = new Timeline(el, items, groups, {
      stack: true,
      showCurrentTime: true,
      zoomable: true,
      moveable: true,
      zoomMin: 1000 * 60 * 60 * 24 * 14, // 2 weeks min zoom
      zoomMax: 1000 * 60 * 60 * 24 * 365 * 5, // 5 years max zoom
      start: startWindow,
      end: endWindow,
      min: new Date('2024-01-01'),
      max: new Date('2028-06-01'),
      orientation: { axis: 'top' },
      margin: { item: { horizontal: 10, vertical: 8 }, axis: 12 },
      verticalScroll: true,
      maxHeight: 540,
      minHeight: 360,
    });

    tl.on('select', (props: { items: string[] }) => {
      const id = props.items?.[0];
      if (id) {
        setSelectedModelId(id);
        const m = visibleModels.find((x) => x.id === id);
        const prov = providerMap.get(m?.provider ?? 'openai');
        if (m) {
          emitOrbSignal({
            type: 'pin',
            color: prov?.color ?? '#3b82f6',
            intensity: 1.2,
            label: `${m.name} (${m.releaseDate})`,
          });
        }
      }
    });

    timelineRef.current = tl;

    return () => {
      tl.destroy();
      timelineRef.current = null;
    };
  }, [activeProviders, visibleModels, providerMap]);

  const zoomIn = () => timelineRef.current?.zoomIn(0.4);
  const zoomOut = () => timelineRef.current?.zoomOut(0.4);
  const fitAll = () => timelineRef.current?.fit({ animation: true });
  const focusToday = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 4, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 5, 1);
    timelineRef.current?.setWindow(start, end, { animation: true });
  };
  const focus2026_2027 = () => {
    timelineRef.current?.setWindow(new Date('2026-01-01'), new Date('2027-06-01'), {
      animation: true,
    });
  };

  const selectedModel = useMemo(
    () => visibleModels.find((m) => m.id === selectedModelId) ?? visibleModels[0] ?? null,
    [visibleModels, selectedModelId]
  );

  const selectedProvider = selectedModel ? providerMap.get(selectedModel.provider) : null;
  const selectedPower = selectedModel ? computePowerIndex(selectedModel, benchmarks) : 0;

  return (
    <div className="d-flex flex-column gap-3">
      {/* Header & Filters */}
      <div className="card">
        <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-3">
          <div>
            <h2 className="card-title d-flex align-items-center gap-2 mb-0">
              <Calendar size={18} className="text-primary" />
              Timeline Chronologique des Modèles LLM
            </h2>
            <div className="text-secondary small">
              Dates de publication réelles, repère <strong>Aujourd’hui</strong> (ligne verte) et feuille de route <strong>Futur 2027</strong> · Glisser pour panner, molette pour zoomer.
            </div>
          </div>

          <div className="d-flex flex-wrap align-items-center gap-2">
            {isAdmin && (
              <button
                className="btn btn-sm btn-outline-success d-inline-flex align-items-center gap-1"
                onClick={onTriggerHarvest}
                disabled={isHarvesting}
                title="Découvrir et importer les nouveaux modèles publiés via OpenRouter"
              >
                <RefreshCw size={13} className={isHarvesting ? 'spin' : ''} />
                {isHarvesting ? 'Moissonnage...' : 'Moissonner nouveaux modèles'}
              </button>
            )}

            <button
              className={`btn btn-sm ${showUpcoming ? 'btn-warning' : 'btn-outline-secondary'}`}
              onClick={() => setShowUpcoming((v) => !v)}
            >
              <Sparkles size={13} className="me-1" />
              Futur ({upcomingCount})
            </button>
          </div>
        </div>

        <div className="card-body py-3 d-flex flex-column gap-3">
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
            {/* Scope mode */}
            <div className="btn-group btn-group-sm" role="group">
              <button
                className={`btn ${filterMode === 'all' ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setFilterMode('all')}
              >
                Toutes les compagnies ({providers.length})
              </button>
              <button
                className={`btn ${filterMode === 'single' ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setFilterMode('single')}
              >
                1 Compagnie
              </button>
              <button
                className={`btn ${filterMode === 'pinned' ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setFilterMode('pinned')}
              >
                <Pin size={12} className="me-1" />
                Épinglées ({pinnedProviders.length})
              </button>
            </div>

            {/* Timeline Navigation Controls */}
            <div className="d-flex flex-wrap align-items-center gap-2">
              <button className="btn btn-sm btn-outline-success" onClick={focusToday}>
                <Clock size={13} className="me-1" />
                Aujourd’hui
              </button>
              <button className="btn btn-sm btn-outline-secondary" onClick={focus2026_2027}>
                <Focus size={13} className="me-1" />
                2026–2027
              </button>
              <div className="btn-group btn-group-sm">
                <button className="btn btn-outline-secondary" onClick={zoomIn} title="Zoomer">
                  <ZoomIn size={14} />
                </button>
                <button className="btn btn-outline-secondary" onClick={zoomOut} title="Dézoomer">
                  <ZoomOut size={14} />
                </button>
                <button className="btn btn-outline-secondary" onClick={fitAll} title="Tout afficher">
                  <RotateCcw size={13} className="me-1" />
                  Tout
                </button>
              </div>
            </div>
          </div>

          {/* Company chips for single or pinned selection */}
          {filterMode !== 'all' && (
            <div className="d-flex flex-wrap gap-2 align-items-center">
              <span className="text-secondary small me-1">
                {filterMode === 'single'
                  ? 'Sélectionnez une compagnie :'
                  : 'Cliquez pour épingler / désépingler des compagnies :'}
              </span>
              {providers.map((p) => {
                const isSelected =
                  filterMode === 'single'
                    ? singleProvider === p.id
                    : pinnedProviders.includes(p.id);
                const count = models.filter(
                  (m) => m.provider === p.id && (showUpcoming || m.status !== 'upcoming')
                ).length;

                return (
                  <button
                    key={p.id}
                    className={`btn btn-sm d-inline-flex align-items-center gap-1 ${
                      isSelected ? 'btn-primary' : 'btn-outline-secondary'
                    }`}
                    onClick={() => {
                      if (filterMode === 'single') setSingleProvider(p.id);
                      else togglePinnedProvider(p.id);
                    }}
                  >
                    <span
                      className="rounded-circle d-inline-block"
                      style={{ width: 8, height: 8, backgroundColor: p.color }}
                    />
                    {p.name}
                    <span className="badge bg-dark-lt ms-1">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Main vis-timeline Canvas */}
      <div className="card">
        <div className="card-body p-2">
          {activeProviders.length === 0 ? (
            <div className="p-5 text-center text-secondary">
              Épinglez au moins une compagnie ci-dessus pour afficher sa timeline.
            </div>
          ) : (
            <div ref={containerRef} />
          )}
        </div>
        <div className="card-footer d-flex flex-wrap justify-content-between align-items-center gap-2 small text-secondary">
          <div className="d-flex flex-wrap align-items-center gap-3">
            <span>
              <span className="text-success fw-bold">│</span> Aujourd’hui
            </span>
            <span>
              <span className="badge bg-yellow-lt text-yellow">FUTUR</span> Modèle roadmap 2027
            </span>
            <span>
              <span className="badge bg-green-lt text-green">LIVE</span> Découvert automatiquement par le moissonneur ({harvestedCount})
            </span>
          </div>
          <span className="font-mono">{visibleModels.length} modèles affichés</span>
        </div>
      </div>

      {/* Selected Model Detail Card */}
      {selectedModel && (
        <div
          className="card"
          style={{ borderLeft: `4px solid ${selectedProvider?.color ?? '#3b82f6'}` }}
        >
          <div className="card-body">
            <div className="row align-items-center g-3">
              <div className="col-lg-5">
                <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
                  <span className="h3 mb-0">{selectedModel.name}</span>
                  <span className="badge bg-primary-lt text-primary">
                    {selectedProvider?.name}
                  </span>
                  {selectedModel.status === 'upcoming' && (
                    <span className="badge bg-yellow-lt text-yellow">À venir (Roadmap)</span>
                  )}
                  {selectedModel.discoveredByHarvester && (
                    <span className="badge bg-green-lt text-green">Moissonné Live</span>
                  )}
                </div>
                <div className="text-secondary small">{selectedModel.positioning}</div>
                <div className="text-secondary small mt-1">{selectedModel.notes}</div>
              </div>

              <div className="col-lg-7">
                <div className="row g-2 font-mono">
                  <div className="col-6 col-sm-3">
                    <div className="subheader">Publication</div>
                    <div className="fw-semibold text-primary">
                      {formatDisplayDate(selectedModel.releaseDate)}
                    </div>
                  </div>
                  <div className="col-6 col-sm-3">
                    <div className="subheader">API ($/1M)</div>
                    <div>
                      {formatUsd(selectedModel.inputPricePer1M)} / {formatUsd(selectedModel.outputPricePer1M)}
                    </div>
                  </div>
                  <div className="col-6 col-sm-3">
                    <div className="subheader">Contexte</div>
                    <div>{formatContext(selectedModel.contextWindow)}</div>
                  </div>
                  <div className="col-6 col-sm-3">
                    <div className="subheader">Puissance / ARC-3</div>
                    <div>
                      {selectedPower > 0 ? `${selectedPower}/100` : 'En attente'}
                      {selectedModel.benchmarks.arc_agi_3?.score != null
                        ? ` · ${selectedModel.benchmarks.arc_agi_3.score}%`
                        : ''}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chronological Release Table */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title mb-0">
            Journal chronologique des publications ({visibleModels.length})
          </h3>
        </div>
        <div className="table-responsive" style={{ maxHeight: 360, overflowY: 'auto' }}>
          <table className="table table-vcenter card-table table-hover">
            <thead>
              <tr>
                <th>Date de publication</th>
                <th>Compagnie</th>
                <th>Modèle</th>
                <th>Génération / Statut</th>
                <th>Tarif API (In / Out)</th>
                <th>Contexte</th>
              </tr>
            </thead>
            <tbody>
              {visibleModels.map((m) => {
                const prov = providerMap.get(m.provider);
                const isSelected = m.id === selectedModel?.id;
                return (
                  <tr
                    key={m.id}
                    className={`cursor-pointer ${isSelected ? 'pinned-row' : ''}`}
                    onClick={() => {
                      setSelectedModelId(m.id);
                      timelineRef.current?.setSelection(m.id);
                      timelineRef.current?.focus(m.id);
                    }}
                  >
                    <td className="font-mono fw-semibold">{formatDisplayDate(m.releaseDate)}</td>
                    <td>
                      <span
                        className="rounded-circle d-inline-block me-2"
                        style={{ width: 8, height: 8, backgroundColor: prov?.color }}
                      />
                      {prov?.name}
                    </td>
                    <td className="fw-medium">{m.name}</td>
                    <td>
                      {m.status === 'upcoming' ? (
                        <span className="badge bg-yellow-lt text-yellow">À venir · {m.generationLabel}</span>
                      ) : m.discoveredByHarvester ? (
                        <span className="badge bg-green-lt text-green">Nouveau · Moissonné</span>
                      ) : (
                        <span className="badge bg-secondary-lt text-secondary">{m.generationLabel}</span>
                      )}
                    </td>
                    <td className="font-mono small">
                      {formatUsd(m.inputPricePer1M)} / {formatUsd(m.outputPricePer1M)}
                    </td>
                    <td className="font-mono small">{formatContext(m.contextWindow)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
