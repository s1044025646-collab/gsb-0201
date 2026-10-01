/** 年龄结构种群模型（Leslie，出生后普查）的公共类型定义。 */

export interface LeslieModel {
  /** 模型名称 */
  name: string;
  /** 各年龄组首行繁殖率 F_i（可大于 1，非负实数），长度 = 年龄组数 */
  fecundity: number[];
  /**
   * 次对角线存活率 s_i：从年龄组 i 进入 i+1 的概率，长度 = 年龄组数 - 1，
   * 取值 (0, 1]。末年龄组默认不累积（无开放组）。
   */
  survival: number[];
  /** 初始各年龄组数量，非负实数，长度 = 年龄组数 */
  initial: number[];
}

export interface AnalysisConfig {
  /** 幂迭代收敛容差 */
  tolerance: number;
  /** 幂迭代最大步数 */
  maxIterations: number;
  /** 投影允许的最大期数 */
  maxSteps: number;
  /** 允许的最大年龄组数 */
  maxGroups: number;
  /** 数量上限，超过则判定溢出并中止 */
  maxValue: number;
}

export const DEFAULT_CONFIG: AnalysisConfig = {
  tolerance: 1e-12,
  maxIterations: 100000,
  maxSteps: 1000,
  maxGroups: 200,
  maxValue: 1e290,
};

export interface ProjectionStep {
  t: number;
  counts: number[];
  total: number;
  /** 实际增长比 N(t)/N(t-1)；t=0 或上期为 0 时为 null（不可定义） */
  growthRatio: number | null;
  growthRatioDefined: boolean;
  /** 本期繁殖产生的新生个体数（首行贡献之和） */
  births: number;
  /** 截至本期累计出生量 */
  cumulativeBirths: number;
}

export interface ProjectionResult {
  stepsRequested: number;
  stepsCompleted: number;
  truncated: boolean;
  abortReason: string | null;
  series: ProjectionStep[];
}

export interface EigenAnalysis {
  /** 主特征值（长期增长因子）；无法确定时为 null */
  lambda: number | null;
  /** 右特征向量残差 ||A w - λ w||_inf */
  rightResidual: number | null;
  /** 左特征向量残差 ||A^T v - λ v||_inf */
  leftResidual: number | null;
  /** 稳定年龄分布 w，归一化为分量之和 = 1 */
  stableAgeDistribution: number[] | null;
  /** 繁殖价值 v，归一化为 v·w = 1 */
  reproductiveValue: number[] | null;
  normalization: {
    right: string;
    left: string;
  };
  irreducible: boolean;
  primitive: boolean;
  /** 周期（不可约非本原时的周期 d；本原为 1；可约为 null） */
  period: number | null;
  converged: boolean;
  iterations: number;
  /** 是否可宣称收敛到唯一稳定结构 */
  stableConvergenceGuaranteed: boolean;
  diagnostics: string[];
  /** 对原始繁殖率参数的敏感度 dλ/dF_i */
  fecunditySensitivity: number[] | null;
  /** 对原始存活率参数的敏感度 dλ/ds_i */
  survivalSensitivity: number[] | null;
  fecundityElasticity: number[] | null;
  survivalElasticity: number[] | null;
  /** 全部矩阵元素弹性之和（理论值 1，用于核验） */
  elasticitySum: number | null;
}
