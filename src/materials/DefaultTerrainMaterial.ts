import * as THREE from 'three';
import {
  texture, uv, uniform, vec3, vec2, vec4, mix, mul, add,
  positionLocal, float, step, normalize, Fn, attribute
} from 'three/tsl';
import { MeshPhysicalNodeMaterial, Node, TextureNode, UniformNode } from 'three/webgpu';
import { TerrainMaterialProvider, TerrainMaterialContext } from '../core/types';

/**
 * Default terrain material provider using Three.js TSL (Shader Language).
 * 
 * Creates a heightmap-displaced material with:
 * - Vertex displacement from heightmap
 * - Height-based coloring (low = green, high = white)
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
  private colorLowNode: Node | null = null;
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
    this.colorHighNode = uniform(vec3(0.867, 0.867, 0.867)); // Snow white
    this.colorLowNode = uniform(vec3(0.176, 0.298, 0.118));  // Grass green
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

    // Color based on height
    const terrainColor = this.colorLowNode!.mix(this.colorHighNode!, height);
    
    // Diffuse texture tiling
    let finalColor: Node;
    if (this.diffuseTextureNode) {
      const tiledUV = uvNode.mul(vec2(4.0, 4.0));
      const diffuseColor = texture(this.diffuseTextureNode as TextureNode, tiledUV);
      finalColor = terrainColor.mul(diffuseColor.rgb);
    } else {
      finalColor = terrainColor;
    }

    // Simple lighting factor based on height
    const lightingFactor = float(0.5).add(float(0.5).mul(height));
    finalColor = finalColor.mul(lightingFactor);

    // Chunk border visualization
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

    // Normal calculation using Sobel filter
    material.normalNode = this.createTerrainNormalSobel(
      this.heightMapNode!,
      globalUV,
      this.maxHeightNode!,
      context.resolution,
      context.worldSize
    );

    material.colorNode = vec4(finalColor.x, finalColor.y, finalColor.z, float(1.0));
    material.wireframe = context.wireframe;
    material.side = THREE.DoubleSide;

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
