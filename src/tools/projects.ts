import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { sonarClient } from '../sonarClient.js'

// 11.1 Zod schemas for all 8 project tool inputs

const listProjectsSchema = z.object({
  filter: z.string().optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(500).optional(),
})

const getProjectSchema = z.object({
  projectKey: z.string().min(1),
})

const createProjectSchema = z.object({
  projectKey: z.string().min(1),
  name: z.string().min(1),
  visibility: z.enum(['public', 'private']),
})

// delete_project requires confirm: true (Req 9.5)
export const deleteProjectSchema = z.object({
  projectKey: z.string().min(1),
  confirm: z.literal(true, {
    error: 'confirm must be true to delete a project',
  }),
})

const setProjectQualityGateSchema = z.object({
  projectKey: z.string().min(1),
  qualityGateId: z.string().min(1),
})

const getProjectBranchesSchema = z.object({
  projectKey: z.string().min(1),
})

const deleteBranchSchema = z.object({
  projectKey: z.string().min(1),
  branch: z.string().min(1),
})

export function registerProjectsTools(server: McpServer): void {
  // 11.2 list_projects
  server.tool(
    'list_projects',
    'List SonarQube projects with quality metrics',
    listProjectsSchema.shape,
    async (params) => {
      try {
        const { filter, page, pageSize } = listProjectsSchema.parse(params)
        const queryParams: Record<string, string | number> = {
          ps: pageSize ?? 100,
          p: page ?? 1,
        }
        if (filter) queryParams['filter'] = filter
        const response = await sonarClient.get('/api/projects/search', { params: queryParams })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 11.3 get_project
  server.tool(
    'get_project',
    'Get full project details including all metrics',
    getProjectSchema.shape,
    async (params) => {
      try {
        const { projectKey } = getProjectSchema.parse(params)
        const [componentResponse, measuresResponse] = await Promise.all([
          sonarClient.get('/api/components/show', { params: { component: projectKey } }),
          sonarClient.get('/api/measures/component', {
            params: {
              component: projectKey,
              metricKeys:
                'coverage,bugs,vulnerabilities,code_smells,security_hotspots,sqale_index,reliability_rating,security_rating,sqale_rating',
            },
          }),
        ])
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                component: componentResponse.data?.component,
                measures: measuresResponse.data?.component?.measures,
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

  // 11.4 create_project
  server.tool(
    'create_project',
    'Create a new SonarQube project',
    createProjectSchema.shape,
    async (params) => {
      try {
        const { projectKey, name, visibility } = createProjectSchema.parse(params)
        const response = await sonarClient.post('/api/projects/create', null, {
          params: { project: projectKey, name, visibility },
        })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 11.5 delete_project — confirm must be true (Req 9.5)
  server.tool(
    'delete_project',
    'Delete a SonarQube project (requires confirm: true)',
    deleteProjectSchema.shape,
    async (params) => {
      try {
        const { projectKey } = deleteProjectSchema.parse(params)
        await sonarClient.post('/api/projects/delete', null, { params: { project: projectKey } })
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, projectKey }) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 11.6 set_project_quality_gate
  server.tool(
    'set_project_quality_gate',
    'Associate a quality gate with a project',
    setProjectQualityGateSchema.shape,
    async (params) => {
      try {
        const { projectKey, qualityGateId } = setProjectQualityGateSchema.parse(params)
        const response = await sonarClient.post('/api/qualitygates/select', null, {
          params: { projectKey, gateId: qualityGateId },
        })
        return { content: [{ type: 'text', text: JSON.stringify(response.data ?? { success: true }) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 11.7 get_project_branches
  server.tool(
    'get_project_branches',
    'Get all analyzed branches for a project',
    getProjectBranchesSchema.shape,
    async (params) => {
      try {
        const { projectKey } = getProjectBranchesSchema.parse(params)
        const response = await sonarClient.get('/api/project_branches/list', {
          params: { project: projectKey },
        })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 11.8 delete_branch
  server.tool(
    'delete_branch',
    'Delete an analyzed branch from a project',
    deleteBranchSchema.shape,
    async (params) => {
      try {
        const { projectKey, branch } = deleteBranchSchema.parse(params)
        await sonarClient.post('/api/project_branches/delete', null, {
          params: { project: projectKey, branch },
        })
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, projectKey, branch }) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )
}
