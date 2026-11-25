import { useEffect, useRef } from 'react';
import Plotly from 'plotly.js-dist-min';
import type { Config, Data, Layout, PlotMouseEvent, PlotlyHTMLElement } from 'plotly.js';

interface PlotlyChartProps {
  data: Data[];
  layout: Partial<Layout>;
  config?: Partial<Config>;
  height?: number;
  onPointClick?: (event: PlotMouseEvent) => void;
}

const DEFAULT_CONFIG: Partial<Config> = {
  responsive: true,
  scrollZoom: true,
  displayModeBar: true,
  displaylogo: false,
  modeBarButtonsToRemove: ['lasso2d', 'select2d'],
  doubleClick: 'reset',
};

export function PlotlyChart({
  data,
  layout,
  config,
  height = 360,
  onPointClick,
}: PlotlyChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const clickHandlerRef = useRef(onPointClick);
  clickHandlerRef.current = onPointClick;

  useEffect(() => {
    const el = containerRef.current as PlotlyHTMLElement | null;
    if (!el) return;

    const mergedLayout: Partial<Layout> = {
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(21, 30, 44, 0.45)',
      font: {
        family: 'Inter, system-ui, sans-serif',
        color: '#cbd5e1',
        size: 11,
      },
      hoverlabel: {
        bgcolor: '#1c2738',
        bordercolor: '#3b82f6',
        font: { family: 'Inter, system-ui, sans-serif', color: '#e2e8f0', size: 12 },
      },
      ...layout,
      height,
    };

    const mergedConfig: Partial<Config> = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    let active = true;
    Plotly.react(el, data, mergedLayout, mergedConfig).then(() => {
      if (!active) return;
      el.removeAllListeners?.('plotly_click');
      if (clickHandlerRef.current) {
        el.on('plotly_click', (evt: PlotMouseEvent) => {
          clickHandlerRef.current?.(evt);
        });
      }
    });

    return () => {
      active = false;
    };
  }, [data, layout, config, height]);

  useEffect(() => {
    const el = containerRef.current as PlotlyHTMLElement | null;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      Plotly.Plots.resize(el);
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      Plotly.purge(el);
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
