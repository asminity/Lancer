/**
 * Swarm / Bee Client Configuration
 *
 * Configures the connection to Ethereum Swarm (Bee node or public gateway)
 * for decentralized, content-addressed storage of large context/report files.
 */

export interface SwarmConfig {
  gatewayUrl: string;
  postageBatchId: string;
  timeoutMs: number;
}

const inMemoryStorage = new Map<string, { content: string; contentType: string; timestamp: number }>();

export interface SwarmStorageAdapter {
  get(key: string): { content: string; contentType: string; timestamp: number } | undefined;
  set(key: string, value: { content: string; contentType: string; timestamp: number }): void;
  has(key: string): boolean;
  clear(): void;
}

export const getSwarmConfig = (): SwarmConfig => {
  const env = (import.meta as any).env || {};
  return {
    gatewayUrl: env.VITE_SWARM_GATEWAY_URL || 'https://api.gateway.ethswarm.org',
    postageBatchId: env.VITE_SWARM_POSTAGE_BATCH_ID || '',
    timeoutMs: Number(env.VITE_SWARM_TIMEOUT_MS) || 15000,
  };
};

/**
 * Dual in-memory + localStorage persistent storage adapter.
 * Ensures uploaded context files remain available across page reloads and browser sessions.
 */
export const getFallbackStorage = (): SwarmStorageAdapter => ({
  get(key: string) {
    if (inMemoryStorage.has(key)) return inMemoryStorage.get(key);
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(`autonex_swarm_${key}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          inMemoryStorage.set(key, parsed);
          return parsed;
        }
      } catch {}
    }
    return undefined;
  },
  set(key: string, value) {
    inMemoryStorage.set(key, value);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(`autonex_swarm_${key}`, JSON.stringify(value));
      } catch {}
    }
  },
  has(key: string) {
    if (inMemoryStorage.has(key)) return true;
    if (typeof localStorage !== 'undefined') {
      try {
        return localStorage.getItem(`autonex_swarm_${key}`) !== null;
      } catch {}
    }
    return false;
  },
  clear() {
    inMemoryStorage.clear();
    if (typeof localStorage !== 'undefined') {
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith('autonex_swarm_')) keysToRemove.push(k);
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
      } catch {}
    }
  },
});
