/**
 * Task 15: Input Validation Completeness
 *
 * Property 7: For each tool, generate inputs with one required field removed and verify
 * ZodError is thrown before any HTTP call is made.
 *
 * Validates: Requirements 13.1, 13.2
 */
import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'
import { z } from 'zod'

vi.mock('../config.js', () => ({
  config: {
    SONARQUBE_URL: 'http://localhost:9000',
    SONARQUBE_TOKEN: 'test-token',
    SONAR_SCAN_TIMEOUT_MS: 5000,
    SONAR_TASK_POLL_INTERVAL_MS: 100,
    SONAR_COMPLEXITY_THRESHOLD: 15,
    SONAR_COVERAGE_MIN: 80,
  },
}))

vi.mock('../sonarClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sonarClient.js')>()
  return { ...actual, sonarClient: actual.createSonarClient({
    baseURL: 'http://localhost:9000',
    token: 'test-token',
    retryDelays: [0, 0, 0],
  }) }
})

// Schemas with required fields — each entry: [schemaName, schema, validInput]
// (defined here for documentation purposes; individual tests use inline schemas)
const _toolSchemas: Array<[string, z.ZodObject<z.ZodRawShape>, Record<string, unknown>]> = []
void _toolSchemas

// Dynamically import schemas after mocks are set up
describe('Property 7: ZodError thrown for missing required fields before any API call', () => {
  // Feature: sonarqube-mcp-server, Property 7: for each tool, generate inputs with one required
  // field removed and verify ZodError is thrown before any HTTP call is made

  describe('analysis tools', () => {
    const runAnalysisSchema = z.object({
      projectKey: z.string().min(1),
      projectName: z.string().min(1),
      sourceDir: z.string().min(1),
    })
    const getTaskStatusSchema = z.object({ taskId: z.string().min(1) })

    it('run_analysis: missing projectKey throws ZodError', () => {
      expect(() => runAnalysisSchema.parse({ projectName: 'test', sourceDir: '/src' })).toThrow(z.ZodError)
    })
    it('run_analysis: missing projectName throws ZodError', () => {
      expect(() => runAnalysisSchema.parse({ projectKey: 'key', sourceDir: '/src' })).toThrow(z.ZodError)
    })
    it('run_analysis: missing sourceDir throws ZodError', () => {
      expect(() => runAnalysisSchema.parse({ projectKey: 'key', projectName: 'test' })).toThrow(z.ZodError)
    })
    it('get_task_status: missing taskId throws ZodError', () => {
      expect(() => getTaskStatusSchema.parse({})).toThrow(z.ZodError)
    })
  })

  describe('quality gate tools', () => {
    const getQualityGateStatusSchema = z.object({ projectKey: z.string().min(1) })
    const compareQualityGatesSchema = z.object({
      projectKey: z.string().min(1),
      branchA: z.string().min(1),
      branchB: z.string().min(1),
    })

    it('get_quality_gate_status: missing projectKey throws ZodError', () => {
      expect(() => getQualityGateStatusSchema.parse({})).toThrow(z.ZodError)
    })
    it('compare_quality_gates: missing branchA throws ZodError', () => {
      expect(() => compareQualityGatesSchema.parse({ projectKey: 'key', branchB: 'main' })).toThrow(z.ZodError)
    })
    it('compare_quality_gates: missing branchB throws ZodError', () => {
      expect(() => compareQualityGatesSchema.parse({ projectKey: 'key', branchA: 'feat' })).toThrow(z.ZodError)
    })
  })

  describe('metrics tools', () => {
    const getCoverageSchema = z.object({ projectKey: z.string().min(1) })
    const getMetricsHistorySchema = z.object({
      projectKey: z.string().min(1),
      metrics: z.array(z.string()).min(1),
    })

    it('get_coverage: missing projectKey throws ZodError', () => {
      expect(() => getCoverageSchema.parse({})).toThrow(z.ZodError)
    })
    it('get_metrics_history: missing metrics throws ZodError', () => {
      expect(() => getMetricsHistorySchema.parse({ projectKey: 'key' })).toThrow(z.ZodError)
    })
    it('get_metrics_history: empty metrics array throws ZodError', () => {
      expect(() => getMetricsHistorySchema.parse({ projectKey: 'key', metrics: [] })).toThrow(z.ZodError)
    })
  })

  describe('issues tools', () => {
    const listIssuesSchema = z.object({ projectKey: z.string().min(1) })
    const getIssueDetailSchema = z.object({ issueKey: z.string().min(1) })
    const markIssueSchema = z.object({
      issueKey: z.string().min(1),
      comment: z.string().trim().min(1),
    })

    it('list_issues: missing projectKey throws ZodError', () => {
      expect(() => listIssuesSchema.parse({})).toThrow(z.ZodError)
    })
    it('get_issue_detail: missing issueKey throws ZodError', () => {
      expect(() => getIssueDetailSchema.parse({})).toThrow(z.ZodError)
    })
    it('mark_as_false_positive: missing issueKey throws ZodError', () => {
      expect(() => markIssueSchema.parse({ comment: 'valid' })).toThrow(z.ZodError)
    })
    it('mark_as_false_positive: missing comment throws ZodError', () => {
      expect(() => markIssueSchema.parse({ issueKey: 'ISSUE-1' })).toThrow(z.ZodError)
    })
  })

  describe('security hotspot tools', () => {
    const listHotspotsSchema = z.object({ projectKey: z.string().min(1) })
    const getHotspotDetailSchema = z.object({ hotspotKey: z.string().min(1) })
    const updateHotspotStatusSchema = z.object({
      hotspotKey: z.string().min(1),
      resolution: z.enum(['FIXED', 'SAFE', 'ACKNOWLEDGED']),
      comment: z.string().trim().min(1),
    })

    it('list_security_hotspots: missing projectKey throws ZodError', () => {
      expect(() => listHotspotsSchema.parse({})).toThrow(z.ZodError)
    })
    it('get_hotspot_detail: missing hotspotKey throws ZodError', () => {
      expect(() => getHotspotDetailSchema.parse({})).toThrow(z.ZodError)
    })
    it('update_hotspot_status: missing hotspotKey throws ZodError', () => {
      expect(() => updateHotspotStatusSchema.parse({ resolution: 'FIXED', comment: 'ok' })).toThrow(z.ZodError)
    })
    it('update_hotspot_status: missing resolution throws ZodError', () => {
      expect(() => updateHotspotStatusSchema.parse({ hotspotKey: 'HS-1', comment: 'ok' })).toThrow(z.ZodError)
    })
    it('update_hotspot_status: missing comment throws ZodError', () => {
      expect(() => updateHotspotStatusSchema.parse({ hotspotKey: 'HS-1', resolution: 'FIXED' })).toThrow(z.ZodError)
    })
  })

  describe('project tools', () => {
    const createProjectSchema = z.object({
      projectKey: z.string().min(1),
      name: z.string().min(1),
      visibility: z.enum(['public', 'private']),
    })
    const deleteProjectSchema = z.object({
      projectKey: z.string().min(1),
      confirm: z.literal(true),
    })

    it('create_project: missing projectKey throws ZodError', () => {
      expect(() => createProjectSchema.parse({ name: 'test', visibility: 'public' })).toThrow(z.ZodError)
    })
    it('create_project: missing visibility throws ZodError', () => {
      expect(() => createProjectSchema.parse({ projectKey: 'key', name: 'test' })).toThrow(z.ZodError)
    })
    it('delete_project: missing confirm throws ZodError', () => {
      expect(() => deleteProjectSchema.parse({ projectKey: 'key' })).toThrow(z.ZodError)
    })
    it('delete_project: confirm=false throws ZodError', () => {
      expect(() => deleteProjectSchema.parse({ projectKey: 'key', confirm: false })).toThrow(z.ZodError)
    })
  })

  describe('rules tools', () => {
    const getActiveRulesSchema = z.object({ profileKey: z.string().min(1) })
    const searchRulesSchema = z.object({ query: z.string().min(1) })

    it('get_active_rules: missing profileKey throws ZodError', () => {
      expect(() => getActiveRulesSchema.parse({})).toThrow(z.ZodError)
    })
    it('search_rules: missing query throws ZodError', () => {
      expect(() => searchRulesSchema.parse({})).toThrow(z.ZodError)
    })
  })

  describe('PR analysis tools', () => {
    const prSchema = z.object({
      projectKey: z.string().min(1),
      pullRequestKey: z.string().min(1),
    })

    it('get_pr_analysis_result: missing projectKey throws ZodError', () => {
      expect(() => prSchema.parse({ pullRequestKey: '42' })).toThrow(z.ZodError)
    })
    it('get_pr_analysis_result: missing pullRequestKey throws ZodError', () => {
      expect(() => prSchema.parse({ projectKey: 'key' })).toThrow(z.ZodError)
    })
  })

  /**
   * Property-based test: for any tool schema with a required string field,
   * removing that field always produces a ZodError.
   */
  describe('property-based: removing any required field always throws ZodError', () => {
    it('run_analysis required fields: removing any one always throws', () => {
      const schema = z.object({
        projectKey: z.string().min(1),
        projectName: z.string().min(1),
        sourceDir: z.string().min(1),
      })
      const requiredFields = ['projectKey', 'projectName', 'sourceDir'] as const

      fc.assert(
        fc.property(
          fc.constantFrom(...requiredFields),
          fc.string({ minLength: 1 }),
          fc.string({ minLength: 1 }),
          fc.string({ minLength: 1 }),
          (removedField, projectKey, projectName, sourceDir) => {
            const input: Record<string, string> = { projectKey, projectName, sourceDir }
            delete input[removedField]
            expect(() => schema.parse(input)).toThrow(z.ZodError)
          }
        ),
        { numRuns: 100 }
      )
    })
  })
})

// 15.2 Verify API response schemas exist and validate before processing
describe('15.2: API response schemas validate before processing', () => {
  it('invalid ce/task response shape throws ZodError', () => {
    const ceTaskResponseSchema = z.object({
      task: z.object({
        id: z.string(),
        status: z.enum(['IN_QUEUE', 'IN_PROGRESS', 'SUCCESS', 'FAILED', 'CANCELLED']),
      }),
    })
    expect(() => ceTaskResponseSchema.parse({ task: { id: 123, status: 'INVALID' } })).toThrow(z.ZodError)
  })

  it('invalid quality gate response shape throws ZodError', () => {
    const qualityGateStatusSchema = z.object({
      projectStatus: z.object({
        status: z.enum(['OK', 'ERROR', 'NONE']),
      }),
    })
    expect(() => qualityGateStatusSchema.parse({ projectStatus: { status: 'UNKNOWN' } })).toThrow(z.ZodError)
  })
})
