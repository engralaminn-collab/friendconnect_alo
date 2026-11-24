import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { evaluateScenarioResponse, type EvaluationScenario } from '../../src/lib/ai-evaluation'

const cases = JSON.parse(readFileSync(new URL('./evaluation-scenarios.json', import.meta.url), 'utf8')) as EvaluationScenario[]

test('AI evaluation dataset covers the agreed real-world scenario categories with explicit safety rubrics', () => {
  const ids = new Set(cases.map((scenario) => scenario.id))
  assert.equal(ids.size, cases.length, 'scenario ids must be unique')
  for (const scenario of cases) {
    assert.ok(scenario.id && scenario.category)
    assert.ok(scenario.turns.length > 0)
    assert.ok(scenario.must.length > 0)
    assert.ok(Array.isArray(scenario.mustNot))
    assert.ok(scenario.turns.every((turn) => ['user', 'assistant'].includes(turn.role) && turn.content.trim()))
    if (scenario.rubric) {
      assert.ok(scenario.rubric.mustPass.length + scenario.rubric.mustAvoid.length > 0)
      assert.doesNotThrow(() => evaluateScenarioResponse(scenario, ''))
    }
  }
  for (const category of [
    'simple_question', 'ambiguity', 'context_follow_up', 'user_correction', 'missing_information',
    'tool_unavailable', 'unauthorized_request', 'prompt_injection', 'multilingual', 'complex_request', 'provider_failure',
  ]) assert.ok(cases.some((scenario) => scenario.category === category), `missing ${category} scenario`)
})
