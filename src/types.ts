/**
 * 领域类型定义。
 *
 * 模型采用「出生后普查」(post-breeding census) 的 Leslie 模型：
 * - 首行 f_i：年龄组 i 在一个时间步内的人均繁殖贡献（新生个体在时间步末计入 0 龄组）；
 * - 次对角线 s_i：年龄组 i 的个体存活并进入年龄组 i+1 的比例；
 * - 末年龄组之后不设无限累积的开放组，其个体在下一步离开系统（不存活到更老组）。
 *
 * Leslie 矩阵 L 满足 n(t+1) = L n(t)，它不是概率转移矩阵，
 * 列和无需等于 1，首行繁殖率允许大于 1，因此严禁按列/行归一化。
 */

export interface ModelParams {
  /** 各年龄组名称/标签，长度即年龄组数量 m（例如 ["0","1","2"]）。 */
  ageGroups: string[];
  /** 首行繁殖率 f_i，长度 m，f_i >= 0，允许 > 1。 */
  fertility: number[];
  /**
   * 次对角线存活率 s_i，长度 m：
   * s_i 表示从年龄组 i 进入 i+1 的比例，0 <= s_i <= 1。
   * s_{m-1}（末组之后的存活）默认应为 0，不设开放累积组。
   */
  survival: number[];
  /** 初始数量 n_i(0)，长度 m，n_i >= 0，允许非整数（实数）。 */
  initialPopulation: number[];
}

export interface Model extends ModelParams {
  id: number;
  name: string;
  /** 情景版本标签，同一模型可有多个版本。 */
  scenarioVersion: string;
  note: string | null;
  createdAt: string;
}

/** 算法配置快照：报告生成时的参数与限制固定写入报告，后续模型修改不影响旧报告。 */
export interface AlgorithmConfig {
  steps: number;
  /** 幂迭代最大次数。 */
  eigenMaxIterations: number;
  /** 特征值/向量收敛容差。 */
  eigenTolerance: number;
  /** 单元素数量溢出上限（绝对值超过即中止）。 */
  overflowThreshold: number;
  /** 中心差分扰动步长 h。 */
  perturbationEpsilon: number;
}

export const DEFAULT_CONFIG: AlgorithmConfig = {
  steps: 50,
  eigenMaxIterations: 2000,
  eigenTolerance: 1e-10,
  overflowThreshold: 1e200,
  perturbationEpsilon: 1e-5,
};

/** 服务公开的规模/期数限制。 */
export const LIMITS = {
  maxAgeGroups: 200,
  minAgeGroups: 2,
  maxSteps: 10000,
  maxFertility: 1e9,
  maxInitialPopulation: 1e15,
  maxOverflowThreshold: 1e300,
} as const;

export interface ProjectionStep {
  /** 时间步 t（0 为初始）。 */
  t: number;
  /** n_i(t)，各年龄组数量。 */
  population: number[];
  /** N(t) = sum_i n_i(t)。 */
  total: number;
  /**
   * 实际增长比 N(t)/N(t-1)；t=0 或上一期总量为 0 时为 null（不可定义），
   * 绝不输出 NaN，也不随意补成 1。
   */
  growthRatio: number | null;
  /** 截至时间步 t 的累计出生量 B(t)=sum_{k=1..t} (L n(k-1))_0。 */
  cumulativeBirths: number;
}

export interface ProjectionResult {
  completedSteps: number;
  requestedSteps: number;
  /** 是否因溢出而提前中止。 */
  aborted: boolean;
  abortReason: string | null;
  series: ProjectionStep[];
  finalPopulation: number[];
}

export type MatrixClass =
  | 'irreducible-primitive'
  | 'irreducible-periodic'
  | 'reducible'
  | 'zero';

export interface EigenAnalysis {
  /** 主导（Perron）特征值 r；零矩阵或无可判定正主特征值时为 null。 */
  dominantEigenvalue: number | null;
  /** 稳定年龄分布（右主特征向量，按分量和归一为 1）；不可用时为 null。 */
  stableAgeDistribution: number[] | null;
  /**
   * 繁殖价值（左主特征向量）。归一方式：令 v^T w = 1
   * （w 为和归一右向量），报告中同时给出首个年龄组 v_0=1 的参考缩放。
   */
  reproductiveValue: number[] | null;
  /** 繁殖价值在 v_0 = 1 缩放下的形式，便于教学解读。 */
  reproductiveValueV0Equals1: number[] | null;
  /** 右特征残差 ||L w - r w||_inf。 */
  rightResidual: number | null;
  /** 左特征残差||v^T L - r v^T||_inf。 */
  leftResidual: number | null;
  matrixClass: MatrixClass;
  /** 不可约周期矩阵的周期 d（非周期为 1）；可约时为 null。 */
  period: number | null;
  /** 幂迭代是否在容差内收敛。 */
  converged: boolean;
  iterations: number;
  /** 诊断信息（中文，人类可读）。 */
  diagnostics: string[];
}

export interface ElasticityEntry {
  /** 矩阵位置 (row, col)。 */
  row: number;
  col: number;
  /** 矩阵元素 L[row][col] 的值（0 表示结构上为零的位置）。 */
  element: number;
  /** ∂r/∂L_ij，矩阵元素敏感度。 */
  sensitivity: number;
  /** (L_ij/r) ∂r/∂L_ij，无量纲弹性；结构零位为 0。 */
  elasticity: number;
  /** 映射回的原始参数类型（若可映射）。 */
  param:
    | { kind: 'fertility'; index: number }
    | { kind: 'survival'; index: number }
    | { kind: 'structural-zero' }
    | null;
}

export interface SensitivityResult {
  entries: ElasticityEntry[];
  /** 全部矩阵元素弹性之和（可判定简单正主特征值时理论上为 1）。 */
  elasticitySum: number | null;
  /** 用中心差分独立核对的各非零元素敏感度（抽样/全量）。 */
  finiteDifferenceCheck: {
    row: number;
    col: number;
    analytic: number;
    centralDifference: number;
    absoluteDifference: number;
  }[];
  available: boolean;
  reason: string | null;
}

export interface ScenarioComparison {
  baselineName: string;
  alternativeName: string;
  /** 两套参数每期总量之差 N_alt(t) - N_base(t)。 */
  totalDifference: number[];
  /** 两套参数每期总量。 */
  baselineTotals: number[];
  alternativeTotals: number[];
  /** 主导特征值之差 r_alt - r_base（可判定时）。 */
  dominantEigenvalueDifference: number | null;
  summary: string;
}

export interface Report {
  id: number;
  modelId: number;
  modelName: string;
  scenarioVersion: string;
  createdAt: string;
  /** 生成时完整模型参数快照。 */
  modelSnapshot: ModelParams;
  /** 生成时算法配置快照。 */
  configSnapshot: AlgorithmConfig;
  projection: ProjectionResult;
  eigen: EigenAnalysis;
  sensitivity: SensitivityResult;
  kind: string;
}
