import { z } from 'zod'

const envSchema = z.object({
  SONARQUBE_URL: z.string().url(),
  SONARQUBE_TOKEN: z.string().min(1),
  SONAR_SCAN_TIMEOUT_MS: z.coerce.number().positive().default(120000),
  SONAR_TASK_POLL_INTERVAL_MS: z.coerce.number().positive().default(3000),
  SONAR_COMPLEXITY_THRESHOLD: z.coerce.number().positive().default(15),
  SONAR_COVERAGE_MIN: z.coerce.number().min(0).max(100).default(80),
})

export type Config = z.infer<typeof envSchema>

export const config: Config = envSchema.parse(process.env)
