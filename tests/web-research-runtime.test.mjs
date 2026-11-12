import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createScope, bindScopeParent } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as NativeExecutor from '@deepseek-ai/dsh-tool-executor-native'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import * as Research from '../lib/web-research.js'

// Real rc.2 registries/executor/assembler/LLM service; only the remote model is scripted.
// Parent rebind uses the same native scope mechanism as agentPresets.recompose.
async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Tools)
  await ctx.plugin(NativeExecutor)
  await ctx.plugin(LlmRuntime)
  const captured = []
  class Capture extends LlmAdapter {
    async *stream(options) { captured.push(options); yield { type: 'text-delta', text: 'ok' } }
  }
  ctx.llm.registerAdapter(['fixture'], new Capture())
  const mint = async (key, parent) => {
    let scope
    await ctx.plugin(Object.assign(inner => { scope = createScope(inner, key) }, { inject: ['tools', 'systemPrompt'] }))
    const binding = parent === undefined ? undefined : bindScopeParent(key, parent)
    key.ctx = scope.ctx
    return { scope, key, binding }
  }
  const standard = await mint({ id: 'standard' })
  const research = await mint({ id: 'web-research' })
  await research.scope.ctx.plugin(Research)
  const names = async agent => {
    const signal = new AbortController().signal
    const toolSet = await ctx.tools.resolve({ agent, modelSelection: { provider: 'fixture', model: 'model' }, signal })
    try {
      const assembly = await ctx.systemPrompt.assemble({ scope: agent, toolSet, signal })
      // Same assembled schemas supplied at the Agent request boundary; capture
      // the actual options arriving at LlmAdapter.stream, not raw registry.schemas.
      for await (const _ of ctx.llm.stream({ provider: 'fixture', model: 'model', messages: [], tools: assembly.tools, signal })) { /* consume */ }
      return (captured.at(-1).tools ?? []).map(tool => tool.name)
    } finally { toolSet.dispose() }
  }
  const tool = (name, body = () => name) => ({
    name, description: name, parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => body(),
  })
  return { ctx, standard, research, mint, names, tool, captured }
}

test('rc.2 final model tools stay browser-only for initial research, recompose, nested and late owned tools', async () => {
  const h = await setup()
  try {
    h.ctx.tools.register(h.tool('bash'))
    h.ctx.tools.register(h.tool('read'))
    const ordinary = await h.mint({ id: 'ordinary-fork' }, h.standard.key)
    ordinary.scope.ctx.tools.register(h.tool('subagent'))
    ordinary.scope.ctx.tools.register(h.tool('list_subagent_profiles'))
    assert.deepEqual((await h.names(ordinary.key)).sort(), ['bash', 'list_subagent_profiles', 'read', 'subagent'])

    // Move a live Agent between preset parents; its own profile tools persist.
    ordinary.binding.rebind(h.research.key)
    assert.deepEqual(await h.names(ordinary.key), [])
    ordinary.scope.ctx.tools.register(h.tool('late_owned_tool'))
    assert.deepEqual(await h.names(ordinary.key), [])

    const initial = await h.mint({ id: 'initial-research' }, h.research.key)
    initial.scope.ctx.tools.register(h.tool('subagent'))
    assert.deepEqual(await h.names(initial.key), [])
    const nested = await h.mint({ id: 'nested-session' }, initial.key)
    nested.scope.ctx.tools.register(h.tool('nested_owned_tool'))
    assert.deepEqual(await h.names(nested.key), [])

    for (const name of [...Research.BROWSER_TOOLS, ...Research.EXCLUDED_TOOLS]) h.ctx.tools.register(h.tool(name))
    assert.deepEqual((await h.names(ordinary.key)).sort(), [...Research.BROWSER_TOOLS].sort())
    assert.deepEqual((await h.names(nested.key)).sort(), [...Research.BROWSER_TOOLS].sort())

    // An allowed browser tool registered in the Agent's own layer also works.
    initial.scope.ctx.tools.register(h.tool(Research.BROWSER_TOOLS[0]))
    assert.equal((await h.names(initial.key)).includes(Research.BROWSER_TOOLS[0]), true)

    ordinary.binding.rebind(h.standard.key)
    const restored = await h.names(ordinary.key)
    for (const name of ['bash', 'read', 'subagent', 'list_subagent_profiles', 'late_owned_tool']) assert.equal(restored.includes(name), true)
    // Simultaneously open nested research remains restricted.
    assert.deepEqual((await h.names(nested.key)).sort(), [...Research.BROWSER_TOOLS].sort())
  } finally { await h.ctx.fiber.dispose() }
})

test('rc.2 native execution guard blocks undeclared owned calls and is removed by preset rebind', async () => {
  const h = await setup()
  try {
    const ordinary = await h.mint({ id: 'fork' }, h.research.key)
    let runs = 0
    ordinary.scope.ctx.tools.register(h.tool('subagent', () => { runs += 1; return 'ran' }))
    const execute = () => h.ctx.tools.execute({ agent: ordinary.key, signal: new AbortController().signal,
      calls: [{ type: 'tool-call', id: 'call', name: 'subagent', arguments: '{}' }] })
    assert.equal((await execute()).results[0].result.isError, true)
    assert.equal(runs, 0)
    ordinary.binding.rebind(h.standard.key)
    assert.equal((await execute()).results[0].result.isError, false)
    assert.equal(runs, 1)
  } finally { await h.ctx.fiber.dispose() }
})
