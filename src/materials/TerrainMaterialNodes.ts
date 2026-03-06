import * as THREE from 'three';
import {
    texture, uv, uniform, vec3, vec2, add, mul, float, positionLocal, normalize, attribute, Fn, smoothstep, clamp
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
    private skirtDepthNode: UniformNode<number>;
    private skirtWidthNode: UniformNode<number>;
    private globalUVNode: Node;
    private heightMapWidth: number;
    private heightMapHeight: number;

    constructor(context: TerrainMaterialContext) {
        this.context = context;
        this.heightMapNode = texture(context.heightMap);
        this.maxHeightNode = uniform(context.maxHeight);
        this.skirtDepthNode = uniform(Math.max(0, context.skirtDepth));
        this.skirtWidthNode = uniform(Math.max(0.0001, Math.min(0.49, context.skirtWidth)));
        const heightMapImage = context.heightMap.image as { width?: number; height?: number } | undefined;
        this.heightMapWidth = (typeof heightMapImage?.width === 'number' && heightMapImage.width > 0)
            ? heightMapImage.width
            : (context.resolution + 1);
        this.heightMapHeight = (typeof heightMapImage?.height === 'number' && heightMapImage.height > 0)
            ? heightMapImage.height
            : (context.resolution + 1);

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

        const instEdgeSkirt = attribute('instanceEdgeSkirt', 'vec4');
        const uvNode = vec2(uv().x, add(float(1.0), mul(uv().y, float(-1.0))));

        const skirtInner = this.skirtWidthNode.mul(float(0.65));
        const oneMinusSkirtUVX = float(1.0).sub(uvNode.x);
        const oneMinusSkirtUVY = float(1.0).sub(uvNode.y);

        const leftSkirt = float(1.0).sub(smoothstep(skirtInner, this.skirtWidthNode, uvNode.x)).mul(instEdgeSkirt.x);
        const rightSkirt = float(1.0).sub(smoothstep(skirtInner, this.skirtWidthNode, oneMinusSkirtUVX)).mul(instEdgeSkirt.y);
        const bottomSkirt = float(1.0).sub(smoothstep(skirtInner, this.skirtWidthNode, uvNode.y)).mul(instEdgeSkirt.z);
        const topSkirt = float(1.0).sub(smoothstep(skirtInner, this.skirtWidthNode, oneMinusSkirtUVY)).mul(instEdgeSkirt.w);

        const skirtMask = clamp(leftSkirt.add(rightSkirt).add(bottomSkirt).add(topSkirt), 0.0, 4.0);
        const skirtOffset = vec3(0, this.skirtDepthNode.mul(skirtMask).negate(), 0);

        return positionLocal.add(displacement).add(skirtOffset);
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
        const { worldSize } = this.context;
        const heightMapNode = this.heightMapNode;
        const globalUV = this.globalUVNode;
        const maxHeightNode = this.maxHeightNode;
        const heightMapWidth = this.heightMapWidth;
        const heightMapHeight = this.heightMapHeight;

        return Fn(() => {
            const texelSizeX = float(1.0 / heightMapWidth).toVar();
            const texelSizeY = float(1.0 / heightMapHeight).toVar();
            const worldStepX = float(worldSize / heightMapWidth).toVar();
            const worldStepZ = float(worldSize / heightMapHeight).toVar();

            // Sample 8 surrounding heights using Sobel kernel
            const hTL = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSizeX.negate(), texelSizeY.negate()))).r.toVar();
            const hTC = texture(heightMapNode as TextureNode, globalUV.add(vec2(0, texelSizeY.negate()))).r.toVar();
            const hTR = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSizeX, texelSizeY.negate()))).r.toVar();
            const hCL = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSizeX.negate(), 0))).r.toVar();
            const hCR = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSizeX, 0))).r.toVar();
            const hBL = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSizeX.negate(), texelSizeY))).r.toVar();
            const hBC = texture(heightMapNode as TextureNode, globalUV.add(vec2(0, texelSizeY))).r.toVar();
            const hBR = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSizeX, texelSizeY))).r.toVar();

            // Sobel operators
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
