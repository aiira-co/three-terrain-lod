import { TerrainLOD } from '../core/TerrainLOD';
import {
  ChunkCollisionData,
  ChunkCollisionCallback,
} from '../core/types';
import {
  TerrainPhysicsConfig,
  ResolvedTerrainPhysicsConfig,
  ChunkPhysicsEntry,
  TerrainRayHit,
  TerrainPhysicsInit,
} from './types';
import { HeightfieldBuilder } from './HeightfieldBuilder';

export class TerrainPhysics {
  private terrain: TerrainLOD;
  private rapier: any;
  private world: any;
  private config: ResolvedTerrainPhysicsConfig;
  private activeColliders: Map<string, ChunkPhysicsEntry> = new Map();
  private initialized = false;
  private collisionCallback: ChunkCollisionCallback | null = null;

  constructor(init: TerrainPhysicsInit) {
    this.terrain = init.terrain;
    this.rapier = init.rapier;
    this.world = init.world;

    const cfg = init.config ?? {};
    this.config = {
      friction: cfg.friction ?? 0.7,
      restitution: cfg.restitution ?? 0.0,
      collisionGroups: cfg.collisionGroups ?? 0xffffffff,
      solverGroups: cfg.solverGroups ?? 0xffffffff,
      dynamicLoading: cfg.dynamicLoading ?? true,
      maxActiveColliders: cfg.maxActiveColliders ?? 64,
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    await this.terrain.init();
    await this.terrain.computeAllCollisionData();

    const allData = this.terrain.getAllCollisionData();

    if (this.config.dynamicLoading) {
      this.collisionCallback = {
        onChunkEnterLOD0: (data: ChunkCollisionData) => {
          this.addChunkCollider(data);
        },
        onChunkExitLOD0: (index: { x: number; z: number }) => {
          this.removeChunkCollider(index.x, index.z);
        },
      };
      this.terrain.setCollisionCallback(this.collisionCallback);
    }

    for (const [, data] of allData) {
      this.addChunkCollider(data);
    }

    this.initialized = true;
  }

  private addChunkCollider(data: ChunkCollisionData): void {
    const key = HeightfieldBuilder.chunkKeyFromData(data);
    if (this.activeColliders.has(key)) return;

    if (this.activeColliders.size >= this.config.maxActiveColliders) {
      console.warn(
        `TerrainPhysics: max active colliders (${this.config.maxActiveColliders}) reached, skipping chunk ${key}`
      );
      return;
    }

    const built = HeightfieldBuilder.build(data);

    const desc = this.rapier.ColliderDesc.heightfield(
      built.nrows,
      built.ncols,
      built.heights,
      { x: built.scale.x, y: built.scale.y, z: built.scale.z }
    )
      .setFriction(this.config.friction)
      .setRestitution(this.config.restitution)
      .setCollisionGroups(this.config.collisionGroups)
      .setSolverGroups(this.config.solverGroups);

    const bodyDesc = this.rapier.RigidBodyDesc.fixed()
      .setTranslation(data.position.x, data.position.y, data.position.z);
    const body = this.world.createRigidBody(bodyDesc);
    const collider = this.world.createCollider(desc, body);

    this.activeColliders.set(key, { collider, body, data });
  }

  private removeChunkCollider(chunkX: number, chunkZ: number): void {
    const key = HeightfieldBuilder.chunkKey(chunkX, chunkZ);
    const entry = this.activeColliders.get(key);
    if (!entry) return;

    this.world.removeRigidBody(entry.body);
    this.activeColliders.delete(key);
  }

  rebuildChunk(chunkX: number, chunkZ: number): void {
    this.removeChunkCollider(chunkX, chunkZ);
    const data = this.terrain.getChunkCollisionData(chunkX, chunkZ);
    if (data) {
      this.addChunkCollider(data);
    }
  }

  rebuildDirtyChunks(): void {
    const dirtyKeys = this.terrain.getDirtyCollisionChunkKeys();
    for (const key of dirtyKeys) {
      const [x, z] = key.split('_').map(Number);
      this.rebuildChunk(x, z);
    }
    this.terrain.clearDirtyRegions();
  }

  getHeightAt(worldX: number, worldZ: number): number {
    return this.terrain.getHeightAt(worldX, worldZ);
  }

  castRay(
    origin: { x: number; y: number; z: number },
    direction: { x: number; y: number; z: number },
    maxToi = 1000
  ): TerrainRayHit | null {
    const ray = new this.rapier.Ray(origin, direction);
    const hit = this.world.castRay(ray, maxToi, true);

    if (!hit) return null;

    const point = ray.pointAt(hit.toi);
    const normal = hit.collider
      ? this.world.castRayAndGetNormal(ray, maxToi, true)
      : null;

    let chunkIndex: { x: number; z: number } | null = null;
    if (hit.collider) {
      for (const [key, entry] of this.activeColliders) {
        if (entry.collider === hit.collider) {
          chunkIndex = entry.data.index;
          break;
        }
      }
    }

    return {
      point: { x: point.x, y: point.y, z: point.z },
      normal: normal
        ? { x: normal.normal.x, y: normal.normal.y, z: normal.normal.z }
        : { x: 0, y: 1, z: 0 },
      toi: hit.toi,
      chunkIndex,
    };
  }

  getActiveColliderCount(): number {
    return this.activeColliders.size;
  }

  getActiveChunkKeys(): string[] {
    return Array.from(this.activeColliders.keys());
  }

  hasCollider(chunkX: number, chunkZ: number): boolean {
    return this.activeColliders.has(HeightfieldBuilder.chunkKey(chunkX, chunkZ));
  }

  getStats(): {
    activeColliders: number;
    maxActiveColliders: number;
    terrainCached: number;
  } {
    return {
      activeColliders: this.activeColliders.size,
      maxActiveColliders: this.config.maxActiveColliders,
      terrainCached: this.terrain.getAllCollisionData().size,
    };
  }

  getTerrain(): TerrainLOD {
    return this.terrain;
  }

  getWorld(): any {
    return this.world;
  }

  setFriction(friction: number): void {
    this.config.friction = friction;
    for (const [, entry] of this.activeColliders) {
      entry.collider.setFriction(friction);
    }
  }

  setRestitution(restitution: number): void {
    this.config.restitution = restitution;
    for (const [, entry] of this.activeColliders) {
      entry.collider.setRestitution(restitution);
    }
  }

  setCollisionGroups(groups: number): void {
    this.config.collisionGroups = groups;
    for (const [, entry] of this.activeColliders) {
      entry.collider.setCollisionGroups(groups);
    }
  }

  dispose(): void {
    if (this.collisionCallback) {
      this.terrain.setCollisionCallback(null);
      this.collisionCallback = null;
    }

    for (const [, entry] of this.activeColliders) {
      this.world.removeRigidBody(entry.body);
    }
    this.activeColliders.clear();

    this.terrain = null as any;
    this.world = null as any;
    this.rapier = null as any;
    this.initialized = false;
  }
}
