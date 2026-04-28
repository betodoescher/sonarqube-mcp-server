import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { sonarClient } from '../sonarClient.js'

// 10.1 Zod schemas for all 5 hotspot tool inputs
const listSecurityHotspotsSchema = z.object({
  projectKey: z.string().min(1),
  status: z.enum(['TO_REVIEW', 'REVIEWED']).optional(),
  resolution: z.enum(['FIXED', 'SAFE', 'ACKNOWLEDGED']).optional(),
  branch: z.string().optional(),
  newCodeOnly: z.boolean().optional(),
})

const getHotspotDetailSchema = z.object({
  hotspotKey: z.string().min(1),
})

const getSecurityRatingSchema = z.object({
  projectKey: z.string().min(1),
  branch: z.string().optional(),
})

const getHotspotsByCategorySchema = z.object({
  projectKey: z.string().min(1),
  branch: z.string().optional(),
})

// update_hotspot_status requires non-empty comment (Req 8.6)
export const updateHotspotStatusSchema = z.object({
  hotspotKey: z.string().min(1),
  resolution: z.enum(['FIXED', 'SAFE', 'ACKNOWLEDGED']),
  comment: z.string().trim().min(1, 'Comment is required and cannot be empty'),
})

interface HotspotItem {
  key: string
  securityCategory?: string
  vulnerabilityProbability?: string
  [key: string]: unknown
}

export function registerSecurityTools(server: McpServer): void {
  // 10.2 list_security_hotspots
  server.tool(
    'list_security_hotspots',
    'List security hotspots for a project',
    listSecurityHotspotsSchema.shape,
    async (params) => {
      try {
        const { projectKey, status, resolution, branch, newCodeOnly } = listSecurityHotspotsSchema.parse(params)
        const queryParams: Record<string, string | boolean> = { projectKey }
        if (status) queryParams['status'] = status
        if (resolution) queryParams['resolution'] = resolution
        if (branch) queryParams['branch'] = branch
        if (newCodeOnly) queryParams['sinceLeakPeriod'] = true
        const response = await sonarClient.get('/api/hotspots/search', { params: queryParams })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 10.3 get_hotspot_detail
  server.tool(
    'get_hotspot_detail',
    'Get full details for a specific security hotspot',
    getHotspotDetailSchema.shape,
    async (params) => {
      try {
        const { hotspotKey } = getHotspotDetailSchema.parse(params)
        const response = await sonarClient.get('/api/hotspots/show', { params: { hotspot: hotspotKey } })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 10.4 get_security_rating
  server.tool(
    'get_security_rating',
    'Get the security rating and hotspot breakdown for a project',
    getSecurityRatingSchema.shape,
    async (params) => {
      try {
        const { projectKey, branch } = getSecurityRatingSchema.parse(params)
        const queryParams: Record<string, string> = {
          component: projectKey,
          metricKeys: 'security_rating,security_hotspots,security_hotspots_reviewed',
        }
        if (branch) queryParams['branch'] = branch
        const [measuresResponse, hotspotsResponse] = await Promise.all([
          sonarClient.get('/api/measures/component', { params: queryParams }),
          sonarClient.get('/api/hotspots/search', { params: { projectKey, ps: 1 } }),
        ])
        const measures: Array<{ metric: string; value?: string }> =
          measuresResponse.data?.component?.measures ?? []
        const getMeasure = (metric: string) => measures.find((m) => m.metric === metric)?.value ?? null
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                securityRating: getMeasure('security_rating'),
                hotspots: getMeasure('security_hotspots'),
                hotspotsReviewed: getMeasure('security_hotspots_reviewed'),
                total: hotspotsResponse.data?.paging?.total ?? 0,
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

  // 10.5 get_hotspots_by_category
  server.tool(
    'get_hotspots_by_category',
    'Get hotspots grouped by OWASP/CWE/SANS category',
    getHotspotsByCategorySchema.shape,
    async (params) => {
      try {
        const { projectKey, branch } = getHotspotsByCategorySchema.parse(params)
        const queryParams: Record<string, string | number> = { projectKey, ps: 500 }
        if (branch) queryParams['branch'] = branch
        const response = await sonarClient.get('/api/hotspots/search', { params: queryParams })
        const hotspots: HotspotItem[] = response.data?.hotspots ?? []

        const byCategory: Record<string, HotspotItem[]> = {}
        for (const hotspot of hotspots) {
          const category = hotspot.securityCategory ?? 'unknown'
          if (!byCategory[category]) byCategory[category] = []
          byCategory[category].push(hotspot)
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ byCategory, total: hotspots.length }),
            },
          ],
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 10.6 update_hotspot_status — comment required (Req 8.6)
  server.tool(
    'update_hotspot_status',
    'Update the status of a security hotspot with a mandatory comment',
    updateHotspotStatusSchema.shape,
    async (params) => {
      try {
        const { hotspotKey, resolution, comment } = updateHotspotStatusSchema.parse(params)
        const response = await sonarClient.post('/api/hotspots/change_status', null, {
          params: { hotspot: hotspotKey, status: 'REVIEWED', resolution, comment },
        })
        return { content: [{ type: 'text', text: JSON.stringify(response.data ?? { success: true }) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )
}
