import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import type { RpcRequest, RpcResponse } from '../../core'
import { RpcDispatcher } from '../../dispatcher'
import { TERMINAL_SEND_METHODS } from './terminal-send-method'

function request(text: string): RpcRequest {
  return {
    id: 'request-1',
    authToken: 'token',
    method: 'terminal.send',
    params: {
      terminal: 'term-1',
      text,
      enter: true,
      agentPrompt: true,
      client: { id: 'client-1', type: 'desktop' }
    }
  }
}

function runtimeStub() {
  const sendTerminalAgentPrompt = vi.fn().mockResolvedValue({
    handle: 'term-1',
    accepted: true,
    bytesWritten: 12
  })
  return {
    getRuntimeId: () => 'runtime-1',
    decorateAgentPromptForClient: vi.fn((prompt: string, clientSurface?: 'web') =>
      clientSurface === 'web' ? `<context>web/serve</context>\n\n${prompt}` : prompt
    ),
    resolveLiveLeafForHandle: () => ({ ptyId: 'pty-1' }),
    getDriver: () => ({ kind: 'desktop' }),
    isTerminalRunningSettledPromptAgent: vi.fn().mockResolvedValue(true),
    sendTerminalAgentPrompt,
    sendTerminal: vi.fn()
  }
}

describe('terminal.send paired Web agent context', () => {
  it('decorates a resumed agent next prompt using authenticated Web client context', async () => {
    const runtime = runtimeStub()
    const dispatcher = new RpcDispatcher({
      runtime: runtime as unknown as OrcaRuntimeService,
      methods: TERMINAL_SEND_METHODS
    })
    const replies: RpcResponse[] = []

    await dispatcher.dispatchStreaming(
      request('retry initialization'),
      (response) => replies.push(JSON.parse(response) as RpcResponse),
      {
        clientId: 'client-1',
        clientKind: 'runtime',
        clientCapabilities: ['client-surface.web.v1']
      }
    )

    expect(replies[0]).toMatchObject({ ok: true })
    expect(runtime.decorateAgentPromptForClient).toHaveBeenCalledWith('retry initialization', 'web')
    expect(runtime.sendTerminalAgentPrompt).toHaveBeenCalledWith(
      'term-1',
      '<context>web/serve</context>\n\nretry initialization',
      expect.any(Object)
    )
  })

  it('keeps an in-process desktop prompt unchanged', async () => {
    const runtime = runtimeStub()
    const dispatcher = new RpcDispatcher({
      runtime: runtime as unknown as OrcaRuntimeService,
      methods: TERMINAL_SEND_METHODS
    })

    await dispatcher.dispatch(request('retry initialization'))

    expect(runtime.decorateAgentPromptForClient).toHaveBeenCalledWith(
      'retry initialization',
      undefined
    )
    expect(runtime.sendTerminalAgentPrompt).toHaveBeenCalledWith(
      'term-1',
      'retry initialization',
      expect.any(Object)
    )
  })
})
