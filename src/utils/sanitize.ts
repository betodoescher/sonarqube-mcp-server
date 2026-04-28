// Shell metacharacters that could enable command injection
const SHELL_METACHARACTERS = /[;&|><`$(){}\[\]\n\r\\]/

/**
 * Sanitizes a CLI input string by rejecting any string containing shell metacharacters.
 * Throws an error if the input contains dangerous characters.
 * Returns the value unchanged if it is safe.
 */
export function sanitizeCliInput(value: string, fieldName: string): string {
  if (SHELL_METACHARACTERS.test(value)) {
    throw new Error(
      `Invalid characters in field '${fieldName}': shell metacharacters are not allowed`
    )
  }
  return value
}
