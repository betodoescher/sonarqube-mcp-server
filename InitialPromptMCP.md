# SonarQube MCP Server

## Contexto
Crie um MCP Server completo para integração com SonarQube Server (self-hosted) no diretório `#SonarQube`.

A instância SonarQube é acessada via `SONARQUBE_URL` (ex: `http://sonarqube.ecoagro-tech.internal`).
A autenticação é via token de usuário no header `Authorization: Bearer `.
A API alvo é a **SonarQube Web API v10+** (`/api/*`).

**Nota de integração futura:** este MCP será integrado ao Azure DevOps MCP já existente para fluxos de PR gate. Projete as interfaces de forma que essa integração seja simples de adicionar — sem acoplamento direto agora, mas com contratos claros (ex: tool `analyze_and_gate` deve retornar estrutura que um orquestrador externo consiga consumir facilmente).

---

## Stack e Requisitos Técnicos

- **Runtime:** Node.js 20+ com TypeScript (strict mode)
- **MCP SDK:** `@modelcontextprotocol/sdk` (versão mais recente)
- **HTTP Client:** `axios` com interceptors para retry e timeout
- **Validação:** `zod` para todos os schemas de input/output
- **Scanner:** invocar `sonar-scanner` via `child_process.spawn` (deve estar instalado no host ou via `sonarqube-scanner` npm package como dependência)
- **Qualidade:** ESLint + Prettier configurados
- **Build:** `tsup` para bundling

---

## Segurança (crítico)

1. O token jamais deve estar hardcoded — ler **apenas** via variável de ambiente `SONARQUBE_TOKEN`
2. Criar `.env.example` com todas as variáveis documentadas
3. Adicionar `.env` e `*.env` no `.gitignore`
4. Módulo `config.ts` centralizado com `zod` que valida todas as envs na inicialização — falha com mensagem clara se ausente
5. Nunca logar o valor do token, nem parcialmente
6. Sanitizar todos os inputs antes de passar para a API ou CLI

---

## Estrutura de Diretórios

```
SonarQube/
├── src/
│   ├── index.ts              # entrypoint MCP
│   ├── config.ts             # validação de envs com zod
│   ├── sonarClient.ts        # cliente axios com retry/timeout/auth
│   ├── scanner.ts            # wrapper para sonar-scanner CLI
│   ├── tools/
│   │   ├── analysis.ts       # disparo de análise e polling de task
│   │   ├── qualityGate.ts    # status e histórico de quality gates
│   │   ├── metrics.ts        # cobertura, duplicações, complexidade, dívida
│   │   ├── issues.ts         # listagem, filtros e gestão de issues
│   │   ├── security.ts       # hotspots e vulnerabilidades
│   │   ├── projects.ts       # gestão de projetos
│   │   ├── rules.ts          # quality profiles e regras
│   │   ├── reports.ts        # relatórios consolidados e rankings
│   │   └── prAnalysis.ts     # análise focada em new code / PR
│   └── types/
│       └── sonar.ts          # tipos compartilhados
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── eslint.config.js
└── README.md
```

---

## Ferramentas MCP a Implementar

### 1. Análise & Disparo (analysis.ts + scanner.ts)
- `run_analysis` — dispara o sonar-scanner para um projeto local. Parâmetros: `projectKey`, `projectName`, `sourceDir`, `branch` (opcional), `pullRequestKey` + `pullRequestBranch` + `pullRequestBase` (opcionais para análise de PR). Internamente usa `sonarqube-scanner` npm ou spawn do CLI. Retorna o `taskId` gerado.
- `get_task_status` — consulta o status de um background task pelo `taskId` (IN_QUEUE, IN_PROGRESS, SUCCESS, FAILED, CANCELLED). Retorna progresso e mensagem de erro se falhou.
- `analyze_and_wait` — combina `run_analysis` + polling de `get_task_status` até conclusão (timeout configurável via env). Retorna status final da task + quality gate logo em seguida. Essa é a tool principal para uso em agentes — dispara, aguarda e já devolve o resultado consolidado.

### 2. Quality Gate (qualityGate.ts)
- `get_quality_gate_status` — status atual do quality gate de um projeto/branch. Retorna: passed/failed, lista de condições com valor atual vs threshold, e qual métrica falhou.
- `get_quality_gate_history` — histórico de status do quality gate ao longo do tempo (por análises anteriores). Parâmetros: `projectKey`, `branch`, `limit`.
- `compare_quality_gates` — compara quality gate entre duas branches de um mesmo projeto. Útil para ver se um branch introduziu regressão.
- `list_quality_gates` — lista todos os quality gates configurados na instância com suas condições.
- `get_project_quality_gate` — qual quality gate está associado a um projeto específico.

