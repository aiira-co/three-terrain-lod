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
- 🖌️ **HeightmapCompositor** - GPU-based non-destructive heightmap editing

## Default Material

The built-in `DefaultTerrainMaterial` provides a rich, TSL-based shader with the following features enabled by default:

- **Slope-based Texturing**: Automatically applies rock texture to steep cliffs.
- **Height-based Layering**: Blends between grass (low), rock (mid), and snow (high).
- **Sobel Normal Calculation**: Computes normals on-the-fly from the heightmap.
- **Triplanar Mapping**: (Coming soon) for vertical surfaces.

### Customization

You can access and modify the material parameters:

```typescript
// Access the default provider
const provider = terrain.getMaterialProvider() as DefaultTerrainMaterial;

// Configure thresholds
provider.setSlopeThreshold(0.45); // Slope angle for rock (0-1)
provider.setSlopeSoftness(0.2); // Blend softness
provider.setSnowHeight(0.8); // Height for snow start (normalized 0-1)

// Toggle visualizations
provider.setShowChunkBorders(true);
provider.setWireframe(true);
```

## Installation

```bash
npm install three-terrain-lod
# or
yarn add three-terrain-lod
```

## Quick Start

```typescript
import { TerrainLOD } from "@interverse/three-terrain-lod";

const terrain = new TerrainLOD({
  heightMapUrl: "terrain_heightmap.png",
  worldSize: 1024,
  maxHeight: 100,
  levels: 6,
  resolution: 64,
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
  heightMapUrl?: string; // URL to heightmap image
  textureUrl?: string; // URL to diffuse texture
  worldSize?: number; // Total terrain size (default: 2048)
  maxHeight?: number; // Maximum terrain height (default: 250)
  levels?: number; // LOD levels (default: 6)
  lodDistanceRatio?: number; // Higher = more detail (default: 2.0)
  resolution?: number; // Vertices per chunk side (default: 64)
  wireframe?: boolean; // Wireframe mode (default: false)
  showChunkBorders?: boolean; // Debug borders (default: false)
  maxChunks?: number; // Max concurrent chunks (default: 500)
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
import { LayeredMaterial } from "@interverse/three-layered-material";

class LayeredTerrainProvider implements TerrainMaterialProvider {
  private layeredMaterial: LayeredMaterial;

  createMaterial(context: TerrainMaterialContext): THREE.Material {
    this.layeredMaterial = new LayeredMaterial({
      layers: [
        {
          name: "Grass",
          map: { color: grassTexture },
          scale: 0.5,
        },
        {
          name: "Rock",
          map: { color: rockTexture },
          mask: { useSlope: true, slopeMin: 0.4, slopeMax: 0.8 },
        },
        {
          name: "Snow",
          map: { color: snowTexture },
          mask: { useHeight: true, heightMin: context.maxHeight * 0.7 },
        },
      ],
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

| Method                          | Description                                           |
| ------------------------------- | ----------------------------------------------------- |
| `update(camera)`                | Update LOD based on camera position (call each frame) |
| `setMaterialProvider(provider)` | Set a custom material provider                        |
| `resetMaterial()`               | Reset to the default built-in material                |
| `getMaterial()`                 | Get the current material                              |
| `getHeightMap()`                | Get the heightmap texture                             |
| `getDiffuseTexture()`           | Get the diffuse texture                               |
| `setWireframe(enabled)`         | Toggle wireframe rendering                            |
| `setMaxHeight(height)`          | Update maximum terrain height                         |
| `setShowChunkBorders(enabled)`  | Toggle debug chunk borders                            |
| `setLODDistanceRatio(ratio)`    | Adjust LOD distance ratio                             |
| `getConfig()`                   | Get the current configuration                         |
| `getStats()`                    | Get terrain statistics                                |
| `dispose()`                     | Clean up all resources                                |

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

## HeightmapCompositor

GPU-based non-destructive heightmap composition. Render brush stamps to a render target for real-time terrain editing.

### Basic Usage

```typescript
import { HeightmapCompositor, BrushData } from "@interverse/three-terrain-lod";

const compositor = new HeightmapCompositor({
  resolution: 1024,
  worldSize: 2048,
});

// Add a brush
compositor.addBrush({
  uuid: "mountain-1",
  position: new THREE.Vector3(100, 0, 200),
  rotation: new THREE.Euler(0, 0, 0),
  scale: new THREE.Vector3(100, 1, 100),
  alphaTexture: mountainBrushTexture,
  blendMode: "max", // 'add' | 'max' | 'subtract'
  falloff: 0.3,
  inclineStrength: 1.5,
  height: 50,
  visible: true,
});

// In render loop
if (compositor.needsUpdate()) {
  compositor.compose(renderer);
  terrain.setHeightMap(compositor.getOutputTexture());
}
```

### Brush Management

```typescript
// Update existing brush
compositor.updateBrush("mountain-1", { height: 75 });

// Remove brush
compositor.removeBrush("mountain-1");

// Get all brushes
const brushes = compositor.getAllBrushes();

// Clear all
compositor.clear();
```

### Blend Modes

| Mode       | Description                           |
| ---------- | ------------------------------------- |
| `max`      | Keep highest value (mountains)        |
| `add`      | Additive blending (cumulative height) |
| `subtract` | Subtractive (canyons/craters)         |

### BrushData Interface

```typescript
interface BrushData {
  uuid: string;
  position: THREE.Vector3; // World position (x, z)
  rotation: THREE.Euler; // Rotation
  scale: THREE.Vector3; // Scale factor
  alphaTexture: THREE.Texture; // Grayscale brush stamp
  blendMode: "add" | "max" | "subtract";
  falloff: number; // Edge softness (0-1)
  inclineStrength: number; // Power curve (1=linear)
  height: number; // Max height contribution
  visible: boolean;
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
      chunk.scale,
    );
    collider.setTranslation(chunk.position);
  },

  onChunkExitLOD0(index) {
    // Chunk is no longer in LOD0 - remove collider
    physics.removeCollider(index.x, index.z);
  },
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
