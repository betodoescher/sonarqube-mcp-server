import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { sonarClient } from '../sonarClient.js'

// 9.1 Zod schemas for all 8 issues tool inputs

const listIssuesSchema = z.object({
  projectKey: z.string().min(1),
  types: z.array(z.enum(['BUG', 'VULNERABILITY', 'CODE_SMELL', 'SECURITY_HOTSPOT'])).optional(),
  severities: z.array(z.enum(['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'])).optional(),
  statuses: z.array(z.string()).optional(),
  assignee: z.string().optional(),
  author: z.string().optional(),
  componentKeys: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  branch: z.string().optional(),
  newCodeOnly: z.boolean().optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(500).optional(),
})

const getIssueDetailSchema = z.object({
  issueKey: z.string().min(1),
})

const getTopIssuesByFileSchema = z.object({
  projectKey: z.string().min(1),
  branch: z.string().optional(),
  limit: z.number().int().positive().optional(),
})

const assignIssueSchema = z.object({
  issueKey: z.string().min(1),
  assignee: z.string().min(1),
})

// mark_as_false_positive and mark_as_wont_fix require non-empty, non-whitespace comment (Req 7.9)
export const markIssueSchema = z.object({
  issueKey: z.string().min(1),
  comment: z.string().trim().min(1, 'Comment is required and cannot be empty or whitespace'),
})

const addIssueCommentSchema = z.object({
  issueKey: z.string().min(1),
  text: z.string().min(1),
})

const bulkChangeIssuesSchema = z.object({
  issueKeys: z.array(z.string().min(1)).optional(),
  projectKey: z.string().optional(),
  action: z.enum(['assign', 'set_severity', 'set_type', 'do_transition']),
  actionParameters: z.record(z.string(), z.string()).optional(),
})

export function registerIssuesTools(server: McpServer): void {
  // 9.2 list_issues
  server.tool(
    'list_issues',
    'List and filter issues in a SonarQube project',
    listIssuesSchema.shape,
    async (params) => {
      try {
        const validated = listIssuesSchema.parse(params)
        const queryParams: Record<string, string | number | boolean> = {
          componentKeys: validated.projectKey,
          ps: validated.pageSize ?? 100,
          p: validated.page ?? 1,
        }
        if (validated.types?.length) queryParams['types'] = validated.types.join(',')
        if (validated.severities?.length) queryParams['severities'] = validated.severities.join(',')
        if (validated.statuses?.length) queryParams['statuses'] = validated.statuses.join(',')
        if (validated.assignee) queryParams['assignees'] = validated.assignee
        if (validated.author) queryParams['author'] = validated.author
        if (validated.componentKeys?.length) queryParams['componentKeys'] = validated.componentKeys.join(',')
        if (validated.tags?.length) queryParams['tags'] = validated.tags.join(',')
        if (validated.branch) queryParams['branch'] = validated.branch
        if (validated.newCodeOnly) queryParams['sinceLeakPeriod'] = true
        const response = await sonarClient.get('/api/issues/search', { params: queryParams })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 9.3 get_issue_detail
  server.tool(
    'get_issue_detail',
    'Get full details for a specific issue',
    getIssueDetailSchema.shape,
    async (params) => {
      try {
        const { issueKey } = getIssueDetailSchema.parse(params)
        const response = await sonarClient.get('/api/issues/search', {
          params: { issues: issueKey, additionalFields: 'comments,transitions,actions,flows' },
        })
        const issue = response.data?.issues?.[0] ?? null
        return { content: [{ type: 'text', text: JSON.stringify(issue) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 9.4 get_top_issues_by_file
  server.tool(
    'get_top_issues_by_file',
    'Get top files ranked by issue count',
    getTopIssuesByFileSchema.shape,
    async (params) => {
      try {
        const { projectKey, branch, limit } = getTopIssuesByFileSchema.parse(params)
        const queryParams: Record<string, string | number> = {
          componentKeys: projectKey,
          facets: 'files',
          ps: 1,
        }
        if (branch) queryParams['branch'] = branch
        const response = await sonarClient.get('/api/issues/search', { params: queryParams })
        const filesFacet = response.data?.facets?.find((f: { property: string }) => f.property === 'files')
        const topFiles = (filesFacet?.values ?? []).slice(0, limit ?? 10)
        return { content: [{ type: 'text', text: JSON.stringify({ topFiles }) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 9.5 assign_issue
  server.tool(
    'assign_issue',
    'Assign an issue to a user',
    assignIssueSchema.shape,
    async (params) => {
      try {
        const { issueKey, assignee } = assignIssueSchema.parse(params)
        const response = await sonarClient.post('/api/issues/assign', null, {
          params: { issue: issueKey, assignee },
        })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 9.6 mark_as_false_positive — comment required and non-empty (Req 7.9)
  server.tool(
    'mark_as_false_positive',
    'Mark an issue as false positive with a mandatory comment',
    markIssueSchema.shape,
    async (params) => {
      try {
        const { issueKey, comment } = markIssueSchema.parse(params)
        await sonarClient.post('/api/issues/do_transition', null, {
          params: { issue: issueKey, transition: 'falsepositive' },
        })
        const response = await sonarClient.post('/api/issues/add_comment', null, {
          params: { issue: issueKey, text: comment },
        })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 9.7 mark_as_wont_fix — comment required and non-empty (Req 7.9)
  server.tool(
    'mark_as_wont_fix',
    "Mark an issue as won't fix with a mandatory comment",
    markIssueSchema.shape,
    async (params) => {
      try {
        const { issueKey, comment } = markIssueSchema.parse(params)
        await sonarClient.post('/api/issues/do_transition', null, {
          params: { issue: issueKey, transition: 'wontfix' },
        })
        const response = await sonarClient.post('/api/issues/add_comment', null, {
          params: { issue: issueKey, text: comment },
        })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 9.8 add_issue_comment
  server.tool(
    'add_issue_comment',
    'Add a comment to an issue',
    addIssueCommentSchema.shape,
    async (params) => {
      try {
        const { issueKey, text } = addIssueCommentSchema.parse(params)
        const response = await sonarClient.post('/api/issues/add_comment', null, {
          params: { issue: issueKey, text },
        })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // 9.9 bulk_change_issues
  server.tool(
    'bulk_change_issues',
    'Apply a bulk action to multiple issues',
    bulkChangeIssuesSchema.shape,
    async (params) => {
      try {
        const validated = bulkChangeIssuesSchema.parse(params)
        const bodyParams: Record<string, string> = {
          do_transition: validated.action,
        }
        if (validated.issueKeys?.length) bodyParams['issues'] = validated.issueKeys.join(',')
        if (validated.actionParameters) {
          Object.assign(bodyParams, validated.actionParameters)
        }
        const response = await sonarClient.post('/api/issues/bulk_change', null, { params: bodyParams })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )
}
