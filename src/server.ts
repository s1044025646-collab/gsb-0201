import * as http from "node:http";
import { Store, defaultDbPath } from "./store";
import { perturbModel, project, validateModel } from "./leslie";
import { analyze } from "./eigen";
import { AnalysisConfig, DEFAULT_CONFIG, LeslieModel, ProjectionResult } from "./types";

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.LESLIE_DB ?? defaultDbPath();

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(text);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** 投影结果转 CSV：每期一行，各年龄组一列。 */
export function projectionToCsv(result: ProjectionResult): string {
  const n = result.series[0]?.counts.length ?? 0;
  const header = ["t", "total", "growthRatio", "births", "cumulativeBirths"];
  for (let i = 0; i < n; i++) header.push(`n_${i + 1}`);
  const lines = [header.join(",")];
  for (const s of result.series) {
    lines.push(
      [
        s.t,
        s.total,
        s.growthRatio === null ? "NA" : s.growthRatio,
        s.births,
        s.cumulativeBirths,
        ...s.counts,
      ].join(",")
    );
  }
  return lines.join("\n") + "\n";
}

function mergeConfig(partial?: Partial<AnalysisConfig>): AnalysisConfig {
  return { ...DEFAULT_CONFIG, ...(partial ?? {}) };
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";
    try {
      if (method === "GET" && path === "/limits") {
        return json(res, 200, { limits: DEFAULT_CONFIG });
      }
      if (method === "GET" && path === "/models") {
        return json(res, 200, { models: store.listModels() });
      }
      if (method === "POST" && path === "/models") {
        const body = (await readBody(req)) as { model: LeslieModel };
        validateModel(body.model);
        const id = store.createModel(body.model);
        return json(res, 201, { id, version: 1 });
      }
      const modelMatch = path.match(/^\/models\/(\d+)$/);
      if (method === "GET" && modelMatch) {
        return json(res, 200, store.getModel(Number(modelMatch[1])));
      }
      const versionMatch = path.match(/^\/models\/(\d+)\/versions$/);
      if (method === "POST" && versionMatch) {
        const body = (await readBody(req)) as { model: LeslieModel };
        validateModel(body.model);
        const id = store.createModelVersion(Number(versionMatch[1]), body.model);
        return json(res, 201, { id, version: store.getModel(id).version });
      }
      if (method === "POST" && path === "/projection") {
        const body = (await readBody(req)) as {
          modelId?: number;
          model?: LeslieModel;
          steps: number;
          config?: Partial<AnalysisConfig>;
        };
        const model = body.modelId ? store.getModel(body.modelId).model : (body.model as LeslieModel);
        const config = mergeConfig(body.config);
        const result = project(model, body.steps, config);
        const modelId = body.modelId ?? store.createModel(model);
        const reportId = store.saveReport(modelId, "projection", { steps: body.steps }, result, config);
        return json(res, 200, { reportId, modelId, result });
      }
      if (method === "POST" && path === "/analysis") {
        const body = (await readBody(req)) as {
          modelId?: number;
          model?: LeslieModel;
          config?: Partial<AnalysisConfig>;
        };
        const model = body.modelId ? store.getModel(body.modelId).model : (body.model as LeslieModel);
        validateModel(model);
        const config = mergeConfig(body.config);
        const result = analyze(model, config);
        const modelId = body.modelId ?? store.createModel(model);
        const reportId = store.saveReport(modelId, "analysis", {}, result, config);
        return json(res, 200, { reportId, modelId, result });
      }
      if (method === "POST" && path === "/compare") {
        const body = (await readBody(req)) as {
          modelId?: number;
          model?: LeslieModel;
          steps: number;
          fecundityScale?: number;
          survivalScale?: number;
          fecundity?: number[];
          survival?: number[];
          config?: Partial<AnalysisConfig>;
        };
        const base = body.modelId ? store.getModel(body.modelId).model : (body.model as LeslieModel);
        const config = mergeConfig(body.config);
        const perturbed = perturbModel(base, body);
        validateModel(perturbed, config);
        const baseline = project(base, body.steps, config);
        const scenario = project(perturbed, body.steps, config);
        const modelId = body.modelId ?? store.createModel(base);
        const reportId = store.saveReport(
          modelId,
          "compare",
          { steps: body.steps, perturbation: body },
          { baseline, scenario, perturbedModel: perturbed },
          config
        );
        return json(res, 200, { reportId, modelId, baseline, scenario, perturbedModel: perturbed });
      }
      if (method === "GET" && path === "/reports") {
        return json(res, 200, { reports: store.listReports() });
      }
      const reportMatch = path.match(/^\/reports\/(\d+)$/);
      if (method === "GET" && reportMatch) {
        return json(res, 200, store.getReport(Number(reportMatch[1])));
      }
      const exportMatch = path.match(/^\/reports\/(\d+)\/export$/);
      if (method === "GET" && exportMatch) {
        const report = store.getReport(Number(exportMatch[1]));
        const format = url.searchParams.get("format") ?? "json";
        if (format === "csv") {
          const result = report.result as { series?: unknown } & ProjectionResult;
          const proj = result.series ? result : (report.result as { baseline?: ProjectionResult }).baseline;
          if (!proj || !proj.series) {
            return json(res, 400, { error: "该报告不含投影序列，无法导出 CSV" });
          }
          res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
          return res.end(projectionToCsv(proj));
        }
        return json(res, 200, report);
      }
      // 结果核验：重新计算并与报告快照比对
      const verifyMatch = path.match(/^\/reports\/(\d+)\/verify$/);
      if (method === "POST" && verifyMatch) {
        const report = store.getReport(Number(verifyMatch[1]));
        const { model } = store.getModel(report.modelId);
        const config = report.config;
        let recomputed: unknown;
        if (report.type === "projection") {
          recomputed = project(model, (report.params as { steps: number }).steps, config);
        } else if (report.type === "analysis") {
          recomputed = analyze(model, config);
        } else {
          return json(res, 400, { error: `报告类型 ${report.type} 暂不支持自动核验` });
        }
        const match = JSON.stringify(recomputed) === JSON.stringify(report.result);
        return json(res, 200, { reportId: report.id, type: report.type, match });
      }
      json(res, 404, { error: `未找到路由 ${method} ${path}` });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
  });
}

if (require.main === module) {
  const store = new Store(DB_PATH);
  const server = createServer(store);
  server.listen(PORT, () => {
    console.log(`Leslie 种群分析服务已启动: http://localhost:${PORT}`);
    console.log(`数据库: ${DB_PATH}`);
  });
}
