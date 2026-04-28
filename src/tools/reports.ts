import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { sonarClient } from '../sonarClient.js'
import type { SortBy } from '../types/sonar.js'

// 13.1 Zod schemas for all 3 report tool inputs
const getPortfolioReportSchema = z.object({
  format: z.enum(['markdown', 'json']).default('json'),
})

const getProjectRankingSchema = z.object({
  sortBy: z.enum([
    'quality_gate',
    'security_rating',
    'reliability_rating',
    'maintainability_rating',
    'coverage',
    'technical_debt',
  ]),
  limit: z.number().int().positive().optional(),
})

const getNewCodeSummarySchema = z.object({
  projectKey: z.string().min(1),
  branch: z.string().optional(),
})

// Metric keys for portfolio/ranking
const PORTFOLIO_METRICS = [
  'alert_status',
  'bugs',
  'vulnerabilities',
  'code_smells',
  'security_hotspots',
  'sqale_index',
  'coverage',
  'reliability_rating',
  'security_rating',
  'sqale_rating',
].join(',')

export interface ProjectMetrics {
  key: string
  name: string
  measures: Array<{ metric: string; value?: string }>
}

function getMeasureValue(measures: Array<{ metric: string; value?: string }>, metric: string): string | null {
  return measures.find((m) => m.metric === metric)?.value ?? null
}

// Pure aggregation function — exported for testing (Property 8)
export function aggregatePortfolioMetrics(projects: ProjectMetrics[]): {
  totalBugs: number
  totalVulnerabilities: number
  totalCodeSmells: number
  totalHotspots: number
  totalDebtMinutes: number
  qualityGatePassRate: number
  top5ByDebt: Array<{ key: string; name: string; debtMinutes: number }>
} {
  let totalBugs = 0
  let totalVulnerabilities = 0
  let totalCodeSmells = 0
  let totalHotspots = 0
  let totalDebtMinutes = 0
  let passCount = 0

  for (const project of projects) {
    totalBugs += parseInt(getMeasureValue(project.measures, 'bugs') ?? '0', 10)
    totalVulnerabilities += parseInt(getMeasureValue(project.measures, 'vulnerabilities') ?? '0', 10)
    totalCodeSmells += parseInt(getMeasureValue(project.measures, 'code_smells') ?? '0', 10)
    totalHotspots += parseInt(getMeasureValue(project.measures, 'security_hotspots') ?? '0', 10)
    totalDebtMinutes += parseInt(getMeasureValue(project.measures, 'sqale_index') ?? '0', 10)
    if (getMeasureValue(project.measures, 'alert_status') === 'OK') passCount++
  }

  const qualityGatePassRate = projects.length > 0 ? (passCount / projects.length) * 100 : 0

  const top5ByDebt = projects
    .map((p) => ({
      key: p.key,
      name: p.name,
      debtMinutes: parseInt(getMeasureValue(p.measures, 'sqale_index') ?? '0', 10),
    }))
    .sort((a, b) => b.debtMinutes - a.debtMinutes)
    .slice(0, 5)

  return { totalBugs, totalVulnerabilities, totalCodeSmells, totalHotspots, totalDebtMinutes, qualityGatePassRate, top5ByDebt }
}

// Pure sort function — exported for testing (task 13.6)
export function sortProjectsByCriterion(
  projects: ProjectMetrics[],
  sortBy: SortBy
): ProjectMetrics[] {
  const metricMap: Record<SortBy, string> = {
    quality_gate: 'alert_status',
    security_rating: 'security_rating',
    reliability_rating: 'reliability_rating',
    maintainability_rating: 'sqale_rating',
    coverage: 'coverage',
    technical_debt: 'sqale_index',
  }
  const metric = metricMap[sortBy]

  return [...projects].sort((a, b) => {
    const valA = getMeasureValue(a.measures, metric) ?? ''
    const valB = getMeasureValue(b.measures, metric) ?? ''
    const numA = parseFloat(valA)
    const numB = parseFloat(valB)
    if (!isNaN(numA) && !isNaN(numB)) {
      // For coverage: higher is better (descending)
      // For debt/ratings: lower is better (ascending)
      if (sortBy === 'coverage') return numB - numA
      return numA - numB
    }
    return valA.localeCompare(valB)
  })
}

