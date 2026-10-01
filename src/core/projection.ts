import type {
  AlgorithmConfig,
  ProjectionResult,
  ProjectionStep,
} from '../types.js';
import { buildLeslieMatrix, matVec, vecSum } from './matrix.js';
import type { ModelParams } from '../types.js';

/**
 * 逐步执行 n(t+1) = L n(t)，绝不直接做矩阵幂。
 *
 * 返回每期：
 * - population：各组数量；
 * - total：总量；
 * - growthRatio：N(t)/N(t-1)，上一期总量为 0 时为 null（不可定义），
 *   不输出 NaN，也不补 1；
 * - cumulativeBirths：累计出生量，每步把新产生的 0 龄组数量
 *   (L n)_0 累加。
 *
 * 任一数量绝对值超过 overflowThreshold 时立即中止，
 * 明确报告已完成的步数与 abortReason，调用方不得把截断序列当作完整预测。
 */
export function project(
  params: ModelParams,
  config: AlgorithmConfig,
): ProjectionResult {
  const matrix = buildLeslieMatrix(params);
  const m = params.ageGroups.length;
  const steps = config.steps;

  let current = params.initialPopulation.slice();
  let cumulativeBirths = 0;
  const series: ProjectionStep[] = [];
  series.push({
    t: 0,
    population: current.slice(),
    total: vecSum(current),
    growthRatio: null,
    cumulativeBirths: 0,
  });

  let aborted = false;
  let abortReason: string | null = null;

  outer:
  for (let t = 1; t <= steps; t++) {
    const next = matVec(matrix, current);

    for (let i = 0; i < m; i++) {
      if (!Number.isFinite(next[i]) || Math.abs(next[i]) > config.overflowThreshold) {
        aborted = true;
        abortReason =
          `在计算第 ${t} 步时数量溢出（年龄组 ${i} 的值为 ${next[i]}，` +
          `阈值为 ${config.overflowThreshold}）。投影在第 ${t - 1} 步后中止，` +
          `以下序列仅包含已完成的 ${t} 个时间点（t=0..${t - 1}），不能作为完整的 ${steps} 步预测。`;
        break outer;
      }
    }

    cumulativeBirths += next[0];
    const totalNext = vecSum(next);
    const totalPrev = vecSum(current);
    // 零总量（包括 0/0 与 正值/0）时增长比不可定义。
    const growthRatio = totalPrev === 0 ? null : totalNext / totalPrev;

    series.push({
      t,
      population: next,
      total: totalNext,
      growthRatio,
      cumulativeBirths,
    });
    current = next;
  }

  return {
    completedSteps: series.length - 1,
    requestedSteps: steps,
    aborted,
    abortReason,
    series,
    finalPopulation: current.slice(),
  };
}
