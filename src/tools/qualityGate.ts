import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { sonarClient } from '../sonarClient.js'

// 7.1 Zod schemas for all 5 quality gate tool inputs
const getQualityGateStatusSchema = z.object({
  projectKey: z.string().min(1),
  branch: z.string().optional(),
})

const getQualityGateHistorySchema = z.object({
  projectKey: z.string().min(1),
  branch: z.string().optional(),
  limit: z.number().int().positive().optional(),
})

const compareQualityGatesSchema = z.object({
  projectKey: z.string().min(1),
  branchA: z.string().min(1),
  branchB: z.string().min(1),
})

const listQualityGatesSchema = z.object({})

const getProjectQualityGateSchema = z.object({
  projectKey: z.string().min(1),
})

const showQualityGateSchema = z.object({
  name: z.string().min(1),
})

const createQualityGateSchema = z.object({
  name: z.string().min(1),
})

const createConditionSchema = z.object({
  gateName: z.string().min(1),
  metric: z.string().min(1),
  op: z.enum(['LT', 'GT']),
  error: z.string().min(1),
})

const deleteConditionSchema = z.object({
  id: z.string().min(1),
})

// API response schemas
const projectStatusResponseSchema = z.object({
  projectStatus: z.object({
    status: z.enum(['OK', 'ERROR', 'NONE']),
    conditions: z
      .array(
        z.object({
          status: z.enum(['OK', 'ERROR']),
          metricKey: z.string(),
          comparator: z.string(),
          errorThreshold: z.string().optional().default(''),
          actualValue: z.string().optional().default(''),
        })
      )
      .optional()
      .default([]),
    ignoredConditions: z.boolean().optional(),
    period: z.object({
      mode: z.string(),
      date: z.string().optional(),
    }).optional(),
    caycStatus: z.string().optional(),
  }),
})

// Pure function for compare logic — exported for testing
export function diffConditions(
  conditionsA: Array<{ metricKey: string; status: string }>,
  conditionsB: Array<{ metricKey: string; status: string }>
): Array<{ metricKey: string; statusA: string; statusB: string }> {
  const mapB = new Map(conditionsB.map((c) => [c.metricKey, c.status]))
  const diffs: Array<{ metricKey: string; statusA: string; statusB: string }> = []

  for (const condA of conditionsA) {
    const statusB = mapB.get(condA.metricKey)
    if (statusB !== undefined && statusB !== condA.status) {
      diffs.push({ metricKey: condA.metricKey, statusA: condA.status, statusB })
    }
  }
  return diffs
}

async function fetchProjectStatus(projectKey: string, branch?: string) {
  const params: Record<string, string> = { projectKey }
  if (branch) params['branch'] = branch
  const response = await sonarClient.get('/api/qualitygates/project_status', { params })
  return projectStatusResponseSchema.parse(response.data).projectStatus
}

export function registerQualityGateTools(server: McpServer): void {
  // 7.2 get_quality_gate_status
  server.tool(
    'get_quality_gate_status',
    'Get the quality gate status for a project',
    getQualityGateStatusSchema.shape,
    async (params) => {
      try {
        const { projectKey, branch } = getQualityGateStatusSchema.parse(params)
        const status = await fetchProjectStatus(projectKey, branch)
        const failedConditions = (status.conditions ?? []).filter((c) => c.status === 'ERROR')
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: status.status,
                passed: status.status === 'OK',
                conditions: status.conditions,
                failedConditions,
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

  // 7.3 get_quality_gate_history
  server.tool(
    'get_quality_gate_history',
    'Get the quality gate status history for a project',
    getQualityGateHistorySchema.shape,
    async (params) => {
      try {
        const { projectKey, branch, limit } = getQualityGateHistorySchema.parse(params)
        const queryParams: Record<string, string | number> = {
          component: projectKey,
          metrics: 'alert_status',
          ps: limit ?? 30,
        }
        if (branch) queryParams['branch'] = branch
        const response = await sonarClient.get('/api/measures/search_history', { params: queryParams })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 7.4 compare_quality_gates
  server.tool(
    'compare_quality_gates',
    'Compare quality gate conditions between two branches',
    compareQualityGatesSchema.shape,
    async (params) => {
      try {
        const { projectKey, branchA, branchB } = compareQualityGatesSchema.parse(params)
        const [statusA, statusB] = await Promise.all([
          fetchProjectStatus(projectKey, branchA),
          fetchProjectStatus(projectKey, branchB),
        ])
        const differingConditions = diffConditions(
          statusA.conditions ?? [],
          statusB.conditions ?? []
        )
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                branchA: { branch: branchA, status: statusA.status, conditions: statusA.conditions },
                branchB: { branch: branchB, status: statusB.status, conditions: statusB.conditions },
                differingConditions,
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

  // 7.5 list_quality_gates
  server.tool(
    'list_quality_gates',
    'List all quality gates configured in SonarQube',
    listQualityGatesSchema.shape,
    async () => {
      try {
        const response = await sonarClient.get('/api/qualitygates/list')
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 7.6 get_project_quality_gate
  server.tool(
    'get_project_quality_gate',
    'Get the quality gate associated with a project',
    getProjectQualityGateSchema.shape,
    async (params) => {
      try {
        const { projectKey } = getProjectQualityGateSchema.parse(params)
        const response = await sonarClient.get('/api/qualitygates/get_by_project', {
          params: { project: projectKey },
        })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 7.7 show_quality_gate — get conditions of a quality gate by name
  server.tool(
    'show_quality_gate',
    'Get full details and conditions of a quality gate by name',
    showQualityGateSchema.shape,
    async (params) => {
      try {
        const { name } = showQualityGateSchema.parse(params)
        const response = await sonarClient.get('/api/qualitygates/show', { params: { name } })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 7.8 create_quality_gate
  server.tool(
    'create_quality_gate',
    'Create a new quality gate',
    createQualityGateSchema.shape,
    async (params) => {
      try {
        const { name } = createQualityGateSchema.parse(params)
        const response = await sonarClient.post('/api/qualitygates/create', null, { params: { name } })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 7.9 create_quality_gate_condition
  server.tool(
    'create_quality_gate_condition',
    'Add a condition to a quality gate (e.g. coverage < 80 fails). Metric examples: new_coverage, new_duplicated_lines_density, new_violations, new_security_hotspots_reviewed, new_reliability_rating, new_security_rating, new_maintainability_rating. Op: LT (less than) or GT (greater than).',
    createConditionSchema.shape,
    async (params) => {
      try {
        const { gateName, metric, op, error } = createConditionSchema.parse(params)
        const response = await sonarClient.post('/api/qualitygates/create_condition', null, {
          params: { gateName, metric, op, error },
        })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 7.10 delete_quality_gate_condition
  server.tool(
    'delete_quality_gate_condition',
    'Remove a condition from a quality gate by condition ID (get IDs from show_quality_gate)',
    deleteConditionSchema.shape,
    async (params) => {
      try {
        const { id } = deleteConditionSchema.parse(params)
        await sonarClient.post('/api/qualitygates/delete_condition', null, { params: { id } })
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedConditionId: id }) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )
}
