import * as THREE from 'three';
import {
    texture, uv, uniform, vec3, vec2, add, mul, float, positionLocal, normalize, attribute, Fn
} from 'three/tsl';
import { Node, TextureNode, UniformNode } from 'three/webgpu';
import { TerrainMaterialContext } from '../core/types';

/**
 * Utility functions for creating terrain material nodes.
 * 
 * These can be used by custom material providers to add proper
 * heightmap displacement and normal calculation without duplicating code.
 * 
 * @example
 * ```typescript
 * import { TerrainMaterialNodes } from '@interverse/three-terrain-lod';
 * 
 * class MyMaterialProvider implements TerrainMaterialProvider {
 *   createMaterial(context: TerrainMaterialContext): THREE.Material {
 *     const nodes = new TerrainMaterialNodes(context);
 *     
 *     const material = new MeshPhysicalNodeMaterial();
 *     material.positionNode = nodes.getDisplacementNode();
 *     material.normalNode = nodes.getNormalNode();
 *     
 *     // Add your custom color/appearance nodes here
 *     material.colorNode = myCustomColorNode;
 *     
 *     return material;
 *   }
 * }
 * ```
 */
export class TerrainMaterialNodes {
    private context: TerrainMaterialContext;
    private heightMapNode: Node;
    private maxHeightNode: UniformNode<number>;
    private globalUVNode: Node;

    constructor(context: TerrainMaterialContext) {
        this.context = context;
        this.heightMapNode = texture(context.heightMap);
        this.maxHeightNode = uniform(context.maxHeight);

        // Calculate global UV from instance attributes
        const instUVTransform = attribute('instanceUVTransform', 'vec3');
        const instUVScale = instUVTransform.x;
        const instUVOffset = vec2(instUVTransform.y, instUVTransform.z);

        // Build UV coordinates (flip Y to match heightmap orientation)
        const uvNode = vec2(uv().x, add(float(1.0), mul(uv().y, float(-1.0))));
        const scaledUV = uvNode.mul(vec2(instUVScale, instUVScale));
        this.globalUVNode = scaledUV.add(instUVOffset);
    }

    /**
     * Get the heightmap-sampled height value (0-1).
     * Use this for height-based effects in your material.
     */
    getHeightNode(): Node {
        const heightData = texture(this.heightMapNode as TextureNode, this.globalUVNode);
        return heightData.r;
    }

    /**
     * Get the global UV node.
     * This is the UV transformed for the current terrain chunk.
     */
    getGlobalUV(): Node {
        return this.globalUVNode;
    }

    /**
     * Get the vertex displacement node.
     * Apply this to material.positionNode for proper terrain height.
     */
    getDisplacementNode(): Node {
        const height = this.getHeightNode();
        const displacement = vec3(0, 1, 0).mul(height.mul(this.maxHeightNode));
        return positionLocal.add(displacement);
    }

    /**
     * Get the terrain normal node using Sobel filter.
     * Apply this to material.normalNode for proper lighting.
     */
    getNormalNode(): Node {
        return this.createTerrainNormalSobel();
    }

    /**
     * Update max height uniform.
     */
    setMaxHeight(height: number): void {
        this.maxHeightNode.value = height;
    }

    /**
     * Create terrain normals using Sobel filter on the heightmap.
     */
    private createTerrainNormalSobel(): Node {
        const { resolution, worldSize } = this.context;
        const heightMapNode = this.heightMapNode;
        const globalUV = this.globalUVNode;
        const maxHeightNode = this.maxHeightNode;

        return Fn(() => {
            const texelSize = float(1.0 / resolution).toVar();
            const worldStep = float(worldSize / resolution).toVar();

            // Sample 8 surrounding heights using Sobel kernel
            const hTL = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSize.negate(), texelSize.negate()))).r.toVar();
            const hTC = texture(heightMapNode as TextureNode, globalUV.add(vec2(0, texelSize.negate()))).r.toVar();
            const hTR = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSize, texelSize.negate()))).r.toVar();
            const hCL = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSize.negate(), 0))).r.toVar();
            const hCR = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSize, 0))).r.toVar();
            const hBL = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSize.negate(), texelSize))).r.toVar();
            const hBC = texture(heightMapNode as TextureNode, globalUV.add(vec2(0, texelSize))).r.toVar();
            const hBR = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSize, texelSize))).r.toVar();

            // Sobel operators
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
