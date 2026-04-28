import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { config } from '../config.js'
import { sonarClient } from '../sonarClient.js'
import { runScanner } from '../scanner.js'
import type { TaskStatus } from '../types/sonar.js'

// 6.1 Zod schemas for run_analysis, get_task_status, analyze_and_wait inputs
const runAnalysisSchema = z.object({
  projectKey: z.string().min(1),
  projectName: z.string().min(1),
  sourceDir: z.string().min(1),
  branch: z.string().optional(),
  pullRequestKey: z.string().optional(),
  pullRequestBranch: z.string().optional(),
  pullRequestBase: z.string().optional(),
})

const getTaskStatusSchema = z.object({
  taskId: z.string().min(1),
})

const analyzeAndWaitSchema = runAnalysisSchema.extend({
  timeoutMs: z.number().positive().optional(),
})

// SonarQube API response schemas
const ceTaskResponseSchema = z.object({
  task: z.object({
    id: z.string(),
    status: z.enum(['IN_QUEUE', 'IN_PROGRESS', 'SUCCESS', 'FAILED', 'CANCELLED']),
    executionTimeMs: z.number().optional(),
    errorMessage: z.string().optional(),
  }),
})

const qualityGateStatusResponseSchema = z.object({
  projectStatus: z.object({
    status: z.enum(['OK', 'ERROR', 'NONE']),
    conditions: z
      .array(
        z.object({
          metric: z.string(),
          operator: z.string(),
          value: z.string().optional(),
          status: z.enum(['OK', 'ERROR']),
          errorThreshold: z.string().optional(),
        })
      )
      .optional(),
  }),
})

const TERMINAL_STATUSES: TaskStatus[] = ['SUCCESS', 'FAILED', 'CANCELLED']

// 6.3 Internal helper: call /api/ce/task and return structured result
async function getTaskStatusImpl(taskId: string) {
  const response = await sonarClient.get('/api/ce/task', { params: { id: taskId } })
  const parsed = ceTaskResponseSchema.parse(response.data)
  return {
    taskId,
    status: parsed.task.status as TaskStatus,
    progress: parsed.task.executionTimeMs,
    errorMessage: parsed.task.errorMessage,
  }
}

export function registerAnalysisTools(server: McpServer): void {
  // 6.2 run_analysis: validate inputs, call scanner, return taskId
  server.tool(
    'run_analysis',
    'Trigger a SonarQube analysis for a local project directory',
    runAnalysisSchema.shape,
    async (params) => {
      try {
        const validated = runAnalysisSchema.parse(params)
        const result = await runScanner(validated)
        if ('error' in result) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            isError: true,
          }
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ taskId: result.taskId }) }],
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }],
          isError: true,
        }
      }
    }
  )

  // 6.3 get_task_status: validate taskId, call /api/ce/task, return status/progress/errorMessage
  server.tool(
    'get_task_status',
    'Get the status of a SonarQube background task',
    getTaskStatusSchema.shape,
    async (params) => {
      try {
        const validated = getTaskStatusSchema.parse(params)
        const result = await getTaskStatusImpl(validated.taskId)
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }],
          isError: true,
        }
      }
    }
  )

  // 6.4 analyze_and_wait: call run_analysis, poll get_task_status, return final status + quality gate
  server.tool(
    'analyze_and_wait',
    'Trigger analysis and wait for completion, returning quality gate result',
    analyzeAndWaitSchema.shape,
    async (params) => {
      try {
        const validated = analyzeAndWaitSchema.parse(params)
        const timeoutMs = validated.timeoutMs ?? config.SONAR_SCAN_TIMEOUT_MS
        const pollInterval = config.SONAR_TASK_POLL_INTERVAL_MS

        // Run analysis
        const scanResult = await runScanner(validated)
        if ('error' in scanResult) {
          return {
            content: [{ type: 'text', text: JSON.stringify(scanResult) }],
            isError: true,
          }
        }

        const { taskId } = scanResult
        const startTime = Date.now()
        let lastStatus: TaskStatus = 'IN_QUEUE'

        // Poll until terminal state or timeout
        while (true) {
          if (Date.now() - startTime > timeoutMs) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: true,
                    type: 'timeout',
                    message: `analyze_and_wait timed out after ${timeoutMs}ms`,
                    lastStatus,
                  }),
                },
              ],
              isError: true,
            }
          }

          const taskResult = await getTaskStatusImpl(taskId)
          lastStatus = taskResult.status

          if (TERMINAL_STATUSES.includes(lastStatus)) {
            // Fetch quality gate on success
            let qualityGate = null
            if (lastStatus === 'SUCCESS') {
              try {
                const qgResponse = await sonarClient.get('/api/qualitygates/project_status', {
                  params: { projectKey: validated.projectKey },
                })
                const qgParsed = qualityGateStatusResponseSchema.parse(qgResponse.data)
                qualityGate = qgParsed.projectStatus
              } catch {
                // Quality gate fetch is best-effort
              }
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ taskId, status: lastStatus, qualityGate }),
                },
              ],
            }
          }

          await new Promise((resolve) => setTimeout(resolve, pollInterval))
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }],
          isError: true,
        }
      }
    }
  )
}
