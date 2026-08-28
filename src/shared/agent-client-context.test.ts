import { describe, expect, it } from 'vitest'
import {
  buildOrcaAgentClientContext,
  prependOrcaAgentClientContext,
  withOrcaAgentClientContextEnv
} from './agent-client-context'

describe('Orca agent client context', () => {
  it('describes paired Web UI on a headless serve host', () => {
    const context = buildOrcaAgentClientContext({ clientSurface: 'web', hostMode: 'serve' })

    expect(context).toContain('clientSurface=web hostMode=serve')
    expect(context).toContain('no user-operable Electron window')
    expect(context).toContain('Prefer Web UI, Orca CLI/RPC, or server-side configuration')
    expect(context).toContain('ORCA_* values are diagnostic only')
  })

  it('keeps a paired Web UI distinct from a desktop host window', () => {
    const context = buildOrcaAgentClientContext({ clientSurface: 'web', hostMode: 'desktop' })

    expect(context).toContain('clientSurface=web hostMode=desktop')
    expect(context).toContain('do not assume they can operate the host Electron window')
    expect(context).not.toContain('this runtime has no user-operable Electron window')
  })

  it.each(['desktop', 'mobile'] as const)('does not mislabel a %s client as Web', (surface) => {
    expect(buildOrcaAgentClientContext({ clientSurface: surface, hostMode: 'desktop' })).toBeNull()
    expect(
      prependOrcaAgentClientContext('Fix the bug', {
        clientSurface: surface,
        hostMode: 'desktop'
      })
    ).toBe('Fix the bug')
  })

  it('does not duplicate an already decorated prompt', () => {
    const args = { clientSurface: 'web' as const, hostMode: 'serve' as const }
    const once = prependOrcaAgentClientContext('Fix the bug', args)

    expect(prependOrcaAgentClientContext(once, args)).toBe(once)
  })

  it('overrides spoofable diagnostic values with trusted launch context', () => {
    expect(
      withOrcaAgentClientContextEnv(
        { ORCA_CLIENT_SURFACE: 'desktop', ORCA_HOST_MODE: 'desktop', PROFILE: 'review' },
        { clientSurface: 'web', hostMode: 'orcad' }
      )
    ).toEqual({
      ORCA_CLIENT_SURFACE: 'web',
      ORCA_HOST_MODE: 'orcad',
      PROFILE: 'review'
    })
  })
})
