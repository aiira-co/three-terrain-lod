import * as THREE from 'three';
import {
    texture, uv, uniform, vec3, vec2, add, mul, float, positionLocal, normalize, attribute, Fn, smoothstep, clamp, mix
} from 'three/tsl';
import { TextureNode } from 'three/webgpu';
import { TerrainMaterialContext } from '../core/types';

type Node = any;
type UniformNode<T = any> = any;

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
    private normalStrengthNode: UniformNode<number>;
    private heightSmoothingNode: UniformNode<number>;
    private heightSmoothingSpreadNode: UniformNode<number>;
    private globalUVNode: Node;
    private heightMapWidth: number;
    private heightMapHeight: number;

    constructor(context: TerrainMaterialContext) {
        this.context = context;
        this.heightMapNode = texture(context.heightMap);
        this.maxHeightNode = uniform(context.maxHeight);
        this.skirtDepthNode = uniform(Math.max(0, context.skirtDepth));
        this.skirtWidthNode = uniform(Math.max(0.0001, Math.min(0.49, context.skirtWidth)));
        this.normalStrengthNode = uniform(Math.max(0, context.normalStrength));
        this.heightSmoothingNode = uniform(Math.min(1, Math.max(0, context.heightSmoothing)));
        this.heightSmoothingSpreadNode = uniform(Math.max(0.25, context.heightSmoothingSpread));

        const heightMapImage = context.heightMap.image as { width?: number; height?: number } | undefined;
        this.heightMapWidth = (typeof heightMapImage?.width === 'number' && heightMapImage.width > 0)
            ? heightMapImage.width
            : (context.resolution + 1);
        this.heightMapHeight = (typeof heightMapImage?.height === 'number' && heightMapImage.height > 0)
            ? heightMapImage.height
            : (context.resolution + 1);

        // Calculate global UV from instance attributes
        const instUVTransform: any = attribute('instanceUVTransform', 'vec3');
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
        const rawHeight = texture(this.heightMapNode as TextureNode, this.globalUVNode).r;
        const filteredHeight = this.createFilteredHeight();
        return mix(rawHeight, filteredHeight, this.heightSmoothingNode);
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

        const instEdgeSkirt: any = attribute('instanceEdgeSkirt', 'vec4');
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
     * Update terrain normal strength uniform.
     */
    setNormalStrength(strength: number): void {
        this.normalStrengthNode.value = Math.max(0, strength);
    }

    /**
     * Update displacement smoothing blend.
     */
    setHeightSmoothing(amount: number): void {
        this.heightSmoothingNode.value = Math.min(1, Math.max(0, amount));
    }

    /**
     * Update displacement smoothing spread in texels.
     */
    setHeightSmoothingSpread(spread: number): void {
        this.heightSmoothingSpreadNode.value = Math.max(0.25, spread);
    }

    private createFilteredHeight(): Node {
        const heightMapNode = this.heightMapNode;
        const globalUV = this.globalUVNode;
        const heightMapWidth = this.heightMapWidth;
        const heightMapHeight = this.heightMapHeight;
        const spreadNode = this.heightSmoothingSpreadNode;

        return Fn(() => {
            const texelSizeX = float(1.0 / heightMapWidth).mul(spreadNode).toVar();
            const texelSizeY = float(1.0 / heightMapHeight).mul(spreadNode).toVar();

            const hC = texture(heightMapNode as TextureNode, globalUV).r.toVar();
            const hN = texture(heightMapNode as TextureNode, globalUV.add(vec2(0, texelSizeY.negate()))).r.toVar();
            const hS = texture(heightMapNode as TextureNode, globalUV.add(vec2(0, texelSizeY))).r.toVar();
            const hE = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSizeX, 0))).r.toVar();
            const hW = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSizeX.negate(), 0))).r.toVar();
            const hNE = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSizeX, texelSizeY.negate()))).r.toVar();
            const hNW = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSizeX.negate(), texelSizeY.negate()))).r.toVar();
            const hSE = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSizeX, texelSizeY))).r.toVar();
            const hSW = texture(heightMapNode as TextureNode, globalUV.add(vec2(texelSizeX.negate(), texelSizeY))).r.toVar();

            const cardinals = hN.add(hS).add(hE).add(hW).mul(2.0).toVar();
            const diagonals = hNE.add(hNW).add(hSE).add(hSW).toVar();
            return hC.mul(4.0).add(cardinals).add(diagonals).div(16.0);
        })();
    }

    /**
     * Create terrain normals using Sobel filter on the heightmap.
     */
    private createTerrainNormalSobel(): Node {
        const { worldSize } = this.context;
        const heightMapNode = this.heightMapNode;
        const globalUV = this.globalUVNode;
        const maxHeightNode = this.maxHeightNode;
        const normalStrengthNode = this.normalStrengthNode;
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

            const strengthX = maxHeightNode.mul(normalStrengthNode).div(worldStepX).toVar();
            const strengthZ = maxHeightNode.mul(normalStrengthNode).div(worldStepZ).toVar();
            const dx = sobelX.mul(strengthX).toVar();
            const dz = sobelZ.mul(strengthZ).toVar();

            const normal = vec3(dx.negate(), 1, dz.negate()).toVar();
            return normalize(normal);
        })();
    }
}

