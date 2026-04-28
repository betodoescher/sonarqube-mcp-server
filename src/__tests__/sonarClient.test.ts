import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fc from 'fast-check'
import MockAdapter from 'axios-mock-adapter'
import { createSonarClient, LogEntry } from '../sonarClient.js'

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

describe('sonarClient', () => {
  describe('Property 3: token never appears in log output', () => {
    // Feature: sonarqube-mcp-server, Property 3: for any token value, it never appears in any log field produced by sonarClient
    it('never logs the token value for any token string', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Use tokens that are long enough to be distinct from log field names/values
          fc.string({ minLength: 8 }).filter((s) => !s.includes('http')),
          async (token) => {
            const logs: LogEntry[] = []
            const client = createSonarClient({
              baseURL: 'http://test.example.com',
              token,
              onLog: (entry) => logs.push(entry),
              retryDelays: [0, 0, 0],
            })
            const mock = new MockAdapter(client as never)
            mock.onGet('/api/test').reply(200, { ok: true })

            await client.get('/api/test')

            // Check that the token value does not appear in any log field value
            for (const log of logs) {
              expect(String(log.method)).not.toContain(token)
              expect(String(log.url)).not.toContain(token)
              expect(String(log.status)).not.toContain(token)
              expect(String(log.duration)).not.toContain(token)
            }
            mock.restore()
          }
        ),
        { numRuns: 50 }
      )
    })
  })

  describe('integration tests', () => {
    let client: ReturnType<typeof createSonarClient>
    let mock: MockAdapter
    const logs: LogEntry[] = []

    beforeEach(() => {
      logs.length = 0
      client = createSonarClient({
        baseURL: 'http://test.example.com',
        token: 'test-token-xyz',
        onLog: (entry) => logs.push(entry),
        retryDelays: [0, 0, 0],
      })
      mock = new MockAdapter(client as never)
    })

    afterEach(() => {
      mock.restore()
    })

    it('retries on 429: mock 429→429→200, asserts 3 calls total', async () => {
      let callCount = 0
      mock.onGet('/api/retry').reply(() => {
        callCount++
        if (callCount < 3) return [429, { error: 'rate limited' }]
        return [200, { ok: true }]
      })

      const response = await client.get('/api/retry')
      expect(response.status).toBe(200)
      expect(callCount).toBe(3)
    })

    it('returns structured error when retries exhausted', async () => {
      mock.onGet('/api/fail').reply(500, { error: 'server error' })

      await expect(client.get('/api/fail')).rejects.toMatchObject({
        status: 500,
        message: expect.stringContaining('500'),
      })
    })

    it('attaches Authorization header on all requests', async () => {
      let capturedAuth = ''
      mock.onGet('/api/auth-check').reply((config) => {
        capturedAuth = (config.headers as Record<string, string>)['Authorization'] ?? ''
        return [200, {}]
      })

      await client.get('/api/auth-check')
      expect(capturedAuth).toBe('Bearer test-token-xyz')
    })

    it('logs method, url, status, duration without token', async () => {
      mock.onGet('/api/log-test').reply(200, {})
      await client.get('/api/log-test')

      expect(logs).toHaveLength(1)
      expect(logs[0].method).toBe('GET')
      expect(logs[0].status).toBe(200)
      expect(typeof logs[0].duration).toBe('number')
      expect(JSON.stringify(logs[0])).not.toContain('test-token-xyz')
    })
  })
})
