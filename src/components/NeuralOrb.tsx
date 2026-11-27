import { useEffect, useRef, useState } from 'react';
import { OrbSignalDetail, emitOrbSignal } from '../utils/orbBus.ts';

interface NeuralOrbProps {
  isHarvesting: boolean;
  pinnedCount: number;
  accentColor?: string;
}

interface Shockwave {
  radius: number;
  alpha: number;
  color: string;
}

interface Particle {
  theta: number;
  phi: number;
  speed: number;
  size: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return [59, 130, 246];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function NeuralOrb({ isHarvesting, pinnedCount, accentColor = '#3b82f6' }: NeuralOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [statusLabel, setStatusLabel] = useState<string>('En ligne');
  const [minimized, setMinimized] = useState(false);

  const stateRef = useRef({
    energy: 0.28,
    currentRgb: hexToRgb(accentColor),
    targetRgb: hexToRgb(accentColor),
    mouseX: 0,
    mouseY: 0,
    harvesting: isHarvesting,
    pinnedCount,
    shockwaves: [] as Shockwave[],
    labelTimeout: 0 as number | ReturnType<typeof setTimeout>,
  });

  useEffect(() => {
    stateRef.current.harvesting = isHarvesting;
    if (isHarvesting) {
      stateRef.current.targetRgb = hexToRgb('#10b981');
      setStatusLabel('Moissonnage...');
    }
  }, [isHarvesting, pinnedCount]);

  useEffect(() => {
    stateRef.current.targetRgb = hexToRgb(accentColor);
  }, [accentColor]);

  useEffect(() => {
    const onSignal = (e: Event) => {
      const detail = (e as CustomEvent<OrbSignalDetail>).detail;
      if (!detail) return;
      const st = stateRef.current;

      const boost = detail.intensity ?? 1.1;
      st.energy = Math.min(2.2, st.energy + boost * 0.55);

      if (detail.color) {
        st.targetRgb = hexToRgb(detail.color);
      }

      st.shockwaves.push({
        radius: 14,
        alpha: 0.75,
        color: detail.color ?? '#3b82f6',
      });

      if (detail.label) {
        setStatusLabel(detail.label);
        clearTimeout(st.labelTimeout);
        st.labelTimeout = setTimeout(() => {
          if (!st.harvesting) {
            setStatusLabel(`${st.pinnedCount} épinglé${st.pinnedCount > 1 ? 's' : ''}`);
          }
        }, 2500);
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      stateRef.current.mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
      stateRef.current.mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    };

    window.addEventListener('aether:orb', onSignal);
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    return () => {
      window.removeEventListener('aether:orb', onSignal);
      window.removeEventListener('mousemove', onMouseMove);
      clearTimeout(stateRef.current.labelTimeout);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = minimized ? 58 : 96;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const particles: Particle[] = Array.from({ length: 28 }, (_, i) => ({
      theta: Math.acos(1 - (2 * (i + 0.5)) / 28),
      phi: Math.PI * (1 + Math.sqrt(5)) * i,
      speed: 0.006 + (i % 4) * 0.0025,
      size: 1 + (i % 2) * 0.6,
    }));

    let rafId = 0;
    let time = 0;

    const render = () => {
      const st = stateRef.current;
      const cx = size / 2;
      const cy = size / 2;
      const baseR = minimized ? 16 : 25;

      const idleTarget = st.harvesting ? 1.8 : 0.28 + Math.min(st.pinnedCount, 5) * 0.05;
      st.energy += (idleTarget - st.energy) * 0.045;
      for (let i = 0; i < 3; i++) {
        st.currentRgb[i] += (st.targetRgb[i] - st.currentRgb[i]) * 0.07;
      }

      const [r, g, b] = st.currentRgb.map((v) => Math.round(v));
      const rgbStr = `${r}, ${g}, ${b}`;

      time += 0.015 + st.energy * 0.022;
      ctx.clearRect(0, 0, size, size);

      const ox = cx + st.mouseX * (minimized ? 1.5 : 3.5);
      const oy = cy + st.mouseY * (minimized ? 1.5 : 3.5);

      // Soft ambient glow
      const haloR = baseR * (1.65 + Math.sin(time * 1.8) * 0.06 + st.energy * 0.1);
      const halo = ctx.createRadialGradient(ox, oy, baseR * 0.2, ox, oy, haloR);
      halo.addColorStop(0, `rgba(${rgbStr}, ${0.26 + st.energy * 0.08})`);
      halo.addColorStop(0.6, `rgba(${rgbStr}, 0.08)`);
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(ox, oy, haloR, 0, Math.PI * 2);
      ctx.fill();

      // Shockwaves
      for (let i = st.shockwaves.length - 1; i >= 0; i--) {
        const sw = st.shockwaves[i];
        sw.radius += 1.3 + st.energy * 0.5;
        sw.alpha *= 0.93;
        if (sw.alpha < 0.03 || sw.radius > size * 0.52) {
          st.shockwaves.splice(i, 1);
          continue;
        }
        const [sr, sg, sb] = hexToRgb(sw.color);
        ctx.strokeStyle = `rgba(${sr}, ${sg}, ${sb}, ${sw.alpha})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(ox, oy, sw.radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Subtle glass ring
      ctx.save();
      ctx.translate(ox, oy);
      ctx.rotate(time * 0.7);
      ctx.scale(1, 0.42);
      ctx.strokeStyle = `rgba(${rgbStr}, 0.42)`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(0, 0, baseR * 1.25, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Smooth core sphere
      const pulseR = baseR * (0.72 + Math.sin(time * 2.2) * 0.04 + st.energy * 0.04);
      const core = ctx.createRadialGradient(
        ox - pulseR * 0.3,
        oy - pulseR * 0.3,
        2,
        ox,
        oy,
        pulseR
      );
      core.addColorStop(0, 'rgba(255,255,255,0.95)');
      core.addColorStop(0.4, `rgba(${rgbStr}, 0.85)`);
      core.addColorStop(1, `rgba(${rgbStr}, 0.15)`);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(ox, oy, pulseR, 0, Math.PI * 2);
      ctx.fill();

      // Orbiting particles
      for (const p of particles) {
        p.phi += p.speed * (1 + st.energy * 1.4);
        const x3 = Math.sin(p.theta) * Math.cos(p.phi);
        const y3 = Math.cos(p.theta);
        const z3 = Math.sin(p.theta) * Math.sin(p.phi);
        const depth = (z3 + 1.35) / 2.35;
        ctx.fillStyle = `rgba(${rgbStr}, ${0.22 + depth * 0.65})`;
        ctx.beginPath();
        ctx.arc(ox + x3 * baseR * 0.96, oy + y3 * baseR * 0.96, p.size * (0.6 + depth * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [minimized]);

  return (
    <div
      className="neural-orb-container"
      style={{
        position: 'fixed',
        right: 18,
        bottom: 18,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        userSelect: 'none',
      }}
    >
      <div
        onClick={() => {
          emitOrbSignal({
            type: 'click',
            color: accentColor,
            intensity: 1.2,
            label: minimized ? 'Orb déployé' : 'Impulsion',
          });
          setMinimized((m) => !m);
        }}
        title="Cliquez pour réduire ou agrandir l'orb réactif"
        style={{
          cursor: 'pointer',
          borderRadius: '50%',
          background: 'rgba(28, 39, 56, 0.72)',
          border: '1px solid rgba(148, 163, 184, 0.2)',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 6px 20px rgba(0, 0, 0, 0.28)',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: minimized ? 58 : 96,
            height: minimized ? 58 : 96,
            display: 'block',
          }}
        />
      </div>

      {!minimized && (
        <span
          className="badge bg-dark-lt text-secondary border mt-1 shadow-sm"
          style={{
            backgroundColor: '#1c2738',
            maxWidth: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontSize: '0.68rem',
          }}
        >
          {statusLabel}
        </span>
      )}
    </div>
  );
}
