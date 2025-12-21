# @interverse/three-terrain-lod

High-performance LOD terrain system for Three.js with quadtree-based chunking and **swappable materials**.

## 📦 Installation

```bash
npm install @interverse/three-terrain-lod
# or
yarn add @interverse/three-terrain-lod
```

**Peer Dependencies:**
- `three` >= 0.182.0

## Features

- 🏔️ **Quadtree LOD** - Automatic level-of-detail based on camera distance
- ⚡ **Instanced Rendering** - Single draw call for all terrain chunks
- 🎨 **Swappable Materials** - Use custom materials (LayeredMaterial, etc.)
- 📦 **Extends THREE.Group** - Add to any scene, no dependencies
- 🔧 **TSL-based Default Material** - WebGPU-ready heightmap displacement

## Installation

```bash
npm install three-terrain-lod
# or
yarn add three-terrain-lod
```

## Quick Start

```typescript
import { TerrainLOD } from '@interverse/three-terrain-lod';

const terrain = new TerrainLOD({
  heightMapUrl: 'terrain_heightmap.png',
  worldSize: 1024,
  maxHeight: 100,
  levels: 6,
  resolution: 64
});

scene.add(terrain);

// In animation loop
function animate() {
  terrain.update(camera);
  renderer.render(scene, camera);
}
```

## Configuration

```typescript
interface TerrainConfig {
  heightMapUrl?: string;      // URL to heightmap image
  textureUrl?: string;        // URL to diffuse texture
  worldSize?: number;         // Total terrain size (default: 2048)
  maxHeight?: number;         // Maximum terrain height (default: 250)
  levels?: number;            // LOD levels (default: 6)
  lodDistanceRatio?: number;  // Higher = more detail (default: 2.0)
  resolution?: number;        // Vertices per chunk side (default: 64)
  wireframe?: boolean;        // Wireframe mode (default: false)
  showChunkBorders?: boolean; // Debug borders (default: false)
  maxChunks?: number;         // Max concurrent chunks (default: 500)
}
```

## Custom Materials

Implement `TerrainMaterialProvider` to use custom materials:

```typescript
import { TerrainMaterialProvider, TerrainMaterialContext } from '@interverse/three-terrain-lod';

class MyTerrainMaterial implements TerrainMaterialProvider {
  private material: THREE.Material;

  createMaterial(context: TerrainMaterialContext): THREE.Material {
    // context.heightMap - The heightmap texture
    // context.maxHeight - Maximum terrain height
    // context.worldSize - Total terrain size
    
    this.material = new THREE.MeshStandardMaterial({
      color: 0x44aa44
    });
    return this.material;
  }

  setWireframe(enabled: boolean): void {
    this.material.wireframe = enabled;
  }

  dispose(): void {
    this.material?.dispose();
  }
}

// Usage
const terrain = new TerrainLOD({ ... });
terrain.setMaterialProvider(new MyTerrainMaterial());

// Reset to default material
terrain.resetMaterial();
```

### LayeredMaterial Integration Example

```typescript
import { LayeredMaterial } from '@interverse/three-layered-material';

class LayeredTerrainProvider implements TerrainMaterialProvider {
  private layeredMaterial: LayeredMaterial;

  createMaterial(context: TerrainMaterialContext): THREE.Material {
    this.layeredMaterial = new LayeredMaterial({
      layers: [
        {
          name: 'Grass',
          map: { color: grassTexture },
          scale: 0.5
        },
        {
          name: 'Rock',
          map: { color: rockTexture },
          mask: { useSlope: true, slopeMin: 0.4, slopeMax: 0.8 }
        },
        {
          name: 'Snow',
          map: { color: snowTexture },
          mask: { useHeight: true, heightMin: context.maxHeight * 0.7 }
        }
      ]
    });
    return this.layeredMaterial;
  }

  dispose(): void {
    this.layeredMaterial?.dispose();
  }
}
```

## API Reference

### TerrainLOD

