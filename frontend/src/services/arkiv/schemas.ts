import { defineSchema, str, addr, u64, dec, bool, bytes } from '@arkiv-network/sdk';

/**
 * 1. autonex.run
 * Represents top-level project execution record on Arkiv Rabdi DB-Chain.
 * Stamped with the user's connected wallet as owner.
 */
export const RunSchema = defineSchema('autonex.run', {
  run_id: str().indexed(),
  owner: addr().indexed(),
  task_class: str().indexed(),
  mode: str().indexed(),
  status: str().indexed(),
  created_at: u64().indexed(),
  goal_summary: str(),
  total_tokens: u64().optional(),
  duration_s: u64().optional(),
  dag_json: bytes().optional(),
});

/**
 * 2. autonex.swarm_round
 * Represents multi-phase deliberation consensus proof, quorum agreement,
 * and top-3 Borda ballots.
 */
export const SwarmRoundSchema = defineSchema('autonex.swarm_round', {
  run_id: str().indexed(),
  round: u64().indexed(),
  swarm_size: u64().indexed(),
  agreement: dec().indexed(),
  moderator: str(),
  clusters_cnt: u64(),
  ballots_cnt: u64(),
  veto_triggered: bool(),
  consensus_json: bytes(),
});

/**
 * 3. autonex.deliverable
 * Stores the synthesized multi-file software solution, project README,
 * and automated test pass assertions.
 */
export const DeliverableSchema = defineSchema('autonex.deliverable', {
  run_id: str().indexed(),
  owner: addr().indexed(),
  project_slug: str().indexed(),
  l2_tests_pass: bool().indexed(),
  l3_score: dec().indexed(),
  file_count: u64(),
  total_lines: u64(),
  bundle_bytes: bytes(),
  report_md: bytes(),
});

/**
 * 4. autonex.audit_log
 * Immutable record of human-in-the-loop security authorization decisions.
 */
export const AuditLogSchema = defineSchema('autonex.audit_log', {
  run_id: str().indexed(),
  operator: addr().indexed(),
  action: str().indexed(),
  decision: str().indexed(),
  agent_id: str(),
  timestamp: u64(),
  resource: str(),
  diff_preview: bytes().optional(),
});

/**
 * 5. autonex.user
 * Represents user identity and wallet registration on Arkiv.
 */
export const UserSchema = defineSchema('autonex.user', {
  user_id: str().indexed(),
  wallet: addr().indexed(),
  display_name: str(),
  created_at: u64().indexed(),
});

/**
 * 6. autonex.project
 * Represents a user's engineering project and metadata.
 */
export const ProjectSchema = defineSchema('autonex.project', {
  project_id: str().indexed(),
  user_id: str().indexed(),
  owner: addr().indexed(),
  name: str().indexed(),
  status: str().indexed(),
  created_at: u64().indexed(),
  description: str().optional(),
});

/**
 * 7. autonex.context_ref
 * Primary metadata pointer linking user/project/report to Ethereum Swarm content address.
 */
export const ContextRefSchema = defineSchema('autonex.context_ref', {
  report_id: str().indexed(),
  project_id: str().indexed(),
  user_id: str().indexed(),
  owner: addr().indexed(),
  storage_provider: str().indexed(), // e.g. 'swarm'
  swarm_ref: str().indexed(),        // 64-char Swarm BZZ content reference
  content_hash: str().indexed(),     // SHA-256 hash
  file_name: str(),
  content_type: str(),
  file_size: u64(),
  created_at: u64().indexed(),
  summary: str().optional(),
});

/**
 * 8. autonex.checkpoint_v2
 * Checkpoint Engine Schema anchoring archive and context references on Arkiv Rabdi DB-Chain.
 */
export const CheckpointV2Schema = defineSchema('autonex.checkpoint_v2', {
  checkpoint_id: str().indexed(),
  project_id: str().indexed(),
  parent_checkpoint_id: str().optional(),
  agent_task_id: str().optional(),
  owner: addr().indexed(),
  run_id: str().indexed(),
  status: str().indexed(),          // 'In Progress' | 'Interrupted' | 'Completed'
  lifecycle_status: str().indexed(),// 'PENDING' | 'UPLOADING' | 'COMPLETED' | 'FAILED'
  created_at: u64().indexed(),
  swarm_archive_ref: str().indexed(),
  archive_sha256: str().indexed(),
  archive_bytes_size: u64(),
  swarm_context_ref: str().indexed(),
  context_sha256: str().indexed(),
  context_bytes_size: u64(),
  encryption_iv: str().optional(),
  cipher_auth_tag: str().optional(),
  context_encryption_iv: str().optional(),
  context_auth_tag: str().optional(),
  file_count: u64(),
  storage_provider: str().indexed(),
  schema_version: str(),
  description: str().optional(),
  manifest_json: bytes().optional(),
  is_active: bool().indexed(),
});
