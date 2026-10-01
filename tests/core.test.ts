import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildMatrix, matVec, perturbModel, project, validateModel } from "../src/leslie";
import { analyze, classifyMatrix } from "../src/eigen";
import { Store } from "../src/store";
import { LeslieModel } from "../src/types";

const twoAge: LeslieModel = {
  name: "两年龄组手算解",
  fecundity: [1, 2],
  survival: [0.5],
  initial: [2, 0],
};

test("两年龄组手算递推：n1=[2,1], n2=[4,1]", () => {
  const r = project(twoAge, 2);
  assert.deepEqual(r.series[1].counts, [2, 1]);
  assert.deepEqual(r.series[2].counts, [4, 1]);
  assert.equal(r.series[1].total, 3);
  assert.equal(r.series[2].growthRatio, 5 / 3);
  assert.equal(r.series[2].cumulativeBirths, 2 + 4);
});

test("矩阵构造：首行繁殖率、次对角线存活率，不做概率归一化", () => {
  const A = buildMatrix(twoAge);
  assert.deepEqual(A, [[1, 2], [0.5, 0]]);
  // 列和不为 1，证明不是概率转移矩阵
  assert.notEqual(A[0][0] + A[1][0], 1);
});

test("独立核对逐期递推：与手工 matVec 循环一致", () => {
  const model: LeslieModel = { name: "m", fecundity: [0.3, 1.2, 0.7], survival: [0.6, 0.4], initial: [5, 3, 1] };
  const r = project(model, 10);
  const A = buildMatrix(model);
  let x = model.initial.slice();
  for (let t = 1; t <= 10; t++) {
    x = matVec(A, x);
    for (let i = 0; i < x.length; i++) {
      assert.ok(Math.abs(x[i] - r.series[t].counts[i]) < 1e-9, `t=${t} i=${i}`);
    }
  }
});

test("数量缩放关系：初始数量放大 k 倍，各期数量同比放大", () => {
  const k = 7.5;
  const scaled: LeslieModel = { ...twoAge, initial: twoAge.initial.map((x) => x * k) };
  const a = project(twoAge, 8);
  const b = project(scaled, 8);
  for (let t = 0; t <= 8; t++) {
    for (let i = 0; i < 2; i++) {
      assert.ok(Math.abs(b.series[t].counts[i] - k * a.series[t].counts[i]) < 1e-9);
    }
  }
});

test("零初始数量：总量为零，增长比标记不可定义而非 NaN 或 1", () => {
  const m: LeslieModel = { ...twoAge, initial: [0, 0] };
  const r = project(m, 3);
  for (const s of r.series) {
    assert.equal(s.total, 0);
    assert.equal(s.growthRatio, null);
    assert.equal(s.growthRatioDefined, false);
  }
});

test("零繁殖：诊断灭绝，主特征值为 0", () => {
  const m: LeslieModel = { name: "z", fecundity: [0, 0], survival: [0.5], initial: [10, 5] };
  const a = analyze(m);
  assert.equal(a.lambda, 0);
  assert.ok(a.diagnostics.some((d) => d.includes("灭绝")));
  assert.equal(a.stableConvergenceGuaranteed, false);
  const r = project(m, 3);
  assert.equal(r.series[3].total, 0);
});

test("周期性矩阵：不可约但非本原，不宣称收敛", () => {
  const m: LeslieModel = { name: "p", fecundity: [0, 3], survival: [0.5], initial: [10, 4] };
  const cls = classifyMatrix(m);
  assert.equal(cls.irreducible, true);
  assert.equal(cls.primitive, false);
  assert.equal(cls.period, 2);
  const a = analyze(m);
  assert.equal(a.stableConvergenceGuaranteed, false);
  assert.ok(a.diagnostics.some((d) => d.includes("周期")));
  // 有限期投影仍按原矩阵正常执行
  const r = project(m, 4);
  assert.equal(r.stepsCompleted, 4);
});

test("可约矩阵：末组不繁殖，给出诊断且不宣称唯一稳定结构", () => {
  const m: LeslieModel = { name: "r", fecundity: [1, 0], survival: [0.5], initial: [4, 1] };
  const a = analyze(m);
  assert.equal(a.irreducible, false);
  assert.equal(a.stableConvergenceGuaranteed, false);
  assert.ok(a.diagnostics.some((d) => d.includes("可约")));
});

test("非法输入一律拒绝", () => {
  assert.throws(() => validateModel({ ...twoAge, survival: [1.5] }), /存活率/);
  assert.throws(() => validateModel({ ...twoAge, survival: [0] }), /存活率/);
  assert.throws(() => validateModel({ ...twoAge, survival: [-0.2] }), /存活率/);
  assert.throws(() => validateModel({ ...twoAge, fecundity: [1] }), /长度/);
  assert.throws(() => validateModel({ ...twoAge, initial: [1] }), /长度/);
  assert.throws(() => validateModel({ ...twoAge, fecundity: [NaN, 1] }), /繁殖率/);
  assert.throws(() => validateModel({ ...twoAge, initial: [-1, 0] }), /初始数量/);
  assert.throws(() => project(twoAge, 0), /时间步/);
  assert.throws(() => project(twoAge, 1001), /上限/);
});

