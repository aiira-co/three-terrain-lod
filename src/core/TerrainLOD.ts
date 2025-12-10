import * as THREE from 'three';
import {
  TerrainConfig,
  ResolvedTerrainConfig,
  TerrainMaterialProvider,
  TerrainMaterialContext,
  ChunkInstanceData
} from './types';
import { InstancePool } from './InstancePool';
import { QuadtreeNode, setCurrentCamera } from './QuadtreeNode';
import { DefaultTerrainMaterial } from '../materials/DefaultTerrainMaterial';

/**
 * High-performance LOD terrain system using instanced rendering and quadtree chunking.
 * 
 * Extends THREE.Group so it can be added to any scene.
 * Call `update(camera)` each frame for LOD calculations.
 * 
 * @example
 * ```typescript
 * const terrain = new TerrainLOD({
 *   heightMapUrl: 'terrain_heightmap.png',
 *   worldSize: 1024,
 *   maxHeight: 100,
 *   levels: 6
 * });
 * scene.add(terrain);
 * 
 * // In animation loop
 * terrain.update(camera);
 * ```
 */
export class TerrainLOD extends THREE.Group {
  private config: ResolvedTerrainConfig;
  private root: QuadtreeNode | null = null;
  private instancedMesh: THREE.InstancedMesh | null = null;
  private sharedGeometry: THREE.PlaneGeometry | null = null;
  private heightMap: THREE.Texture | null = null;
  private diffuseTexture: THREE.Texture | null = null;
  private isInitialized: boolean = false;

  private instancePool: InstancePool;
  private needsUpdate: boolean = false;

  // Instance attribute arrays
  private instanceUVTransforms: Float32Array;

  // Material provider
  private materialProvider: TerrainMaterialProvider;
  private defaultMaterialProvider: DefaultTerrainMaterial;
  private currentMaterial: THREE.Material | null = null;

  constructor(config: TerrainConfig = {}) {
    super();
    const maxChunks = config.maxChunks ?? 500;

    this.config = {
      heightMapUrl: config.heightMapUrl || '',
      textureUrl: config.textureUrl || '',
      worldSize: config.worldSize ?? 2048,
      maxHeight: config.maxHeight ?? 250,
      levels: config.levels ?? 6,
      lodDistanceRatio: config.lodDistanceRatio ?? 2.0,
      resolution: config.resolution ?? 64,
      wireframe: config.wireframe ?? false,
      showChunkBorders: config.showChunkBorders ?? false,
      maxChunks
    };

    this.instancePool = new InstancePool(maxChunks);
    this.instanceUVTransforms = new Float32Array(maxChunks * 3);

    // Create default material provider
    this.defaultMaterialProvider = new DefaultTerrainMaterial();
    this.materialProvider = this.defaultMaterialProvider;

    this.init();
  }

  private async init(): Promise<void> {
    try {
      await this.loadTextures();
      this.createSharedGeometry();
      this.createMaterial();
      this.createInstancedMesh();

      this.root = new QuadtreeNode(0, 0, this.config.worldSize, 0, this);
      this.root.update();

      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize TerrainLOD:', error);
    }
  }

  private async loadTextures(): Promise<void> {
    const loader = new THREE.TextureLoader();

    if (this.config.heightMapUrl) {
      this.heightMap = await loader.loadAsync(this.config.heightMapUrl);
    } else {
      this.heightMap = this.generateProceduralHeightmap();
    }
    this.heightMap.wrapS = this.heightMap.wrapT = THREE.ClampToEdgeWrapping;
    this.heightMap.magFilter = THREE.LinearFilter;
    this.heightMap.minFilter = THREE.LinearMipMapLinearFilter;

    if (this.config.textureUrl) {
      this.diffuseTexture = await loader.loadAsync(this.config.textureUrl);
    } else {
      this.diffuseTexture = this.generateProceduralDiffuse();
    }
    this.diffuseTexture.wrapS = this.diffuseTexture.wrapT = THREE.RepeatWrapping;
    this.diffuseTexture.repeat.set(16, 16);
    this.diffuseTexture.anisotropy = 16;
  }

  private generateProceduralHeightmap(): THREE.Texture {
    const size = 2048;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);

