import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import * as fc from 'fast-check'

// We test the schema directly, not the module-level config (which reads process.env)
const envSchema = z.object({
  SONARQUBE_URL: z.string().url(),
  SONARQUBE_TOKEN: z.string().min(1),
  SONAR_SCAN_TIMEOUT_MS: z.coerce.number().positive().default(120000),
  SONAR_TASK_POLL_INTERVAL_MS: z.coerce.number().positive().default(3000),
  SONAR_COMPLEXITY_THRESHOLD: z.coerce.number().positive().default(15),
  SONAR_COVERAGE_MIN: z.coerce.number().min(0).max(100).default(80),
})

describe('config envSchema', () => {
  describe('unit tests', () => {
    it('parses a valid env correctly', () => {
      const result = envSchema.parse({
        SONARQUBE_URL: 'http://localhost:9000',
        SONARQUBE_TOKEN: 'mytoken123',
      })
      expect(result.SONARQUBE_URL).toBe('http://localhost:9000')
      expect(result.SONARQUBE_TOKEN).toBe('mytoken123')
      expect(result.SONAR_SCAN_TIMEOUT_MS).toBe(120000)
      expect(result.SONAR_TASK_POLL_INTERVAL_MS).toBe(3000)
      expect(result.SONAR_COMPLEXITY_THRESHOLD).toBe(15)
      expect(result.SONAR_COVERAGE_MIN).toBe(80)
    })

    it('throws ZodError when SONARQUBE_URL is missing', () => {
      expect(() =>
        envSchema.parse({ SONARQUBE_TOKEN: 'mytoken123' })
      ).toThrow(z.ZodError)
    })

    it('throws ZodError when SONARQUBE_TOKEN is missing', () => {
      expect(() =>
        envSchema.parse({ SONARQUBE_URL: 'http://localhost:9000' })
      ).toThrow(z.ZodError)
    })

    it('throws ZodError when SONARQUBE_URL is not a valid URL', () => {
      expect(() =>
        envSchema.parse({ SONARQUBE_URL: 'not-a-url', SONARQUBE_TOKEN: 'mytoken123' })
      ).toThrow(z.ZodError)
    })

    it('applies defaults when optional vars are absent', () => {
      const result = envSchema.parse({
        SONARQUBE_URL: 'http://localhost:9000',
        SONARQUBE_TOKEN: 'mytoken123',
      })
      expect(result.SONAR_SCAN_TIMEOUT_MS).toBe(120000)
      expect(result.SONAR_TASK_POLL_INTERVAL_MS).toBe(3000)
      expect(result.SONAR_COMPLEXITY_THRESHOLD).toBe(15)
      expect(result.SONAR_COVERAGE_MIN).toBe(80)
    })

    it('accepts custom values for optional vars', () => {
      const result = envSchema.parse({
        SONARQUBE_URL: 'http://localhost:9000',
        SONARQUBE_TOKEN: 'mytoken123',
        SONAR_SCAN_TIMEOUT_MS: '60000',
        SONAR_TASK_POLL_INTERVAL_MS: '5000',
        SONAR_COMPLEXITY_THRESHOLD: '20',
        SONAR_COVERAGE_MIN: '90',
      })
      expect(result.SONAR_SCAN_TIMEOUT_MS).toBe(60000)
      expect(result.SONAR_TASK_POLL_INTERVAL_MS).toBe(5000)
      expect(result.SONAR_COMPLEXITY_THRESHOLD).toBe(20)
      expect(result.SONAR_COVERAGE_MIN).toBe(90)
    })
  })

  describe('Property 1: missing required field always throws ZodError identifying the field', () => {
    // **Validates: Requirements 1.2**
    it('throws ZodError for any env missing SONARQUBE_URL', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1 }),
          (token) => {
            expect(() =>
              envSchema.parse({ SONARQUBE_TOKEN: token })
            ).toThrow(z.ZodError)
          }
        ),
        { numRuns: 100 }
      )
    })

    it('throws ZodError for any env missing SONARQUBE_TOKEN', () => {
      fc.assert(
        fc.property(
          fc.webUrl(),
          (url) => {
            expect(() =>
              envSchema.parse({ SONARQUBE_URL: url })
            ).toThrow(z.ZodError)
          }
        ),
        { numRuns: 100 }
      )
    })

    it('ZodError identifies the missing field', () => {
      try {
        envSchema.parse({ SONARQUBE_TOKEN: 'token' })
      } catch (e) {
        expect(e).toBeInstanceOf(z.ZodError)
        const zodErr = e as z.ZodError
        const paths = zodErr.issues.map((issue) => issue.path[0])
        expect(paths).toContain('SONARQUBE_URL')
      }
    })
  })

  describe('Property 2: only required fields → correct defaults applied', () => {
    // **Validates: Requirements 1.2**
    it('always applies correct defaults for any valid required-only env', () => {
      fc.assert(
        fc.property(
          fc.record({
            SONARQUBE_URL: fc.webUrl(),
            SONARQUBE_TOKEN: fc.string({ minLength: 1 }),
          }),
          (env) => {
            const result = envSchema.parse(env)
            expect(result.SONAR_SCAN_TIMEOUT_MS).toBe(120000)
            expect(result.SONAR_TASK_POLL_INTERVAL_MS).toBe(3000)
            expect(result.SONAR_COMPLEXITY_THRESHOLD).toBe(15)
            expect(result.SONAR_COVERAGE_MIN).toBe(80)
          }
        ),
        { numRuns: 100 }
      )
    })
  })
})
