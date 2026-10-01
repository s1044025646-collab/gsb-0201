# 年龄结构种群投影与增长弹性分析后端

教学用离散年龄结构种群分析服务。纯后端（REST API + CLI），TypeScript + Node.js + SQLite，
Windows 本地运行，不依赖 Docker、WSL 或任何外部在线服务。

## 模型约定（出生后普查 Leslie 模型）

- 状态向量 `n(t)` 为各年龄组数量（非负实数），投影方程 `n(t+1) = A · n(t)`。
- 矩阵 `A` **首行**为繁殖率 `F_i`：年龄组 `i` 在下一期对第一年龄组的新生贡献，允许大于 1。
- **次对角线**为存活率 `s_i`：从年龄组 `i` 进入 `i+1` 的比例，取值 `(0, 1]`。
- 末年龄组**默认不累积**（无开放组）：进入末组后下一期离开种群。
- `A` 是人口投影矩阵，**不是**概率转移矩阵，不做任何行/列归一化。

## 环境要求

- Node.js ≥ 22.5（使用内置 `node:sqlite`，无需原生编译；开发环境为 Node 25）。
- 仅开发依赖：`typescript`、`tsx`、`@types/node`。

## 快速开始

```powershell
npm install        # 安装依赖
npm run build      # 编译到 dist/
npm test           # 运行全部测试（node:test）
npm run demo       # 演示：增长 vs 降繁殖对照、周期情景、重启后读报告
npm start          # 启动编译后的 API 服务（默认端口 3000）
npm run serve      # 直接用 tsx 启动（免构建）
npm run cli -- ... # 命令行界面
```

配置项通过环境变量设置：

- `PORT`：API 端口（默认 3000）
- `LESLIE_DB`：SQLite 文件路径（默认 `项目目录/data/leslie.db`）

## 模型 JSON 格式

```json
{
  "name": "增长情景（三年龄组）",
  "fecundity": [0, 1.6, 2.4],
  "survival": [0.5, 0.8],
  "initial": [100, 20, 5]
}
```

约束：`fecundity` 长度 = 年龄组数 n；`survival` 长度 = n-1，每个值 ∈ (0,1]；
`initial` 长度 = n，非负。长度不匹配、数值越界、时间步非正整数或超限都会被拒绝并给出中文错误。

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/limits` | 规模与期数限制（maxSteps=1000、maxGroups=200 等） |
| POST | `/models` | 导入模型 `{ "model": {...} }` |
| GET | `/models` / `/models/:id` | 列出 / 读取模型 |
| POST | `/models/:id/versions` | 修改模型（生成新版本，旧版本与旧报告不变） |
| POST | `/projection` | 投影 `{ modelId 或 model, steps, config? }` |
| POST | `/analysis` | 长期结构分析（λ、稳定年龄分布、繁殖价值、敏感度、弹性） |
| POST | `/compare` | 繁殖率/存活率缩放或替换的双情景对照 |
| GET | `/reports` / `/reports/:id` | 列出 / 读取报告快照 |
| GET | `/reports/:id/export?format=json\|csv` | 导出报告 |
| POST | `/reports/:id/verify` | 重新计算并与快照比对 |

所有计算报告（含输入与算法配置快照）写入 SQLite；修改模型只新增版本，旧报告永不被改写。

## CLI 一览

```powershell
npm run cli -- import examples/growth.json   # 导入模型
npm run cli -- project 1 20                  # 投影 20 期
npm run cli -- analyze 1                     # 长期结构分析
npm run cli -- compare 1 20 0.6              # 繁殖率降为 60% 的对照
npm run cli -- verify 1                      # 核验报告快照
npm run cli -- report 1                      # 读取报告（重启后仍可读）
npm run cli -- export 1 out.csv              # 导出 CSV（或 .json）
npm run cli -- reports                       # 列出全部报告
npm run cli -- limits                        # 查看限制
```

## 分析语义说明

- **投影**：逐期返回各组数量、总量、实际增长比 `N(t)/N(t-1)`、本期出生量与累计出生量。
  上期总量为零时增长比为 `null` 且 `growthRatioDefined=false`，绝不输出 NaN 或补 1。
  数值溢出（超过 `maxValue`）时中止，`truncated=true` 并说明已完成期数，截断序列不会被当作完整预测。
- **长期结构**：幂迭代求主特征值 λ 与右特征向量 w（归一化：分量之和 = 1，即稳定年龄分布）；
  对 `Aᵀ` 求左特征向量 v（归一化：`v·w = 1`，即繁殖价值）。报告 `‖Aw−λw‖∞` 与 `‖Aᵀv−λv‖∞` 残差。
- **结构判定**：Leslie 矩阵不可约 ⟺ 末组繁殖率 `F_n > 0`；不可约时本原 ⟺ `gcd{i : F_i>0} = 1`。
  只有不可约且本原时才置 `stableConvergenceGuaranteed=true`。周期矩阵、可约矩阵、零繁殖（灭绝）、
  迭代不收敛都只给诊断，不给零元素加小数凑答案；有限期投影始终按原矩阵执行。
- **敏感度与弹性**：λ 为简单正主特征值时，`dλ/da_ij = v_i·w_j`（`v·w=1` 归一），
  映射回 `F_i`、`s_i`；弹性 `e = (a/λ)·dλ/da`，全部元素弹性之和理论值为 1（结果中给出 `elasticitySum` 供核验）。

## 测试

`tests/core.test.ts` 共 15 个用例，覆盖：两年龄组手算解（λ 为黄金比例）、零初始数量、零繁殖灭绝、
周期矩阵、可约矩阵、非法存活率与长度不匹配、溢出截断、逐期递推独立核对、数量缩放线性关系、
特征残差、弹性总和为 1、中心差分核对敏感度、扰动对照、SQLite 版本化与重启后读取。

## 已知限制

- 幂迭代只适用于实主特征值情形；周期矩阵如实报告不收敛，不做移位/ deflate 等进阶处理。
- 可约矩阵的渐近分析只给诊断，不做完全的可约分解。
- 投影矩阵为稠密二维数组，年龄组上限 200（可在 `src/types.ts` 的 `DEFAULT_CONFIG` 调整）。
- `node:sqlite` 在 Node 22/23 为实验特性，启动时会打印 ExperimentalWarning，不影响功能。
