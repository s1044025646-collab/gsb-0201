#!/usr/bin/env node
import * as fs from "node:fs";
import { Store, defaultDbPath } from "./store";
import { perturbModel, project, validateModel } from "./leslie";
import { analyze } from "./eigen";
import { projectionToCsv } from "./server";
import { DEFAULT_CONFIG, LeslieModel } from "./types";

const DB_PATH = process.env.LESLIE_DB ?? defaultDbPath();

function usage(): void {
  console.log(`用法: npm run cli -- <命令> [参数]

命令:
  import <model.json>                 导入模型，返回模型 id
  models                              列出全部模型版本
  project <modelId> <steps>           投影并保存报告
  analyze <modelId>                   长期结构分析并保存报告
  compare <modelId> <steps> <Fscale> [Sscale]  繁殖率/存活率缩放对照
  verify <reportId>                   重新计算并核验报告快照
  reports                             列出全部报告
  report <reportId>                   读取报告（重启后仍可读取）
  export <reportId> <out.(json|csv)>  导出报告为 JSON 或 CSV
  limits                              显示规模与期数限制
`);
}

function main(): void {
  const [cmd, ...args] = process.argv.slice(2);
  const store = new Store(DB_PATH);
  try {
    switch (cmd) {
      case "import": {
        const model = JSON.parse(fs.readFileSync(args[0], "utf-8")) as LeslieModel;
        validateModel(model);
        const id = store.createModel(model);
        console.log(`已导入模型 id=${id}（版本 1）`);
        break;
      }
      case "models":
        console.table(store.listModels());
        break;
      case "project": {
        const { model } = store.getModel(Number(args[0]));
        const steps = Number(args[1]);
        const result = project(model, steps);
        const reportId = store.saveReport(Number(args[0]), "projection", { steps }, result);
        console.log(`报告 id=${reportId}，完成 ${result.stepsCompleted}/${result.stepsRequested} 期`);
        if (result.truncated) console.log(`警告: ${result.abortReason}`);
        console.table(
          result.series.map((s) => ({
            t: s.t,
            total: s.total.toPrecision(6),
            growthRatio: s.growthRatioDefined ? s.growthRatio!.toPrecision(6) : "不可定义",
            births: s.births.toPrecision(6),
            cumulativeBirths: s.cumulativeBirths.toPrecision(6),
          }))
        );
        break;
      }
      case "analyze": {
        const { model } = store.getModel(Number(args[0]));
        const result = analyze(model);
        const reportId = store.saveReport(Number(args[0]), "analysis", {}, result);
        console.log(`报告 id=${reportId}`);
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      case "compare": {
        const { model } = store.getModel(Number(args[0]));
        const steps = Number(args[1]);
        const fecundityScale = Number(args[2]);
        const survivalScale = args[3] !== undefined ? Number(args[3]) : undefined;
        const perturbed = perturbModel(model, { fecundityScale, survivalScale });
        validateModel(perturbed);
        const baseline = project(model, steps);
        const scenario = project(perturbed, steps);
        const reportId = store.saveReport(
          Number(args[0]),
          "compare",
          { steps, fecundityScale, survivalScale },
          { baseline, scenario, perturbedModel: perturbed }
        );
        console.log(`报告 id=${reportId}`);
        console.log("期\t基线总量\t对照总量");
        for (let i = 0; i < baseline.series.length; i++) {
          console.log(
            `${baseline.series[i].t}\t${baseline.series[i].total.toPrecision(6)}\t${scenario.series[i].total.toPrecision(6)}`
          );
        }
        break;
      }
      case "verify": {
        const report = store.getReport(Number(args[0]));
        const { model } = store.getModel(report.modelId);
        let recomputed: unknown;
        if (report.type === "projection") {
          recomputed = project(model, (report.params as { steps: number }).steps, report.config);
        } else if (report.type === "analysis") {
          recomputed = analyze(model, report.config);
        } else {
          throw new Error(`报告类型 ${report.type} 暂不支持自动核验`);
        }
        const match = JSON.stringify(recomputed) === JSON.stringify(report.result);
        console.log(match ? "核验通过：重算结果与快照一致" : "核验失败：结果不一致");
        process.exitCode = match ? 0 : 1;
        break;
      }
      case "reports":
        console.table(store.listReports());
        break;
      case "report":
        console.log(JSON.stringify(store.getReport(Number(args[0])), null, 2));
        break;
      case "export": {
        const report = store.getReport(Number(args[0]));
        const out = args[1];
        if (out.endsWith(".csv")) {
          const r = report.result as { series?: unknown[]; baseline?: { series?: unknown[] } };
          const proj = (r.series ? r : r.baseline) as Parameters<typeof projectionToCsv>[0];
          if (!proj || !proj.series) throw new Error("该报告不含投影序列，无法导出 CSV");
          fs.writeFileSync(out, projectionToCsv(proj), "utf-8");
        } else {
          fs.writeFileSync(out, JSON.stringify(report, null, 2), "utf-8");
        }
        console.log(`已导出到 ${out}`);
        break;
      }
      case "limits":
        console.log(JSON.stringify(DEFAULT_CONFIG, null, 2));
        break;
      default:
        usage();
        if (cmd) process.exitCode = 1;
    }
  } catch (err) {
    console.error(`错误: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

main();
