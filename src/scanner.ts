import { readFile } from 'fs/promises'
import { join } from 'path'
import { config } from './config.js'
import { sanitizeCliInput } from './utils/sanitize.js'

export interface ScanOptions {
  projectKey: string
  projectName: string
  sourceDir: string
  branch?: string
  pullRequestKey?: string
  pullRequestBranch?: string
  pullRequestBase?: string
}

export interface ScanResult {
  taskId: string
}

export interface ScanError {
  error: true
  type: 'timeout' | 'exit_error' | 'parse_error'
  message: string
  exitCode?: number
  stderr?: string
}

// Exported for testing — allows injecting a mock scanner function
export type ScannerFn = (options: ScanOptions) => Promise<void>

async function extractTaskId(sourceDir: string): Promise<string> {
  const reportPath = join(sourceDir, '.scannerwork', 'report-task.txt')
  const content = await readFile(reportPath, 'utf-8')
  const match = content.match(/^ceTaskId=(.+)$/m)
  if (!match?.[1]) {
    throw new Error('ceTaskId not found in report-task.txt')
  }
  return match[1].trim()
}

async function defaultScannerFn(options: ScanOptions): Promise<void> {
  // Dynamic import to allow mocking in tests
  const scannerModule = await import('sonarqube-scanner')
  const scan = scannerModule.scan ?? scannerModule.default

  const serverOptions: Record<string, string> = {
    'sonar.projectKey': options.projectKey,
    'sonar.projectName': options.projectName,
    'sonar.sources': options.sourceDir,
  }

  if (options.branch) {
    serverOptions['sonar.branch.name'] = options.branch
  }

  if (options.pullRequestKey && options.pullRequestBranch && options.pullRequestBase) {
    serverOptions['sonar.pullrequest.key'] = options.pullRequestKey
    serverOptions['sonar.pullrequest.branch'] = options.pullRequestBranch
    serverOptions['sonar.pullrequest.base'] = options.pullRequestBase
  }

  // Redirect stdout to stderr during scan to prevent sonar-scanner output
  // from polluting the MCP StdioServerTransport JSON-RPC channel
  const originalWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk: any, ...args: any[]) =>
    (process.stderr.write as any)(chunk, ...args)

  try {
    await scan({
      serverUrl: config.SONARQUBE_URL,
      token: config.SONARQUBE_TOKEN,
      options: serverOptions,
    })
  } finally {
    process.stdout.write = originalWrite
  }
}

export async function runScanner(
  options: ScanOptions,
  scannerFn: ScannerFn = defaultScannerFn
): Promise<ScanResult | ScanError> {
  // Sanitize all string inputs to prevent command injection
  const sanitized: ScanOptions = {
    projectKey: sanitizeCliInput(options.projectKey, 'projectKey'),
    projectName: sanitizeCliInput(options.projectName, 'projectName'),
    sourceDir: sanitizeCliInput(options.sourceDir, 'sourceDir'),
  }

  if (options.branch !== undefined) {
    sanitized.branch = sanitizeCliInput(options.branch, 'branch')
  }
  if (options.pullRequestKey !== undefined) {
    sanitized.pullRequestKey = sanitizeCliInput(options.pullRequestKey, 'pullRequestKey')
  }
  if (options.pullRequestBranch !== undefined) {
    sanitized.pullRequestBranch = sanitizeCliInput(options.pullRequestBranch, 'pullRequestBranch')
  }
  if (options.pullRequestBase !== undefined) {
    sanitized.pullRequestBase = sanitizeCliInput(options.pullRequestBase, 'pullRequestBase')
  }

  const timeoutMs = config.SONAR_SCAN_TIMEOUT_MS

  const timeoutPromise = new Promise<ScanError>((resolve) =>
    setTimeout(
      () =>
        resolve({
          error: true,
          type: 'timeout',
          message: `Scanner timed out after ${timeoutMs}ms`,
        }),
      timeoutMs
    )
  )

  const scanPromise = (async (): Promise<ScanResult | ScanError> => {
    try {
      await scannerFn(sanitized)
      const taskId = await extractTaskId(sanitized.sourceDir)
      return { taskId }
    } catch (err: unknown) {
      const error = err as { exitCode?: number; stderr?: string; message?: string }
      if (error.exitCode !== undefined) {
        return {
          error: true,
          type: 'exit_error',
          message: `Scanner exited with code ${error.exitCode}`,
          exitCode: error.exitCode,
          stderr: error.stderr ?? '',
        }
      }
      return {
        error: true,
        type: 'parse_error',
        message: error.message ?? 'Unknown scanner error',
      }
    }
  })()

  return Promise.race([scanPromise, timeoutPromise])
}
