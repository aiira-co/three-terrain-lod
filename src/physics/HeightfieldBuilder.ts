import { ChunkCollisionData } from '../core/types';

/**
 * Converts ChunkCollisionData into Rapier heightfield parameters.
 *
 * Rapier API contract (non-obvious, verified empirically against parry source):
 *   - nrows/ncols are SUBDIVISION counts (vertex_count - 1)
 *   - scale.x / scale.z are TOTAL extent of the heightfield (NOT per-cell)
 *   - heights array indexed as heights[j*(nrows+1) + i] where
 *     i indexes along Z, j indexes along X
 *
 * ChunkCollisionData stores heights row-major with row=Z, col=X, i.e.
 *   heights[z*(cols) + x]. That matches Rapier's index formula only if
 *   we interpret "row" as Rapier's "j" (along X) and "col" as "i" (along Z),
 *   which means the heightfield is X/Z transposed. We undo that here by
 *   transposing the heights array.
 */
export class HeightfieldBuilder {
  static build(data: ChunkCollisionData): {
    nrows: number;
    ncols: number;
    heights: Float32Array;
    scale: { x: number; y: number; z: number };
  } {
    const nrows = data.cols - 1;
    const ncols = data.rows - 1;
    const rows = data.rows;
    const cols = data.cols;

    const transposed = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        transposed[c * rows + r] = data.heights[r * cols + c];
      }
    }

    const scale = { x: data.size, y: 1.0, z: data.size };

    return { nrows, ncols, heights: transposed, scale };
  }

  static chunkKey(x: number, z: number): string {
    return `${x}_${z}`;
  }

  static chunkKeyFromData(data: ChunkCollisionData): string {
    return HeightfieldBuilder.chunkKey(data.index.x, data.index.z);
  }
}
