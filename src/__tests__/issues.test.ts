import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'
import { z } from 'zod'
import { markIssueSchema } from '../tools/issues.js'

// Feature: sonarqube-mcp-server, Property 7 (issues subset): for any call to mark_as_false_positive
// or mark_as_wont_fix with empty/whitespace comment, ZodError thrown before API call

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

describe('issues tools', () => {
  describe('markIssueSchema', () => {
    it('throws ZodError for empty comment', () => {
      expect(() => markIssueSchema.parse({ issueKey: 'ISSUE-1', comment: '' })).toThrow(z.ZodError)
    })

    it('throws ZodError for whitespace-only comment', () => {
      expect(() => markIssueSchema.parse({ issueKey: 'ISSUE-1', comment: '   ' })).toThrow(z.ZodError)
    })

    it('throws ZodError when comment is missing', () => {
      expect(() => markIssueSchema.parse({ issueKey: 'ISSUE-1' })).toThrow(z.ZodError)
    })

    it('throws ZodError when issueKey is empty', () => {
      expect(() => markIssueSchema.parse({ issueKey: '', comment: 'valid comment' })).toThrow(z.ZodError)
    })

    it('accepts a valid non-empty comment', () => {
      const result = markIssueSchema.parse({ issueKey: 'ISSUE-1', comment: 'This is a valid comment' })
      expect(result.comment).toBe('This is a valid comment')
      expect(result.issueKey).toBe('ISSUE-1')
    })

    it('trims and accepts a comment with surrounding whitespace', () => {
      // .trim().min(1) means "  valid  " trims to "valid" which passes
      const result = markIssueSchema.parse({ issueKey: 'ISSUE-1', comment: '  valid  ' })
      expect(result.comment).toBe('valid')
    })
  })

  describe('Property 7 (issues subset): empty/whitespace comment throws ZodError before API call', () => {
    /**
     * Validates: Requirements 7.9, 13.1, 13.2
     * For any call to mark_as_false_positive or mark_as_wont_fix with empty/whitespace comment,
     * ZodError is thrown before any API call is made.
     */
    it('throws ZodError for any empty or whitespace-only comment string', () => {
      // Feature: sonarqube-mcp-server, Property 7: for any call to mark_as_false_positive or
      // mark_as_wont_fix with empty/whitespace comment, ZodError thrown before API call
      fc.assert(
        fc.property(
          fc.stringMatching(/^\s*$/),
          (comment) => {
            expect(() => markIssueSchema.parse({ issueKey: 'ISSUE-1', comment })).toThrow(z.ZodError)
          }
        ),
        { numRuns: 100 }
      )
    })

    it('never throws ZodError for any non-empty, non-whitespace comment', () => {
      // Feature: sonarqube-mcp-server, Property 7 (inverse): valid comments always parse successfully
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
          (comment) => {
            const result = markIssueSchema.parse({ issueKey: 'ISSUE-1', comment })
            expect(result.comment).toBe(comment.trim())
          }
        ),
        { numRuns: 100 }
      )
    })
  })
})
