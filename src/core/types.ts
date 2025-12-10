import * as THREE from 'three';

// ============================================
// Configuration Types
// ============================================

/**
 * Configuration options for TerrainLOD
 */
export interface TerrainConfig {
  /** URL to the heightmap image */
  heightMapUrl?: string;
  /** URL to the diffuse texture */
  textureUrl?: string;
  /** Total terrain size in world units */
  worldSize?: number;
  /** Maximum terrain height */
  maxHeight?: number;
  /** Number of LOD levels (0 = lowest detail) */
  levels?: number;
  /** LOD distance ratio - higher values split chunks sooner */
  lodDistanceRatio?: number;
  /** Base mesh resolution (vertices per side) */
  resolution?: number;
  /** Enable wireframe rendering */
  wireframe?: boolean;
  /** Show debug chunk borders */
  showChunkBorders?: boolean;
  /** Maximum number of concurrent chunks */
  maxChunks?: number;
}

/**
 * Resolved configuration with all required fields
 */
export interface ResolvedTerrainConfig extends Required<TerrainConfig> {
  heightMapUrl: string;
  textureUrl: string;
  maxChunks: number;
}

// ============================================
// Material Provider Interface
// ============================================

/**
 * Context passed to material providers for creating terrain materials.
 * Contains all the data needed to create a material that works with the terrain system.
 */
export interface TerrainMaterialContext {
  /** The heightmap texture */
  heightMap: THREE.Texture;
  /** The diffuse texture (may be null if not provided) */
  diffuseTexture: THREE.Texture | null;
  /** Maximum terrain height */
  maxHeight: number;
  /** Total terrain size in world units */
  worldSize: number;
  /** Mesh resolution (vertices per side) */
  resolution: number;
  /** Whether wireframe is enabled */
  wireframe: boolean;
  /** Whether chunk borders should be shown */
  showChunkBorders: boolean;
}

/**
 * Interface for custom terrain materials.
 * 
 * Implement this interface to provide custom materials for the terrain system.
 * This allows integration with material systems like LayeredMaterial without
 * creating package dependencies.
 * 
 * @example
 * ```typescript
 * class MyTerrainMaterial implements TerrainMaterialProvider {
 *   createMaterial(context: TerrainMaterialContext): THREE.Material {
 *     // Create and return your custom material
 *     // You can use context.heightMap for height-based effects
 *   }
 * }
 * 
 * const terrain = new TerrainLOD({ ... });
 * terrain.setMaterialProvider(new MyTerrainMaterial());
 * ```
 */
export interface TerrainMaterialProvider {
  /**
   * Create the material for the terrain.
   * 
   * IMPORTANT: The material must handle vertex displacement using the heightmap.
   * The terrain provides per-instance UV transforms via the 'instanceUVTransform' 
   * attribute (vec3: scale, offsetX, offsetY).
   * 
   * @param context - Contains textures and configuration needed for the material
   * @returns A Three.js material configured for the terrain
   */
  createMaterial(context: TerrainMaterialContext): THREE.Material;

  /**
   * Called when the terrain's wireframe setting changes.
   * @param enabled - Whether wireframe is enabled
   */
  setWireframe?(enabled: boolean): void;

  /**
   * Called when max height changes.
   * @param height - New max height value
   */
  setMaxHeight?(height: number): void;

  /**
   * Called when chunk border visibility changes.
   * @param enabled - Whether chunk borders are visible
   */
  setShowChunkBorders?(enabled: boolean): void;

  /**
   * Called when the material needs to be disposed.
   */
  dispose?(): void;

  /**
   * Called when the heightmap is updated.
   * @param heightMap - The new heightmap texture
   */
  onHeightMapUpdate?(heightMap: THREE.Texture): void;
}

// ============================================
// Instance Data Types
// ============================================

/**
 * Data for a terrain chunk instance
 */
export interface ChunkInstanceData {
  x: number;
  z: number;
  size: number;
  uvScale: number;
  uvOffsetX: number;
  uvOffsetY: number;
}
