const prefix = 'autonex_working_snapshot:';

export interface WorkingSnapshot {
  projectId: string;
  files: Record<string, string>;
  baseCheckpointId: string | null;
  updatedAt: string;
}

export function loadWorkingSnapshot(projectId: string): WorkingSnapshot | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(prefix + projectId);
    return raw ? JSON.parse(raw) as WorkingSnapshot : null;
  } catch (error) {
    console.warn('[Checkpoint] Failed to load local working snapshot:', error);
    return null;
  }
}

export function saveWorkingSnapshot(
  projectId: string,
  files: Record<string, string>,
  baseCheckpointId: string | null
): WorkingSnapshot {
  const snapshot: WorkingSnapshot = {
    projectId,
    files: { ...files },
    baseCheckpointId,
    updatedAt: new Date().toISOString(),
  };
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(prefix + projectId, JSON.stringify(snapshot));
    } catch (error) {
      throw new Error(`Unable to persist local working snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return snapshot;
}

export function hasWorkingChanges(
  files: Record<string, string>,
  baseline: Record<string, string> | null
): boolean {
  if (!baseline) return false;
  const currentKeys = Object.keys(files);
  const baselineKeys = Object.keys(baseline);
  return currentKeys.length !== baselineKeys.length ||
    currentKeys.some((key) => files[key] !== baseline[key]);
}
