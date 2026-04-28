import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import MockAdapter from 'axios-mock-adapter'

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

vi.mock('../scanner.js', () => ({
  runScanner: vi.fn(),
}))

// Use a real axios instance (with zero retry delays) so MockAdapter works correctly
vi.mock('../sonarClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sonarClient.js')>()
  return {
    ...actual,
    sonarClient: actual.createSonarClient({
      baseURL: 'http://localhost:9000',
      token: 'test-token',
      retryDelays: [0, 0, 0],
    }),
  }
})

import { runScanner } from '../scanner.js'
import { sonarClient } from '../sonarClient.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

// Minimal mock MCP server that captures tool registrations
// Matches the server.tool(name, description, paramsSchema, cb) overload
function buildMockServer() {
  const tools: Record<string, (params: unknown) => Promise<unknown>> = {}
  const mockServer = {
    tool: vi.fn(
      (
        name: string,
        _descOrSchema: unknown,
        _schemaOrCb: unknown,
        cb?: (params: unknown) => Promise<unknown>
      ) => {
        // Handle both 3-arg (name, desc, cb) and 4-arg (name, desc, schema, cb) overloads
        if (typeof cb === 'function') {
          tools[name] = cb
        } else if (typeof _schemaOrCb === 'function') {
          tools[name] = _schemaOrCb as (params: unknown) => Promise<unknown>
        }
      }
    ),
    callTool: async (name: string, params: unknown) => {
      const handler = tools[name]
      if (!handler) throw new Error(`Tool '${name}' not registered`)
      return handler(params)
    },
  }
  return mockServer
}

describe('analysis tools', () => {
  let mock: MockAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    mock = new MockAdapter(sonarClient as never)
  })

  afterEach(() => {
    mock.restore()
  })

  // 6.5 Tests: polling stops on SUCCESS/FAILED/CANCELLED, timeout returns last known status

  describe('analyze_and_wait', () => {
    it('polling stops on SUCCESS and returns quality gate', async () => {
      vi.mocked(runScanner).mockResolvedValue({ taskId: 'task-abc' })

      let callCount = 0
      mock.onGet('/api/ce/task').reply(() => {
        callCount++
        const status = callCount < 3 ? 'IN_PROGRESS' : 'SUCCESS'
        return [200, { task: { id: 'task-abc', status } }]
      })

      mock.onGet('/api/qualitygates/project_status').reply(200, {
        projectStatus: { status: 'OK', conditions: [] },
      })

      const { registerAnalysisTools } = await import('../tools/analysis.js')
      const server = buildMockServer()
      registerAnalysisTools(server as unknown as McpServer)

      const result = (await server.callTool('analyze_and_wait', {
        projectKey: 'my-project',
        projectName: 'My Project',
        sourceDir: '/tmp/project',
      })) as { content: Array<{ text: string }> }

      const data = JSON.parse(result.content[0].text)
      expect(data.status).toBe('SUCCESS')
      expect(data.qualityGate).toBeDefined()
      expect(callCount).toBe(3)
    })

    it('polling stops on FAILED and returns FAILED status', async () => {
      vi.mocked(runScanner).mockResolvedValue({ taskId: 'task-fail' })

      mock.onGet('/api/ce/task').reply(200, {
        task: { id: 'task-fail', status: 'FAILED', errorMessage: 'Analysis failed' },
      })

      const { registerAnalysisTools } = await import('../tools/analysis.js')
      const server = buildMockServer()
      registerAnalysisTools(server as unknown as McpServer)

      const result = (await server.callTool('analyze_and_wait', {
        projectKey: 'my-project',
        projectName: 'My Project',
        sourceDir: '/tmp/project',
      })) as { content: Array<{ text: string }> }

      const data = JSON.parse(result.content[0].text)
      expect(data.status).toBe('FAILED')
    })

    it('polling stops on CANCELLED and returns CANCELLED status', async () => {
      vi.mocked(runScanner).mockResolvedValue({ taskId: 'task-cancel' })

      mock.onGet('/api/ce/task').reply(200, {
        task: { id: 'task-cancel', status: 'CANCELLED' },
      })

      const { registerAnalysisTools } = await import('../tools/analysis.js')
      const server = buildMockServer()
      registerAnalysisTools(server as unknown as McpServer)

      const result = (await server.callTool('analyze_and_wait', {
        projectKey: 'my-project',
        projectName: 'My Project',
        sourceDir: '/tmp/project',
      })) as { content: Array<{ text: string }> }

      const data = JSON.parse(result.content[0].text)
      expect(data.status).toBe('CANCELLED')
    })

    it('returns timeout error with last known status when polling exceeds timeoutMs', async () => {
      vi.useFakeTimers()
      vi.mocked(runScanner).mockResolvedValue({ taskId: 'task-timeout' })

      mock.onGet('/api/ce/task').reply(200, {
        task: { id: 'task-timeout', status: 'IN_PROGRESS' },
      })

      const { registerAnalysisTools } = await import('../tools/analysis.js')
      const server = buildMockServer()
      registerAnalysisTools(server as unknown as McpServer)

      const resultPromise = server.callTool('analyze_and_wait', {
        projectKey: 'my-project',
        projectName: 'My Project',
        sourceDir: '/tmp/project',
        timeoutMs: 300,
      })

      // Advance time past the timeout
      await vi.advanceTimersByTimeAsync(2000)
      vi.useRealTimers()

      const result = (await resultPromise) as {
        content: Array<{ text: string }>
        isError: boolean
      }
      const data = JSON.parse(result.content[0].text)
      expect(data.error).toBe(true)
      expect(data.type).toBe('timeout')
      expect(data.lastStatus).toBeDefined()
    })
  })
})
