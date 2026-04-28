// 16.4 Import config at module load so startup fails fast on bad env
import { config } from './config.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerAnalysisTools } from './tools/analysis.js'
import { registerQualityGateTools } from './tools/qualityGate.js'
import { registerMetricsTools } from './tools/metrics.js'
import { registerIssuesTools } from './tools/issues.js'
import { registerSecurityTools } from './tools/security.js'
import { registerProjectsTools } from './tools/projects.js'
import { registerRulesTools } from './tools/rules.js'
import { registerReportsTools } from './tools/reports.js'
import { registerPrAnalysisTools } from './tools/prAnalysis.js'
import { registerAdminTools } from './tools/admin.js'

// Suppress unused variable warning — config is imported for side-effect (startup validation)
void config

// 16.1 Initialize McpServer with name and version
const server = new McpServer({ name: 'sonarqube-mcp-server', version: '1.0.0' })

// 16.2 Register all tool modules
registerAnalysisTools(server)
registerQualityGateTools(server)
registerMetricsTools(server)
registerIssuesTools(server)
registerSecurityTools(server)
registerProjectsTools(server)
registerRulesTools(server)
registerReportsTools(server)
registerPrAnalysisTools(server)
registerAdminTools(server)

// 16.3 Connect StdioServerTransport and start server
const transport = new StdioServerTransport()
server.connect(transport).catch((err: unknown) => {
  console.error('Failed to start MCP server:', err)
  process.exit(1)
})
