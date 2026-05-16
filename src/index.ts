// Core exports
export {
  TerrainLOD,
  TerrainConfig,
  ResolvedTerrainConfig,
  TerrainMaterialProvider,
  TerrainMaterialContext,
  ChunkInstanceData,
  InstancePool,
  QuadtreeNode,
  HeightmapCompositor,
  BrushData,
  HeightmapCompositorConfig
} from './core';

// Material exports
export { DefaultTerrainMaterial, TerrainMaterialNodes } from './materials';

// Physics exports
export {
  TerrainPhysics,
  HeightfieldBuilder,
  TerrainPhysicsConfig,
  ResolvedTerrainPhysicsConfig,
  ChunkPhysicsEntry,
  TerrainRayHit,
  TerrainPhysicsInit,
} from './physics';
