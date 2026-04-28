import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { sanitizeCliInput } from '../utils/sanitize.js'

// Feature: sonarqube-mcp-server, Property 4: for any string containing a shell metacharacter, sanitizeCliInput throws; for clean strings it returns the value unchanged

const METACHARACTERS = [';', '&', '|', '>', '<', '`', '$', '(', ')', '{', '}', '[', ']', '\n', '\r', '\\']

describe('sanitizeCliInput', () => {
  describe('unit tests', () => {
    it('returns clean strings unchanged', () => {
      expect(sanitizeCliInput('my-project', 'projectKey')).toBe('my-project')
      expect(sanitizeCliInput('main', 'branch')).toBe('main')
      expect(sanitizeCliInput('feature/my-feature', 'branch')).toBe('feature/my-feature')
    })

    it.each(METACHARACTERS)('throws for string containing metacharacter: %s', (char) => {
      expect(() => sanitizeCliInput(`value${char}injection`, 'field')).toThrow()
    })

    it('throws for string that is only a metacharacter', () => {
      expect(() => sanitizeCliInput(';', 'field')).toThrow()
    })
  })

  describe('Property 4: shell metacharacter sanitization', () => {
    /**
     * Validates: Requirements 1.2
     */
    it('throws for any string containing at least one shell metacharacter', () => {
      const metacharArb = fc.constantFrom(...METACHARACTERS)
      fc.assert(
        fc.property(
          fc.string(),
          metacharArb,
          fc.string(),
          (prefix, meta, suffix) => {
            const input = prefix + meta + suffix
            expect(() => sanitizeCliInput(input, 'testField')).toThrow()
          }
        ),
        { numRuns: 200 }
      )
    })

    /**
     * Validates: Requirements 1.2
     */
    it('returns clean strings unchanged for any string without metacharacters', () => {
      // Generate strings that only contain safe characters
      const safeCharArb = fc.stringMatching(/^[a-zA-Z0-9\-_./:@]+$/)
      fc.assert(
        fc.property(safeCharArb, (input) => {
          expect(sanitizeCliInput(input, 'testField')).toBe(input)
        }),
        { numRuns: 200 }
      )
    })
  })
})
