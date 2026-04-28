import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { updateHotspotStatusSchema } from '../tools/security.js'

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

describe('security tools', () => {
  describe('update_hotspot_status validation', () => {
    it('throws ZodError for empty comment', () => {
      expect(() =>
        updateHotspotStatusSchema.parse({ hotspotKey: 'HS-1', resolution: 'FIXED', comment: '' })
      ).toThrow(z.ZodError)
    })

    it('throws ZodError for whitespace-only comment', () => {
      expect(() =>
        updateHotspotStatusSchema.parse({ hotspotKey: 'HS-1', resolution: 'FIXED', comment: '   ' })
      ).toThrow(z.ZodError)
    })

    it('throws ZodError when comment is missing', () => {
      expect(() =>
        updateHotspotStatusSchema.parse({ hotspotKey: 'HS-1', resolution: 'FIXED' })
      ).toThrow(z.ZodError)
    })

    it('accepts valid inputs', () => {
      const result = updateHotspotStatusSchema.parse({
        hotspotKey: 'HS-1',
        resolution: 'SAFE',
        comment: 'Reviewed and confirmed safe',
      })
      expect(result.hotspotKey).toBe('HS-1')
      expect(result.resolution).toBe('SAFE')
      expect(result.comment).toBe('Reviewed and confirmed safe')
    })

    it('throws ZodError for invalid resolution value', () => {
      expect(() =>
        updateHotspotStatusSchema.parse({ hotspotKey: 'HS-1', resolution: 'INVALID', comment: 'valid' })
      ).toThrow(z.ZodError)
    })
  })
})
