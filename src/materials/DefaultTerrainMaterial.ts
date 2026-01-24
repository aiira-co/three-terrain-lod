import * as THREE from 'three';
import {
  texture, uv, uniform, vec3, vec2, vec4, mix, mul, add,
  positionLocal, float, step, normalize, Fn, attribute, smoothstep, pow, abs, clamp
} from 'three/tsl';
import { MeshPhysicalNodeMaterial, Node, TextureNode, UniformNode } from 'three/webgpu';
import { TerrainMaterialProvider, TerrainMaterialContext } from '../core/types';

/**
 * Nodes exposed for external modification.
 */
export interface TerrainMaterialNodes {
  heightMap: Node | null;
  diffuseTexture: Node | null;
  maxHeight: UniformNode<number> | null;
  showChunkBorders: UniformNode<number> | null;
  colorHigh: Node | null;
  colorMid: Node | null;
  colorLow: Node | null;
  colorRock: Node | null;
  slopeThreshold: UniformNode<number> | null;
  slopeSoftness: UniformNode<number> | null;
  snowHeight: UniformNode<number> | null;
}

/**
 * Default terrain material provider using Three.js TSL (Shader Language).
 * 
 * Creates a heightmap-displaced material with:
 * - Vertex displacement from heightmap
 * - **Slope-based texturing** (rock on cliffs)
 * - **Height-based layering** (grass → rock → snow)
 * - Diffuse texture tiling
 * - Optional chunk border visualization
 * - Sobel-based normal calculation
 * 
 * This is the built-in material used when no custom provider is set.
 */
export class DefaultTerrainMaterial implements TerrainMaterialProvider {
  private material: MeshPhysicalNodeMaterial | null = null;
  private heightMapNode: Node | null = null;
  private diffuseTextureNode: Node | null = null;
  private maxHeightNode: UniformNode<number> | null = null;
  private showChunkBordersNode: UniformNode<number> | null = null;
  private colorHighNode: Node | null = null;
  private colorMidNode: Node | null = null;
  private colorLowNode: Node | null = null;
  private colorRockNode: Node | null = null;
  private slopeThresholdNode: UniformNode<number> | null = null;
  private slopeSoftnessNode: UniformNode<number> | null = null;
  private snowHeightNode: UniformNode<number> | null = null;
  private context: TerrainMaterialContext | null = null;

