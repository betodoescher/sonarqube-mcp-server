import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { deleteProjectSchema } from '../tools/projects.js'

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
  return {
    ...actual,
    sonarClient: actual.createSonarClient({
      baseURL: 'http://localhost:9000',
      token: 'test-token',
      retryDelays: [0, 0, 0],
    }),
  }
})

describe('projects tools', () => {
  describe('deleteProjectSchema', () => {
    it('throws ZodError when confirm is false', () => {
      expect(() =>
        deleteProjectSchema.parse({ projectKey: 'my-project', confirm: false })
      ).toThrow(z.ZodError)
    })

    it('throws ZodError when confirm is absent', () => {
      expect(() =>
        deleteProjectSchema.parse({ projectKey: 'my-project' })
      ).toThrow(z.ZodError)
    })

    it('throws ZodError when confirm is a string "true"', () => {
      expect(() =>
        deleteProjectSchema.parse({ projectKey: 'my-project', confirm: 'true' })
      ).toThrow(z.ZodError)
    })

    it('parses successfully when confirm is true', () => {
      const result = deleteProjectSchema.parse({ projectKey: 'my-project', confirm: true })
      expect(result.projectKey).toBe('my-project')
      expect(result.confirm).toBe(true)
    })

    it('throws ZodError when projectKey is empty', () => {
      expect(() =>
        deleteProjectSchema.parse({ projectKey: '', confirm: true })
      ).toThrow(z.ZodError)
    })
  })
})
