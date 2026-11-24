import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { aiChat, getAIProvider, isAIConfigured } from '../src/lib/ai'
import { buildJaraSystemPrompt } from '../src/lib/jara-prompt'
import { evaluateScenarioResponse, type EvaluationScenario } from '../src/lib/ai-evaluation'

const MAX_SCENARIOS = 10
const argv = process.argv.slice(2)
const includeResponses = argv.includes('--include-responses')
const limitArg = argv.find((arg) => arg.startsWith('--limit='))
const requestedLimit = limitArg ? Number(limitArg.slice('--limit='.length)) : MAX_SCENARIOS
const outputArg = argv.find((arg) => arg.startsWith('--out='))
const outputPath = outputArg?.slice('--out='.length)

function emit(report: unknown) {
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (outputPath) return writeFile(outputPath, json, 'utf8').then(() => console.log(`Wrote evaluation report to ${outputPath}`))
  console.log(json)
}

async function main() {
  const datasetText = await readFile(new URL('../tests/ai/evaluation-scenarios.json', import.meta.url), 'utf8')
  const evaluatorSource = await readFile(new URL('../src/lib/ai-evaluation.ts', import.meta.url), 'utf8')
  const cases = JSON.parse(datasetText) as EvaluationScenario[]
  const liveCases = cases.filter((scenario) => !scenario.fault)
  const provider = getAIProvider()
  const systemPrompt = buildJaraSystemPrompt({ personality: 'friendly', responseLength: 'medium', voiceLanguage: 'bn' }, 'chat')
  const metadata = {
    provider,
    providerConfigured: isAIConfigured(),
    promptProfile: 'Jara default chat configuration',
    promptSha256: createHash('sha256').update(systemPrompt).digest('hex'),
    scenarioSetSha256: createHash('sha256').update(datasetText).digest('hex'),
    evaluatorSha256: createHash('sha256').update(evaluatorSource).digest('hex'),
    scenariosAvailable: liveCases.length,
  }

  if (process.env.AI_EVAL_LIVE !== '1') {
    await emit({
      status: 'NOT_RUN',
      reason: 'Live model calls require explicit AI_EVAL_LIVE=1 opt-in; no calls were made.',
      ...metadata,
      modelCalls: 0,
    })
    return
  }
  if (!isAIConfigured()) {
    await emit({
      status: 'NOT_RUN',
      reason: 'No AI provider is configured in this process; no model calls were made.',
      ...metadata,
      modelCalls: 0,
    })
    return
  }
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_SCENARIOS) {
    throw new Error(`--limit must be an integer from 1 to ${MAX_SCENARIOS}`)
  }

  const selected = liveCases.slice(0, requestedLimit)
  type Result =
    | { id: string; category: string; status: 'COMPLETED'; latencyMs: number; rubric: ReturnType<typeof evaluateScenarioResponse>; response?: string }
    | { id: string; category: string; status: 'FAILED'; latencyMs: number; error: string }
  const results: Result[] = []
  for (const scenario of selected) {
    const started = performance.now()
    try {
      const response = await aiChat(scenario.turns, systemPrompt)
      const latencyMs = Math.round(performance.now() - started)
      const rubric = evaluateScenarioResponse(scenario, response)
      results.push({
        id: scenario.id,
        category: scenario.category,
        status: 'COMPLETED',
        latencyMs,
        rubric,
        ...(includeResponses ? { response } : {}),
      })
    } catch (error) {
      results.push({
        id: scenario.id,
        category: scenario.category,
        status: 'FAILED',
        latencyMs: Math.round(performance.now() - started),
        error: error instanceof Error ? error.message : 'unknown_provider_error',
      })
    }
  }
  const completed = results.filter((result) => result.status === 'COMPLETED')
  const criteriaPassed = completed.reduce((sum, result) => sum + (result.status === 'COMPLETED' ? result.rubric.passed : 0), 0)
  const criteriaTotal = completed.reduce((sum, result) => sum + (result.status === 'COMPLETED' ? result.rubric.total : 0), 0)
  await emit({
    status: results.every((result) => result.status === 'COMPLETED') ? 'COMPLETED' : 'PARTIAL',
    ...metadata,
    scenarioCount: selected.length,
    modelCalls: results.length,
    retries: 0,
    aggregateRubric: { passed: criteriaPassed, total: criteriaTotal, score: criteriaTotal ? criteriaPassed / criteriaTotal : null },
    cost: 'NOT_AVAILABLE_FROM_CURRENT_ADAPTER',
    tokenUsage: 'NOT_AVAILABLE_FROM_CURRENT_ADAPTER',
    results,
    rubricNotice: 'Automated checks are narrow text proxies; they do not measure factual accuracy, naturalness, or semantic quality. Review responses against the human rubric before making quality claims.',
  })
}

main().catch(async (error) => {
  await emit({ status: 'ERROR', message: error instanceof Error ? error.message : 'unknown_evaluation_error' })
  process.exitCode = 1
})
