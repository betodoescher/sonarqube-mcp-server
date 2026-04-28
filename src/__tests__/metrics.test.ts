import { describe, it, expect, vi } from 'vitest'
import { sortByCoverageAscending, filterAboveThreshold, formatDebt, sqaleRating } from '../tools/metrics.js'

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

function makeComponent(key: string, coverage: string) {
  return { key, name: key, measures: [{ metric: 'coverage', value: coverage }] }
}

function makeComplexityComponent(key: string, complexity: string) {
  return { key, name: key, measures: [{ metric: 'complexity', value: complexity }] }
}

describe('metrics tools', () => {
  describe('sortByCoverageAscending', () => {
    it('returns files sorted ascending by coverage', () => {
      const components = [
        makeComponent('FileA.ts', '80'),
        makeComponent('FileB.ts', '20'),
        makeComponent('FileC.ts', '50'),
        makeComponent('FileD.ts', '10'),
      ]
      const result = sortByCoverageAscending(components, 10)
      expect(result.map((r) => r.file)).toEqual(['FileD.ts', 'FileB.ts', 'FileC.ts', 'FileA.ts'])
      expect(result[0].coverage).toBe(10)
    })

    it('respects the limit parameter', () => {
      const components = [
        makeComponent('A.ts', '90'),
        makeComponent('B.ts', '10'),
        makeComponent('C.ts', '50'),
        makeComponent('D.ts', '30'),
        makeComponent('E.ts', '70'),
      ]
      const result = sortByCoverageAscending(components, 3)
      expect(result).toHaveLength(3)
      expect(result[0].coverage).toBe(10)
    })

    it('returns empty array for empty input', () => {
      expect(sortByCoverageAscending([], 10)).toHaveLength(0)
    })
  })

  describe('filterAboveThreshold', () => {
    it('filters components above the complexity threshold', () => {
      const components = [
        makeComplexityComponent('A.ts', '5'),
        makeComplexityComponent('B.ts', '20'),
        makeComplexityComponent('C.ts', '15'),
        makeComplexityComponent('D.ts', '30'),
      ]
      const result = filterAboveThreshold(components, 15)
      expect(result).toHaveLength(2)
      expect(result.map((r) => r.file)).toContain('B.ts')
      expect(result.map((r) => r.file)).toContain('D.ts')
    })

    it('returns empty array when no components exceed threshold', () => {
      const components = [
        makeComplexityComponent('A.ts', '5'),
        makeComplexityComponent('B.ts', '10'),
      ]
      expect(filterAboveThreshold(components, 15)).toHaveLength(0)
    })

    it('sorts results descending by complexity', () => {
      const components = [
        makeComplexityComponent('A.ts', '20'),
        makeComplexityComponent('B.ts', '50'),
        makeComplexityComponent('C.ts', '30'),
      ]
      const result = filterAboveThreshold(components, 15)
      expect(result[0].complexity).toBe(50)
      expect(result[1].complexity).toBe(30)
      expect(result[2].complexity).toBe(20)
    })
  })

  describe('formatDebt', () => {
    it('formats minutes correctly', () => {
      expect(formatDebt(30)).toBe('30min')
      expect(formatDebt(90)).toBe('1h 30min')
      expect(formatDebt(480)).toBe('1d')
      expect(formatDebt(960)).toBe('2d')
    })
  })

  describe('sqaleRating', () => {
    it('returns correct rating for debt ratios', () => {
      expect(sqaleRating(0.03)).toBe('A')
      expect(sqaleRating(0.07)).toBe('B')
      expect(sqaleRating(0.15)).toBe('C')
      expect(sqaleRating(0.3)).toBe('D')
      expect(sqaleRating(0.6)).toBe('E')
    })
  })
})