  /**
   * Create the terrain material.
   * @param context - Material context with textures and settings
   * @returns The created material
   */
  createMaterial(context: TerrainMaterialContext): THREE.Material {
    this.context = context;

    // Create shared nodes
    this.heightMapNode = texture(context.heightMap);
    this.diffuseTextureNode = context.diffuseTexture ? texture(context.diffuseTexture) : null;
    this.maxHeightNode = uniform(context.maxHeight);

    // Material layer colors
    this.colorHighNode = uniform(vec3(0.95, 0.95, 0.98)); // Snow (bright white-blue)
    this.colorMidNode = uniform(vec3(0.45, 0.38, 0.32));  // Rock (gray-brown)
    this.colorLowNode = uniform(vec3(0.22, 0.42, 0.15));  // Grass (darker green)
    this.colorRockNode = uniform(vec3(0.35, 0.32, 0.28)); // Cliff rock (dark gray)

    // Slope-based texturing parameters
    this.slopeThresholdNode = uniform(0.45);  // Slope angle where rock starts
    this.slopeSoftnessNode = uniform(0.25);   // Blend softness
    this.snowHeightNode = uniform(0.75);      // Height where snow starts (0-1)

    this.showChunkBordersNode = uniform(context.showChunkBorders ? 1.0 : 0.0);

    const material = new MeshPhysicalNodeMaterial();

    // Per-instance UV transform using instanceIndex
    const instUVTransform = attribute('instanceUVTransform', 'vec3');
    const instUVScale = instUVTransform.x;
    const instUVOffset = vec2(instUVTransform.y, instUVTransform.z);

    // Build UV coordinates (flip Y)
    const uvNode = vec2(uv().x, add(float(1.0), mul(uv().y, float(-1.0))));
    const scaledUV = uvNode.mul(vec2(instUVScale, instUVScale));
    const globalUV = scaledUV.add(instUVOffset);

    // Sample heightmap
    const heightData = texture(this.heightMapNode as TextureNode, globalUV);
    const height = heightData.r;

    // Vertex displacement
    const displacement = vec3(0, 1, 0).mul(height.mul(this.maxHeightNode));
    material.positionNode = positionLocal.add(displacement);

    // Calculate normal for slope detection (do this first)
    const normalNode = this.createTerrainNormalSobel(
      this.heightMapNode!,
      globalUV,
      this.maxHeightNode!,
      context.resolution,
      context.worldSize
    );
    material.normalNode = normalNode;

    // Slope calculation: 0 = flat, 1 = vertical cliff
    // We use the Y component of the normal (pointing up = flat)
    const slope = Fn(() => {
      // The normal Y component: 1.0 = flat, 0.0 = vertical
      const flatness = abs(normalNode.y);
      // Convert to slope: 0.0 = flat, 1.0 = vertical
      return clamp(float(1.0).sub(flatness), 0.0, 1.0);
    })();

    // ===== HEIGHT-BASED LAYERING =====
    // Low terrain: grass color
    // Mid terrain: rock/dirt color  
    // High terrain: snow color

    const grassRockBlend = smoothstep(0.3, 0.5, height);
    const rockSnowBlend = smoothstep(this.snowHeightNode!, float(1.0), height);

    // Blend grass -> rock -> snow based on height
    const grassToRock = mix(this.colorLowNode!, this.colorMidNode!, grassRockBlend);
    const heightBasedColor = mix(grassToRock, this.colorHighNode!, rockSnowBlend);

    // ===== SLOPE-BASED ROCK OVERLAY =====
    // Steep slopes show rock regardless of height
    const slopeBlend = smoothstep(
      this.slopeThresholdNode!,
      this.slopeThresholdNode!.add(this.slopeSoftnessNode!),
      slope
    );

    // Mix cliff rock color based on slope
    let terrainColor = mix(heightBasedColor, this.colorRockNode!, slopeBlend);

    // ===== DIFFUSE TEXTURE =====
    let finalColor: Node;
    if (this.diffuseTextureNode) {
      // Tiled diffuse texture for detail
      const tiledUV = uvNode.mul(vec2(8.0, 8.0)); // Higher tiling for detailed grass
      const diffuseColor = texture(this.diffuseTextureNode as TextureNode, tiledUV);
      // Blend diffuse with terrain color (modulate)
      finalColor = terrainColor.mul(diffuseColor.rgb.mul(1.2)); // Brighten slightly
    } else {
      finalColor = terrainColor;
    }

    // ===== AMBIENT OCCLUSION / LIGHTING =====
    // Darken valleys, brighten peaks
    const aoFactor = float(0.6).add(float(0.4).mul(height));
    finalColor = finalColor.mul(aoFactor);

    // ===== CHUNK BORDER VISUALIZATION =====
    const maxUV1 = uvNode.x.max(uvNode.y);
    const border1 = maxUV1.step(0.98);
    const oneMinusUVX = float(1.0).sub(uvNode.x);
    const oneMinusUVY = float(1.0).sub(uvNode.y);
    const maxUV2 = oneMinusUVX.max(oneMinusUVY);
    const border2 = maxUV2.step(0.98);
    const borderTotal = border1.add(border2);
    const borderColor = vec3(1.0, 1.0, 0.0);
    const borderIntensity = borderTotal.mul(0.3).mul(this.showChunkBordersNode!);
    finalColor = mix(finalColor, borderColor, borderIntensity);

    material.colorNode = vec4(finalColor.x, finalColor.y, finalColor.z, float(1.0));
    material.wireframe = context.wireframe;
    material.side = THREE.DoubleSide;
    material.roughness = 0.85;
    material.metalness = 0.0;

    this.material = material;
    return material;
  }

