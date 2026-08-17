import { describe, expect, it } from 'vitest'
import { acquireCookieMutationLock, withCookieMutationLock } from './browser-cookie-import-clear'

/**
 * STA-4601: two imports on one partition must not interleave on the live jar.
 *
 * Nothing serialises imports per partition — neither the renderer IPC handler nor the runtime RPC
 * method — so before this change the lock covered the clear alone and was released before the
 * writes and the rollback. That let import A's rollback remove cookies import B had already
 * written and reported as imported.
 *
 * These tests drive the lock primitive directly with deterministic interleavings rather than
 * racing two real imports, so a failure names the ordering rule that broke instead of flaking.
 */
describe('cookie mutation lock', () => {
  it('serialises two transactions on the same owner', async () => {
    const owner = {}
    const order: string[] = []

    const first = withCookieMutationLock(owner, async () => {
      order.push('A:clear')
      await Promise.resolve()
      order.push('A:write')
    })
    // Why: started before A resolves, so an unserialised implementation interleaves here.
    const second = withCookieMutationLock(owner, async () => {
      order.push('B:clear')
      await Promise.resolve()
      order.push('B:write')
    })

    await Promise.all([first, second])

    expect(order).toEqual(['A:clear', 'A:write', 'B:clear', 'B:write'])
  })

  it('does not serialise across different owners', async () => {
    // Why: the lock is per partition. Two different profiles must still import concurrently.
    const order: string[] = []
    const a = withCookieMutationLock({}, async () => {
      order.push('a:start')
      await Promise.resolve()
      order.push('a:end')
    })
    const b = withCookieMutationLock({}, async () => {
      order.push('b:start')
      await Promise.resolve()
      order.push('b:end')
    })

    await Promise.all([a, b])

    expect(order).toContain('a:end')
    expect(order).toContain('b:end')
    // Interleaved rather than strictly sequential.
    expect(order).not.toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })

  it('releases the lock when the transaction throws, so the next import is not wedged', async () => {
    const owner = {}

    await expect(
      withCookieMutationLock(owner, async () => {
        throw new Error('clear rejected')
      })
    ).rejects.toThrow('clear rejected')

    // Why: a failed import must not leave the partition permanently locked.
    await expect(withCookieMutationLock(owner, async () => 'second ran')).resolves.toBe(
      'second ran'
    )
  })

  it('holds across an explicit acquire/release so a rollback stays inside the transaction', async () => {
    // Why: path A takes the lock directly rather than through a callback, because its rollback runs
    // in a finally block. A stale rollback outside the lock is the STA-4601 defect.
    const owner = {}
    const order: string[] = []

    const release = await acquireCookieMutationLock(owner)
    const queued = withCookieMutationLock(owner, async () => {
      order.push('B:clear')
    })

    order.push('A:replace')
    await Promise.resolve()
    order.push('A:rollback')
    release()

    await queued

    expect(order).toEqual(['A:replace', 'A:rollback', 'B:clear'])
  })

  it('leaves the lock usable if a holder releases twice', async () => {
    const owner = {}
    const release = await acquireCookieMutationLock(owner)
    release()
    release()

    await expect(withCookieMutationLock(owner, async () => 'ok')).resolves.toBe('ok')
  })
})
