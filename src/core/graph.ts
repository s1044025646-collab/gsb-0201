import type { ModelParams } from '../types.js';

export interface GraphStructure {
  /** 有向边：L[i][j] > 0 表示 j -> i（非负矩阵的有向图）。 */
  adjacency: number[][];
  irreducible: boolean;
  /** 不可约时的周期 d（各闭合回路长度的最大公约数）；非周期为 1。 */
  period: number | null;
  /** 闭强连通分量数量（无出边的 SCC）；多个意味着多个独立优势类。 */
  closedSccCount: number;
  sccOf: number[];
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

/**
 * 分析非负矩阵有向图：
 * - 不可约性（任意两节点互相可达）；
 * - 周期（不可约时所有闭合环长度的 gcd；对 Leslie 矩阵等于
 *   gcd{ j+1 | f_j > 0 }，本实现用通用图算法计算）；
 * - 闭强连通分量计数，用于识别多个独立优势类。
 * 全程不修改矩阵，不给零元素加小数。
 */
export function analyzeGraph(params: ModelParams): GraphStructure {
  const m = params.ageGroups.length;
  const adjacency: number[][] = Array.from({ length: m }, () => []);
  for (let j = 0; j < m; j++) {
    if (params.fertility[j] > 0) adjacency[j].push(0);
  }
  for (let i = 0; i < m - 1; i++) {
    if (params.survival[i] > 0) adjacency[i].push(i + 1);
  }

  // Tarjan 强连通分量。
  let indexCounter = 0;
  const indices = new Array<number>(m).fill(-1);
  const low = new Array<number>(m).fill(0);
  const onStack = new Array<boolean>(m).fill(false);
  const stack: number[] = [];
  const sccs: number[][] = [];

  const strongConnect = (v: number): void => {
    indices[v] = indexCounter;
    low[v] = indexCounter;
    indexCounter++;
    stack.push(v);
    onStack[v] = true;
    for (const w of adjacency[v]) {
      if (indices[w] === -1) {
        strongConnect(w);
        low[v] = Math.min(low[v], low[w]);
      } else if (onStack[w]) {
        low[v] = Math.min(low[v], indices[w]);
      }
    }
    if (low[v] === indices[v]) {
      const component: number[] = [];
      let w: number;
      do {
        w = stack.pop()!;
        onStack[w] = false;
        component.push(w);
      } while (w !== v);
      sccs.push(component);
    }
  };

  for (let v = 0; v < m; v++) {
    if (indices[v] === -1) strongConnect(v);
  }

  const sccOf = new Array<number>(m).fill(-1);
  sccs.forEach((component, id) => {
    for (const node of component) sccOf[node] = id;
  });

  // 统计闭 SCC：分量内节点没有指向分量外节点的边。
  let closedSccCount = 0;
  for (let id = 0; id < sccs.length; id++) {
    let closed = true;
    for (const node of sccs[id]) {
      for (const target of adjacency[node]) {
        if (sccOf[target] !== id) {
          closed = false;
          break;
        }
      }
      if (!closed) break;
    }
    if (closed) closedSccCount++;
  }

  const irreducible = sccs.length === 1;

  let period: number | null = null;
  if (irreducible) {
    // 不可约时，每个节点处回归时间的 gcd 相同。
    // 用 BFS 最短距离，收集从 0 出发且回到 0 的环长，取 gcd。
    period = computePeriod(adjacency, 0, m);
  }

  return { adjacency, irreducible, period, closedSccCount, sccOf };
}

function computePeriod(adjacency: number[][], start: number, m: number): number {
  // 标准算法：BFS 记录距离 dist，对每条边 v->w，
  // 若 w 已访问，用 dist[v]+1-dist[w] 与当前 d 取 gcd。
  const dist = new Array<number>(m).fill(-1);
  dist[start] = 0;
  const queue: number[] = [start];
  let d = 0;
  while (queue.length > 0) {
    const v = queue.shift()!;
    for (const w of adjacency[v]) {
      if (dist[w] === -1) {
        dist[w] = dist[v] + 1;
        queue.push(w);
      } else {
        d = gcd(d, dist[v] + 1 - dist[w]);
      }
    }
  }
  return Math.abs(d) === 0 ? 1 : Math.abs(d);
}
