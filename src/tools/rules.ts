import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { sonarClient } from '../sonarClient.js'

// 12.1 Zod schemas for all 3 rules tool inputs
const listQualityProfilesSchema = z.object({})

const getActiveRulesSchema = z.object({
  profileKey: z.string().min(1),
  languages: z.array(z.string()).optional(),
  types: z.array(z.enum(['BUG', 'VULNERABILITY', 'CODE_SMELL', 'SECURITY_HOTSPOT'])).optional(),
  severities: z.array(z.enum(['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'])).optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(500).optional(),
})

const searchRulesSchema = z.object({
  query: z.string().min(1),
  tags: z.array(z.string()).optional(),
  types: z.array(z.enum(['BUG', 'VULNERABILITY', 'CODE_SMELL', 'SECURITY_HOTSPOT'])).optional(),
  severities: z.array(z.enum(['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'])).optional(),
  languages: z.array(z.string()).optional(),
})

interface QualityProfile {
  key: string
  name: string
  language: string
  languageName?: string
  isDefault?: boolean
  activeRuleCount?: number
  [key: string]: unknown
}

export function registerRulesTools(server: McpServer): void {
  // 12.2 list_quality_profiles — grouped by language
  server.tool(
    'list_quality_profiles',
    'List all quality profiles grouped by programming language',
    listQualityProfilesSchema.shape,
    async () => {
      try {
        const response = await sonarClient.get('/api/qualityprofiles/search')
        const profiles: QualityProfile[] = response.data?.profiles ?? []

        // Group by language
        const byLanguage: Record<string, QualityProfile[]> = {}
        for (const profile of profiles) {
          const lang = profile.language ?? 'unknown'
          if (!byLanguage[lang]) byLanguage[lang] = []
          byLanguage[lang].push(profile)
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ byLanguage, total: profiles.length }),
            },
          ],
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 12.3 get_active_rules
  server.tool(
    'get_active_rules',
    'Get active rules for a quality profile',
    getActiveRulesSchema.shape,
    async (params) => {
      try {
        const { profileKey, languages, types, severities, page, pageSize } = getActiveRulesSchema.parse(params)
        const queryParams: Record<string, string | number> = {
          qprofile: profileKey,
          activation: 'true',
          ps: pageSize ?? 100,
          p: page ?? 1,
        }
        if (languages?.length) queryParams['languages'] = languages.join(',')
        if (types?.length) queryParams['types'] = types.join(',')
        if (severities?.length) queryParams['severities'] = severities.join(',')
        const response = await sonarClient.get('/api/rules/search', { params: queryParams })
        return { content: [{ type: 'text' as const, text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 12.4 search_rules
  server.tool(
    'search_rules',
    'Search for rules by query and optional filters',
    searchRulesSchema.shape,
    async (params) => {
      try {
        const { query, tags, types, severities, languages } = searchRulesSchema.parse(params)
        const queryParams: Record<string, string> = { q: query }
        if (tags?.length) queryParams['tags'] = tags.join(',')
        if (types?.length) queryParams['types'] = types.join(',')
        if (severities?.length) queryParams['severities'] = severities.join(',')
        if (languages?.length) queryParams['languages'] = languages.join(',')
        const response = await sonarClient.get('/api/rules/search', { params: queryParams })
        return { content: [{ type: 'text' as const, text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )
}