  /**
   * Set wireframe mode.
   */
  setWireframe(enabled: boolean): void {
    if (this.material) {
      this.material.wireframe = enabled;
      this.material.needsUpdate = true;
    }
  }

  /**
   * Set maximum height.
   */
  setMaxHeight(height: number): void {
    if (this.maxHeightNode) {
      this.maxHeightNode.value = height;
    }
  }

  /**
   * Set chunk border visibility.
   */
  setShowChunkBorders(enabled: boolean): void {
    if (this.showChunkBordersNode) {
      this.showChunkBordersNode.value = enabled ? 1.0 : 0.0;
    }
  }

  /**
   * Set slope threshold (0-1, where rock texture starts).
   * @param threshold - 0 = rock everywhere, 1 = rock only on vertical surfaces
   */
  setSlopeThreshold(threshold: number): void {
    if (this.slopeThresholdNode) {
      this.slopeThresholdNode.value = Math.max(0, Math.min(1, threshold));
    }
  }

  /**
   * Set slope blend softness.
   * @param softness - 0 = hard edge, 1 = very gradual blend
   */
  setSlopeSoftness(softness: number): void {
    if (this.slopeSoftnessNode) {
      this.slopeSoftnessNode.value = Math.max(0, Math.min(1, softness));
    }
  }

  /**
   * Set snow height threshold (0-1, normalized height where snow starts).
   * @param height - 0 = snow at sea level, 1 = snow only at max height
   */
  setSnowHeight(height: number): void {
    if (this.snowHeightNode) {
      this.snowHeightNode.value = Math.max(0, Math.min(1, height));
    }
  }

  /**
   * Get all uniform nodes for external customization.
   */
  getNodes(): TerrainMaterialNodes {
    return {
      heightMap: this.heightMapNode,
      diffuseTexture: this.diffuseTextureNode,
      maxHeight: this.maxHeightNode,
      showChunkBorders: this.showChunkBordersNode,
      colorHigh: this.colorHighNode,
      colorMid: this.colorMidNode,
      colorLow: this.colorLowNode,
      colorRock: this.colorRockNode,
      slopeThreshold: this.slopeThresholdNode,
      slopeSoftness: this.slopeSoftnessNode,
      snowHeight: this.snowHeightNode
    };
  }

  /**
   * Dispose the material.
   */
  dispose(): void {
    this.material?.dispose();
    this.material = null;
  }

  /**
   * Create terrain normals using Sobel filter.
   */
  private createTerrainNormalSobel(
    heightMapNode: Node,
    globalUV: Node,
    maxHeightNode: UniformNode<number>,
    resolution: number,
    worldSize: number
  ): Node {
    return Fn(() => {
      const texelSize = float(1.0 / resolution).toVar();
      const worldStep = float(worldSize / resolution).toVar();

      const hTL = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSize.negate(), texelSize.negate()))).r.toVar();
      const hTC = texture(heightMapNode as TextureNode, globalUV.add(vec2(0, texelSize.negate()))).r.toVar();
      const hTR = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSize, texelSize.negate()))).r.toVar();
      const hCL = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSize.negate(), 0))).r.toVar();
      const hCR = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSize, 0))).r.toVar();
      const hBL = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSize.negate(), texelSize))).r.toVar();
      const hBC = texture(heightMapNode as TextureNode, globalUV.add(vec2(0, texelSize))).r.toVar();
      const hBR = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSize, texelSize))).r.toVar();

      const sobelX = hTR.add(hCR.mul(2)).add(hBR).sub(hTL.add(hCL.mul(2)).add(hBL)).toVar();
      const sobelZ = hBL.add(hBC.mul(2)).add(hBR).sub(hTL.add(hTC.mul(2)).add(hTR)).toVar();

      const strength = maxHeightNode.div(worldStep).toVar();
      const dx = sobelX.mul(strength).toVar();
      const dz = sobelZ.mul(strength).toVar();

      const normal = vec3(dx.negate(), 1, dz.negate()).toVar();
      return normalize(normal);
    })();
  }
}
