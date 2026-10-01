/**
 * 演示脚本：
 * 1) 增长情景 vs 降低繁殖率对照；
 * 2) 周期矩阵为什么不能宣称收敛；
 * 3) 关闭并重开数据库后读取旧报告（模拟重启）。
 */
import * as fs from "node:fs";
import { Store, defaultDbPath } from "./store";
import { perturbModel, project } from "./leslie";
import { analyze } from "./eigen";
import { LeslieModel } from "./types";

const DB = process.env.LESLIE_DB ?? defaultDbPath();

function line(title: string): void {
  console.log("\n=== " + title + " ===");
}

function main(): void {
  if (fs.existsSync(DB)) fs.rmSync(DB);
  const store = new Store(DB);

  line("1. 增长情景：三年龄组 Leslie 模型");
  const growth: LeslieModel = {
    name: "增长情景",
    fecundity: [0, 1.6, 2.4],
    survival: [0.5, 0.8],
    initial: [100, 20, 5],
  };
  const growthId = store.createModel(growth);
  const steps = 20;
  const baseProj = project(growth, steps);
  const baseReport = store.saveReport(growthId, "projection", { steps }, baseProj);
  console.log(`模型 id=${growthId}，投影报告 id=${baseReport}`);
  console.log("t\t总量\t\t增长比\t\t累计出生");
  for (const s of baseProj.series.filter((_, i) => i % 4 === 0 || i === steps)) {
    const gr = s.growthRatioDefined ? s.growthRatio!.toFixed(6) : "不可定义";
    console.log(`${s.t}\t${s.total.toExponential(4)}\t${gr}\t\t${s.cumulativeBirths.toExponential(4)}`);
  }

  const growthAnalysis = analyze(growth);
  const growthAnalysisReport = store.saveReport(growthId, "analysis", {}, growthAnalysis);
  console.log(`分析报告 id=${growthAnalysisReport}`);
  console.log(`长期增长因子 λ = ${growthAnalysis.lambda?.toFixed(6)}`);
  console.log(`稳定年龄分布 w = ${growthAnalysis.stableAgeDistribution?.map((x) => x.toFixed(4))}`);
  console.log(`繁殖价值 v = ${growthAnalysis.reproductiveValue?.map((x) => x.toFixed(4))}`);
  console.log(`右残差 = ${growthAnalysis.rightResidual?.toExponential(2)}，左残差 = ${growthAnalysis.leftResidual?.toExponential(2)}`);
  console.log(`繁殖率弹性 = ${growthAnalysis.fecundityElasticity?.map((x) => x.toFixed(4))}`);
  console.log(`存活率弹性 = ${growthAnalysis.survivalElasticity?.map((x) => x.toFixed(4))}`);
  console.log(`弹性总和 = ${growthAnalysis.elasticitySum?.toFixed(12)}（理论值 1）`);
  console.log(`诊断: ${growthAnalysis.diagnostics.join("；")}`);

  line("2. 对照情景：繁殖率降低 40%");
  const reduced = perturbModel(growth, { fecundityScale: 0.6 });
  const reducedId = store.createModelVersion(growthId, reduced);
  const redProj = project(reduced, steps);
  const cmpReport = store.saveReport(
    growthId,
    "compare",
    { steps, fecundityScale: 0.6 },
    { baseline: baseProj, scenario: redProj, perturbedModel: reduced }
  );
  console.log(`对照模型 id=${reducedId}（版本 2），比较报告 id=${cmpReport}`);
  console.log("t\t基线总量\t降繁殖总量");
  for (let i = 0; i <= steps; i += 5) {
    console.log(`${i}\t${baseProj.series[i].total.toExponential(4)}\t${redProj.series[i].total.toExponential(4)}`);
  }
  const redAnalysis = analyze(reduced);
  console.log(`对照 λ = ${redAnalysis.lambda?.toFixed(6)}（基线 λ = ${growthAnalysis.lambda?.toFixed(6)}）`);

  line("3. 周期矩阵：不能宣称收敛");
  const periodic: LeslieModel = {
    name: "周期情景",
    fecundity: [0, 3],
    survival: [0.5],
    initial: [10, 4],
  };
  const periodicId = store.createModel(periodic);
  const pAnalysis = analyze(periodic);
  const pReport = store.saveReport(periodicId, "analysis", {}, pAnalysis);
  console.log(`模型 id=${periodicId}，分析报告 id=${pReport}`);
  console.log(`不可约=${pAnalysis.irreducible}，本原=${pAnalysis.primitive}，周期=${pAnalysis.period}`);
  console.log(`幂迭代收敛=${pAnalysis.converged}，可宣称稳定收敛=${pAnalysis.stableConvergenceGuaranteed}`);
  console.log(`诊断: ${pAnalysis.diagnostics.join("；")}`);
  const pProj = project(periodic, 6);
  console.log("有限期投影仍按原矩阵执行（总量序列）:");
  console.log(pProj.series.map((s) => `${s.t}:${s.total.toPrecision(4)}`).join("  "));

  line("4. 模拟重启：关闭数据库后重新打开并读取旧报告");
  store.close();
  const store2 = new Store(DB);
  const loaded = store2.getReport(cmpReport);
  console.log(`重启后读取报告 id=${loaded.id}，类型=${loaded.type}，创建时间=${loaded.createdAt}`);
  const base = (loaded.result as { baseline: { series: Array<{ t: number; total: number }> } }).baseline;
  console.log(`旧报告基线末期总量 = ${base.series[base.series.length - 1].total.toExponential(6)}`);
  console.log("模型版本列表（修改模型不会改写旧报告）:");
  console.table(store2.listModels());
  store2.close();

  line("演示完成");
}

main();
