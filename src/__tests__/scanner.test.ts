import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock config before importing scanner
vi.mock('../config.js', () => ({
  config: {
    SONARQUBE_URL: 'http://localhost:9000',
    SONARQUBE_TOKEN: 'test-token',
    SONAR_SCAN_TIMEOUT_MS: 5000,
    SONAR_TASK_POLL_INTERVAL_MS: 3000,
    SONAR_COMPLEXITY_THRESHOLD: 15,
    SONAR_COVERAGE_MIN: 80,
  },
}))

import { runScanner, ScanOptions, ScannerFn } from '../scanner.js'

const baseOptions: ScanOptions = {
  projectKey: 'my-project',
  projectName: 'My Project',
  sourceDir: '/tmp/test-project',
}

async function makeTmpDir(suffix: string): Promise<string> {
  const tmpDir = join(tmpdir(), `scanner-test-${suffix}-${Date.now()}`)
  const scannerWorkDir = join(tmpDir, '.scannerwork')
  await mkdir(scannerWorkDir, { recursive: true })
  return tmpDir
}

describe('runScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extracts taskId correctly from mock report-task.txt', async () => {
    const tmpDir = await makeTmpDir('taskid')
    await writeFile(
      join(tmpDir, '.scannerwork', 'report-task.txt'),
      'projectKey=my-project\nceTaskId=abc123taskid\nserverUrl=http://localhost:9000\n'
    )

    const mockScannerFn: ScannerFn = vi.fn().mockResolvedValue(undefined)

    const result = await runScanner({ ...baseOptions, sourceDir: tmpDir }, mockScannerFn)

    expect(result).toEqual({ taskId: 'abc123taskid' })
    expect(mockScannerFn).toHaveBeenCalledOnce()
  })

  it('returns structured error with exitCode and stderr on non-zero exit', async () => {
    const exitErrorScanner: ScannerFn = () => {
      const err = Object.assign(new Error('Scanner failed'), {
        exitCode: 2,
        stderr: 'Error: compilation failed\nSyntax error on line 42',
      })
      return Promise.reject(err)
    }

    const result = await runScanner(baseOptions, exitErrorScanner)

    expect(result).toMatchObject({
      error: true,
      type: 'exit_error',
      message: expect.stringContaining('2'),
      exitCode: 2,
      stderr: expect.stringContaining('compilation failed'),
    })
  })

  it('returns exit_error with exitCode 1 and captures stderr', async () => {
    const exitErrorScanner: ScannerFn = () => {
      const err = Object.assign(new Error('Scanner failed'), {
        exitCode: 1,
        stderr: 'Build failed\nCompile error',
      })
      return Promise.reject(err)
    }

    const result = await runScanner(baseOptions, exitErrorScanner)

    expect(result).toMatchObject({
      error: true,
      type: 'exit_error',
      exitCode: 1,
      stderr: 'Build failed\nCompile error',
    })
  })

  it('returns timeout error shape when scanner times out', async () => {
    // We test the timeout path by verifying the timeout promise resolves correctly.
    // Since the module mock sets SONAR_SCAN_TIMEOUT_MS=5000, we use fake timers
    // to advance time without actually waiting.
    vi.useFakeTimers()

    const neverResolvingScanner: ScannerFn = () => new Promise(() => {}) // never resolves

    const resultPromise = runScanner(baseOptions, neverResolvingScanner)

    // Advance past the 5000ms timeout
    await vi.advanceTimersByTimeAsync(6000)

    const result = await resultPromise

    expect(result).toMatchObject({
      error: true,
      type: 'timeout',
      message: expect.stringContaining('timed out'),
    })

    vi.useRealTimers()
  })

  it('sanitizes inputs and rejects shell metacharacters', async () => {
    const mockScannerFn: ScannerFn = vi.fn().mockResolvedValue(undefined)

    await expect(
      runScanner({ ...baseOptions, projectKey: 'project;rm -rf /' }, mockScannerFn)
    ).rejects.toThrow()

    expect(mockScannerFn).not.toHaveBeenCalled()
  })

  it('passes branch parameter when provided', async () => {
    const tmpDir = await makeTmpDir('branch')
    await writeFile(join(tmpDir, '.scannerwork', 'report-task.txt'), 'ceTaskId=branchtaskid\n')

    let capturedOptions: ScanOptions | undefined
    const mockScannerFn: ScannerFn = vi.fn().mockImplementation(async (opts) => {
      capturedOptions = opts
    })

    await runScanner({ ...baseOptions, sourceDir: tmpDir, branch: 'feature-branch' }, mockScannerFn)

    expect(capturedOptions?.branch).toBe('feature-branch')
  })

  it('passes all pull request parameters when all three are provided', async () => {
    const tmpDir = await makeTmpDir('pr')
    await writeFile(join(tmpDir, '.scannerwork', 'report-task.txt'), 'ceTaskId=prtaskid\n')

    let capturedOptions: ScanOptions | undefined
    const mockScannerFn: ScannerFn = vi.fn().mockImplementation(async (opts) => {
      capturedOptions = opts
    })

    await runScanner(
      {
        ...baseOptions,
        sourceDir: tmpDir,
        pullRequestKey: '42',
        pullRequestBranch: 'feature-pr',
        pullRequestBase: 'main',
      },
      mockScannerFn
    )

    expect(capturedOptions?.pullRequestKey).toBe('42')
    expect(capturedOptions?.pullRequestBranch).toBe('feature-pr')
    expect(capturedOptions?.pullRequestBase).toBe('main')
  })

  it('returns parse_error when report-task.txt is missing ceTaskId', async () => {
    const tmpDir = await makeTmpDir('missing-taskid')
    await writeFile(
      join(tmpDir, '.scannerwork', 'report-task.txt'),
      'projectKey=my-project\nserverUrl=http://localhost:9000\n'
    )

    const mockScannerFn: ScannerFn = vi.fn().mockResolvedValue(undefined)

    const result = await runScanner({ ...baseOptions, sourceDir: tmpDir }, mockScannerFn)

    expect(result).toMatchObject({
      error: true,
      type: 'parse_error',
      message: expect.stringContaining('ceTaskId'),
    })
  })
})
