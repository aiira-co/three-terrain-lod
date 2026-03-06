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
  skirtDepth: UniformNode<number> | null;
  skirtWidth: UniformNode<number> | null;
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
  private skirtDepthNode: UniformNode<number> | null = null;
  private skirtWidthNode: UniformNode<number> | null = null;
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

    this.skirtDepthNode = uniform(Math.max(0, context.skirtDepth));
    this.skirtWidthNode = uniform(Math.max(0.0001, Math.min(0.49, context.skirtWidth)));

    this.showChunkBordersNode = uniform(context.showChunkBorders ? 1.0 : 0.0);

    const material = new MeshPhysicalNodeMaterial();
    const heightMapImage = context.heightMap.image as { width?: number; height?: number } | undefined;
    const heightMapWidth = (typeof heightMapImage?.width === 'number' && heightMapImage.width > 0)
      ? heightMapImage.width
      : (context.resolution + 1);
    const heightMapHeight = (typeof heightMapImage?.height === 'number' && heightMapImage.height > 0)
      ? heightMapImage.height
      : (context.resolution + 1);

    // Per-instance UV transform using instanceIndex
    const instUVTransform = attribute('instanceUVTransform', 'vec3');
    const instEdgeSkirt = attribute('instanceEdgeSkirt', 'vec4');
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

    // Skirt offset near tile borders to hide LOD cracks between neighbors
    const skirtInner = this.skirtWidthNode!.mul(float(0.65));
    const oneMinusSkirtUVX = float(1.0).sub(uvNode.x);
    const oneMinusSkirtUVY = float(1.0).sub(uvNode.y);

    const leftSkirt = float(1.0).sub(smoothstep(skirtInner, this.skirtWidthNode!, uvNode.x)).mul(instEdgeSkirt.x);
    const rightSkirt = float(1.0).sub(smoothstep(skirtInner, this.skirtWidthNode!, oneMinusSkirtUVX)).mul(instEdgeSkirt.y);
    const bottomSkirt = float(1.0).sub(smoothstep(skirtInner, this.skirtWidthNode!, uvNode.y)).mul(instEdgeSkirt.z);
    const topSkirt = float(1.0).sub(smoothstep(skirtInner, this.skirtWidthNode!, oneMinusSkirtUVY)).mul(instEdgeSkirt.w);

    const skirtMask = clamp(leftSkirt.add(rightSkirt).add(bottomSkirt).add(topSkirt), 0.0, 4.0);
    const skirtOffset = vec3(0, this.skirtDepthNode!.mul(skirtMask).negate(), 0);

    material.positionNode = positionLocal.add(displacement).add(skirtOffset);

    // Calculate normal for slope detection (do this first)
    const normalNode = this.createTerrainNormalSobel(
      this.heightMapNode!,
      globalUV,
      this.maxHeightNode!,
      heightMapWidth,
      heightMapHeight,
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
    const oneMinusBorderUVX = float(1.0).sub(uvNode.x);
    const oneMinusBorderUVY = float(1.0).sub(uvNode.y);
    const maxUV2 = oneMinusBorderUVX.max(oneMinusBorderUVY);
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
   * Set skirt depth in world units.
   */
  setSkirtDepth(depth: number): void {
    if (this.skirtDepthNode) {
      this.skirtDepthNode.value = Math.max(0, depth);
    }
  }

  /**
   * Set skirt width in local chunk UV space (0-0.5).
   */
  setSkirtWidth(width: number): void {
    if (this.skirtWidthNode) {
      this.skirtWidthNode.value = Math.max(0.0001, Math.min(0.49, width));
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
      snowHeight: this.snowHeightNode,
      skirtDepth: this.skirtDepthNode,
      skirtWidth: this.skirtWidthNode
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
    heightMapWidth: number,
    heightMapHeight: number,
    worldSize: number
  ): Node {
    return Fn(() => {
      const texelSizeX = float(1.0 / heightMapWidth).toVar();
      const texelSizeY = float(1.0 / heightMapHeight).toVar();
      const worldStepX = float(worldSize / heightMapWidth).toVar();
      const worldStepZ = float(worldSize / heightMapHeight).toVar();

      const hTL = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSizeX.negate(), texelSizeY.negate()))).r.toVar();
      const hTC = texture(heightMapNode as TextureNode, globalUV.add(vec2(0, texelSizeY.negate()))).r.toVar();
      const hTR = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSizeX, texelSizeY.negate()))).r.toVar();
      const hCL = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSizeX.negate(), 0))).r.toVar();
      const hCR = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSizeX, 0))).r.toVar();
      const hBL = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSizeX.negate(), texelSizeY))).r.toVar();
      const hBC = texture(heightMapNode as TextureNode, globalUV.add(vec2(0, texelSizeY))).r.toVar();
      const hBR = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSizeX, texelSizeY))).r.toVar();

      const sobelX = hTR.add(hCR.mul(2)).add(hBR).sub(hTL.add(hCL.mul(2)).add(hBL)).toVar();
      const sobelZ = hBL.add(hBC.mul(2)).add(hBR).sub(hTL.add(hTC.mul(2)).add(hTR)).toVar();

      const strengthX = maxHeightNode.div(worldStepX).toVar();
      const strengthZ = maxHeightNode.div(worldStepZ).toVar();
      const dx = sobelX.mul(strengthX).toVar();
      const dz = sobelZ.mul(strengthZ).toVar();

      const normal = vec3(dx.negate(), 1, dz.negate()).toVar();
      return normalize(normal);
    })();
  }
}
