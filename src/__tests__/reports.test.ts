import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'
import { aggregatePortfolioMetrics, sortProjectsByCriterion } from '../tools/reports.js'

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

function makeProject(key: string, metrics: Record<string, string>) {
  return {
    key,
    name: key,
    measures: Object.entries(metrics).map(([metric, value]) => ({ metric, value })),
  }
}

describe('reports tools', () => {
  /**
   * **Validates: Requirements 13.5**
   * Property 8: for any array of mock project metrics, get_portfolio_report totals equal arithmetic sum of inputs
   */
  describe('Property 8: portfolio report totals equal arithmetic sum of inputs', () => {
    it('totalBugs, totalVulnerabilities, totalCodeSmells, totalHotspots, totalDebtMinutes equal sum of inputs', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              bugs: fc.nat(1000),
              vulnerabilities: fc.nat(1000),
              code_smells: fc.nat(1000),
              security_hotspots: fc.nat(1000),
              sqale_index: fc.nat(100000),
            }),
            { minLength: 0, maxLength: 20 }
          ),
          (projectData) => {
            const projects = projectData.map((data, i) =>
              makeProject(`project-${i}`, {
                bugs: String(data.bugs),
                vulnerabilities: String(data.vulnerabilities),
                code_smells: String(data.code_smells),
                security_hotspots: String(data.security_hotspots),
                sqale_index: String(data.sqale_index),
              })
            )

            const result = aggregatePortfolioMetrics(projects)

            const expectedBugs = projectData.reduce((sum, p) => sum + p.bugs, 0)
            const expectedVulns = projectData.reduce((sum, p) => sum + p.vulnerabilities, 0)
            const expectedSmells = projectData.reduce((sum, p) => sum + p.code_smells, 0)
            const expectedHotspots = projectData.reduce((sum, p) => sum + p.security_hotspots, 0)
            const expectedDebt = projectData.reduce((sum, p) => sum + p.sqale_index, 0)

            expect(result.totalBugs).toBe(expectedBugs)
            expect(result.totalVulnerabilities).toBe(expectedVulns)
            expect(result.totalCodeSmells).toBe(expectedSmells)
            expect(result.totalHotspots).toBe(expectedHotspots)
            expect(result.totalDebtMinutes).toBe(expectedDebt)
          }
        ),
        { numRuns: 100 }
      )
    })

    it('top5ByDebt contains at most 5 projects', () => {
      const projects = Array.from({ length: 10 }, (_, i) =>
        makeProject(`project-${i}`, { sqale_index: String(i * 100) })
      )
      const result = aggregatePortfolioMetrics(projects)
      expect(result.top5ByDebt).toHaveLength(5)
    })

    it('qualityGatePassRate is 100 when all projects pass', () => {
      const projects = [
        makeProject('a', { alert_status: 'OK' }),
        makeProject('b', { alert_status: 'OK' }),
      ]
      expect(aggregatePortfolioMetrics(projects).qualityGatePassRate).toBe(100)
    })

    it('qualityGatePassRate is 0 for empty project list', () => {
      expect(aggregatePortfolioMetrics([]).qualityGatePassRate).toBe(0)
    })
  })

  describe('get_project_ranking sort logic', () => {
    const projects = [
      makeProject('a', { coverage: '80', sqale_index: '100', security_rating: '2', reliability_rating: '3', sqale_rating: '1' }),
      makeProject('b', { coverage: '50', sqale_index: '500', security_rating: '1', reliability_rating: '1', sqale_rating: '3' }),
      makeProject('c', { coverage: '95', sqale_index: '50', security_rating: '3', reliability_rating: '2', sqale_rating: '2' }),
    ]

    it('sorts by coverage descending (higher is better)', () => {
      const sorted = sortProjectsByCriterion(projects, 'coverage')
      expect(sorted[0].key).toBe('c') // 95%
      expect(sorted[1].key).toBe('a') // 80%
      expect(sorted[2].key).toBe('b') // 50%
    })

    it('sorts by technical_debt ascending (lower is better)', () => {
      const sorted = sortProjectsByCriterion(projects, 'technical_debt')
      expect(sorted[0].key).toBe('c') // 50 min
      expect(sorted[1].key).toBe('a') // 100 min
      expect(sorted[2].key).toBe('b') // 500 min
    })

    it('sorts by security_rating ascending (lower rating number is better)', () => {
      const sorted = sortProjectsByCriterion(projects, 'security_rating')
      expect(sorted[0].key).toBe('b') // rating 1 (A)
      expect(sorted[1].key).toBe('a') // rating 2 (B)
      expect(sorted[2].key).toBe('c') // rating 3 (C)
    })

    it('sorts by reliability_rating ascending (lower rating number is better)', () => {
      const sorted = sortProjectsByCriterion(projects, 'reliability_rating')
      expect(sorted[0].key).toBe('b') // rating 1
      expect(sorted[1].key).toBe('c') // rating 2
      expect(sorted[2].key).toBe('a') // rating 3
    })

    it('sorts by maintainability_rating ascending (lower rating number is better)', () => {
      const sorted = sortProjectsByCriterion(projects, 'maintainability_rating')
      expect(sorted[0].key).toBe('a') // sqale_rating 1
      expect(sorted[1].key).toBe('c') // sqale_rating 2
      expect(sorted[2].key).toBe('b') // sqale_rating 3
    })

    it('does not mutate the original array', () => {
      const original = [...projects]
      sortProjectsByCriterion(projects, 'coverage')
      expect(projects).toEqual(original)
    })
  })
})
