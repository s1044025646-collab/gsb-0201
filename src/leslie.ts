import {
  AnalysisConfig,
  DEFAULT_CONFIG,
  LeslieModel,
  ProjectionResult,
  ProjectionStep,
} from "./types";

/** 校验模型输入，不合法时抛出带中文说明的错误。 */
export function validateModel(model: LeslieModel, config: AnalysisConfig = DEFAULT_CONFIG): void {
  if (!model || typeof model !== "object") {
    throw new Error("模型必须是对象");
  }
  const { fecundity, survival, initial } = model;
  if (!Array.isArray(fecundity) || !Array.isArray(survival) || !Array.isArray(initial)) {
    throw new Error("fecundity、survival、initial 必须是数组");
  }
  const n = fecundity.length;
  if (n < 1) {
    throw new Error("至少需要一个年龄组");
  }
  if (n > config.maxGroups) {
    throw new Error(`年龄组数 ${n} 超过上限 ${config.maxGroups}`);
  }
  if (survival.length !== n - 1) {
    throw new Error(`存活率长度应为年龄组数减一（${n - 1}），实际为 ${survival.length}`);
  }
  if (initial.length !== n) {
    throw new Error(`初始数量长度应等于年龄组数（${n}），实际为 ${initial.length}`);
  }
  for (let i = 0; i < n; i++) {
    const f = fecundity[i];
    if (typeof f !== "number" || !Number.isFinite(f) || f < 0) {
      throw new Error(`繁殖率 F_${i + 1} 必须是非负有限实数，实际为 ${f}`);
    }
  }
  for (let i = 0; i < survival.length; i++) {
    const s = survival[i];
    if (typeof s !== "number" || !Number.isFinite(s) || s <= 0 || s > 1) {
      throw new Error(`存活率 s_${i + 1} 必须在 (0, 1] 区间内，实际为 ${s}`);
    }
  }
  for (let i = 0; i < n; i++) {
    const x = initial[i];
    if (typeof x !== "number" || !Number.isFinite(x) || x < 0) {
      throw new Error(`初始数量 n_${i + 1} 必须是非负有限实数，实际为 ${x}`);
    }
  }
}

/**
 * 构造 Leslie 投影矩阵（行主序二维数组）。
 * 首行为繁殖率 F_i，次对角线为存活率 s_i。
 * 注意：这是人口投影矩阵，绝不是概率转移矩阵，不做任何行/列归一化。
 */
export function buildMatrix(model: LeslieModel): number[][] {
  const n = model.fecundity.length;
  const A: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) {
    A[0][j] = model.fecundity[j];
  }
  for (let i = 0; i < n - 1; i++) {
    A[i + 1][i] = model.survival[i];
  }
  return A;
}

/** 矩阵乘向量 y = A x */
export function matVec(A: number[][], x: number[]): number[] {
  const n = A.length;
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const row = A[i];
    for (let j = 0; j < n; j++) {
      sum += row[j] * x[j];
    }
    y[i] = sum;
  }
  return y;
}

/**
 * 逐步投影。零总量时增长比标记为不可定义（null）。
 * 溢出或超限时中止并说明已完成的范围，绝不把截断序列当作完整预测。
 */
export function project(
  model: LeslieModel,
  steps: number,
  config: AnalysisConfig = DEFAULT_CONFIG
): ProjectionResult {
  validateModel(model, config);
  if (!Number.isInteger(steps) || steps < 1) {
    throw new Error(`时间步必须是正整数，实际为 ${steps}`);
  }
  if (steps > config.maxSteps) {
    throw new Error(`时间步 ${steps} 超过上限 ${config.maxSteps}`);
  }
  const A = buildMatrix(model);
  const n = model.fecundity.length;
  const series: ProjectionStep[] = [];
  let counts = model.initial.slice();
  let total = counts.reduce((a, b) => a + b, 0);
  let cumulativeBirths = 0;
  series.push({
    t: 0,
    counts: counts.slice(),
    total,
    growthRatio: null,
    growthRatioDefined: false,
    births: 0,
    cumulativeBirths,
  });

  let truncated = false;
  let abortReason: string | null = null;
  let completed = 0;

  for (let t = 1; t <= steps; t++) {
    const next = matVec(A, counts);
    const births = A[0].reduce((acc, f, j) => acc + f * counts[j], 0);
    let nextTotal = 0;
    for (const v of next) {
      if (!Number.isFinite(v) || Math.abs(v) > config.maxValue) {
        truncated = true;
        abortReason = `第 ${t} 期计算溢出（数值超过 ${config.maxValue} 或出现非有限值），已中止；以下仅包含前 ${t - 1} 期完整结果`;
        break;
      }
      nextTotal += v;
    }
    if (truncated) break;
    if (!Number.isFinite(nextTotal) || nextTotal > config.maxValue) {
      truncated = true;
      abortReason = `第 ${t} 期总量溢出，已中止；以下仅包含前 ${t - 1} 期完整结果`;
      break;
    }
    cumulativeBirths += births;
    const growthRatioDefined = total > 0;
    series.push({
      t,
      counts: next.slice(),
      total: nextTotal,
      growthRatio: growthRatioDefined ? nextTotal / total : null,
      growthRatioDefined,
      births,
      cumulativeBirths,
    });
    counts = next;
    total = nextTotal;
    completed = t;
  }

  return {
    stepsRequested: steps,
    stepsCompleted: completed,
    truncated,
    abortReason,
    series,
  };
}

/** 对繁殖率/存活率做缩放或逐项替换，用于情景比较。 */
export function perturbModel(
  model: LeslieModel,
  options: {
    fecundityScale?: number;
    survivalScale?: number;
    fecundity?: number[];
    survival?: number[];
  }
): LeslieModel {
  const fecundity = options.fecundity
    ? options.fecundity.slice()
    : model.fecundity.map((f) => f * (options.fecundityScale ?? 1));
  const survival = options.survival
    ? options.survival.slice()
    : model.survival.map((s) => s * (options.survivalScale ?? 1));
  const result: LeslieModel = {
    name: model.name + "（扰动）",
    fecundity,
    survival,
    initial: model.initial.slice(),
  };
  return result;
}
