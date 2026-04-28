import { describe, it, expect, vi } from 'vitest'

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

import { diffConditions } from '../tools/qualityGate.js'

describe('qualityGate tools', () => {
  describe('compare_quality_gates - diffConditions', () => {
    it('identifies conditions where status differs between branches', () => {
      const conditionsA = [
        { metricKey: 'coverage', status: 'OK' },
        { metricKey: 'bugs', status: 'ERROR' },
        { metricKey: 'duplications', status: 'OK' },
      ]
      const conditionsB = [
        { metricKey: 'coverage', status: 'ERROR' },
        { metricKey: 'bugs', status: 'ERROR' },
        { metricKey: 'duplications', status: 'OK' },
      ]

      const diffs = diffConditions(conditionsA, conditionsB)

      expect(diffs).toHaveLength(1)
      expect(diffs[0]).toEqual({ metricKey: 'coverage', statusA: 'OK', statusB: 'ERROR' })
    })

    it('returns empty array when all conditions match', () => {
      const conditions = [
        { metricKey: 'coverage', status: 'OK' },
        { metricKey: 'bugs', status: 'ERROR' },
      ]
      expect(diffConditions(conditions, conditions)).toHaveLength(0)
    })

    it('returns empty array when conditions arrays are empty', () => {
      expect(diffConditions([], [])).toHaveLength(0)
    })

    it('ignores metrics present in A but not in B', () => {
      const conditionsA = [{ metricKey: 'coverage', status: 'OK' }]
      const conditionsB: Array<{ metricKey: string; status: string }> = []
      expect(diffConditions(conditionsA, conditionsB)).toHaveLength(0)
    })

    it('identifies multiple differing conditions', () => {
      const conditionsA = [
        { metricKey: 'coverage', status: 'OK' },
        { metricKey: 'bugs', status: 'OK' },
        { metricKey: 'vulnerabilities', status: 'OK' },
      ]
      const conditionsB = [
        { metricKey: 'coverage', status: 'ERROR' },
        { metricKey: 'bugs', status: 'ERROR' },
        { metricKey: 'vulnerabilities', status: 'OK' },
      ]
      const diffs = diffConditions(conditionsA, conditionsB)
      expect(diffs).toHaveLength(2)
    })
  })
})
