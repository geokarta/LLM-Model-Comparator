import { useMemo, useState } from 'react';
import { BookOpen, ExternalLink, Layers, ShieldAlert, Trophy } from 'lucide-react';
import { BenchmarkDefinition, BenchmarkId, LLMModel, ProviderMeta } from '../../shared/types.ts';
import { formatUsd } from '../../shared/metrics.ts';

interface BenchmarkCodexProps {
  benchmarks: BenchmarkDefinition[];
  models: LLMModel[];
  providers: ProviderMeta[];
  highlightedId: BenchmarkId | null;
}

export function BenchmarkCodex({
  benchmarks,
  models,
  providers,
  highlightedId,
}: BenchmarkCodexProps) {
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  const providerMap = useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers]
  );

  const categories = useMemo(
    () => ['ALL', ...Array.from(new Set(benchmarks.map((b) => b.category)))],
    [benchmarks]
  );

  const filtered = useMemo(
    () =>
      categoryFilter === 'ALL'
        ? benchmarks
        : benchmarks.filter((b) => b.category === categoryFilter),
    [benchmarks, categoryFilter]
  );

  return (
    <div className="d-flex flex-column gap-3">
      <div className="card">
        <div className="card-body d-flex flex-wrap align-items-center justify-content-between gap-3">
          <div>
            <h2 className="h3 mb-1 d-flex align-items-center gap-2">
              <BookOpen size={18} className="text-primary" />
              Codex des Benchmarks ({benchmarks.length} étalons)
            </h2>
            <div className="text-secondary small">
              Explication détaillée de chaque benchmark (ARC-AGI 1/2/3, SWE-bench, HLE, GPQA, etc.), méthodologie et niveau de saturation.
            </div>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            {categories.map((cat) => (
              <button
                key={cat}
                className={`btn btn-sm ${categoryFilter === cat ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat === 'ALL' ? 'Tous' : cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="row row-deck row-cards">
        {filtered.map((bench) => {
          const top5 = [...models]
            .filter((m) => m.benchmarks[bench.id]?.score !== null && m.benchmarks[bench.id]?.score !== undefined)
            .sort((a, b) => (b.benchmarks[bench.id]?.score ?? 0) - (a.benchmarks[bench.id]?.score ?? 0))
            .slice(0, 5);

          const isHighlighted = highlightedId === bench.id;
          const satBadge =
            bench.saturationLevel === 'Faible (Frontière)'
              ? 'bg-green-lt text-green'
              : bench.saturationLevel === 'Modérée'
                ? 'bg-yellow-lt text-yellow'
                : 'bg-red-lt text-red';

          return (
            <div key={bench.id} className="col-lg-6">
              <div
                className={`card h-100 ${isHighlighted ? 'border-primary' : ''}`}
                style={isHighlighted ? { boxShadow: '0 0 0 1px #3b82f6' } : undefined}
              >
                <div className="card-header d-flex justify-content-between align-items-start gap-2">
                  <div>
                    <div className="subheader text-primary">
                      {bench.category} · Poids {Math.round(bench.weight * 100)}%
                    </div>
                    <h3 className="card-title mb-0 mt-1">{bench.name}</h3>
                  </div>
                  <span className={`badge ${satBadge}`}>
                    Saturation : {bench.saturationLevel}
                  </span>
                </div>

                <div className="card-body d-flex flex-column gap-3">
                  <p className="mb-0">{bench.summary}</p>

                  <div
                    className="p-3 rounded border small d-flex flex-column gap-2"
                    style={{ backgroundColor: 'rgba(21,30,44,0.55)' }}
                  >
                    <div>
                      <strong className="text-primary">
                        <Layers size={13} className="me-1" />
                        Ce qu’il mesure :
                      </strong>{' '}
                      <span className="text-secondary">{bench.whatItMeasures}</span>
                    </div>
                    <div>
                      <strong className="text-success">
                        <ShieldAlert size={13} className="me-1" />
                        Pourquoi c’est important :
                      </strong>{' '}
                      <span className="text-secondary">{bench.whyItMatters}</span>
                    </div>
                    <div>
                      <strong className="text-warning">Méthodologie :</strong>{' '}
                      <span className="text-secondary">{bench.methodology}</span>
                    </div>
                  </div>

                  <div>
                    <div className="subheader mb-2 d-flex align-items-center gap-1">
                      <Trophy size={13} className="text-warning" />
                      Top 5 actuel sur {bench.shortName}
                    </div>
                    <div className="list-group list-group-flush border rounded overflow-hidden">
                      {top5.map((m, idx) => {
                        const entry = m.benchmarks[bench.id];
                        const prov = providerMap.get(m.provider);
                        return (
                          <div
                            key={m.id}
                            className="list-group-item d-flex justify-content-between align-items-center py-2 px-3"
                            style={{
                              backgroundColor: 'rgba(21,30,44,0.45)',
                              borderLeft: `3px solid ${prov?.color ?? '#3b82f6'}`,
                            }}
                          >
                            <span className="small">
                              <span className="text-secondary font-mono me-2">#{idx + 1}</span>
                              <span className="fw-medium">{m.name}</span>
                            </span>
                            <span className="d-flex align-items-center gap-3 font-mono small">
                              {bench.hasCostPerTask && entry?.costPerTaskUsd != null && (
                                <span className="text-warning">{formatUsd(entry.costPerTaskUsd)}/t</span>
                              )}
                              <span className="fw-semibold text-primary">
                                {bench.unit === 'Elo'
                                  ? `${entry?.score} Elo`
                                  : `${entry?.score?.toFixed(1)}%`}
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="card-footer">
                  <a
                    href={bench.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="link-primary small d-inline-flex align-items-center gap-1"
                  >
                    Source officielle : {bench.sourceName}
                    <ExternalLink size={13} />
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
