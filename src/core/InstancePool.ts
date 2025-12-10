import { ChunkInstanceData } from './types';

/**
 * Manages a pool of instance IDs for efficient reuse.
 * Prevents allocation churn when chunks are activated/deactivated.
 */
export class InstancePool {
  private activeInstances: Map<number, ChunkInstanceData> = new Map();
  private freeIds: number[] = [];
  private nextId: number = 0;
  private maxInstances: number;

  constructor(maxInstances: number) {
    this.maxInstances = maxInstances;
  }

  /**
   * Acquire an instance ID from the pool.
   * @returns Instance ID or null if pool is exhausted
   */
  acquire(): number | null {
    if (this.freeIds.length > 0) {
      return this.freeIds.pop()!;
    }
    if (this.nextId < this.maxInstances) {
      return this.nextId++;
    }
    console.warn('InstancePool: Maximum instances reached!');
    return null;
  }

  /**
   * Release an instance ID back to the pool.
   * @param id - The instance ID to release
   */
  release(id: number): void {
    if (this.activeInstances.delete(id)) {
      this.freeIds.push(id);
    }
  }

  /**
   * Store data for an instance.
   * @param id - Instance ID
   * @param data - Chunk data to store
   */
  setData(id: number, data: ChunkInstanceData): void {
    this.activeInstances.set(id, data);
  }

  /**
   * Get data for an instance.
   * @param id - Instance ID
   * @returns Chunk data or undefined if not found
   */
  getData(id: number): ChunkInstanceData | undefined {
    return this.activeInstances.get(id);
  }

  /**
   * Get the highest active instance ID.
   * Used to set the instanced mesh count.
   */
  getHighestActiveId(): number {
    if (this.activeInstances.size === 0) return -1;
    return Math.max(...Array.from(this.activeInstances.keys()));
  }

  /**
   * Get pool statistics.
   */
  getStats(): { active: number; available: number; total: number } {
    return {
      active: this.activeInstances.size,
      available: this.freeIds.length,
      total: this.nextId
    };
  }

  /**
   * Clear the pool and reset all state.
   */
  clear(): void {
    this.activeInstances.clear();
    this.freeIds = [];
    this.nextId = 0;
  }
}
