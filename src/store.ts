import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { AnalysisConfig, DEFAULT_CONFIG, LeslieModel } from "./types";

/**
 * SQLite 存储层：保存模型版本与运行报告快照。
 * 模型修改会生成新版本，旧报告永远指向旧版本快照，不会被改写。
 */
export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        parent_id INTEGER,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        params TEXT NOT NULL,
        config TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (model_id) REFERENCES models(id)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  /** 导入新模型（版本 1）。 */
  createModel(model: LeslieModel): number {
    const stmt = this.db.prepare(
      "INSERT INTO models (name, version, parent_id, payload, created_at) VALUES (?, 1, NULL, ?, ?)"
    );
    const r = stmt.run(model.name, JSON.stringify(model), new Date().toISOString());
    return Number(r.lastInsertRowid);
  }

  /** 修改模型：基于已有模型创建新版本，旧版本与旧报告保持不变。 */
  createModelVersion(parentId: number, model: LeslieModel): number {
    const parent = this.getModel(parentId);
    const stmt = this.db.prepare(
      "INSERT INTO models (name, version, parent_id, payload, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    const r = stmt.run(
      model.name,
      parent.version + 1,
      parentId,
      JSON.stringify(model),
      new Date().toISOString()
    );
    return Number(r.lastInsertRowid);
  }

  getModel(id: number): { id: number; name: string; version: number; model: LeslieModel } {
    const row = this.db
      .prepare("SELECT id, name, version, payload FROM models WHERE id = ?")
      .get(id) as { id: number; name: string; version: number; payload: string } | undefined;
    if (!row) throw new Error(`模型 id=${id} 不存在`);
    return { id: row.id, name: row.name, version: row.version, model: JSON.parse(row.payload) };
  }

  listModels(): Array<{ id: number; name: string; version: number; parentId: number | null; createdAt: string }> {
    const rows = this.db
      .prepare("SELECT id, name, version, parent_id, created_at FROM models ORDER BY id")
      .all() as Array<{ id: number; name: string; version: number; parent_id: number | null; created_at: string }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      version: r.version,
      parentId: r.parent_id,
      createdAt: r.created_at,
    }));
  }

  /** 保存一次运行报告（含输入快照与算法配置快照）。 */
  saveReport(
    modelId: number,
    type: string,
    params: unknown,
    result: unknown,
    config: AnalysisConfig = DEFAULT_CONFIG
  ): number {
    const stmt = this.db.prepare(
      "INSERT INTO reports (model_id, type, params, config, result, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const r = stmt.run(
      modelId,
      type,
      JSON.stringify(params),
      JSON.stringify(config),
      JSON.stringify(result),
      new Date().toISOString()
    );
    return Number(r.lastInsertRowid);
  }

  getReport(id: number): {
    id: number;
    modelId: number;
    type: string;
    params: unknown;
    config: AnalysisConfig;
    result: unknown;
    createdAt: string;
  } {
    const row = this.db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new Error(`报告 id=${id} 不存在`);
    return {
      id: row.id as number,
      modelId: row.model_id as number,
      type: row.type as string,
      params: JSON.parse(row.params as string),
      config: JSON.parse(row.config as string),
      result: JSON.parse(row.result as string),
      createdAt: row.created_at as string,
    };
  }

  listReports(): Array<{ id: number; modelId: number; type: string; createdAt: string }> {
    const rows = this.db
      .prepare("SELECT id, model_id, type, created_at FROM reports ORDER BY id")
      .all() as Array<{ id: number; model_id: number; type: string; created_at: string }>;
    return rows.map((r) => ({ id: r.id, modelId: r.model_id, type: r.type, createdAt: r.created_at }));
  }
}

export function defaultDbPath(): string {
  return path.join(process.cwd(), "data", "leslie.db");
}
