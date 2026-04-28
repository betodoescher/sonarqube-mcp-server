import axios, {
  AxiosInstance,
  InternalAxiosRequestConfig,
  AxiosResponse,
  AxiosError,
} from 'axios'
import { config as defaultConfig } from './config.js'

export interface LogEntry {
  method: string
  url: string
  status: number
  duration: number
}

interface RetryConfig extends InternalAxiosRequestConfig {
  _retryCount?: number
  _startTime?: number
}

const DEFAULT_RETRY_DELAYS = [1000, 2000, 4000]
const MAX_RETRIES = 3

export function createSonarClient(
  options: {
    baseURL?: string
    token?: string
    onLog?: (entry: LogEntry) => void
    retryDelays?: number[]
  } = {}
): AxiosInstance {
  const baseURL = options.baseURL ?? defaultConfig.SONARQUBE_URL
  const token = options.token ?? defaultConfig.SONARQUBE_TOKEN
  const onLog =
    options.onLog ??
    ((entry: LogEntry) => console.log(JSON.stringify(entry)))
  const retryDelays = options.retryDelays ?? DEFAULT_RETRY_DELAYS

  const client = axios.create({
    baseURL,
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  })

  // Request interceptor: attach auth header, record start time — token never logged
  client.interceptors.request.use((req: RetryConfig) => {
    req.headers['Authorization'] = `Bearer ${token}`
    req._startTime = Date.now()
    return req
  })

  // Response interceptor: log metadata (no token), handle retries on 429/5xx
  client.interceptors.response.use(
    (response: AxiosResponse) => {
      const req = response.config as RetryConfig
      const duration = Date.now() - (req._startTime ?? Date.now())
      onLog({
        method: (req.method ?? 'UNKNOWN').toUpperCase(),
        url: req.url ?? '',
        status: response.status,
        duration,
      })
      return response
    },
    async (error: AxiosError) => {
      const req = error.config as RetryConfig | undefined
      if (!req) return Promise.reject(error)

      const status = error.response?.status ?? 0
      const shouldRetry = status === 429 || (status >= 500 && status < 600)

      req._retryCount = req._retryCount ?? 0

      if (shouldRetry && req._retryCount < MAX_RETRIES) {
        const delay = retryDelays[req._retryCount] ?? 4000
        req._retryCount++
        await new Promise((resolve) => setTimeout(resolve, delay))
        return client(req)
      }

      // Log failed request after retries exhausted
      const duration = Date.now() - (req._startTime ?? Date.now())
      onLog({
        method: (req.method ?? 'UNKNOWN').toUpperCase(),
        url: req.url ?? '',
        status,
        duration,
      })

      if (error.response) {
        return Promise.reject({
          status: error.response.status,
          message: `Request failed with status ${error.response.status}`,
        })
      }
      return Promise.reject(error)
    }
  )

  return client
}

export const sonarClient = createSonarClient()
