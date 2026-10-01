import type {
  AlgorithmConfig,
  EigenAnalysis,
  ModelParams,
  SensitivityResult,
} from '../types.js';
import { buildLeslieMatrix } from './matrix.js';
import {
  dominantEigenvalueByCharacteristicEquation,
} from './eigen.js';

/**
 * 对可判定的简单正主特征值 r，计算矩阵元素敏感度与无量纲弹性：
 *
 *   ∂r/∂L_ij = v_i w_j / (v^T w)      （Caswell 公式）
 *   e_ij     = (L_ij / r) ∂r/∂L_ij
 *
 * 其中 w 为右主特征向量（取 w_0=1 的递推形式即可，比值与缩放无关），
 * v 为左主特征向量。全部 m×m 元素都给出条目：
 * 结构零位敏感度按公式可能非零（如紧邻存活位），但弹性必为 0，
 * 因为 L_ij=0；只有首行与次对角线的元素映射回原始繁殖率/存活率。
 *
 * 弹性矩阵所有元素之和为 1（数量级核对）。
 * 中心差分核对：对每个非零元素，用 ±h 扰动矩阵后重新解特征方程。
 */
export function analyzeSensitivity(
  params: ModelParams,
  eigen: EigenAnalysis,
  config: AlgorithmConfig,
): SensitivityResult {
  const r = eigen.dominantEigenvalue;
  if (r === null || r <= 0) {
    return {
      entries: [],
      elasticitySum: null,
      finiteDifferenceCheck: [],
      available: false,
      reason: '不存在可判定的简单正主特征值，敏感度/弹性不适用。',
    };
  }

  const m = params.ageGroups.length;
  const matrix = buildLeslieMatrix(params);

  // 与 eigen.ts 一致地重建 v、w（w_0=1 形式）。
  const w = new Array<number>(m).fill(0);
  w[0] = 1;
  for (let i = 0; i < m - 1; i++) {
    w[i + 1] = (params.survival[i] / r) * w[i];
  }
  const v = new Array<number>(m).fill(0);
  v[m - 1] = params.fertility[m - 1] / r;
  for (let i = m - 2; i >= 0; i--) {
    v[i] = (params.fertility[i] + params.survival[i] * v[i + 1]) / r;
  }
  const vTw = v.reduce((acc, vi, i) => acc + vi * w[i], 0);

  const entries: SensitivityResult['entries'] = [];
  let elasticitySum = 0;
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      const element = matrix[i][j];
      const sensitivity = (v[i] * w[j]) / vTw;
      const elasticity = (element / r) * sensitivity;
      elasticitySum += elasticity;
      let param: SensitivityResult['entries'][number]['param'] = { kind: 'structural-zero' };
      if (i === 0 && element !== 0 || i === 0 && j >= 0 && params.fertility[j] !== 0 && j === 0) {
        // handled below uniformly
      }
      if (i === 0) {
        param = { kind: 'fertility', index: j };
      } else if (i === j + 1) {
        param = { kind: 'survival', index: j };
      } else {
        param = { kind: 'structural-zero' };
      }
      entries.push({ row: i, col: j, element, sensitivity, elasticity, param });
    }
  }

  // 中心差分核对（对每个非零元素）。
  const h = config.perturbationEpsilon;
  const finiteDifferenceCheck: SensitivityResult['finiteDifferenceCheck'] = [];
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      if (matrix[i][j] === 0) continue;
      const plus = perturb(params, i, j, h);
      const minus = perturb(params, i, j, -h);
      const rPlus = dominantEigenvalueByCharacteristicEquation(plus);
      const rMinus = dominantEigenvalueByCharacteristicEquation(minus);
      if (rPlus === null || rMinus === null) continue;
      const centralDifference = (rPlus - rMinus) / (2 * h);
      const analytic = (v[i] * w[j]) / vTw;
      finiteDifferenceCheck.push({
        row: i,
        col: j,
        analytic,
        centralDifference,
        absoluteDifference: Math.abs(analytic - centralDifference),
      });
    }
  }

  return {
    entries,
    elasticitySum,
    finiteDifferenceCheck,
    available: true,
    reason: null,
  };
}

/** 按矩阵位置 (row,col) 扰动，并映射回 fertility/survival 参数后重建模型。 */
function perturb(
  params: ModelParams,
  row: number,
  col: number,
  delta: number,
): ModelParams {
  const next: ModelParams = {
    ageGroups: params.ageGroups.slice(),
    fertility: params.fertility.slice(),
    survival: params.survival.slice(),
    initialPopulation: params.initialPopulation.slice(),
  };
  if (row === 0) {
    next.fertility[col] = Math.max(0, next.fertility[col] + delta);
  } else if (row === col + 1) {
    next.survival[col] = Math.min(1, Math.max(0, next.survival[col] + delta));
  }
  return next;
}