test("溢出中止：报告已完成范围且标记截断", () => {
  const m: LeslieModel = { name: "o", fecundity: [1e10, 1e10], survival: [0.9], initial: [1e200, 0] };
  const r = project(m, 50);
  assert.equal(r.truncated, true);
  assert.ok(r.stepsCompleted < 50);
  assert.ok(r.abortReason && r.abortReason.includes("中止"));
  assert.ok(r.series.every((s) => Number.isFinite(s.total)));
});

test("两年龄组特征分析：λ=黄金比例，残差近零", () => {
  const a = analyze(twoAge);
  const phi = (1 + Math.sqrt(5)) / 2;
  assert.ok(a.converged);
  assert.ok(Math.abs((a.lambda as number) - phi) < 1e-9);
  assert.ok((a.rightResidual as number) < 1e-9);
  assert.ok((a.leftResidual as number) < 1e-9);
  // 稳定年龄分布 w2 = 0.5/λ * w1
  const w = a.stableAgeDistribution as number[];
  assert.ok(Math.abs(w[1] - (0.5 / phi) * w[0]) < 1e-9);
  assert.ok(Math.abs(w[0] + w[1] - 1) < 1e-12);
  // 繁殖价值归一化 v·w = 1
  const v = a.reproductiveValue as number[];
  assert.ok(Math.abs(v[0] * w[0] + v[1] * w[1] - 1) < 1e-9);
  assert.equal(a.stableConvergenceGuaranteed, true);
});

test("弹性总和为 1（本原矩阵）", () => {
  const m: LeslieModel = { name: "e", fecundity: [0.2, 1.5, 0.9], survival: [0.6, 0.7], initial: [10, 5, 2] };
  const a = analyze(m);
  assert.ok(a.stableConvergenceGuaranteed);
  assert.ok(Math.abs((a.elasticitySum as number) - 1) < 1e-9);
});

test("敏感度与中心差分独立核对", () => {
  const m: LeslieModel = { name: "s", fecundity: [0.4, 1.8], survival: [0.6], initial: [10, 5] };
  const a = analyze(m);
  const h = 1e-6;
  const lam = (x: LeslieModel) => analyze(x).lambda as number;
  // 对 F_1 的中心差分
  const fp: LeslieModel = { ...m, fecundity: [m.fecundity[0] + h, m.fecundity[1]] };
  const fm: LeslieModel = { ...m, fecundity: [m.fecundity[0] - h, m.fecundity[1]] };
  const cdF = (lam(fp) - lam(fm)) / (2 * h);
  assert.ok(Math.abs(cdF - (a.fecunditySensitivity as number[])[0]) < 1e-4);
  // 对 s_1 的中心差分
  const sp: LeslieModel = { ...m, survival: [m.survival[0] + h] };
  const sm: LeslieModel = { ...m, survival: [m.survival[0] - h] };
  const cdS = (lam(sp) - lam(sm)) / (2 * h);
  assert.ok(Math.abs(cdS - (a.survivalSensitivity as number[])[0]) < 1e-4);
});

test("扰动比较：降低繁殖率后 λ 与总量下降", () => {
  const m: LeslieModel = { name: "g", fecundity: [0, 1.6, 2.4], survival: [0.5, 0.8], initial: [100, 20, 5] };
  const reduced = perturbModel(m, { fecundityScale: 0.6 });
  const lamBase = analyze(m).lambda as number;
  const lamRed = analyze(reduced).lambda as number;
  assert.ok(lamRed < lamBase);
  const pBase = project(m, 10);
  const pRed = project(reduced, 10);
  assert.ok(pRed.series[10].total < pBase.series[10].total);
});

test("SQLite：模型版本化与报告快照不被改写", () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "leslie-")), "t.db");
  const store = new Store(dbPath);
  const id1 = store.createModel(twoAge);
  const result1 = project(twoAge, 5);
  const reportId = store.saveReport(id1, "projection", { steps: 5 }, result1);
  // 修改模型生成新版本
  const modified: LeslieModel = { ...twoAge, fecundity: [2, 3] };
  const id2 = store.createModelVersion(id1, modified);
  assert.equal(store.getModel(id2).version, 2);
  // 旧报告仍指向旧模型与旧结果
  const report = store.getReport(reportId);
  assert.equal(report.modelId, id1);
  assert.deepEqual(report.result, JSON.parse(JSON.stringify(result1)));
  assert.deepEqual(store.getModel(id1).model.fecundity, [1, 2]);
  // 模拟重启后读取
  store.close();
  const store2 = new Store(dbPath);
  const reloaded = store2.getReport(reportId);
  assert.deepEqual(reloaded.result, JSON.parse(JSON.stringify(result1)));
  store2.close();
});
