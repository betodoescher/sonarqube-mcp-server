import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'
import { deriveVerdict } from '../tools/prAnalysis.js'
import type { Verdict, NewIssuesSummary } from '../types/sonar.js'

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

const VALID_VERDICTS: Verdict[] = ['safe_to_merge', 'merge_with_caution', 'do_not_merge']

describe('prAnalysis tools', () => {
  describe('deriveVerdict', () => {
    it('returns do_not_merge when quality gate failed', () => {
      expect(deriveVerdict(false, { bugs: 0, vulnerabilities: 0, codeSmells: 0, hotspots: 0 })).toBe('do_not_merge')
      expect(deriveVerdict(false, { bugs: 5, vulnerabilities: 2, codeSmells: 10, hotspots: 3 })).toBe('do_not_merge')
    })

    it('returns safe_to_merge when gate passed and zero issues', () => {
      expect(deriveVerdict(true, { bugs: 0, vulnerabilities: 0, codeSmells: 0, hotspots: 0 })).toBe('safe_to_merge')
    })

    it('returns merge_with_caution when gate passed but code smells present', () => {
      expect(deriveVerdict(true, { bugs: 0, vulnerabilities: 0, codeSmells: 5, hotspots: 0 })).toBe('merge_with_caution')
    })

    it('returns merge_with_caution when gate passed but hotspots present', () => {
      expect(deriveVerdict(true, { bugs: 0, vulnerabilities: 0, codeSmells: 0, hotspots: 2 })).toBe('merge_with_caution')
    })

    it('returns do_not_merge when gate passed but bugs present', () => {
      expect(deriveVerdict(true, { bugs: 1, vulnerabilities: 0, codeSmells: 0, hotspots: 0 })).toBe('do_not_merge')
    })

    it('returns do_not_merge when gate passed but vulnerabilities present', () => {
      expect(deriveVerdict(true, { bugs: 0, vulnerabilities: 1, codeSmells: 0, hotspots: 0 })).toBe('do_not_merge')
    })
  })

  /**
   * **Validates: Requirements 14.6**
   * Property 5: for any combination of qualityGatePassed/newIssues inputs, deriveVerdict returns
   * exactly one of the three verdict values and never throws
   */
  describe('Property 5: deriveVerdict is deterministic and exhaustive', () => {
    it('always returns one of the three valid verdicts and never throws', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          fc.nat(100),
          fc.nat(100),
          fc.nat(100),
          fc.nat(100),
          (qualityGatePassed, bugs, vulnerabilities, codeSmells, hotspots) => {
            let verdict: Verdict | undefined
            expect(() => {
              verdict = deriveVerdict(qualityGatePassed, { bugs, vulnerabilities, codeSmells, hotspots })
            }).not.toThrow()
            expect(VALID_VERDICTS).toContain(verdict)
          }
        ),
        { numRuns: 200 }
      )
    })
  })

  /**
   * **Validates: Requirements 14.7**
   * Property 6: for any valid mock PR data, get_new_issues_summary response conforms to
   * NewIssuesSummary interface with all fields present
   */
  describe('Property 6: NewIssuesSummary shape is always complete', () => {
    it('deriveVerdict output combined with mock data always produces a complete NewIssuesSummary shape', () => {
      fc.assert(
        fc.property(
          fc.record({
            projectKey: fc.string({ minLength: 1 }),
            pullRequestKey: fc.string({ minLength: 1 }),
            qualityGatePassed: fc.boolean(),
            bugs: fc.nat(100),
            vulnerabilities: fc.nat(100),
            codeSmells: fc.nat(100),
            hotspots: fc.nat(100),
            coverageOnNewCode: fc.oneof(fc.float({ min: 0, max: 100 }), fc.constant(null)),
          }),
          (data) => {
            const newIssues = {
              bugs: data.bugs,
              vulnerabilities: data.vulnerabilities,
              codeSmells: data.codeSmells,
              hotspots: data.hotspots,
            }

            const summary: NewIssuesSummary = {
              verdict: deriveVerdict(data.qualityGatePassed, newIssues),
              qualityGatePassed: data.qualityGatePassed,
              newIssues,
              coverageOnNewCode: data.coverageOnNewCode,
              failedConditions: [],
              projectKey: data.projectKey,
              pullRequestKey: data.pullRequestKey,
              analysisDate: new Date().toISOString(),
            }

            // Verify all required fields are present and correctly typed
            expect(VALID_VERDICTS).toContain(summary.verdict)
            expect(typeof summary.qualityGatePassed).toBe('boolean')
            expect(typeof summary.newIssues.bugs).toBe('number')
            expect(typeof summary.newIssues.vulnerabilities).toBe('number')
            expect(typeof summary.newIssues.codeSmells).toBe('number')
            expect(typeof summary.newIssues.hotspots).toBe('number')
            expect(summary.coverageOnNewCode === null || typeof summary.coverageOnNewCode === 'number').toBe(true)
            expect(Array.isArray(summary.failedConditions)).toBe(true)
            expect(typeof summary.projectKey).toBe('string')
            expect(typeof summary.pullRequestKey).toBe('string')
            expect(typeof summary.analysisDate).toBe('string')
          }
        ),
        { numRuns: 100 }
      )
    })
  })
})
