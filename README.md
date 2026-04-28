# SonarQube MCP Server

A Node.js/TypeScript MCP (Model Context Protocol) server that exposes SonarQube Web API v10+ as callable tools for AI agents (Claude Desktop, Kiro, etc.).

## Prerequisites

- Node.js >= 18
- A running SonarQube instance (v10+) accessible via HTTP/HTTPS
- A SonarQube authentication token

## Installation

```bash
npm install
npm run build
```

## SonarQube Token Generation

Go to **SonarQube → My Account → Security → Generate Tokens**.

Minimum required permissions per tool category:

| Category | Required Permission |
|---|---|
| Analysis (run_analysis, analyze_and_wait) | Execute Analysis + Browse |
| Quality Gates | Browse |
| Metrics | Browse |
| Issues (read) | Browse |
| Issues (assign, comment, transition) | Browse + Administer Issues |
| Security Hotspots (read) | Browse |
| Security Hotspots (update status) | Browse + Administer Security Hotspots |
| Projects (list, get) | Browse |
| Projects (create, delete) | Administer (global) |
| Rules / Quality Profiles | Browse |
| Reports | Browse |
| PR Analysis | Browse |

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `SONARQUBE_URL` | ✅ | — | SonarQube server URL, e.g. `http://localhost:9000` |
| `SONARQUBE_TOKEN` | ✅ | — | Authentication token |
| `SONAR_SCAN_TIMEOUT_MS` | ❌ | `120000` | Scanner timeout in milliseconds |
| `SONAR_TASK_POLL_INTERVAL_MS` | ❌ | `3000` | Polling interval for task status in milliseconds |
| `SONAR_COMPLEXITY_THRESHOLD` | ❌ | `15` | Cyclomatic complexity threshold for `get_complexity` |
| `SONAR_COVERAGE_MIN` | ❌ | `80` | Minimum coverage percentage for coverage checks |

