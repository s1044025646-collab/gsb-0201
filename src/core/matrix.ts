import type { ModelParams } from '../types.js';

/**
 * 构造「出生后普查」Leslie 矩阵 L（m×m，行主序二维数组）。
 *
 *   L[0][j] = f_j   （首行：年龄组 j 的繁殖贡献，进入 0 龄组）
 *   L[i+1][i] = s_i （次对角线：年龄组 i 存活进入 i+1；i = 0..m-2）
 *   其余位置为 0（结构零，不参与任何加小数修补）
 *
 * 注意：Leslie 矩阵不是概率转移矩阵——列和一般不等于 1（f_j 可 >1，
 * 末组成员在时间步后离开系统）。严禁归一化。
 */
export function buildLeslieMatrix(params: ModelParams): number[][] {
  const m = params.ageGroups.length;
  const matrix: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  for (let j = 0; j < m; j++) {
    matrix[0][j] = params.fertility[j];
  }
  for (let i = 0; i < m - 1; i++) {
    matrix[i + 1][i] = params.survival[i];
  }
  return matrix;
}

export function matVec(matrix: number[][], vec: number[]): number[] {
  const m = matrix.length;
  const out = new Array<number>(m).fill(0);
  for (let i = 0; i < m; i++) {
    let sum = 0;
    const row = matrix[i];
    for (let j = 0; j < m; j++) {
      sum += row[j] * vec[j];
    }
    out[i] = sum;
  }
  return out;
}

export function vecSum(vec: number[]): number {
  let sum = 0;
  for (const x of vec) sum += x;
  return sum;
}

export function infNormVec(vec: number[]): number {
  let norm = 0;
  for (const x of vec) {
    const a = Math.abs(x);
    if (a > norm) norm = a;
  }
  return norm;
}

export function infNormMat(matrix: number[][]): number {
  let norm = 0;
  for (const row of matrix) {
    for (const x of row) {
      const a = Math.abs(x);
      if (a > norm) norm = a;
    }
  }
  return norm;
}

export function transpose(matrix: number[][]): number[][] {
  const m = matrix.length;
  const out: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      out[j][i] = matrix[i][j];
    }
  }
  return out;
}
