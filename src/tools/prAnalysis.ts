import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { sonarClient } from '../sonarClient.js'
import type { Verdict, NewIssuesSummary } from '../types/sonar.js'

// 14.1 Zod schemas for all 3 PR analysis tool inputs
const getPrAnalysisResultSchema = z.object({
  projectKey: z.string().min(1),
  pullRequestKey: z.string().min(1),
})

const getNewIssuesSummarySchema = z.object({
  projectKey: z.string().min(1),
  pullRequestKey: z.string().min(1),
})

const listPrAnalysesSchema = z.object({
  projectKey: z.string().min(1),
})

// 14.3 Pure function: deriveVerdict — exported for testing (Property 5)
export function deriveVerdict(
  qualityGatePassed: boolean,
  newIssues: { bugs: number; vulnerabilities: number; codeSmells: number; hotspots: number }
): Verdict {
  if (!qualityGatePassed) return 'do_not_merge'
  if (newIssues.bugs === 0 && newIssues.vulnerabilities === 0 && newIssues.codeSmells === 0 && newIssues.hotspots === 0) {
    return 'safe_to_merge'
  }
  if (newIssues.bugs === 0 && newIssues.vulnerabilities === 0) {
    return 'merge_with_caution'
  }
  return 'do_not_merge'
}

// API response schemas
const qualityGateStatusSchema = z.object({
  projectStatus: z.object({
    status: z.enum(['OK', 'ERROR', 'NONE']),
    conditions: z
      .array(
        z.object({
          metric: z.string(),
          operator: z.string(),
          value: z.string().optional().default(''),
          status: z.enum(['OK', 'ERROR']),
          errorThreshold: z.string().optional().default(''),
        })
      )
      .optional()
      .default([]),
    ignoredConditions: z.boolean().optional(),
  }),
})

export function registerPrAnalysisTools(server: McpServer): void {
  // 14.2 get_pr_analysis_result
  server.tool(
    'get_pr_analysis_result',
    'Get analysis results for a pull request',
    getPrAnalysisResultSchema.shape,
    async (params) => {
      try {
        const { projectKey, pullRequestKey } = getPrAnalysisResultSchema.parse(params)

        const [qgResponse, issuesResponse] = await Promise.all([
          sonarClient.get('/api/qualitygates/project_status', {
            params: { projectKey, pullRequest: pullRequestKey },
          }),
          sonarClient.get('/api/issues/search', {
            params: {
              componentKeys: projectKey,
              pullRequest: pullRequestKey,
              ps: 500,
              facets: 'types,severities',
            },
          }),
        ])

        const qgParsed = qualityGateStatusSchema.parse(qgResponse.data)
        const issues = issuesResponse.data?.issues ?? []
        const facets = issuesResponse.data?.facets ?? []

        const typesFacet = facets.find((f: { property: string }) => f.property === 'types')
        const severitiesFacet = facets.find((f: { property: string }) => f.property === 'severities')

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                qualityGate: qgParsed.projectStatus,
                issueCount: issues.length,
                byType: typesFacet?.values ?? [],
                bySeverity: severitiesFacet?.values ?? [],
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

  // 14.4 get_new_issues_summary — returns NewIssuesSummary shape (Azure DevOps contract)
  server.tool(
    'get_new_issues_summary',
    'Get a merge verdict and new issues summary for a pull request',
    getNewIssuesSummarySchema.shape,
    async (params) => {
      try {
        const { projectKey, pullRequestKey } = getNewIssuesSummarySchema.parse(params)

        const [qgResponse, issuesResponse, measuresResponse] = await Promise.all([
          sonarClient.get('/api/qualitygates/project_status', {
            params: { projectKey, pullRequest: pullRequestKey },
          }),
          sonarClient.get('/api/issues/search', {
            params: {
              componentKeys: projectKey,
              pullRequest: pullRequestKey,
              ps: 500,
              types: 'BUG,VULNERABILITY,CODE_SMELL,SECURITY_HOTSPOT',
            },
          }),
          sonarClient.get('/api/measures/component', {
            params: {
              component: projectKey,
              pullRequest: pullRequestKey,
              metricKeys: 'new_coverage',
            },
          }),
        ])

        const qgParsed = qualityGateStatusSchema.parse(qgResponse.data)
        const qualityGatePassed = qgParsed.projectStatus.status === 'OK'
        const issues: Array<{ type: string }> = issuesResponse.data?.issues ?? []

        const newIssues = {
          bugs: issues.filter((i) => i.type === 'BUG').length,
          vulnerabilities: issues.filter((i) => i.type === 'VULNERABILITY').length,
          codeSmells: issues.filter((i) => i.type === 'CODE_SMELL').length,
          hotspots: issues.filter((i) => i.type === 'SECURITY_HOTSPOT').length,
        }

        const measures: Array<{ metric: string; periods?: Array<{ value: string }> }> =
          measuresResponse.data?.component?.measures ?? []
        const coverageMeasure = measures.find((m) => m.metric === 'new_coverage')
        const coverageOnNewCode = coverageMeasure?.periods?.[0]?.value
          ? parseFloat(coverageMeasure.periods[0].value)
          : null

        const failedConditions = (qgParsed.projectStatus.conditions ?? [])
          .filter((c) => c.status === 'ERROR')
          .map((c) => ({
            metric: c.metric,
            actual: c.value ?? '',
            threshold: c.errorThreshold ?? '',
          }))

        const analysisDate = new Date().toISOString()

        const summary: NewIssuesSummary = {
          verdict: deriveVerdict(qualityGatePassed, newIssues),
          qualityGatePassed,
          newIssues,
          coverageOnNewCode,
          failedConditions,
          projectKey,
          pullRequestKey,
          analysisDate,
        }

        return { content: [{ type: 'text', text: JSON.stringify(summary) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 14.5 list_pr_analyses
  server.tool(
    'list_pr_analyses',
    'List all pull request analyses for a project',
    listPrAnalysesSchema.shape,
    async (params) => {
      try {
        const { projectKey } = listPrAnalysesSchema.parse(params)
        const response = await sonarClient.get('/api/project_pull_requests/list', {
          params: { project: projectKey },
        })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )
}
