import * as THREE from 'three';
import {
    texture, uv, uniform, vec2, vec3, vec4, float, max, add, sub,
    smoothstep, length, pow, mix, Fn
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

/**
 * Brush data for heightmap composition.
 */
export interface BrushData {
    /** Unique identifier */
    uuid: string;
    /** World position (x, z used for placement) */
    position: THREE.Vector3;
    /** Rotation in radians */
    rotation: THREE.Euler;
    /** Scale factor */
    scale: THREE.Vector3;
    /** Grayscale brush alpha texture (white = full height) */
    alphaTexture: THREE.Texture;
    /** Blend mode for composition */
    blendMode: 'add' | 'max' | 'subtract';
    /** Edge falloff (0 = hard edge, 1 = full fade) */
    falloff: number;
    /** Power curve for height (1 = linear, >1 = sharper peaks) */
    inclineStrength: number;
    /** Maximum height contribution */
    height: number;
    /** Whether brush is active */
    visible: boolean;
}

/**
 * Configuration for HeightmapCompositor.
 */
export interface HeightmapCompositorConfig {
    /** Output texture resolution (default: 1024) */
    resolution?: number;
    /** World size in units (default: 2048) */
    worldSize?: number;
    /** Base height (black level, default: 0) */
    baseHeight?: number;
}

/**
 * Resolved configuration with defaults applied.
 */
interface ResolvedCompositorConfig {
    resolution: number;
    worldSize: number;
    baseHeight: number;
}

/**
 * HeightmapCompositor - GPU-based non-destructive heightmap composition.
 * 
 * Renders brush stamps to a render target using GPU blending,
 * producing a heightmap texture that can be used for terrain displacement.
 * 
 * @example
 * ```typescript
 * const compositor = new HeightmapCompositor({ resolution: 1024, worldSize: 2048 });
 * 
 * compositor.addBrush({
 *     uuid: 'mountain-1',
 *     position: new Vector3(100, 0, 200),
 *     rotation: new Euler(0, 0, 0),
 *     scale: new Vector3(100, 1, 100),
 *     alphaTexture: mountainBrushTexture,
 *     blendMode: 'max',
 *     falloff: 0.3,
 *     inclineStrength: 1.5,
 *     height: 50,
 *     visible: true
 * });
 * 
 * // In render loop
 * compositor.compose(renderer);
 * terrain.setHeightMap(compositor.getOutputTexture());
 * ```
 */
export class HeightmapCompositor {
    private config: ResolvedCompositorConfig;
    private renderTarget: THREE.WebGLRenderTarget;
    private compositorScene: THREE.Scene;
    private compositorCamera: THREE.OrthographicCamera;
    private brushes: Map<string, BrushData> = new Map();
    private brushMeshes: Map<string, THREE.Mesh> = new Map();
    private isDirty: boolean = true;
    private baseMaterial: THREE.MeshBasicMaterial;
    private outputTexture: THREE.Texture;

    constructor(config: HeightmapCompositorConfig = {}) {
        this.config = {
            resolution: config.resolution ?? 1024,
            worldSize: config.worldSize ?? 2048,
            baseHeight: config.baseHeight ?? 0
        };

        // Create render target (RGBA format for compatibility, R channel = height)
        this.renderTarget = new THREE.WebGLRenderTarget(
            this.config.resolution,
            this.config.resolution,
            {
                type: THREE.FloatType,
                format: THREE.RGBAFormat,
                magFilter: THREE.LinearFilter,
                minFilter: THREE.LinearMipMapLinearFilter,
                generateMipmaps: true,
                depthBuffer: false,
                stencilBuffer: false
            }
        );

        // Compositor scene and orthographic camera
        this.compositorScene = new THREE.Scene();

        const halfWorld = this.config.worldSize / 2;
        this.compositorCamera = new THREE.OrthographicCamera(
            -halfWorld, halfWorld,   // left, right
            halfWorld, -halfWorld,   // top, bottom (flipped for UV alignment)
            0.1, 1000
        );
        this.compositorCamera.position.set(0, 100, 0);
        this.compositorCamera.lookAt(0, 0, 0);

        // Base plane (black background)
        this.baseMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(
                this.config.baseHeight / 255,
                this.config.baseHeight / 255,
                this.config.baseHeight / 255
            )
        });
        const basePlane = new THREE.Mesh(
            new THREE.PlaneGeometry(this.config.worldSize, this.config.worldSize),
            this.baseMaterial
        );
        basePlane.rotation.x = -Math.PI / 2;
        basePlane.position.y = -10; // Below brushes
        this.compositorScene.add(basePlane);

        this.outputTexture = this.renderTarget.texture;
    }

    /**
     * Add a brush to the compositor.
     * @param brush - Brush configuration
     */
    addBrush(brush: BrushData): void {
        this.brushes.set(brush.uuid, brush);
        this._createBrushMesh(brush);
        this.isDirty = true;
    }

    /**
     * Update an existing brush.
     * @param uuid - Brush UUID
     * @param updates - Partial brush data to update
     */
    updateBrush(uuid: string, updates: Partial<BrushData>): void {
        const brush = this.brushes.get(uuid);
        if (!brush) return;

        Object.assign(brush, updates);
        this._updateBrushMesh(uuid);
        this.isDirty = true;
    }

    /**
     * Remove a brush from the compositor.
     * @param uuid - Brush UUID
     */
    removeBrush(uuid: string): void {
        this.brushes.delete(uuid);

        const mesh = this.brushMeshes.get(uuid);
        if (mesh) {
            this.compositorScene.remove(mesh);
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
            this.brushMeshes.delete(uuid);
        }

        this.isDirty = true;
    }

    /**
     * Get a brush by UUID.
     * @param uuid - Brush UUID
     */
    getBrush(uuid: string): BrushData | undefined {
        return this.brushes.get(uuid);
    }

    /**
     * Get all brushes.
     */
    getAllBrushes(): BrushData[] {
        return Array.from(this.brushes.values());
    }

    /**
     * Mark compositor as needing recomposition.
     */
    markDirty(): void {
        this.isDirty = true;
    }

    /**
     * Check if compositor needs updating.
     */
    needsUpdate(): boolean {
        return this.isDirty;
    }

    /**
     * Compose all brushes to the render target.
     * Call this every frame or when brushes change.
     * @param renderer - WebGL renderer
     * @param force - Force composition even if not dirty
     */
    compose(renderer: THREE.WebGLRenderer, force: boolean = false): void {
        if (!this.isDirty && !force) return;

        // Store current state
        const currentRenderTarget = renderer.getRenderTarget();
        const currentAutoClear = renderer.autoClear;

        // Render to our target
        renderer.setRenderTarget(this.renderTarget);
        renderer.autoClear = true;
        renderer.clear();
        renderer.render(this.compositorScene, this.compositorCamera);

        // Restore state
        renderer.setRenderTarget(currentRenderTarget);
        renderer.autoClear = currentAutoClear;

        this.isDirty = false;
    }

    /**
     * Get the output heightmap texture.
     * Use this with TerrainLOD.setHeightMap().
     */
    getOutputTexture(): THREE.Texture {
        return this.outputTexture;
    }

    /**
     * Get the render target for advanced use.
     */
    getRenderTarget(): THREE.WebGLRenderTarget {
        return this.renderTarget;
    }

    /**
     * Get current configuration.
     */
    getConfig(): ResolvedCompositorConfig {
        return { ...this.config };
    }

    /**
     * Set base height (adjusts black level).
     * @param height - Base height value (0-255 scale)
     */
    setBaseHeight(height: number): void {
        this.config.baseHeight = height;
        const normalizedHeight = height / 255;
        this.baseMaterial.color.setRGB(normalizedHeight, normalizedHeight, normalizedHeight);
        this.isDirty = true;
    }

    /**
     * Clear all brushes.
     */
    clear(): void {
        for (const uuid of this.brushes.keys()) {
            this.removeBrush(uuid);
        }
        this.isDirty = true;
    }

    /**
     * Dispose all resources.
     */
    dispose(): void {
        this.clear();
        this.renderTarget.dispose();
        this.baseMaterial.dispose();
    }

    /**
     * Serialize compositor state for saving.
     */
    toJSON(): object {
        return {
            config: this.config,
            brushes: Array.from(this.brushes.values()).map(brush => ({
                uuid: brush.uuid,
                position: { x: brush.position.x, y: brush.position.y, z: brush.position.z },
                rotation: { x: brush.rotation.x, y: brush.rotation.y, z: brush.rotation.z },
                scale: { x: brush.scale.x, y: brush.scale.y, z: brush.scale.z },
                blendMode: brush.blendMode,
                falloff: brush.falloff,
                inclineStrength: brush.inclineStrength,
                height: brush.height,
                visible: brush.visible
                // Note: alphaTexture needs to be handled separately (URL or base64)
            }))
        };
    }

    // ============================================
    // Private Methods
    // ============================================

    /**
     * Create a mesh for a brush.
     */
    private _createBrushMesh(brush: BrushData): void {
        // Create plane geometry for the brush stamp
        const geometry = new THREE.PlaneGeometry(1, 1);
        geometry.rotateX(-Math.PI / 2);

        // Create material based on blend mode
        const material = this._createBrushMaterial(brush);

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `brush_${brush.uuid}`;

        this._applyBrushTransform(mesh, brush);

        if (brush.visible) {
            this.compositorScene.add(mesh);
        }

        this.brushMeshes.set(brush.uuid, mesh);
    }

    /**
     * Update an existing brush mesh.
     */
    private _updateBrushMesh(uuid: string): void {
        const brush = this.brushes.get(uuid);
        const mesh = this.brushMeshes.get(uuid);
        if (!brush || !mesh) return;

        this._applyBrushTransform(mesh, brush);

        // Update visibility
        if (brush.visible && !mesh.parent) {
            this.compositorScene.add(mesh);
        } else if (!brush.visible && mesh.parent) {
            this.compositorScene.remove(mesh);
        }

        // Update material if needed
        const material = mesh.material as THREE.ShaderMaterial;
        if (material.uniforms) {
            material.uniforms.falloff.value = brush.falloff;
            material.uniforms.inclineStrength.value = brush.inclineStrength;
            material.uniforms.maxHeight.value = brush.height / 255; // Normalize
        }
    }

    /**
     * Apply brush transform to mesh.
     */
    private _applyBrushTransform(mesh: THREE.Mesh, brush: BrushData): void {
        mesh.position.set(brush.position.x, 0, brush.position.z);
        mesh.rotation.y = brush.rotation.y;
        mesh.scale.set(brush.scale.x, 1, brush.scale.z);
    }

    /**
     * Create material for brush based on blend mode.
     */
    private _createBrushMaterial(brush: BrushData): THREE.ShaderMaterial {
        // For now, use a simple shader material
        // In production, this should use TSL nodes for WebGPU
        const material = new THREE.ShaderMaterial({
            uniforms: {
                alphaMap: { value: brush.alphaTexture },
                falloff: { value: brush.falloff },
                inclineStrength: { value: brush.inclineStrength },
                maxHeight: { value: brush.height / 255 } // Normalize to 0-1 for texture
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D alphaMap;
                uniform float falloff;
                uniform float inclineStrength;
                uniform float maxHeight;
                varying vec2 vUv;
                
                void main() {
                    // Sample brush alpha texture
                    float alpha = texture2D(alphaMap, vUv).r;
                    
                    // Apply falloff from edges
                    vec2 centered = vUv * 2.0 - 1.0;
                    float dist = length(centered);
                    float falloffMask = 1.0 - smoothstep(1.0 - falloff, 1.0, dist);
                    
                    // Apply incline strength (power curve)
                    float height = pow(alpha * falloffMask, inclineStrength);
                    
                    // Scale by max height
                    float finalHeight = height * maxHeight;
                    
                    gl_FragColor = vec4(finalHeight, finalHeight, finalHeight, 1.0);
                }
            `,
            transparent: false,
            depthTest: false,
            depthWrite: false,
            blending: this._getBlendingMode(brush.blendMode)
        });

        return material;
    }

    /**
     * Get Three.js blending constant for blend mode.
     */
    private _getBlendingMode(mode: 'add' | 'max' | 'subtract'): THREE.Blending {
        switch (mode) {
            case 'add':
                return THREE.AdditiveBlending;
            case 'subtract':
                return THREE.SubtractiveBlending;
            case 'max':
                // Max blending isn't directly supported, use additive as fallback
                // For true max blending, we'd need custom blend equations
                return THREE.AdditiveBlending;
            default:
                return THREE.AdditiveBlending;
        }
    }
}
