import { LIMITS, type ModelParams } from '../types.js';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * 校验模型参数。规则：
 * - 年龄组数量 2..maxAgeGroups；
 * - fertility / survival / initialPopulation 长度必须与年龄组一致；
 * - 数量为非负有限实数；繁殖率非负（允许 >1）；存活率在 [0,1]；
 * - 末年龄组之后的存活率 s_{m-1} 必须为 0（不设无限累积开放组），
 *   若调用方显式给出非零末存活率则拒绝，提示语义不匹配；
 * - 年龄组标签非空且唯一。
 */
export function validateModelParams(params: unknown): asserts params is ModelParams {
  if (params === null || typeof params !== 'object') {
    throw new ValidationError('模型参数必须是对象。');
  }
  const p = params as Record<string, unknown>;
  const { ageGroups, fertility, survival, initialPopulation } = p as Record<string, unknown>;

  if (!Array.isArray(ageGroups) || !Array.isArray(fertility) ||
      !Array.isArray(survival) || !Array.isArray(initialPopulation)) {
    throw new ValidationError('ageGroups、fertility、survival、initialPopulation 必须都是数组。');
  }

  const m = ageGroups.length;
  if (m < LIMITS.minAgeGroups) {
    throw new ValidationError(`至少需要 ${LIMITS.minAgeGroups} 个年龄组。`);
  }
  if (m > LIMITS.maxAgeGroups) {
    throw new ValidationError(`年龄组数量 ${m} 超过上限 ${LIMITS.maxAgeGroups}。`);
  }
  if (fertility.length !== m) {
    throw new ValidationError(`繁殖率长度 ${fertility.length} 与年龄组数 ${m} 不匹配。`);
  }
  if (survival.length !== m) {
    throw new ValidationError(`存活率长度 ${survival.length} 与年龄组数 ${m} 不匹配。`);
  }
  if (initialPopulation.length !== m) {
    throw new ValidationError(`初始数量长度 ${initialPopulation.length} 与年龄组数 ${m} 不匹配。`);
  }

  const labels = new Set<string>();
  for (let i = 0; i < m; i++) {
    const label = ageGroups[i];
    if (typeof label !== 'string' || label.trim() === '') {
      throw new ValidationError(`年龄组标签 #${i} 必须是非空字符串。`);
    }
    if (labels.has(label)) {
      throw new ValidationError(`年龄组标签 "${label}" 重复。`);
    }
    labels.add(label);

    if (!isFiniteNumber(fertility[i]) || fertility[i] < 0) {
      throw new ValidationError(`繁殖率 f_${i}=${String(fertility[i])} 必须是非负有限实数（允许大于 1）。`);
    }
    if (fertility[i] > LIMITS.maxFertility) {
      throw new ValidationError(`繁殖率 f_${i}=${fertility[i]} 超过上限 ${LIMITS.maxFertility}。`);
    }
    if (!isFiniteNumber(survival[i]) || survival[i] < 0 || survival[i] > 1) {
      throw new ValidationError(`存活率 s_${i}=${String(survival[i])} 必须在闭区间 [0,1] 内。`);
    }
    if (!isFiniteNumber(initialPopulation[i]) || initialPopulation[i] < 0) {
      throw new ValidationError(`初始数量 n_${i}=${String(initialPopulation[i])} 必须是非负有限实数。`);
    }
    if (initialPopulation[i] > LIMITS.maxInitialPopulation) {
      throw new ValidationError(`初始数量 n_${i} 超过上限 ${LIMITS.maxInitialPopulation}。`);
    }
  }

  // 末年龄组之后不设开放组：s_{m-1} 必须为 0。
  // 为容忍调用方省略末值，这里要求显式传入且为 0；如需要开放组应使用别的模型。
  if (survival[m - 1] !== 0) {
    throw new ValidationError(
      `末年龄组之后的存活率 s_${m - 1}=${survival[m - 1]} 必须为 0：本服务不设无限累积的开放年龄组。`,
    );
  }
}

export function validateSteps(steps: unknown): asserts steps is number {
  if (!isFiniteNumber(steps) || !Number.isInteger(steps) || steps < 0) {
    throw new ValidationError('时间步步数必须是非负整数。');
  }
  if (steps > LIMITS.maxSteps) {
    throw new ValidationError(`时间步步数 ${steps} 超过上限 ${LIMITS.maxSteps}。`);
  }
}

/** 校验两套参数年龄分组一致（用于情景比较）。 */
export function assertSameAgeGroups(a: ModelParams, b: ModelParams): void {
  if (a.ageGroups.length !== b.ageGroups.length ||
      a.ageGroups.some((label, i) => label !== b.ageGroups[i])) {
    throw new ValidationError('两套参数的年龄分组（数量或标签）不匹配，无法逐组比较。');
  }
}