| Method | Description |
|--------|-------------|
| `update(camera)` | Update LOD based on camera position (call each frame) |
| `setMaterialProvider(provider)` | Set a custom material provider |
| `resetMaterial()` | Reset to the default built-in material |
| `getMaterial()` | Get the current material |
| `getHeightMap()` | Get the heightmap texture |
| `getDiffuseTexture()` | Get the diffuse texture |
| `setWireframe(enabled)` | Toggle wireframe rendering |
| `setMaxHeight(height)` | Update maximum terrain height |
| `setShowChunkBorders(enabled)` | Toggle debug chunk borders |
| `setLODDistanceRatio(ratio)` | Adjust LOD distance ratio |
| `getConfig()` | Get the current configuration |
| `getStats()` | Get terrain statistics |
| `dispose()` | Clean up all resources |

### TerrainMaterialProvider Interface

```typescript
interface TerrainMaterialProvider {
  createMaterial(context: TerrainMaterialContext): THREE.Material;
  setWireframe?(enabled: boolean): void;
  setMaxHeight?(height: number): void;
  setShowChunkBorders?(enabled: boolean): void;
  dispose?(): void;
  onHeightMapUpdate?(heightMap: THREE.Texture): void;
}
```

### TerrainMaterialContext

```typescript
interface TerrainMaterialContext {
  heightMap: THREE.Texture;
  diffuseTexture: THREE.Texture | null;
  maxHeight: number;
  worldSize: number;
  resolution: number;
  wireframe: boolean;
  showChunkBorders: boolean;
}
```

## Instance UV Transform Attribute

For custom shaders, the terrain provides per-instance UV transforms via the `instanceUVTransform` attribute:

```glsl
// In your vertex shader
attribute vec3 instanceUVTransform; // (scale, offsetX, offsetY)

void main() {
  vec2 globalUV = vUv * instanceUVTransform.x + instanceUVTransform.yz;
  // Sample heightmap with globalUV
}
```

## Collision API

The terrain provides physics-engine-agnostic collision data for integration with Rapier, Jolt, or other physics engines.

### Pre-computing Collision Data

```typescript
// After terrain is initialized, pre-compute collision data
await terrain.computeAllCollisionData();

// Set resolution: 32, 64, or 128 (subdivisions per chunk)
terrain.setCollisionResolution(64);
```

### Getting Chunk Collision Data

```typescript
// Get collision data for a specific chunk
const chunkData = terrain.getChunkCollisionData(0, 0);

if (chunkData) {
  // chunkData.heights - Float32Array of height values
  // chunkData.rows / chunkData.cols - Grid dimensions
  // chunkData.position - World position { x, y, z }
  // chunkData.scale - Physics shape scale { x, y, z }
  // chunkData.maxHeight - Maximum terrain height
}

// Get all cached collision data
const allChunks = terrain.getAllCollisionData();
```

### Dynamic Collision (LOD-based)

```typescript
// Set up collision callback for dynamic loading/unloading
terrain.setCollisionCallback({
  onChunkEnterLOD0(chunk) {
    // Chunk is now in highest detail - create physics collider
    const collider = physics.createHeightfield(
      chunk.rows - 1,
      chunk.cols - 1,
      chunk.heights,
      chunk.scale
    );
    collider.setTranslation(chunk.position);
  },
  
  onChunkExitLOD0(index) {
    // Chunk is no longer in LOD0 - remove collider
    physics.removeCollider(index.x, index.z);
  }
});
```

### Height Query

```typescript
// Sample terrain height at any world position
const height = terrain.getHeightAt(playerX, playerZ);
```

### ChunkCollisionData Interface

```typescript
interface ChunkCollisionData {
  position: { x: number; y: number; z: number };
  size: number;
  index: { x: number; z: number };
  lodLevel: number;
  rows: number;
  cols: number;
  heights: Float32Array;
  maxHeight: number;
  scale: { x: number; y: number; z: number };
}
```

## License

MIT
