import { ChunkCollisionData } from '../core/types';

// ============================================
// Configuration Types
// ============================================

/**
 * Configuration options for TerrainPhysics.
 */
export interface TerrainPhysicsConfig {
  /** Friction coefficient for terrain colliders (default: 0.7) */
  friction?: number;
  /** Restitution / bounciness coefficient (default: 0.0) */
  restitution?: number;
  /** Collision groups packed bitmask (default: 0xFFFFFFFF) */
  collisionGroups?: number;
  /** Solver groups packed bitmask (default: 0xFFFFFFFF) */
  solverGroups?: number;
  /**
   * Use dynamic LOD-based collider loading/unloading (default: true).
   * When true, colliders are added/removed as chunks enter/exit LOD0.
   * When false, all colliders are pre-created at init time.
   */
  dynamicLoading?: boolean;
  /** Maximum number of simultaneous active colliders (default: 64) */
  maxActiveColliders?: number;
}

/**
 * Resolved configuration with all required fields.
 */
export interface ResolvedTerrainPhysicsConfig {
  friction: number;
  restitution: number;
  collisionGroups: number;
  solverGroups: number;
  dynamicLoading: boolean;
  maxActiveColliders: number;
}

// ============================================
// Runtime Types
// ============================================

/**
 * Tracks a single chunk's Rapier collider state.
 */
export interface ChunkPhysicsEntry {
  /** Handle of the collider inside the Rapier World. */
  collider: any;
  /** Handle of the fixed rigidbody this collider is attached to. */
  body: any;
  /** The collision data used to build this collider. */
  data: ChunkCollisionData;
}

/**
 * Result of a ray-cast against the terrain.
 */
export interface TerrainRayHit {
  /** World-space hit point. */
  point: { x: number; y: number; z: number };
  /** World-space surface normal at hit point. */
  normal: { x: number; y: number; z: number };
  /** Distance along the ray (time of impact). */
  toi: number;
  /** Grid index of the chunk that was hit. */
  chunkIndex: { x: number; z: number } | null;
}

/**
 * Initialization bundle passed to TerrainPhysics.
 *
 * Decoupling the Rapier module reference from a static import avoids
 * initialization-order issues and lets consumers use either ESM or the
 * compat (UMD) bundle.
 */
export interface TerrainPhysicsInit {
  /** The Rapier namespace returned after `await RAPIER.init()`. */
  rapier: any;
  /** A Rapier World that the caller owns and steps each frame. */
  world: any;
  /** The terrain LOD instance whose collision data drives the colliders. */
  terrain: import('../core/TerrainLOD').TerrainLOD;
  /** Optional physics configuration. */
  config?: TerrainPhysicsConfig;
}