### 3. Métricas (metrics.ts)
- `get_coverage` — cobertura de código do projeto: % geral, linhas cobertas, linhas a cobrir, % de branches cobertos. Suporte a filtro por `component` (pasta/módulo específico).
- `get_coverage_breakdown` — cobertura por arquivo — retorna os N arquivos com menor cobertura (útil para priorizar testes).
- `get_duplications` — % duplicação geral, linhas duplicadas, blocos duplicados e top arquivos mais duplicados.
- `get_complexity` — complexidade ciclomática total, média por função e lista de funções acima de um threshold configurável.
- `get_technical_debt` — technical debt total em minutos/horas/dias, SQALE rating (A–E) e debt ratio (%).
- `get_all_metrics` — retorna todas as métricas principais de um projeto em uma única chamada (cobertura, duplicações, complexidade, dívida, bugs, vulnerabilidades, code smells, reliability/security/maintainability ratings). Ideal para dashboards.
- `get_metrics_history` — evolução temporal de uma ou mais métricas. Parâmetros: `projectKey`, `metrics[]`, `from`, `to`.

### 4. Issues & Code Smells (issues.ts)
- `list_issues` — lista issues com filtros completos: `projectKey`, `types[]` (BUG, VULNERABILITY, CODE_SMELL, SECURITY_HOTSPOT), `severities[]` (BLOCKER, CRITICAL, MAJOR, MINOR, INFO), `statuses[]`, `assignee`, `author`, `componentKeys[]` (arquivos específicos), `tags[]`, `branch`, `newCodeOnly` (boolean — só new code), `page`, `pageSize`.
- `get_issue_detail` — detalhes completos de uma issue pelo `issueKey`: regra, localização, mensagem, esforço de remediação, fluxo de código.
- `get_top_issues_by_file` — top N arquivos com mais issues, agrupados por tipo e severidade.
- `assign_issue` — atribui uma issue a um usuário do SonarQube. Parâmetros: `issueKey`, `assignee` (login).
- `mark_as_false_positive` — marca uma issue como false positive com comentário obrigatório explicando o motivo.
- `mark_as_wont_fix` — marca uma issue como won't fix com comentário obrigatório.
- `add_issue_comment` — adiciona um comentário em uma issue.
- `bulk_change_issues` — altera status/assignee/tags em múltiplas issues de uma vez. Parâmetros: `issueKeys[]` ou filtros (mesmo interface do `list_issues`), `action` (assign, set_severity, set_type, do_transition), `actionParameters`.

### 5. Security Hotspots (security.ts)
- `list_security_hotspots` — lista hotspots com filtros: `projectKey`, `status` (TO_REVIEW, REVIEWED), `resolution` (FIXED, SAFE, ACKNOWLEDGED), `branch`, `newCodeOnly`.
- `get_hotspot_detail` — detalhes de um hotspot: categoria de risco, descrição, código vulnerável, recomendação.
- `get_security_rating` — security rating atual (A–E) e breakdown por severidade.
- `get_hotspots_by_category` — hotspots agrupados por categoria OWASP Top 10 / CWE / SANS Top 25.
- `update_hotspot_status` — atualiza status de um hotspot para REVIEWED com resolução (FIXED, SAFE, ACKNOWLEDGED) e comentário.

### 6. Projetos (projects.ts)
- `list_projects` — lista todos os projetos da instância com métricas resumidas (quality gate status, last analysis date, bugs, vulnerabilities, code smells, coverage). Suporte a paginação e filtro por nome.
- `get_project` — detalhes completos de um projeto.
- `create_project` — cria um novo projeto. Parâmetros: `projectKey`, `name`, `visibility` (public/private).
- `delete_project` — remove um projeto (requer confirmação explícita no input: `confirm: true`).
- `set_project_quality_gate` — associa um quality gate a um projeto.
- `get_project_branches` — lista branches analisadas de um projeto com status de quality gate por branch.
- `delete_branch` — remove uma branch analisada de um projeto.

### 7. Quality Profiles & Regras (rules.ts)
- `list_quality_profiles` — lista quality profiles da instância por linguagem.
- `get_active_rules` — regras ativas em um quality profile. Parâmetros: `profileKey`, `languages[]`, `types[]`, `severities[]`, `page`, `pageSize`.
- `search_rules` — busca regras disponíveis por texto, tag, tipo, severidade ou linguagem.

