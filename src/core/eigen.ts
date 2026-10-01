import type {
  AlgorithmConfig,
  EigenAnalysis,
  ModelParams,
} from '../types.js';
import { analyzeGraph } from './graph.js';
import {
  buildLeslieMatrix,
  infNormVec,
  matVec,
  transpose,
  vecSum,
} from './matrix.js';

/**
 * 长期结构分析。
 *
 * 有限期投影始终按原矩阵执行（在 projection.ts 中完成）；
 * 本函数只在满足条件时声称分布会收敛到唯一稳定结构：
 * - 不可约且非周期（primitive）+ 简单正主特征值 + 幂迭代收敛
 *   => 报告唯一稳定年龄分布；
 * - 不可约但周期 d>1 => 主特征值仍可正且简单，但数量按周期振荡，
 *   不声称收敛，period 与诊断中说明原因；
 * - 可约 => 可能存在多个独立优势类，仅给出可计算的主特征值线索，
 *   不声称唯一稳定分布；
 * - 零繁殖 => 主导特征值为 0，种群灭绝。
 */
export function analyzeLongTerm(
  params: ModelParams,
  config: AlgorithmConfig,
): EigenAnalysis {
  const matrix = buildLeslieMatrix(params);
  const m = params.ageGroups.length;
  const graph = analyzeGraph(params);
  const diagnostics: string[] = [];

  const allZero = params.fertility.every((f) => f === 0);
  if (allZero) {
    return {
      dominantEigenvalue: 0,
      stableAgeDistribution: null,
      reproductiveValue: null,
      reproductiveValueV0Equals1: null,
      rightResidual: null,
      leftResidual: null,
      matrixClass: 'zero',
      period: null,
      converged: false,
      iterations: 0,
      diagnostics: [
        '所有年龄组繁殖率均为 0：Leslie 矩阵严格次随机且无新生个体，',
        '主导特征值为 0，有限步内现有个体随存活不断衰老离开系统，种群必然灭绝。',
        '不存在正的稳定年龄分布；不对零元素添加小数制造答案。',
      ],
    };
  }

  // 不可约性对 Leslie 矩阵等价于 s_0..s_{m-2} > 0 且至少一个 f_j > 0。
  const matrixClass: EigenAnalysis['matrixClass'] = graph.irreducible
    ? (graph.period === 1 ? 'irreducible-primitive' : 'irreducible-periodic')
    : 'reducible';

  if (!graph.irreducible) {
    diagnostics.push(
      '矩阵可约（存在零存活率造成的断裂，或繁殖/存活路径不能使各年龄组互相可达）。',
      `检测到 ${graph.closedSccCount} 个闭合强连通分量；` +
      (graph.closedSccCount > 1
        ? '存在多个独立优势类，可能有模相等的多个主导特征值，不能声称唯一稳定年龄分布。'
        : '虽然只有一个闭合分量，收敛速度与最终结构仍依赖初始数量所在的类，不做唯一性断言。'),
    );
  } else if ((graph.period ?? 1) > 1) {
    diagnostics.push(
      `矩阵不可约但具有周期 d=${graph.period}：各繁殖年龄的 j+1 存在大于 1 的公因子，`,
      `种群结构每 ${graph.period} 步循环振荡而不逐期收敛；长期平均增长率仍可取正主特征值，`,
      '但「分布收敛到唯一稳定结构」的结论不成立（周期情景）。',
    );
  } else {
    diagnostics.push('矩阵不可约且非周期（primitive）：满足 Perron-Frobenius 收敛的结构条件。');
  }

  // 用特征方程（r 的标量方程）二分求主特征值，避免对周期矩阵做幂迭代时的振荡问题。
  const eigenvalue = dominantEigenvalueByCharacteristicEquation(params);
  if (eigenvalue === null || eigenvalue <= 0) {
    diagnostics.push('未能判定简单正主特征值，敏感度/弹性与稳定分布不提供。');
    return {
      dominantEigenvalue: eigenvalue,
      stableAgeDistribution: null,
      reproductiveValue: null,
      reproductiveValueV0Equals1: null,
      rightResidual: null,
      leftResidual: null,
      matrixClass,
      period: graph.period,
      converged: false,
      iterations: 0,
      diagnostics,
    };
  }

  // 右主特征向量：w_0=1，w_{i+1} = (s_i / r) w_i。
  const w = new Array<number>(m).fill(0);
  w[0] = 1;
  for (let i = 0; i < m - 1; i++) {
    w[i + 1] = (params.survival[i] / eigenvalue) * w[i];
  }

  // 左主特征向量（繁殖价值）：v_{m-1}=f_{m-1}/r；
  // v_i = (f_i + s_i v_{i+1}) / r，i = m-2..0。
  const v = new Array<number>(m).fill(0);
  v[m - 1] = params.fertility[m - 1] / eigenvalue;
  for (let i = m - 2; i >= 0; i--) {
    v[i] = (params.fertility[i] + params.survival[i] * v[i + 1]) / eigenvalue;
  }

  // 归一：w 按分量和归一（稳定年龄分布）；v 缩放使 v^T w = 1。
  const wSum = vecSum(w);
  const wNorm = w.map((x) => x / wSum);
  const dot = v.reduce((acc, vi, i) => acc + vi * wNorm[i], 0);
  const vNorm = v.map((x) => x / dot);
  // 教学参考：v_0 = 1 缩放（新生个体繁殖价值为 1）。
  const v0Equals1 = v.map((x) => x / v[0]);

  // 残差：L w - r w 与 v^T L - r v^T，使用和归一向量。
  const lw = matVec(matrix, wNorm);
  const rightResidual = infNormVec(lw.map((x, i) => x - eigenvalue * wNorm[i]));
  const lT = transpose(matrix);
  const vTl = matVec(lT, vNorm);
  const leftResidual = infNormVec(vTl.map((x, i) => x - eigenvalue * vNorm[i]));

  // 幂迭代收敛性独立检查（仅非周期不可约矩阵可逐期收敛）。
  const power = powerIterationConvergence(matrix, config);
  if (!power.converged) {
    diagnostics.push(
      `幂迭代在 ${config.eigenMaxIterations} 次内未达到容差 ${config.eigenTolerance}，不报告经验收敛。`,
    );
  }

  const canClaimConvergence =
    matrixClass === 'irreducible-primitive' && power.converged;

  if (matrixClass === 'irreducible-primitive' && power.converged) {
    diagnostics.push(
      `右主特征向量按分量和归一为稳定年龄分布；左主特征向量按 v^T w = 1 归一为繁殖价值，`,
      `另附 v_0=1 的教学缩放。右残差 ${rightResidual.toExponential(3)}，左残差 ${leftResidual.toExponential(3)}。`,
    );
  } else if (matrixClass === 'irreducible-periodic') {
    diagnostics.push(
      '仍给出正主特征值与形式上的左右主特征向量（残差应为机器精度量级），',
      '但周期结构下它们不代表逐期收敛极限；稳定年龄分布字段置为 null。',
    );
  }

  return {
    dominantEigenvalue: eigenvalue,
    stableAgeDistribution: canClaimConvergence ? wNorm : null,
    // 繁殖价值是单位个体的未来贡献期望，周期情景下仍可逐组计算，
    // 但仅在可声称收敛时作为长期繁殖价值报告。
    reproductiveValue: canClaimConvergence ? vNorm : null,
    reproductiveValueV0Equals1: canClaimConvergence ? v0Equals1 : null,
    rightResidual,
    leftResidual,
    matrixClass,
    period: graph.period,
    converged: canClaimConvergence,
    iterations: power.iterations,
    diagnostics,
  };
}

