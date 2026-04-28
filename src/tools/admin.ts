import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { sonarClient } from '../sonarClient.js'

export function registerAdminTools(server: McpServer): void {
  // Set a quality gate as default
  server.tool(
    'set_default_quality_gate',
    'Set a quality gate as the default for all projects',
    {
      name: z.string().min(1),
    },
    async (params) => {
      try {
        await sonarClient.post('/api/qualitygates/set_as_default', null, { params: { name: params.name } })
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, name: params.name }) }] }
      } catch (err: any) {
        const message = err?.message ?? String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // Assign a quality gate to a project
  server.tool(
    'assign_quality_gate_to_project',
    'Assign a quality gate to a specific project',
    {
      gateName: z.string().min(1),
      projectKey: z.string().min(1),
    },
    async (params) => {
      try {
        await sonarClient.post('/api/qualitygates/select', null, {
          params: { gateName: params.gateName, projectKey: params.projectKey },
        })
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, project: params.projectKey, gate: params.gateName }) }] }
      } catch (err: any) {
        const message = err?.message ?? String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // Copy a quality profile
  server.tool(
    'copy_quality_profile',
    'Copy a quality profile to a new name',
    {
      fromKey: z.string().min(1).describe('Source profile key'),
      toName: z.string().min(1).describe('New profile name'),
    },
    async (params) => {
      try {
        const response = await sonarClient.post('/api/qualityprofiles/copy', null, {
          params: { fromKey: params.fromKey, toName: params.toName },
        })
        return { content: [{ type: 'text', text: JSON.stringify(response.data) }] }
      } catch (err: any) {
        const message = err?.message ?? String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // Set a quality profile as default for its language
  server.tool(
    'set_default_quality_profile',
    'Set a quality profile as default for its language',
    {
      qualityProfile: z.string().min(1),
      language: z.string().min(1).describe('Language key (e.g. ts, js, py)'),
    },
    async (params) => {
      try {
        await sonarClient.post('/api/qualityprofiles/set_default', null, {
          params: { qualityProfile: params.qualityProfile, language: params.language },
        })
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, profile: params.qualityProfile, language: params.language }) }] }
      } catch (err: any) {
        const message = err?.message ?? String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // Activate a rule in a quality profile
  server.tool(
    'activate_rule_in_profile',
    'Activate a rule in a quality profile with optional parameters and severity',
    {
      profileKey: z.string().min(1).describe('Quality profile key'),
      rule: z.string().min(1).describe('Rule key (e.g. typescript:S1541)'),
      severity: z.enum(['INFO', 'MINOR', 'MAJOR', 'CRITICAL', 'BLOCKER']).optional(),
      params: z.string().optional().describe('Rule parameters as key=value (e.g. threshold=15)'),
    },
    async (params) => {
      try {
        const reqParams: Record<string, string> = { key: params.profileKey, rule: params.rule }
        if (params.severity) reqParams.severity = params.severity
        if (params.params) reqParams.params = params.params
        await sonarClient.post('/api/qualityprofiles/activate_rule', null, { params: reqParams })
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, rule: params.rule, profile: params.profileKey }) }] }
      } catch (err: any) {
        const message = err?.message ?? String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )

  // Deactivate a rule in a quality profile
  server.tool(
    'deactivate_rule_in_profile',
    'Deactivate a rule in a quality profile',
    {
      profileKey: z.string().min(1).describe('Quality profile key'),
      rule: z.string().min(1).describe('Rule key (e.g. typescript:S1541)'),
    },
    async (params) => {
      try {
        await sonarClient.post('/api/qualityprofiles/deactivate_rule', null, {
          params: { key: params.profileKey, rule: params.rule },
        })
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, rule: params.rule, profile: params.profileKey }) }] }
      } catch (err: any) {
        const message = err?.message ?? String(err)
        return { content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }], isError: true }
      }
    }
  )
}
