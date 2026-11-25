import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const ua = path.join(root, '.ua');
const inter = path.join(ua, 'intermediate');
const graphPath = path.join(inter, 'assembled-graph.json');
const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
const scan = JSON.parse(fs.readFileSync(path.join(inter, 'scan-result.json'), 'utf8'));
const fileTypes = new Set(['file', 'config', 'document', 'service', 'pipeline', 'table', 'schema', 'resource', 'endpoint']);
const files = graph.nodes.filter(node => fileTypes.has(node.type));
const groups = [
  { id: 'layer:agent-core', name: 'Agent 核心与编排', description: '主 Agent、上下文、提示、状态结构及执行编排。', match: n => n.filePath?.startsWith('src/agent/') && !/\/(api|tools|middlewares|backends|guardrails|memory)\//.test(n.filePath) },
  { id: 'layer:agent-services', name: 'Agent 工具与运行时', description: '采购工具、MCP 客户端、沙箱后端、中间件和安全护栏。', match: n => /^src\/agent\/(tools|middlewares|backends|guardrails|memory)\//.test(n.filePath || '') },
  { id: 'layer:web-api', name: 'Web API 与认证', description: 'FastAPI 入口、认证、聊天流、历史记录及会话装载接口。', match: n => /^src\/api_view\//.test(n.filePath || '') },
  { id: 'layer:mcp', name: 'ERP MCP 服务', description: 'ERP 数据与采购操作的 MCP 服务入口及工具注册实现。', match: n => /^src\/mcp_server\//.test(n.filePath || '') },
  { id: 'layer:frontend', name: 'Vue 前端', description: 'Vue 聊天工作台、认证视图、API 客户端、渲染组件及样式。', match: n => /^frontend\//.test(n.filePath || '') },
  { id: 'layer:skills-tests', name: '技能与验证', description: '采购技能、开发验证脚本和自动化测试，覆盖领域工作流及回归行为。', match: n => /(^|\/)(test|tests|deepagents_test|skills)\//.test(n.filePath || '') || /(^|\/)(test_[^/]+\.py|[^/]+\.test\.js)$/.test(n.filePath || '') },
  { id: 'layer:docs-data', name: '文档与业务数据', description: '项目说明、架构资料、图表资产和供应链 SQL 数据定义。', match: n => n.type === 'document' || n.type === 'table' || /^src\/docs\//.test(n.filePath || '') || n.filePath === 'chip_supply_db.sql' },
  { id: 'layer:project-config', name: '项目配置与启动', description: '依赖清单、环境变量模板、启动脚本及其余项目级配置。', match: () => true },
];
const assigned = new Set();
const layers = [];
for (const group of groups) {
  const nodeIds = files.filter(n => !assigned.has(n.id) && group.match(n)).map(n => n.id);
  if (!nodeIds.length) continue;
  nodeIds.forEach(id => assigned.add(id));
  layers.push({ id: group.id, name: group.name, description: group.description, nodeIds });
}
if (assigned.size !== files.length) throw new Error(`Layer assignment incomplete: ${assigned.size}/${files.length}`);
fs.writeFileSync(path.join(inter, 'layers.json'), JSON.stringify(layers, null, 2), 'utf8');

const idsByPath = new Map(files.map(n => [n.filePath, n.id]));
const pick = (...paths) => paths.map(p => idsByPath.get(p)).filter(Boolean).slice(0, 5);
const tour = [
  { order: 1, title: '项目概览与运行方式', description: '从项目说明认识采购助手的能力边界、启动依赖与主要服务。重点留意 Web、MCP、MySQL 和 OpenSandbox 如何共同组成运行环境。', nodeIds: pick('README.md', 'pyproject.toml') },
  { order: 2, title: '服务启动入口', description: '启动器协调 FastAPI 后端与 Vue 开发服务器，并验证本次进程就绪、端口占用和退出清理。它把多个开发服务纳入同一生命周期。', nodeIds: pick('start_web.py', 'src/api_view/web_main.py') },
  { order: 3, title: '主 Agent 编排', description: '主 Agent 汇总模型、MCP 工具、沙箱后端和 middleware，形成采购任务的执行入口。沿着上下文预计算与子 Agent 配置，可理解职责如何拆分。', nodeIds: pick('src/agent/main_agent.py', 'src/agent/middleware_config.py', 'src/agent/schema.py') },
  { order: 4, title: '输入安全护栏', description: '聊天输入先经过独立安全检查，再决定是否进入业务 Agent；配置、策略、提示和 Colang 流程共同定义检查边界。拦截、超时与无效配置采用不同失败响应。', nodeIds: pick('src/agent/input_guard.py', 'src/agent/guardrails/config.yml', 'src/agent/guardrails/policies.yml', 'src/agent/guardrails/prompts.yml') },
  { order: 5, title: '认证与会话 API', description: 'Web API 通过登录会话取得用户名，并在历史读取、恢复和删除时检查归属。聊天路由以流式响应承载 Agent 执行状态，认证模块负责 Cookie 与同源写请求约束。', nodeIds: pick('src/api_view/api/auth.py', 'src/api_view/auth.py', 'src/api_view/api/chat.py', 'src/api_view/api/history.py') },
  { order: 6, title: 'ERP MCP 工具', description: 'MCP 服务把供应商、物料、库存和采购单操作封装为 Agent 可调用工具。主 Agent 的 MCP 客户端加载远端工具，采购操作与分析能力保持在 ERP 集成边界内。', nodeIds: pick('src/mcp_server/server_main.py', 'src/mcp_server/tools/suppliers_tools.py', 'src/mcp_server/tools/parts_tools.py', 'src/mcp_server/tools/order_tools.py', 'src/agent/tools/mcp_client.py') },
  { order: 7, title: '沙箱与用户隔离', description: '沙箱管理器按用户绑定和回收执行环境，代理后端承接 DeepAgents 的文件与命令操作。启动配置负责环境初始化，持久化绑定让会话能重连到正确沙箱。', nodeIds: pick('src/agent/backends/sandbox_manager.py', 'src/agent/backends/sandbox_setup.py', 'src/agent/backends/sandbox_proxy.py', 'src/agent/mysql_storage.py') },
  { order: 8, title: '持久化与业务数据', description: 'MySQL 保存检查点、展示消息、账号、登录会话和沙箱关联；供应链 SQL 文件描述独立的业务库结构。两类数据分别承担应用会话状态和 ERP 业务数据职责。', nodeIds: pick('src/agent/mysql_storage.py', 'src/agent/backends/sandbox_manager.py', 'chip_supply_db.sql') },
  { order: 9, title: '图表生成与校验', description: '图表工具把多种图形能力统一到单一入口，再依据上游 MCP schema 校验配置并处理远端错误。测试与场景数据展示了参数约束和兼容性覆盖。', nodeIds: pick('src/agent/tools/chart_generator.py', 'src/agent/tools/chart_validation.py', 'src/test/test_chart_generator.py', 'src/skills/analyis_chart_params.md') },
  { order: 10, title: 'Vue 聊天工作台', description: '前端以聊天工作区组织消息、执行过程、审批和图表展示，并通过 API 客户端与后端交换流式结果。认证页面和历史侧栏补足会话生命周期。', nodeIds: pick('frontend/src/App.vue', 'frontend/src/ChatWorkspace.vue', 'frontend/src/components/ChatArea.vue', 'frontend/src/api/chat.js', 'frontend/src/api/auth.js') },
].filter(step => step.nodeIds.length);
fs.writeFileSync(path.join(inter, 'tour.json'), JSON.stringify(tour, null, 2), 'utf8');
const nodeById = new Map(graph.nodes.map(n => [n.id, n]));
const analyzedAt = new Date().toISOString();
graph.version = '1.0.0';
graph.kind = 'codebase';
graph.project = { name: scan.name, languages: scan.languages, frameworks: scan.frameworks, description: scan.description, analyzedAt, gitCommitHash: '' };
graph.layers = layers;
graph.tour = tour;
const ids = new Set(graph.nodes.map(n => n.id));
const errors = [];
for (const n of graph.nodes) {
  if (!n.id || !n.type || !n.name || !n.summary || !Array.isArray(n.tags) || !n.tags.length) errors.push(`invalid node ${n.id}`);
}
for (const e of graph.edges) if (!ids.has(e.source) || !ids.has(e.target)) errors.push(`dangling edge ${e.source} -> ${e.target}`);
for (const layer of layers) for (const id of layer.nodeIds) if (!ids.has(id)) errors.push(`dangling layer ref ${id}`);
for (const step of tour) for (const id of step.nodeIds) if (!ids.has(id)) errors.push(`dangling tour ref ${id}`);
const result = { version: graph.version, kind: graph.kind, project: graph.project, nodes: graph.nodes, edges: graph.edges, layers, tour };
if (errors.length) throw new Error(errors.slice(0, 20).join('\n'));
fs.writeFileSync(graphPath, JSON.stringify(result, null, 2), 'utf8');
fs.writeFileSync(path.join(inter, 'review.json'), JSON.stringify({ issues: [], warnings: ['子 Agent 语义分析及独立 LLM 审查因上游不支持加密 agent 消息而未运行；文件摘要使用确定性规则生成。', '结构提取器跳过不支持的图表、文本和特殊格式文件；这些文件仍以文件节点保留。'], stats: { totalNodes: graph.nodes.length, totalEdges: graph.edges.length, totalLayers: layers.length, tourSteps: tour.length, nodeTypes: graph.nodes.reduce((a,n)=>(a[n.type]=(a[n.type]||0)+1,a),{}), edgeTypes: graph.edges.reduce((a,e)=>(a[e.type]=(a[e.type]||0)+1,a),{}) } }, null, 2), 'utf8');
console.log(JSON.stringify({ nodes: graph.nodes.length, edges: graph.edges.length, fileNodes: files.length, layers: layers.map(l => ({ name: l.name, files: l.nodeIds.length })), tourSteps: tour.length, errors: errors.length }));