/**
 * Leslie 特征方程（Euler-Lotka 形式，出生后普查）：
 *   1 = sum_{j=0}^{m-1} f_j l_j / r^{j+1}，
 *   l_0 = 1，l_j = s_0 s_1 ... s_{j-1}。
 * 定义 phi(r) = sum f_j l_j / r^{j+1} - 1，在 r>0 上严格单调递减，
 * 因此正根唯一（若存在）。用二分法求解；根在 r=0 附近时返回 0 或 null。
 */
export function dominantEigenvalueByCharacteristicEquation(
  params: ModelParams,
): number | null {
  const m = params.ageGroups.length;
  const l = new Array<number>(m).fill(0);
  l[0] = 1;
  for (let i = 1; i < m; i++) {
    l[i] = l[i - 1] * params.survival[i - 1];
  }

  const phi = (r: number): number => {
    let sum = 0;
    let rPow = r; // r^{1}, r^{2}, ...
    for (let j = 0; j < m; j++) {
      sum += (params.fertility[j] * l[j]) / rPow;
      rPow *= r;
    }
    return sum - 1;
  };

  // phi 在 r→0+ 时为 +inf（只要有可达的正繁殖），r→inf 时为 -1。
  let lo = 1e-12;
  let phiLo = phi(lo);
  if (!Number.isFinite(phiLo)) {
    // 找到一个有限且为正的下界。
    lo = 1e-6;
    phiLo = phi(lo);
  }
  let hi = 1e6;
  let phiHi = phi(hi);
  // 扩大上界直到 phi(hi) < 0。
  let guard = 0;
  while (phiHi >= 0 && guard < 20) {
    hi *= 10;
    phiHi = phi(hi);
    guard++;
  }
  if (!(phiLo > 0) || !(phiHi < 0)) {
    // 极端参数下无法可靠夹逼。
    return null;
  }
  for (let k = 0; k < 200; k++) {
    const mid = Math.sqrt(lo * hi);
    const phiMid = phi(mid);
    if (Math.abs(phiMid) < 1e-12) return mid;
    if (phiMid > 0) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

function powerIterationConvergence(
  matrix: number[][],
  config: AlgorithmConfig,
): { converged: boolean; iterations: number } {
  const m = matrix.length;
  let vec = new Array<number>(m).fill(1 / m);
  let lambda = 0;
  for (let k = 1; k <= config.eigenMaxIterations; k++) {
    const next = matVec(matrix, vec);
    const norm = infNormVec(next);
    if (norm === 0) {
      return { converged: false, iterations: k };
    }
    const nextNorm = next.map((x) => x / norm);
    // 同时观察 Rayleigh 风格的比值（以总种群比近似）与方向变化。
    const directional = infNormVec(nextNorm.map((x, i) => x - vec[i]));
    vec = nextNorm;
    const newLambda = norm;
    if (k > 1 && Math.abs(newLambda - lambda) < config.eigenTolerance &&
        directional < Math.sqrt(config.eigenTolerance)) {
      return { converged: true, iterations: k };
    }
    lambda = newLambda;
  }
  return { converged: false, iterations: config.eigenMaxIterations };
}
