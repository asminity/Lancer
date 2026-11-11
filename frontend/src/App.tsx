import { useEffect } from 'react';
import { useStore } from '@/state/store';
import { Landing } from '@/ui/Landing';
import { Workspace } from '@/ui/Workspace';
import { ArkivHistoryModal } from '@/ui/ArkivHistoryModal';
import { ErrorCheckpointModal } from '@/ui/ErrorCheckpointModal';
import { IAICreditOptimizationDemo } from '@/ui/IAICreditOptimizationDemo';
import { MODELS } from '@/mock/data';
import { apiUrl, USE_MOCK } from '@/api/client';
import { setAccent, resetAccentBlend } from '@/three/materials';
import { engine, GOLDEN_GOAL } from '@/state/engine';
import { validateLayout } from '@/nav/validate';
import { GRID } from '@/nav/grid';
import { buildHallLayout } from '@/swarm/hallLayout';
import { validateHall } from '@/swarm/validateHall';

export default function App() {
  const phase = useStore((s) => s.phase);
  const appMode = useStore((s) => s.appMode);
  const swarmSize = useStore((s) => s.swarmSize);
  const arkivHistoryOpen = useStore((s) => s.arkivHistoryOpen);

  useEffect(() => {
    // startup validator — the app refuses to run on an invalid layout
    const errs = validateLayout(GRID);
    if (errs.length) throw new Error('Layout validation failed:\n' + errs.join('\n'));
    if ((import.meta as any).env?.DEV) {
      for (const n of [10, 20, 30, 40, 50] as const) {
        const issues = validateHall(buildHallLayout(n));
        if (issues.length) console.warn(`[swarm] hall validation warning for N=${n}:`, issues);
      }
    }
  }, []);

  useEffect(() => {
    if (appMode === 'swarm' && phase === 'landing') {
      import('@/swarm/directorRef').then(({ rebuildSwarmDirector }) => {
        rebuildSwarmDirector(swarmSize);
      });
    }
  }, [appMode, swarmSize, phase]);

  useEffect(() => {
    // brand color -> materials + CSS vars
    const hex = useStore.getState().accent;
    document.documentElement.style.setProperty('--accent', hex);
    setAccent(hex); resetAccentBlend();
    fetch(apiUrl('/api/models'))
      .then((r) => r.json())
      .then((models) => useStore.setState({ models: Array.isArray(models) && models.length ? models : MODELS, demoMode: false, offline: false }))
      .catch(() => useStore.setState({ models: MODELS, demoMode: false }));
  }, []);

  return (
    <div className="h-full w-full">
      {phase === 'landing' ? <Landing /> : <Workspace />}
      <ArkivHistoryModal
        open={arkivHistoryOpen}
        onClose={() => useStore.setState({ arkivHistoryOpen: false })}
      />
      <ErrorCheckpointModal />
      <IAICreditOptimizationDemo />
    </div>
  );
}