async function fetchAllProjectsWithMetrics(): Promise<ProjectMetrics[]> {
  const response = await sonarClient.get('/api/projects/search', {
    params: { ps: 500, metricKeys: PORTFOLIO_METRICS },
  })
  return response.data?.components ?? []
}

export function registerReportsTools(server: McpServer): void {
  // 13.2 get_portfolio_report
  server.tool(
    'get_portfolio_report',
    'Get a consolidated portfolio report across all projects',
    getPortfolioReportSchema.shape,
    async (params) => {
      try {
        const { format } = getPortfolioReportSchema.parse(params)
        const projects = await fetchAllProjectsWithMetrics()
        const aggregated = aggregatePortfolioMetrics(projects)

        if (format === 'markdown') {
          const md = [
            '# Portfolio Report',
            '',
            `**Total Projects:** ${projects.length}`,
            `**Quality Gate Pass Rate:** ${aggregated.qualityGatePassRate.toFixed(1)}%`,
            `**Total Bugs:** ${aggregated.totalBugs}`,
            `**Total Vulnerabilities:** ${aggregated.totalVulnerabilities}`,
            `**Total Code Smells:** ${aggregated.totalCodeSmells}`,
            `**Total Hotspots:** ${aggregated.totalHotspots}`,
            '',
            '## Top 5 Projects by Technical Debt',
            ...aggregated.top5ByDebt.map(
              (p, i) => `${i + 1}. **${p.name}** (${p.key}): ${p.debtMinutes} min`
            ),
          ].join('\n')
          return { content: [{ type: 'text', text: md }] }
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ totalProjects: projects.length, ...aggregated }),
            },
          ],
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 13.3 get_project_ranking
  server.tool(
    'get_project_ranking',
    'Get projects ranked by a specified quality criterion',
    getProjectRankingSchema.shape,
    async (params) => {
      try {
        const { sortBy, limit } = getProjectRankingSchema.parse(params)
        const projects = await fetchAllProjectsWithMetrics()
        const sorted = sortProjectsByCriterion(projects, sortBy as SortBy)
        const ranked = sorted.slice(0, limit ?? 20)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ sortBy, ranked, total: projects.length }),
            },
          ],
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 13.4 get_new_code_summary
  server.tool(
    'get_new_code_summary',
    'Get new code period metrics for a project',
    getNewCodeSummarySchema.shape,
    async (params) => {
      try {
        const { projectKey, branch } = getNewCodeSummarySchema.parse(params)
        const queryParams: Record<string, string> = {
          component: projectKey,
          metricKeys: [
            'new_bugs',
            'new_vulnerabilities',
            'new_code_smells',
            'new_security_hotspots',
            'new_coverage',
            'new_duplicated_lines_density',
          ].join(','),
        }
        if (branch) queryParams['branch'] = branch
        const response = await sonarClient.get('/api/measures/component', { params: queryParams })
        const measures: Array<{ metric: string; periods?: Array<{ value: string }> }> =
          response.data?.component?.measures ?? []

        const getNewValue = (metric: string) => {
          const m = measures.find((m) => m.metric === metric)
          return m?.periods?.[0]?.value ?? null
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                projectKey,
                newBugs: getNewValue('new_bugs'),
                newVulnerabilities: getNewValue('new_vulnerabilities'),
                newCodeSmells: getNewValue('new_code_smells'),
                newHotspots: getNewValue('new_security_hotspots'),
                newCoverage: getNewValue('new_coverage'),
                newDuplicationDensity: getNewValue('new_duplicated_lines_density'),
              }),
            },
          ],
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )
}
