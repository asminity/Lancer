/**
 * AUTONEX Checkpoint Engine: File Exclusion & Sanitization Policy
 *
 * Implements strict, auditable exclusion rules to prevent security credential leaks
 * and unnecessary dependency/cache bloating into decentralized archives.
 */

export interface ExclusionRule {
  id: string;
  category: 'secrets' | 'dependencies' | 'build_outputs' | 'caches' | 'git_internals' | 'backups';
  description: string;
  pattern: RegExp;
}

export const DEFAULT_EXCLUSION_RULES: ExclusionRule[] = [
  // 1. Secrets & Private Keys
  {
    id: 'secrets_env',
    category: 'secrets',
    description: 'Environment variable files containing potential secrets or credentials',
    pattern: /(^|\/)\.env(\..+)?$/i,
  },
  {
    id: 'secrets_keys',
    category: 'secrets',
    description: 'Cryptographic private keys, certificates, or keystores',
    pattern: /\.(pem|key|pkcs12|p12|pfx|keystore|secret)$/i,
  },
  {
    id: 'secrets_ssh',
    category: 'secrets',
    description: 'SSH private identity credentials',
    pattern: /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)($|\.)/i,
  },

  // 2. Package Managers & Dependency Trees
  {
    id: 'deps_node_modules',
    category: 'dependencies',
    description: 'Node.js dependency packages directory',
    pattern: /(^|\/)node_modules(\/|$)/i,
  },
  {
    id: 'deps_python_venv',
    category: 'dependencies',
    description: 'Python virtual environment directory',
    pattern: /(^|\/)(\.venv|venv|env)(\/|$)/i,
  },
  {
    id: 'deps_pnpm_store',
    category: 'dependencies',
    description: 'PNPM package store cache',
    pattern: /(^|\/)\.pnpm-store(\/|$)/i,
  },

  // 3. Build & Compiler Outputs
  {
    id: 'build_dist',
    category: 'build_outputs',
    description: 'Production compiled bundle output directory',
    pattern: /(^|\/)(dist|build|out|\.next|\.turbo)(\/|$)/i,
  },
  {
    id: 'build_pycache',
    category: 'build_outputs',
    description: 'Python compiled bytecode caches',
    pattern: /(^|\/)__pycache__(\/|$)|(\.pyc|\.pyo)$/i,
  },

  // 4. Temporary Files & OS Caches
  {
    id: 'cache_temp',
    category: 'caches',
    description: 'Temporary or cache files and editor swap files',
    pattern: /\.(tmp|temp|swp|swo|log)$/i,
  },
  {
    id: 'cache_os',
    category: 'caches',
    description: 'Operating system thumbnail and metadata caches',
    pattern: /(^|\/)(\.DS_Store|Thumbs\.db|ehthumbs\.db)$/i,
  },

  // 5. Version Control Internals
  {
    id: 'vcs_git',
    category: 'git_internals',
    description: 'Git repository internal database',
    pattern: /(^|\/)\.git(\/|$)/i,
  },

  // 6. Checkpoint Engine Artifacts & Safety Backups
  {
    id: 'engine_internal',
    category: 'backups',
    description: 'Checkpoint Engine locks, staging dirs, and safety backups',
    pattern: /(^|\/)(\.autonex_backup.*|\.autonex_lock|\.autonex_staging.*)(\/|$)/i,
  },
];

export interface ExclusionCheckResult {
  excluded: boolean;
  rule?: string;
  reason?: string;
}

/**
 * Normalizes any Windows or POSIX relative path to strict POSIX format without leading/trailing slashes.
 */
export function normalizeRelativePath(relPath: string): string {
  return relPath
    .replace(/\\/g, '/')
    .replace(/^\.?\/+/, '')
    .replace(/\/+$/, '')
    .trim();
}

/**
 * Evaluates whether a file or directory should be excluded from the archive.
 */
export function evaluateExclusion(
  normalizedPath: string,
  isDirectory: boolean,
  customExclusionPatterns?: string[]
): ExclusionCheckResult {
  const testPath = isDirectory ? `${normalizedPath}/` : normalizedPath;

  // 1. Check custom exclusion patterns if provided
  if (customExclusionPatterns && customExclusionPatterns.length > 0) {
    for (const pat of customExclusionPatterns) {
      if (testPath.includes(pat) || normalizedPath === pat) {
        return {
          excluded: true,
          rule: 'custom_exclusion',
          reason: `Matched custom exclusion pattern: "${pat}"`,
        };
      }
    }
  }

  // 2. Check default exclusion rules
  for (const rule of DEFAULT_EXCLUSION_RULES) {
    if (rule.pattern.test(testPath) || rule.pattern.test(normalizedPath)) {
      return {
        excluded: true,
        rule: rule.id,
        reason: rule.description,
      };
    }
  }

  return { excluded: false };
}

