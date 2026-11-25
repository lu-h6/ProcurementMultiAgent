import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const ua = path.join(root, '.ua');
const inter = path.join(ua, 'intermediate');
const tmp = path.join(ua, 'tmp');
const scan = JSON.parse(fs.readFileSync(path.join(inter, 'scan-result.json'), 'utf8'));
const batches = JSON.parse(fs.readFileSync(path.join(inter, 'batches.json'), 'utf8'));
const extracts = new Map();
for (const file of fs.readdirSync(tmp).filter(name => /^ua-file-extract-results-\d+\.json$/.test(name))) {
  const data = JSON.parse(fs.readFileSync(path.join(tmp, file), 'utf8'));
  for (const result of data.results || []) extracts.set(result.path, result);
}

const nodeType = file => {
  if (file.fileCategory === 'docs') return 'document';
  if (file.fileCategory === 'config') return 'config';
  if (file.fileCategory === 'data') return file.language === 'sql' ? 'table' : 'schema';
  if (file.fileCategory === 'infra') return /workflow|\.gitlab-ci|Jenkinsfile|\.circleci/.test(file.path) ? 'pipeline' : 'service';
  return 'file';
};
const fileId = file => `${nodeType(file)}:${file.path}`;
const label = value => value.replace(/[_-]+/g, ' ').replace(/\.(py|js|jsx|vue|html|css|json|ya?ml|toml|md|sql|txt|drawio|dsl)$/i, '');
function fileSummary(file) {
  const p = file.path.toLowerCase();
  if (file.path === 'README.md') return '项目总览文档，说明 ERP 采购助手的安装启动、图表工具、输入安全、Web 认证和 MySQL 会话存储。';
  if (file.path === 'pyproject.toml' || file.path === 'requirements.txt') return '声明 Python 包构建元数据及 DeepAgents、LangChain、FastAPI、MCP、MySQL 等运行依赖。';
  if (file.path === '.env.example') return '列出模型、ERP/MCP、沙箱、MySQL、认证和 Web 服务的环境变量模板，不包含真实凭据。';
  if (file.language === 'sql') return '包含芯链供应链业务数据库的 SQL 定义或初始化数据，为采购业务提供关系型数据结构。';
  if (p.includes('/guardrails/') || p.includes('input_guard')) return '定义或实现用户输入安全检查、策略规则、审查提示及拦截流程。';
  if (p.includes('/middlewares/')) return `实现 Agent 运行时的${label(path.basename(file.path))}中间件，处理跨请求的上下文、安全或工具行为。`;
  if (p.includes('/backends/')) return `实现 OpenSandbox 执行后端及其${label(path.basename(file.path))}生命周期、配置或代理适配。`;
  if (p.includes('/tools/')) return `封装 Agent 可调用的${label(path.basename(file.path))}工具、参数处理与外部服务交互。`;
  if (p.includes('/api/') || p.includes('api_view')) return `提供 Web ${label(path.basename(file.path))}接口处理、会话鉴权或响应序列化。`;
  if (p.includes('/mcp_server/')) return `注册或运行 ERP MCP 服务中的${label(path.basename(file.path))}能力。`;
  if (p.includes('/skills/')) return `为采购 Agent 提供${label(path.basename(file.path))}领域技能说明或辅助脚本。`;
  if (p.includes('/test') || /(^|\/)test[^/]*\.py$|\.test\.js$/.test(p)) return `验证${label(path.basename(file.path))}相关行为、输入边界和失败处理。`;
  if (p.includes('/docs/') || p.startsWith('docs/')) return `记录${label(path.basename(file.path))}相关的项目设计、实现说明、验证结果或架构资料。`;
  if (p.startsWith('frontend/src/components/')) return `实现 Web 聊天界面的${label(path.basename(file.path))}视图组件。`;
  if (p.startsWith('frontend/src/')) return `实现 Vue 前端的${label(path.basename(file.path))}界面、状态、API 或样式功能。`;
  if (file.fileCategory === 'config') return `配置项目的${label(path.basename(file.path))}运行、构建或开发工具行为。`;
  if (file.fileCategory === 'docs') return `说明项目中的${label(path.basename(file.path))}使用方式或设计背景。`;
  return `实现项目${label(file.path)}模块中的功能逻辑，并参与采购助手运行流程。`;
}
function tagsFor(file) {
  const tags = new Set();
  const p = (file.path || file.filePath || '').toLowerCase();
  if (file.fileCategory === 'docs') tags.add('文档');
  if (file.fileCategory === 'config') tags.add('配置');
  if (file.fileCategory === 'data') tags.add('数据库');
  if (file.fileCategory === 'infra') tags.add('基础设施');
  if (p.includes('test')) tags.add('测试');
  if (p.includes('guard')) tags.add('安全');
  if (p.includes('mcp')) tags.add('mcp');
  if (p.includes('sandbox')) tags.add('沙箱');
  if (p.includes('chart')) tags.add('图表');
  if (p.includes('auth')) tags.add('认证');
  if (p.includes('mysql') || p.includes('storage')) tags.add('持久化');
  if (p.includes('skill')) tags.add('技能');
  if (p.includes('api') || p.includes('web')) tags.add('api');
  if (tags.size < 3) tags.add(file.language || 'code');
  if (tags.size < 3) tags.add('采购助手');
  if (tags.size < 3) tags.add('模块');
  return [...tags].slice(0, 5);
}
const nodes = [];
const edges = [];
const fileNodes = new Map();
const fileSymbolNames = new Map();
const nodeIds = new Set();
for (const file of scan.files) {
  const type = nodeType(file);
  const id = fileId(file);
  const node = { id, type, name: path.basename(file.path), filePath: file.path, summary: fileSummary(file), tags: tagsFor(file), complexity: file.sizeLines > 200 ? 'complex' : file.sizeLines > 50 ? 'moderate' : 'simple' };
  nodes.push(node); nodeIds.add(id); fileNodes.set(file.path, node);
}
for (const [filePath, result] of extracts) {
  const parent = fileNodes.get(filePath);
  if (!parent) continue;
  const functions = result.functions || [];
  const exports = new Set((result.exports || []).map(item => item.name));
  const accepted = new Map();
  for (const fn of functions) {
    if ((fn.endLine - fn.startLine + 1 >= 10) || exports.has(fn.name)) accepted.set(fn.name, fn);
  }
  for (const cls of result.classes || []) {
    if (cls.methods?.length >= 2 || cls.endLine - cls.startLine + 1 >= 20) {
      const id = `class:${filePath}:${cls.name}`;
      nodes.push({ id, type: 'class', name: cls.name, filePath, lineRange: [cls.startLine, cls.endLine], summary: `${cls.name} 封装${label(path.basename(filePath))}相关状态与行为，是所在模块的主要对象结构。`, tags: ['类', '数据模型', '业务逻辑'], complexity: cls.endLine - cls.startLine > 200 ? 'complex' : 'moderate' });
      nodeIds.add(id); edges.push({ source: parent.id, target: id, type: 'contains', direction: 'forward', weight: 1.0 });
    }
  }
  for (const fn of accepted.values()) {
    const id = `function:${filePath}:${fn.name}`;
    if (nodeIds.has(id)) continue;
    const lines = fn.endLine - fn.startLine + 1;
    nodes.push({ id, type: 'function', name: fn.name, filePath, lineRange: [fn.startLine, fn.endLine], summary: `处理${label(fn.name)}相关逻辑，供${label(path.basename(filePath))}模块内部或调用方使用。`, tags: ['函数', ...tagsFor(parent)], complexity: lines > 100 ? 'complex' : lines > 35 ? 'moderate' : 'simple' });
    nodeIds.add(id); edges.push({ source: parent.id, target: id, type: 'contains', direction: 'forward', weight: 1.0 });
    if (exports.has(fn.name)) edges.push({ source: parent.id, target: id, type: 'exports', direction: 'forward', weight: 0.8 });
  }
  fileSymbolNames.set(filePath, new Set([...accepted.keys(), ...(result.classes || []).map(cls => cls.name)]));
}
const byPath = new Map(scan.files.map(file => [file.path, file]));
for (const [sourcePath, targets] of Object.entries(scan.importMap)) {
  const source = fileNodes.get(sourcePath);
  if (!source) continue;
  for (const targetPath of targets) {
    const target = fileNodes.get(targetPath);
    if (target) edges.push({ source: source.id, target: target.id, type: 'imports', direction: 'forward', weight: 0.7 });
  }
}
for (const file of scan.files) {
  const source = fileNodes.get(file.path);
  if (!source) continue;
  if (file.path === 'README.md') {
    const targets = ['start_web.py', 'src/agent/main_agent.py', 'src/api_view/web_main.py'].map(p => fileNodes.get(p)).filter(Boolean);
    for (const target of targets) edges.push({ source: source.id, target: target.id, type: 'documents', direction: 'forward', weight: 0.5 });
  }
  if (file.fileCategory === 'config' && ['pyproject.toml', 'frontend/package.json', '.env.example'].includes(file.path)) {
    for (const targetPath of file.path === 'frontend/package.json' ? ['frontend/src/App.vue'] : ['start_web.py', 'src/agent/config.py', 'src/api_view/web_main.py']) {
      const target = fileNodes.get(targetPath); if (target) edges.push({ source: source.id, target: target.id, type: 'configures', direction: 'forward', weight: 0.6 });
    }
  }
}
for (const file of scan.files) {
  if (!/(\.test\.|test_.*\.py$|_test\.py$|^src\/test\/)/i.test(file.path)) continue;
  const dir = path.posix.dirname(file.path);
  const stem = path.posix.basename(file.path).replace(/\.test\.|\.spec\./, '.').replace(/^test_/, '').replace(/_test(?=\.)/, '');
  const candidates = [path.posix.join(dir, stem), path.posix.join(dir.replace(/\/test$/, ''), stem)];
  for (const candidate of candidates) {
    if (fileNodes.has(candidate) && candidate !== file.path) edges.push({ source: fileNodes.get(candidate).id, target: fileNodes.get(file.path).id, type: 'tested_by', direction: 'forward', weight: 0.5 });
  }
}
const uniqueEdges = new Map();
for (const edge of edges) uniqueEdges.set(`${edge.source}|${edge.target}|${edge.type}`, edge);
const grouped = new Map(batches.batches.map(b => [b.batchIndex, new Set(b.files.map(f => f.path))]));
for (const batch of batches.batches) {
  const paths = grouped.get(batch.batchIndex);
  const batchNodes = nodes.filter(node => paths.has(node.filePath) || node.filePath && paths.has(node.filePath));
  const ids = new Set(batchNodes.map(node => node.id));
  const batchEdges = [...uniqueEdges.values()].filter(edge => ids.has(edge.source) && (ids.has(edge.target) || edge.type === 'imports' && nodeIds.has(edge.target)));
  const output = path.join(inter, `batch-${batch.batchIndex}.json`);
  fs.writeFileSync(output, JSON.stringify({ nodes: batchNodes, edges: batchEdges }, null, 2));
}
console.log(JSON.stringify({ files: fileNodes.size, functions: nodes.filter(n => n.type === 'function').length, classes: nodes.filter(n => n.type === 'class').length, edges: uniqueEdges.size, batches: batches.batches.length, importEdges: [...uniqueEdges.values()].filter(e => e.type === 'imports').length }));
