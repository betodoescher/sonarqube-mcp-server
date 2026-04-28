export type TaskStatus = 'IN_QUEUE' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED' | 'CANCELLED'
export type Rating = 'A' | 'B' | 'C' | 'D' | 'E'
export type Visibility = 'public' | 'private'
export type IssueType = 'BUG' | 'VULNERABILITY' | 'CODE_SMELL' | 'SECURITY_HOTSPOT'
export type Severity = 'BLOCKER' | 'CRITICAL' | 'MAJOR' | 'MINOR' | 'INFO'
export type HotspotStatus = 'TO_REVIEW' | 'REVIEWED'
export type HotspotResolution = 'FIXED' | 'SAFE' | 'ACKNOWLEDGED'
export type BulkAction = 'assign' | 'set_severity' | 'set_type' | 'do_transition'
export type SortBy =
  | 'quality_gate'
  | 'security_rating'
  | 'reliability_rating'
  | 'maintainability_rating'
  | 'coverage'
  | 'technical_debt'
export type Verdict = 'safe_to_merge' | 'merge_with_caution' | 'do_not_merge'

export interface QualityGateCondition {
  metric: string
  operator: string
  value: string
  status: 'OK' | 'ERROR'
  threshold: string
}

export interface QualityGateStatus {
  status: 'OK' | 'ERROR' | 'NONE'
  conditions: QualityGateCondition[]
}

export interface TaskResult {
  taskId: string
  status: TaskStatus
  progress?: number
  errorMessage?: string
}

export interface Issue {
  key: string
  rule: string
  severity: Severity
  type: IssueType
  component: string
  line?: number
  message: string
  effort?: string
  status: string
  assignee?: string
  author?: string
  tags: string[]
  creationDate: string
}

export interface Hotspot {
  key: string
  component: string
  securityCategory: string
  vulnerabilityProbability: string
  status: HotspotStatus
  resolution?: HotspotResolution
  line?: number
  message: string
}

export interface Project {
  key: string
  name: string
  visibility: Visibility
  lastAnalysisDate?: string
  qualityGate?: string
  measures?: Record<string, string>
}

// Azure DevOps integration contract — stable shape
export interface NewIssuesSummary {
  verdict: Verdict
  qualityGatePassed: boolean
  newIssues: {
    bugs: number
    vulnerabilities: number
    codeSmells: number
    hotspots: number
  }
  coverageOnNewCode: number | null
  failedConditions: Array<{ metric: string; actual: string; threshold: string }>
  projectKey: string
  pullRequestKey: string
  analysisDate: string
}
