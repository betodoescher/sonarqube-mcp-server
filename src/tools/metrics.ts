import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { sonarClient } from '../sonarClient.js'
import { config } from '../config.js'
import type { Rating } from '../types/sonar.js'

// 8.1 Zod schemas for all 7 metrics tool inputs
const projectBranchSchema = z.object({
  projectKey: z.string().min(1),
  branch: z.string().optional(),
})

const getCoverageSchema = projectBranchSchema.extend({
  component: z.string().optional(),
})

const getCoverageBreakdownSchema = projectBranchSchema.extend({
  limit: z.number().int().positive().default(10),
})

const getDuplicationsSchema = projectBranchSchema

const getComplexitySchema = projectBranchSchema.extend({
  threshold: z.number().positive().optional(),
})

const getTechnicalDebtSchema = projectBranchSchema

const getAllMetricsSchema = projectBranchSchema

const getMetricsHistorySchema = z.object({
  projectKey: z.string().min(1),
  metrics: z.array(z.string().min(1)).min(1),
  from: z.string().optional(),
  to: z.string().optional(),
})

// Helper: extract measure value from component measures array
function getMeasure(measures: Array<{ metric: string; value?: string }>, metric: string): string | null {
  return measures.find((m) => m.metric === metric)?.value ?? null
}

// Helper: convert minutes to human-readable debt string
export function formatDebt(minutes: number): string {
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  const remainingMins = minutes % 60
  if (hours < 8) return remainingMins > 0 ? `${hours}h ${remainingMins}min` : `${hours}h`
  const days = Math.floor(hours / 8)
  const remainingHours = hours % 8
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
}

// Helper: SQALE rating from debt ratio
export function sqaleRating(debtRatio: number): Rating {
  if (debtRatio <= 0.05) return 'A'
  if (debtRatio <= 0.1) return 'B'
  if (debtRatio <= 0.2) return 'C'
  if (debtRatio <= 0.5) return 'D'
  return 'E'
}

// Helper: sort component tree items by coverage ascending and return top N
export function sortByCoverageAscending(
  components: Array<{ key: string; name: string; measures: Array<{ metric: string; value?: string }> }>,
  limit: number
): Array<{ file: string; coverage: number }> {
  return components
    .map((c) => ({
      file: c.key,
      coverage: parseFloat(getMeasure(c.measures, 'coverage') ?? '100'),
    }))
    .sort((a, b) => a.coverage - b.coverage)
    .slice(0, limit)
}

// Helper: filter components above complexity threshold
export function filterAboveThreshold(
  components: Array<{ key: string; name: string; measures: Array<{ metric: string; value?: string }> }>,
  threshold: number
): Array<{ file: string; complexity: number }> {
  return components
    .map((c) => ({
      file: c.key,
      complexity: parseInt(getMeasure(c.measures, 'complexity') ?? '0', 10),
    }))
    .filter((c) => c.complexity > threshold)
    .sort((a, b) => b.complexity - a.complexity)
}