### 8. Relatórios & Rankings (reports.ts)
- `get_portfolio_report` — relatório consolidado de todos os projetos da instância: quality gate status geral, ratings médios, total de bugs/vulnerabilidades/code smells/hotspots, top 5 projetos com mais dívida técnica. Exportável em Markdown ou JSON.
- `get_project_ranking` — ranking de projetos por qualidade. Critérios de ordenação configuráveis: quality gate status, security rating, reliability rating, maintainability rating, coverage, technical debt. Retorna tabela rankeada.
- `get_new_code_summary` — resumo de qualidade apenas do new code (código novo desde o período de referência configurado): issues novas, cobertura do novo código, duplicações novas. Ideal para relatórios de sprint.

### 9. Análise de PR / New Code (prAnalysis.ts)
- `get_pr_analysis_result` — resultado completo de uma análise de PR: quality gate status, issues introduzidas no PR (agrupadas por tipo e severidade), cobertura do novo código, arquivos com mais issues novas. Parâmetros: `projectKey`, `pullRequestKey`.
- `get_new_issues_summary` — resumo das issues introduzidas em uma branch vs base, com veredicto textual: "safe to merge", "merge with caution" ou "do not merge" baseado nas condições do quality gate. Estrutura de retorno desenhada para consumo futuro pelo Azure DevOps MCP.
- `list_pr_analyses` — lista análises de PR de um projeto com status de quality gate por PR.

---

## Padrões de Implementação

### Cliente HTTP (sonarClient.ts)
- Instância axios com `baseURL`, header `Authorization: Bearer` e `Content-Type` configurados
- Interceptor de retry automático (3 tentativas, backoff exponencial) para erros 429 e 5xx
- Timeout de 30s por request
- Interceptor de log estruturado (nunca logar o token)

### Scanner Wrapper (scanner.ts)
- Usar o pacote npm `sonarqube-scanner` como dependência para não depender de instalação manual
- Retornar `taskId` do arquivo `.scannerwork/report-task.txt` gerado após o scan
- Timeout configurável via env `SONAR_SCAN_TIMEOUT_MS` (default: 120000ms)
- Tratar erros de compilação/scan e retornar mensagens claras

### Config (config.ts)
```typescript
const envSchema = z.object({
  SONARQUBE_URL: z.string().url(),
  SONARQUBE_TOKEN: z.string().min(1),
  SONAR_SCAN_TIMEOUT_MS: z.coerce.number().default(120000),
  SONAR_TASK_POLL_INTERVAL_MS: z.coerce.number().default(3000),
  SONAR_COMPLEXITY_THRESHOLD: z.coerce.number().default(15),
  SONAR_COVERAGE_MIN: z.coerce.number().default(80),
})
export const config = envSchema.parse(process.env)
```

### Contrato de integração futura (Azure DevOps)
A tool `get_new_issues_summary` deve retornar sempre este shape para facilitar a integração futura:
```typescript
{
  verdict: 'safe_to_merge' | 'merge_with_caution' | 'do_not_merge',
  qualityGatePassed: boolean,
  newIssues: { bugs: number, vulnerabilities: number, codeSmells: number, hotspots: number },
  coverageOnNewCode: number | null,
  failedConditions: Array<{ metric: string, actual: string, threshold: string }>,
  projectKey: string,
  pullRequestKey: string,
  analysisDate: string,
}
```

---

## README.md

Deve conter:
1. Pré-requisitos e instalação (`npm install`)
2. Como gerar o token no SonarQube (Administration → Security → Users → Tokens) com permissões mínimas por categoria de tool
3. Configuração do `.env` com todas as variáveis e thresholds explicados
4. Como adicionar ao MCP de um cliente (Claude Desktop, Kiro, etc.)
5. Lista completa de tools por categoria com exemplos de uso
6. Seção "Fluxo típico de análise" com exemplo end-to-end: `run_analysis` → aguardar → `get_quality_gate_status` → `list_issues` com `newCodeOnly: true`
7. Nota sobre integração futura com Azure DevOps MCP

---

## Restrições
- Usar apenas a SonarQube Web API (`/api/*`) — não usar bibliotecas de alto nível
- API version alvo: SonarQube 10+
- Todo o código deve compilar sem erros com `strict: true` no tsconfig
- Nenhum `any` explícito — tipar tudo corretamente
- Tools de relatório devem calcular agregações no lado do MCP, não delegar ao LLM
- O módulo `scanner.ts` deve funcionar mesmo sem `sonar-scanner` no PATH do sistema (usar o pacote npm como fallback)