    const numCircles = 600;
    for (let i = 0; i < numCircles; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const radius = Math.random() * 100 + 50;
      const opacity = Math.random() * 0.1;

      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
      grad.addColorStop(0, `rgba(255, 255, 255, ${opacity})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    const centerGrad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    centerGrad.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
    centerGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = centerGrad;
    ctx.fillRect(0, 0, size, size);

    return new THREE.CanvasTexture(canvas);
  }

  private generateProceduralDiffuse(): THREE.Texture {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#2d4c1e';
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = '#3e6b29';
    ctx.lineWidth = 2;
    const gridSteps = 32;
    const step = size / gridSteps;

    for (let i = 0; i <= size; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(size, i);
      ctx.stroke();
    }

    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.random() > 0.5) {
        const val = (Math.random() - 0.5) * 20;
        data[i] = Math.max(0, Math.min(255, data[i] + val));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + val));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + val));
      }
    }
    ctx.putImageData(imageData, 0, 0);

    return new THREE.CanvasTexture(canvas);
  }

  private createSharedGeometry(): void {
    this.sharedGeometry = new THREE.PlaneGeometry(1, 1, this.config.resolution, this.config.resolution);
    this.sharedGeometry.rotateX(-Math.PI / 2);
  }

  private createMaterial(): void {
    const context: TerrainMaterialContext = {
      heightMap: this.heightMap!,
      diffuseTexture: this.diffuseTexture,
      maxHeight: this.config.maxHeight,
      worldSize: this.config.worldSize,
      resolution: this.config.resolution,
      wireframe: this.config.wireframe,
      showChunkBorders: this.config.showChunkBorders
    };

    this.currentMaterial = this.materialProvider.createMaterial(context);
  }

  private createInstancedMesh(): void {
    this.instancedMesh = new THREE.InstancedMesh(
      this.sharedGeometry!,
      this.currentMaterial!,
      this.config.maxChunks
    );

    // Set up instance attributes
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Create instanced buffer attribute for UV transforms
    const uvTransformAttr = new THREE.InstancedBufferAttribute(this.instanceUVTransforms, 3);
    uvTransformAttr.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.geometry.setAttribute('instanceUVTransform', uvTransformAttr);

    this.instancedMesh.count = 0;
    this.instancedMesh.frustumCulled = false;

    this.add(this.instancedMesh);
  }

  // ============================================
  // Instance Management
  // ============================================

  /**
   * Add a terrain chunk instance.
   * @internal Called by QuadtreeNode
   */
  public addInstance(data: ChunkInstanceData): number {
    const id = this.instancePool.acquire();
    if (id === null) return -1;

    this.instancePool.setData(id, data);

    // Update instance matrix
    const matrix = new THREE.Matrix4();
    matrix.compose(
      new THREE.Vector3(data.x, this.config.maxHeight * -0.4, data.z),
      new THREE.Quaternion(),
      new THREE.Vector3(data.size, 1, data.size)
    );
    this.instancedMesh!.setMatrixAt(id, matrix);

    // Update UV transform
    const offset = id * 3;
    this.instanceUVTransforms[offset] = data.uvScale;
    this.instanceUVTransforms[offset + 1] = data.uvOffsetX;
    this.instanceUVTransforms[offset + 2] = data.uvOffsetY;

    this.needsUpdate = true;
    return id;
  }

  /**
   * Remove a terrain chunk instance.
   * @internal Called by QuadtreeNode
   */
  public removeInstance(id: number): void {
    if (id === -1) return;

    this.instancePool.release(id);

    // Hide instance by setting scale to 0
    const matrix = new THREE.Matrix4();
    matrix.scale(new THREE.Vector3(0, 0, 0));
    this.instancedMesh!.setMatrixAt(id, matrix);

    this.needsUpdate = true;
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Update the terrain LOD based on camera position.
   * Call this every frame in your render loop.
   * @param camera - The camera to use for LOD calculations
   */
  public update(camera: THREE.Camera): void {
    if (this.isInitialized && this.root) {
      setCurrentCamera(camera);
      this.root.update();

      if (this.needsUpdate && this.instancedMesh) {
        const maxId = this.instancePool.getHighestActiveId();
        this.instancedMesh.count = maxId + 1;

        this.instancedMesh.instanceMatrix.needsUpdate = true;
        const uvAttr = this.instancedMesh.geometry.getAttribute('instanceUVTransform');
        if (uvAttr) {
          (uvAttr as THREE.InstancedBufferAttribute).needsUpdate = true;
        }

        this.needsUpdate = false;
      }
    }
  }

  /**
   * Set a custom material provider.
   * The provider will be used to create the terrain material.
   * @param provider - Custom material provider implementing TerrainMaterialProvider
   */
  public setMaterialProvider(provider: TerrainMaterialProvider): void {
    // Dispose old material if different provider
    if (this.materialProvider !== provider) {
      this.materialProvider.dispose?.();
    }

    this.materialProvider = provider;
    this.recreateMaterial();
  }

  /**
   * Reset to the default built-in material.
   */
  public resetMaterial(): void {
    if (this.materialProvider !== this.defaultMaterialProvider) {
      this.materialProvider.dispose?.();
      this.materialProvider = this.defaultMaterialProvider;
      this.recreateMaterial();
    }
  }

  /**
   * Get the current material.
   * Useful for external modifications.
   */
  public getMaterial(): THREE.Material | null {
    return this.currentMaterial;
  }

  /**
   * Get the heightmap texture.
   * Useful for custom material providers that need height data.
   */
  public getHeightMap(): THREE.Texture | null {
    return this.heightMap;
  }

  /**
   * Get the diffuse texture.
   */
  public getDiffuseTexture(): THREE.Texture | null {
    return this.diffuseTexture;
  }

  /**
   * Get the UV transform attribute for custom shaders.
   * Format: vec3(scale, offsetX, offsetY) per instance.
   */
  public getUVTransformAttribute(): THREE.InstancedBufferAttribute | null {
    return this.instancedMesh?.geometry.getAttribute('instanceUVTransform') as THREE.InstancedBufferAttribute | null;
  }

  private recreateMaterial(): void {
    if (!this.isInitialized || !this.heightMap) return;

    const context: TerrainMaterialContext = {
      heightMap: this.heightMap,
      diffuseTexture: this.diffuseTexture,
      maxHeight: this.config.maxHeight,
      worldSize: this.config.worldSize,
      resolution: this.config.resolution,
      wireframe: this.config.wireframe,
      showChunkBorders: this.config.showChunkBorders
    };

    // Dispose old material
    this.currentMaterial?.dispose();

    // Create new material
    this.currentMaterial = this.materialProvider.createMaterial(context);

    // Update instanced mesh
    if (this.instancedMesh) {
      this.instancedMesh.material = this.currentMaterial;
    }
  }

  /**
   * Set wireframe rendering mode.
   */
  public setWireframe(enabled: boolean): void {
    this.config.wireframe = enabled;
    this.materialProvider.setWireframe?.(enabled);
  }

  /**
   * Set maximum terrain height.
   */
  public setMaxHeight(height: number): void {
    this.config.maxHeight = height;
    this.materialProvider.setMaxHeight?.(height);
  }

  /**
   * Set chunk border visibility (debug).
   */
  public setShowChunkBorders(enabled: boolean): void {
    this.config.showChunkBorders = enabled;
    this.materialProvider.setShowChunkBorders?.(enabled);
  }

  /**
   * Set LOD distance ratio.
   * Higher values split chunks sooner (more detail).
   */
  public setLODDistanceRatio(ratio: number): void {
    this.config.lodDistanceRatio = ratio;
  }

  /**
   * Get the current configuration.
   */
  public getConfig(): ResolvedTerrainConfig {
    return this.config;
  }

  /**
   * Get terrain statistics.
   */
  public getStats(): {
    instances: { active: number; available: number; total: number };
    drawCalls: number;
    materials: number;
    geometries: number;
  } {
    return {
      instances: this.instancePool.getStats(),
      drawCalls: 1,
      materials: 1,
      geometries: 1
    };
  }

  /**
   * Dispose the terrain and all resources.
   */
  public dispose(): void {
    if (this.root) {
      this.root.dispose();
    }
    if (this.instancedMesh) {
      this.remove(this.instancedMesh);
      this.instancedMesh.dispose();
    }
    this.instancePool.clear();
    this.sharedGeometry?.dispose();
    this.materialProvider.dispose?.();
    this.currentMaterial?.dispose();
    this.heightMap?.dispose();
    this.diffuseTexture?.dispose();
    this.isInitialized = false;
  }
}