export function registerMetricsTools(server: McpServer): void {
  // 8.2 get_coverage
  server.tool(
    'get_coverage',
    'Get code coverage metrics for a project',
    getCoverageSchema.shape,
    async (params) => {
      try {
        const { projectKey, branch, component } = getCoverageSchema.parse(params)
        const componentKey = component ?? projectKey
        const queryParams: Record<string, string> = {
          component: componentKey,
          metricKeys: 'coverage,line_coverage,lines_to_cover,lines_covered,branch_coverage',
        }
        if (branch) queryParams['branch'] = branch
        const response = await sonarClient.get('/api/measures/component', { params: queryParams })
        const measures: Array<{ metric: string; value?: string }> = response.data?.component?.measures ?? []
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                coverage: getMeasure(measures, 'coverage'),
                lineCoverage: getMeasure(measures, 'line_coverage'),
                linesToCover: getMeasure(measures, 'lines_to_cover'),
                linesCovered: getMeasure(measures, 'lines_covered'),
                branchCoverage: getMeasure(measures, 'branch_coverage'),
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

  // 8.3 get_coverage_breakdown
  server.tool(
    'get_coverage_breakdown',
    'Get files with lowest coverage sorted ascending',
    getCoverageBreakdownSchema.shape,
    async (params) => {
      try {
        const { projectKey, branch, limit } = getCoverageBreakdownSchema.parse(params)
        const queryParams: Record<string, string | number> = {
          component: projectKey,
          metricKeys: 'coverage',
          qualifiers: 'FIL',
          ps: 500,
        }
        if (branch) queryParams['branch'] = branch
        const response = await sonarClient.get('/api/measures/component_tree', { params: queryParams })
        const components = response.data?.components ?? []
        const sorted = sortByCoverageAscending(components, limit)
        return { content: [{ type: 'text', text: JSON.stringify({ files: sorted, total: components.length }) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 8.4 get_duplications
  server.tool(
    'get_duplications',
    'Get code duplication metrics for a project',
    getDuplicationsSchema.shape,
    async (params) => {
      try {
        const { projectKey, branch } = getDuplicationsSchema.parse(params)
        const queryParams: Record<string, string> = {
          component: projectKey,
          metricKeys: 'duplicated_lines_density,duplicated_lines,duplicated_blocks,duplicated_files',
        }
        if (branch) queryParams['branch'] = branch
        const response = await sonarClient.get('/api/measures/component', { params: queryParams })
        const measures: Array<{ metric: string; value?: string }> = response.data?.component?.measures ?? []
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                duplicationPercentage: getMeasure(measures, 'duplicated_lines_density'),
                duplicatedLines: getMeasure(measures, 'duplicated_lines'),
                duplicatedBlocks: getMeasure(measures, 'duplicated_blocks'),
                duplicatedFiles: getMeasure(measures, 'duplicated_files'),
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

  // 8.5 get_complexity
  server.tool(
    'get_complexity',
    'Get complexity metrics and functions exceeding threshold',
    getComplexitySchema.shape,
    async (params) => {
      try {
        const { projectKey, branch, threshold } = getComplexitySchema.parse(params)
        const complexityThreshold = threshold ?? config.SONAR_COMPLEXITY_THRESHOLD
        const queryParams: Record<string, string | number> = {
          component: projectKey,
          metricKeys: 'complexity,cognitive_complexity,function_complexity',
          qualifiers: 'FIL',
          ps: 500,
        }
        if (branch) queryParams['branch'] = branch
        const response = await sonarClient.get('/api/measures/component_tree', { params: queryParams })
        const components = response.data?.components ?? []
        const aboveThreshold = filterAboveThreshold(components, complexityThreshold)
        const totalComplexity = components.reduce(
          (sum: number, c: { measures: Array<{ metric: string; value?: string }> }) =>
            sum + parseInt(getMeasure(c.measures, 'complexity') ?? '0', 10),
          0
        )
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                totalComplexity,
                threshold: complexityThreshold,
                filesAboveThreshold: aboveThreshold,
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

  // 8.6 get_technical_debt
  server.tool(
    'get_technical_debt',
    'Get technical debt metrics for a project',
    getTechnicalDebtSchema.shape,
    async (params) => {
      try {
        const { projectKey, branch } = getTechnicalDebtSchema.parse(params)
        const queryParams: Record<string, string> = {
          component: projectKey,
          metricKeys: 'sqale_index,sqale_debt_ratio,sqale_rating,ncloc',
        }
        if (branch) queryParams['branch'] = branch
        const response = await sonarClient.get('/api/measures/component', { params: queryParams })
        const measures: Array<{ metric: string; value?: string }> = response.data?.component?.measures ?? []
        const debtMinutes = parseInt(getMeasure(measures, 'sqale_index') ?? '0', 10)
        const debtRatio = parseFloat(getMeasure(measures, 'sqale_debt_ratio') ?? '0') / 100
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                debtMinutes,
                debtHuman: formatDebt(debtMinutes),
                debtRatio: getMeasure(measures, 'sqale_debt_ratio'),
                sqaleRating: sqaleRating(debtRatio),
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

  // 8.7 get_all_metrics
  server.tool(
    'get_all_metrics',
    'Get all key metrics for a project in a single call',
    getAllMetricsSchema.shape,
    async (params) => {
      try {
        const { projectKey, branch } = getAllMetricsSchema.parse(params)
        const queryParams: Record<string, string> = {
          component: projectKey,
          metricKeys: [
            'coverage', 'duplicated_lines_density', 'complexity',
            'sqale_index', 'sqale_rating', 'bugs', 'vulnerabilities',
            'code_smells', 'security_hotspots', 'reliability_rating',
            'security_rating', 'sqale_debt_ratio',
          ].join(','),
        }
        if (branch) queryParams['branch'] = branch
        const response = await sonarClient.get('/api/measures/component', { params: queryParams })
        const measures: Array<{ metric: string; value?: string }> = response.data?.component?.measures ?? []
        const result: Record<string, string | null> = {}
        for (const m of measures) {
          result[m.metric] = m.value ?? null
        }
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 8.8 get_metrics_history
  server.tool(
    'get_metrics_history',
    'Get time-series history for specified metrics',
    getMetricsHistorySchema.shape,
    async (params) => {
      try {
        const { projectKey, metrics, from, to } = getMetricsHistorySchema.parse(params)
        const queryParams: Record<string, string> = {
          component: projectKey,
          metrics: metrics.join(','),
        }
        if (from) queryParams['from'] = from
        if (to) queryParams['to'] = to
        const response = await sonarClient.get('/api/measures/search_history', { params: queryParams })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )
}