## MCP Client Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "sonarqube": {
      "command": "node",
      "args": ["/absolute/path/to/MCP-sonarqube/dist/index.js"],
      "env": {
        "SONARQUBE_URL": "http://localhost:9000",
        "SONARQUBE_TOKEN": "your_token_here"
      }
    }
  }
}
```

### Kiro

Add to your Kiro MCP settings:

```json
{
  "mcpServers": {
    "sonarqube": {
      "command": "node",
      "args": ["/absolute/path/to/MCP-sonarqube/dist/index.js"],
      "env": {
        "SONARQUBE_URL": "http://localhost:9000",
        "SONARQUBE_TOKEN": "your_token_here"
      }
    }
  }
}
```

## Tools Reference

### Analysis

| Tool | Description | Required Params |
|---|---|---|
| `run_analysis` | Trigger a SonarQube analysis | `projectKey`, `projectName`, `sourceDir` |
| `get_task_status` | Poll background task status | `taskId` |
| `analyze_and_wait` | Trigger analysis and wait for result | `projectKey`, `projectName`, `sourceDir` |

### Quality Gates

| Tool | Description | Required Params |
|---|---|---|
| `get_quality_gate_status` | Get pass/fail status and conditions | `projectKey` |
| `get_quality_gate_history` | Time-ordered gate status history | `projectKey` |
| `compare_quality_gates` | Compare two branches side by side | `projectKey`, `branchA`, `branchB` |
| `list_quality_gates` | List all gate definitions | — |
| `get_project_quality_gate` | Get gate assigned to a project | `projectKey` |

### Metrics

| Tool | Description | Required Params |
|---|---|---|
| `get_coverage` | Line and branch coverage | `projectKey` |
| `get_coverage_breakdown` | Files with lowest coverage | `projectKey` |
| `get_duplications` | Duplication percentage and top files | `projectKey` |
| `get_complexity` | Cyclomatic complexity and hotspots | `projectKey` |
| `get_technical_debt` | SQALE debt in hours/days | `projectKey` |
| `get_all_metrics` | All metrics in one call | `projectKey` |
| `get_metrics_history` | Time-series for requested metrics | `projectKey`, `metrics` |

### Issues

| Tool | Description | Required Params |
|---|---|---|
| `list_issues` | Paginated, filtered issue list | `projectKey` |
| `get_issue_detail` | Full detail for one issue | `issueKey` |
| `get_top_issues_by_file` | Files ranked by issue count | `projectKey` |
| `assign_issue` | Assign issue to a user | `issueKey`, `assignee` |
| `mark_as_false_positive` | Transition + comment | `issueKey`, `comment` |
| `mark_as_wont_fix` | Transition + comment | `issueKey`, `comment` |
| `add_issue_comment` | Add a comment | `issueKey`, `text` |
| `bulk_change_issues` | Bulk action on matching issues | `action` |

### Security Hotspots

| Tool | Description | Required Params |
|---|---|---|
| `list_security_hotspots` | List hotspots with filters | `projectKey` |
| `get_hotspot_detail` | Risk, description, remediation | `hotspotKey` |
| `get_security_rating` | A–E rating + hotspot breakdown | `projectKey` |
| `get_hotspots_by_category` | Grouped by OWASP/CWE/SANS | `projectKey` |
| `update_hotspot_status` | Change resolution + comment | `hotspotKey`, `resolution`, `comment` |

### Projects

| Tool | Description | Required Params |
|---|---|---|
| `list_projects` | Paginated project list with metrics | — |
| `get_project` | Full project details | `projectKey` |
| `create_project` | Create a new project | `projectKey`, `name`, `visibility` |
| `delete_project` | Delete a project (requires confirm) | `projectKey`, `confirm: true` |
| `set_project_quality_gate` | Associate a gate with a project | `projectKey`, `qualityGateId` |
| `get_project_branches` | All analyzed branches | `projectKey` |
| `delete_branch` | Remove an analyzed branch | `projectKey`, `branch` |

### Rules & Quality Profiles

| Tool | Description | Required Params |
|---|---|---|
| `list_quality_profiles` | All profiles grouped by language | — |
| `get_active_rules` | Active rules in a profile | `profileKey` |
| `search_rules` | Search rules by query | `query` |

### Reports & Rankings

| Tool | Description | Required Params |
|---|---|---|
| `get_portfolio_report` | Portfolio-wide quality summary | — |
| `get_project_ranking` | Projects sorted by criterion | `sortBy` |
| `get_new_code_summary` | New code metrics for a project | `projectKey` |

### PR Analysis

| Tool | Description | Required Params |
|---|---|---|
| `get_pr_analysis_result` | Quality gate + issues for a PR | `projectKey`, `pullRequestKey` |
| `get_new_issues_summary` | Merge verdict + new issues summary | `projectKey`, `pullRequestKey` |
| `list_pr_analyses` | All PR analyses for a project | `projectKey` |

## End-to-End Workflow Example

```
1. run_analysis
   → { taskId: "AY..." }

2. get_task_status(taskId)
   → { status: "SUCCESS" }
   (or use analyze_and_wait to do steps 1+2 automatically)

3. get_quality_gate_status(projectKey)
   → { status: "OK", conditions: [...] }

4. list_issues(projectKey, newCodeOnly: true)
   → { issues: [...], total: 3 }
```

Or in a single call:

```
analyze_and_wait(projectKey, projectName, sourceDir)
→ { status: "SUCCESS", qualityGate: { status: "OK", conditions: [...] } }
```

## Azure DevOps Integration

The `get_new_issues_summary` tool returns a stable typed shape (`NewIssuesSummary`) designed for consumption by an Azure DevOps MCP server in PR gate flows. The `verdict` field (`safe_to_merge` | `merge_with_caution` | `do_not_merge`) can be used directly to set PR status policies.

## Development

```bash
npm run dev        # watch mode
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint
npm test           # vitest --run
npm run build      # tsup → dist/
```
