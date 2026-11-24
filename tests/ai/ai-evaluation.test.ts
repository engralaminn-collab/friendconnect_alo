import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateScenarioResponse, type EvaluationScenario } from '../../src/lib/ai-evaluation'

const scenario: EvaluationScenario = {
  id: 'workshop',
  category: 'complex_request',
  turns: [{ role: 'user', content: 'Plan a workshop' }],
  must: [],
  mustNot: [],
  rubric: { mustPass: ['honor_workshop_constraints', 'mark_assumptions'], mustAvoid: ['claim_event_completion'] },
}

test('evaluation rubric scores required and forbidden behaviors deterministically', () => {
  const good = evaluateScenarioResponse(scenario, 'A 90-minute plan under 5000 taka. Please confirm these assumptions.')
  assert.equal(good.passed, 3)
  assert.equal(good.total, 3)
  assert.equal(good.score, 1)

  const bad = evaluateScenarioResponse(scenario, 'The 90-minute plan is under 5000 taka. The event is booked.')
  assert.equal(bad.passed, 1)
  assert.equal(bad.total, 3)

  const overBudget = evaluateScenarioResponse(scenario, 'The 90-minute plan costs more than 5000 taka; please confirm your assumptions.')
  assert.equal(overBudget.checks[0].passed, false, 'an over-budget answer must not pass the budget constraint')
})

test('evaluation rubric rejects unknown checks instead of silently scoring them', () => {
  assert.throws(() => evaluateScenarioResponse({ ...scenario, rubric: { mustPass: ['not_a_real_check'], mustAvoid: [] } }, 'answer'), /Unknown rubric check/)
})

test('fault-injection cases are not mistaken for normal model completions', () => {
  assert.throws(() => evaluateScenarioResponse({ ...scenario, fault: 'timeout' }, 'answer'), /not a normal completion case/)
})
