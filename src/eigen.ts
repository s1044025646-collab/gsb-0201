import { matVec } from "./leslie";
import { AnalysisConfig, DEFAULT_CONFIG, EigenAnalysis, LeslieModel } from "./types";

function infNorm(x: number[]): number {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  return m;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function transpose(A: number[][]): number[][] {
  const n = A.length;
  const T: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) T[j][i] = A[i][j];
  return T;
}

interface PowerResult {
  lambda: number;
  vector: number[];
  converged: boolean;
  iterations: number;
}

/**
 * 幂迭代求主特征值与右特征向量。
 * 对周期矩阵（多个等模主特征值）不会收敛，此时如实报告不收敛。
 */
function powerIteration(
  A: number[][],
  config: AnalysisConfig,
  seed?: number[]
): PowerResult {
  const n = A.length;
  let x = seed ? seed.slice() : new Array<number>(n).fill(1);
  let norm = infNorm(x);
  if (norm === 0) x = new Array<number>(n).fill(1);
  else x = x.map((v) => v / norm);
  let lambda = 0;
  let prevLambda = 0;
  let converged = false;
  let iter = 0;
  for (iter = 1; iter <= config.maxIterations; iter++) {
    const y = matVec(A, x);
    const ny = infNorm(y);
    if (ny === 0) {
      // 幂零方向：主特征值为 0（例如全部繁殖率为零）
      return { lambda: 0, vector: x, converged: true, iterations: iter };
    }
    // 用最大分量比值估计特征值，保留符号
    let idx = 0;
    for (let i = 1; i < n; i++) if (Math.abs(y[i]) > Math.abs(y[idx])) idx = i;
    lambda = x[idx] !== 0 ? y[idx] / x[idx] : ny;
    x = y.map((v) => v / ny);
    if (Math.abs(lambda - prevLambda) <= config.tolerance * Math.max(1, Math.abs(lambda))) {
      converged = true;
      break;
    }
    prevLambda = lambda;
  }
  return { lambda, vector: x, converged, iterations: iter };
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

/**
 * Leslie 矩阵结构判定：
 * - 不可约 当且仅当 末年龄组繁殖率 F_n > 0（且存活率均 > 0，已由校验保证）。
 * - 不可约时，本原（非周期）当且仅当 gcd{ i : F_i > 0 } = 1（i 为 1 起始年龄下标）。
 */
export function classifyMatrix(model: LeslieModel): {
  irreducible: boolean;
  primitive: boolean;
  period: number | null;
} {
  const F = model.fecundity;
  const n = F.length;
  const fertile = F.map((f, i) => (f > 0 ? i + 1 : 0)).filter((i) => i > 0);
  if (fertile.length === 0) {
    return { irreducible: false, primitive: false, period: null };
  }
  const irreducible = F[n - 1] > 0;
  if (!irreducible) {
    return { irreducible: false, primitive: false, period: null };
  }
  let d = fertile[0];
  for (const i of fertile) d = gcd(d, i);
  return { irreducible: true, primitive: d === 1, period: d };
}

/**
 * 长期结构分析：主特征值、稳定年龄分布、繁殖价值、敏感度与弹性。
 * 不做任何“给零元素加小数”式的微扰造假；不可判定情形如实给出诊断。
 */
export function analyze(
  model: LeslieModel,
  config: AnalysisConfig = DEFAULT_CONFIG
): EigenAnalysis {
  const n = model.fecundity.length;
  const diagnostics: string[] = [];
  const { irreducible, primitive, period } = classifyMatrix(model);
  const A = buildMatrixFromModel(model);

  const allZeroFecundity = model.fecundity.every((f) => f === 0);
  if (allZeroFecundity) {
    diagnostics.push("所有繁殖率均为零：种群必然灭绝，主特征值为 0，不存在稳定年龄分布。");
  }
  if (!irreducible && !allZeroFecundity) {
    diagnostics.push(
      "末年龄组繁殖率为零：矩阵可约，存在不产生后代回路的末尾年龄组；渐近行为由可约分解决定，不能宣称全向量收敛到唯一稳定结构。"
    );
  }
  if (irreducible && !primitive) {
    diagnostics.push(
      `矩阵不可约但为周期矩阵（周期 d=${period}）：存在 ${period} 个等模主特征值，年龄结构呈周期振荡，幂迭代不收敛，不能宣称收敛到唯一稳定结构。`
    );
  }

  // 右特征向量幂迭代
  const right = powerIteration(A, config);
  if (!right.converged) {
    diagnostics.push(
      `幂迭代在 ${config.maxIterations} 步内未收敛（通常意味着周期性或多个等模主特征值），不输出特征向量与弹性。`
    );
  }

  let lambda: number | null = right.converged ? right.lambda : null;
  let w: number[] | null = null;
  let v: number[] | null = null;
  let rightResidual: number | null = null;
  let leftResidual: number | null = null;
  let fecSens: number[] | null = null;
  let survSens: number[] | null = null;
  let fecElast: number[] | null = null;
  let survElast: number[] | null = null;
  let elasticitySum: number | null = null;

  if (right.converged && lambda !== null && lambda > 0) {
    // 右特征向量：归一化为分量之和 = 1（稳定年龄分布）
    const wRaw = right.vector.map((x) => Math.max(x, 0));
    const wSum = wRaw.reduce((a, b) => a + b, 0);
    if (wSum > 0) {
      w = wRaw.map((x) => x / wSum);
      const Aw = matVec(A, w);
      rightResidual = infNorm(Aw.map((x, i) => x - (lambda as number) * (w as number[])[i]));

      // 左特征向量：对 A^T 做幂迭代
      const left = powerIteration(transpose(A), config);
      if (left.converged && Math.abs(left.lambda - lambda) <= 1e-6 * Math.max(1, lambda)) {
        const vRaw = left.vector.map((x) => Math.max(x, 0));
        // 归一化为 v·w = 1（繁殖价值的标准归一）
        const vw = dot(vRaw, w);
        if (vw > 0) {
          v = vRaw.map((x) => x / vw);
          const ATv = matVec(transpose(A), v);
          leftResidual = infNorm(ATv.map((x, i) => x - (lambda as number) * (v as number[])[i]));

          // 敏感度 dλ/da_ij = v_i * w_j（v·w = 1 归一下）
          // 映射回原始参数：F_j -> a_1j；s_i -> a_{i+1,i}
          fecSens = model.fecundity.map((_, j) => (v as number[])[0] * (w as number[])[j]);
          survSens = model.survival.map((_, i) => (v as number[])[i + 1] * (w as number[])[i]);
          const lam = lambda as number;
          fecElast = model.fecundity.map((f, j) => (f * (fecSens as number[])[j]) / lam);
          survElast = model.survival.map((s, i) => (s * (survSens as number[])[i]) / lam);
          elasticitySum =
            fecElast.reduce((a, b) => a + b, 0) + survElast.reduce((a, b) => a + b, 0);
        } else {
          diagnostics.push("左特征向量与右特征向量内积为零，无法归一化繁殖价值。");
        }
      } else if (!left.converged) {
        diagnostics.push("左特征向量幂迭代未收敛，无法计算繁殖价值与弹性。");
      }
    } else {
      diagnostics.push("右特征向量全为零分量，无法构造稳定年龄分布。");
    }
  } else if (right.converged && lambda === 0) {
    lambda = 0;
    if (!allZeroFecundity) {
      diagnostics.push("主特征值为 0：长期增长因子为零，种群渐近灭绝。");
    }
  }

  const stableConvergenceGuaranteed =
    irreducible && primitive && right.converged && lambda !== null && lambda > 0;
  if (stableConvergenceGuaranteed) {
    diagnostics.push(
      "矩阵不可约且本原（aperiodic）：由 Perron-Frobenius 定理，任意正初始向量将收敛到唯一稳定年龄结构。"
    );
  }

  return {
    lambda,
    rightResidual,
    leftResidual,
    stableAgeDistribution: w,
    reproductiveValue: v,
    normalization: {
      right: "稳定年龄分布 w：分量之和 = 1",
      left: "繁殖价值 v：v·w = 1",
    },
    irreducible,
    primitive,
    period,
    converged: right.converged,
    iterations: right.iterations,
    stableConvergenceGuaranteed,
    diagnostics,
    fecunditySensitivity: fecSens,
    survivalSensitivity: survSens,
    fecundityElasticity: fecElast,
    survivalElasticity: survElast,
    elasticitySum,
  };
}

function buildMatrixFromModel(model: LeslieModel): number[][] {
  const n = model.fecundity.length;
  const A: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) A[0][j] = model.fecundity[j];
  for (let i = 0; i < n - 1; i++) A[i + 1][i] = model.survival[i];
  return A;
}
