import * as THREE from 'three';
import type { TerrainLOD } from './TerrainLOD';

// Camera reference set during update
let currentCamera: THREE.Camera | null = null;

/**
 * Set the current camera for LOD calculations.
 * Called by TerrainLOD during update.
 * @internal
 */
export function setCurrentCamera(camera: THREE.Camera | null): void {
  currentCamera = camera;
}

/**
 * Get the current camera.
 * @internal
 */
export function getCurrentCamera(): THREE.Camera | null {
  return currentCamera;
}

/**
 * Quadtree node for terrain LOD management.
 * Handles splitting, merging, and instance registration based on camera distance.
 */
export class QuadtreeNode {
  public children: QuadtreeNode[] = [];
  public instanceId: number = -1;
  public isLeaf: boolean = true;

  constructor(
    public x: number,
    public z: number,
    public size: number,
    public level: number,
    private terrain: TerrainLOD
  ) {}

  /**
   * Update the node based on camera distance.
   * Splits or merges as needed.
   */
  update(): void {
    const distance = this.getDistanceFromCamera();
    const config = this.terrain.getConfig();

    const splitDistance = this.size * config.lodDistanceRatio;
    const shouldSplit = distance < splitDistance && this.level < config.levels - 1;

    if (shouldSplit) {
      if (this.isLeaf) this.split();
      this.children.forEach(child => child.update());
    } else {
      if (!this.isLeaf) this.merge();
      if (this.instanceId === -1) this.registerInstance();
    }
  }

  private split(): void {
    this.isLeaf = false;
    this.unregisterInstance();

    const halfSize = this.size / 2;
    const quarterOffset = this.size / 4;
    const nextLevel = this.level + 1;

    this.children = [
      new QuadtreeNode(this.x - quarterOffset, this.z - quarterOffset, halfSize, nextLevel, this.terrain),
      new QuadtreeNode(this.x + quarterOffset, this.z - quarterOffset, halfSize, nextLevel, this.terrain),
      new QuadtreeNode(this.x - quarterOffset, this.z + quarterOffset, halfSize, nextLevel, this.terrain),
      new QuadtreeNode(this.x + quarterOffset, this.z + quarterOffset, halfSize, nextLevel, this.terrain)
    ];
  }

  private merge(): void {
    this.isLeaf = true;
    this.children.forEach(child => child.dispose());
    this.children = [];
  }

  private registerInstance(): void {
    const uvTransform = this.getUVTransform();
    this.instanceId = this.terrain.addInstance({
      x: this.x,
      z: this.z,
      size: this.size,
      uvScale: uvTransform.scale,
      uvOffsetX: uvTransform.offsetX,
      uvOffsetY: uvTransform.offsetY
    });
  }

  private unregisterInstance(): void {
    if (this.instanceId !== -1) {
      this.terrain.removeInstance(this.instanceId);
      this.instanceId = -1;
    }
  }

  private getDistanceFromCamera(): number {
    if (!currentCamera) return Infinity;
    const cameraPos = currentCamera.position;
    const dx = cameraPos.x - this.x;
    const dz = cameraPos.z - this.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /**
   * Dispose the node and all children.
   */
  public dispose(): void {
    this.unregisterInstance();
    this.children.forEach(child => child.dispose());
  }

  private getUVTransform(): { scale: number; offsetX: number; offsetY: number } {
    const worldSize = this.terrain.getConfig().worldSize;
    const halfWorld = worldSize / 2;

    const scale = this.size / worldSize;
    const centerUVX = (this.x + halfWorld) / worldSize;
    const centerUVY = (this.z + halfWorld) / worldSize;

    return {
      scale,
      offsetX: centerUVX - scale / 2,
      offsetY: centerUVY - scale / 2
    };
  }
}
