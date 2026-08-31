import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../../src/main/runtime/orca-runtime'
import {
  applyWebSessionTabsSnapshot,
  type WebSessionTabsSyncState
} from '../../src/renderer/src/runtime/web-session-tabs-sync'
import { getDefaultWorkspaceSession } from '../../src/shared/constants'
import type { RuntimeMobileSessionTabsResult } from '../../src/shared/runtime-types'
import type { WorkspaceSessionState } from '../../src/shared/workspace-session-state-types'

vi.mock('../../src/renderer/src/store', () => ({
  useAppStore: { setState: vi.fn() }
}))

const WORKTREE_ID = 'repo-1::/remote-worktree'
const TAB_ID = 'host-terminal'
const LEAF_ID = '00000000-0000-4000-8000-000000000001'
const PTY_ID = 'remote-pty'

const storeBase = {
  getRepo: () => ({
    id: 'repo-1',
    path: '/remote/repo',
    displayName: 'repo',
    badgeColor: 'blue',
    addedAt: 1
  }),
  getRepos: () => [storeBase.getRepo()],
  addRepo: () => {},
  updateRepo: () => undefined as never,
  getAllWorktreeMeta: () => ({}),
  getWorktreeMeta: () => undefined,
  getGitHubCache: () => ({ pr: {}, issue: {} }),
  setWorktreeMeta: () => undefined as never,
  removeWorktreeMeta: () => {},
  getRetiredWorktreeNameRegistry: () => ({ exhaustedTiers: 0, names: [] }),
  addRetiredWorktreeName: () => {},
  mergeRetiredWorktreeNames: () => false,
  getSettings: () => ({
    workspaceDir: '/remote/workspaces',
    nestWorkspaces: false,
    refreshLocalBaseRefOnWorktreeCreate: false,
    branchPrefix: 'none',
    branchPrefixCustom: ''
  })
}

function makeSession(): WorkspaceSessionState {
  return {
    ...getDefaultWorkspaceSession(),
    activeRepoId: 'repo-1',
    activeWorktreeId: WORKTREE_ID,
    activeTabId: TAB_ID,
    activeTabIdByWorktree: { [WORKTREE_ID]: TAB_ID },
    tabsByWorktree: {
      [WORKTREE_ID]: [
        {
          id: TAB_ID,
          ptyId: PTY_ID,
          worktreeId: WORKTREE_ID,
          title: 'Base terminal',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1
        }
      ]
    },
    terminalLayoutsByTabId: {
      [TAB_ID]: {
        root: { type: 'leaf', leafId: LEAF_ID },
        activeLeafId: LEAF_ID,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF_ID]: PTY_ID }
      }
    }
  }
}

function createRuntime(initialSession: WorkspaceSessionState) {
  let session = initialSession
  const runtime = new OrcaRuntimeService({
    ...storeBase,
    getWorkspaceSession: () => session,
    setWorkspaceSession: (next: WorkspaceSessionState) => {
      session = next
    }
  })
  runtime.registerPty(PTY_ID, WORKTREE_ID, null, {
    tabId: TAB_ID,
    leafId: LEAF_ID,
    incarnationId: 'title-persistence-incarnation'
  })
  return { runtime, getSession: () => session }
}

function makeViewerState(): WebSessionTabsSyncState {
  return {
    activeBrowserTabId: null,
    activeBrowserTabIdByWorktree: {},
    activeFileId: null,
    activeFileIdByWorktree: {},
    activeGroupIdByWorktree: {},
    activeTabId: null,
    activeTabIdByWorktree: {},
    activeTabType: 'terminal',
    activeTabTypeByWorktree: {},
    activeWorktreeId: WORKTREE_ID,
    agentStatusByPaneKey: {},
    agentStatusEpoch: 0,
    browserCertificateFailuresByPageId: {},
    browserPagesByWorkspace: {},
    browserTabsByWorktree: {},
    groupsByWorktree: {},
    layoutByWorktree: {},
    openFiles: [],
    ptyIdsByTabId: {},
    remoteBrowserPageHandlesByPageId: {},
    tabBarOrderByWorktree: {},
    tabsByWorktree: {},
    terminalLayoutsByTabId: {},
    unifiedTabsByWorktree: {},
    unreadTerminalTabs: {},
    sortEpoch: 0
  }
}

function applySnapshot(
  state: WebSessionTabsSyncState,
  snapshot: RuntimeMobileSessionTabsResult,
  environmentId: string
): WebSessionTabsSyncState {
  return { ...state, ...applyWebSessionTabsSnapshot(state, snapshot, environmentId) }
}

function visibleTitle(state: WebSessionTabsSyncState): string | null {
  const tab = state.tabsByWorktree[WORKTREE_ID]?.[0]
  return tab?.customTitle ?? tab?.title ?? null
}

describe('remote Web terminal custom title persistence', () => {
  it('preserves a local rename when an older host omits customTitle', async () => {
    const host = createRuntime(makeSession())
    const legacySnapshot = structuredClone(
      await host.runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)
    )
    for (const tab of legacySnapshot.tabs) {
      if (tab.type === 'terminal') {
        delete tab.customTitle
      }
    }
    const renamed = makeViewerState()
    renamed.tabsByWorktree[WORKTREE_ID] = [
      {
        id: TAB_ID,
        ptyId: null,
        worktreeId: WORKTREE_ID,
        title: 'Base terminal',
        customTitle: 'Local rename',
        color: null,
        sortOrder: 0,
        createdAt: 1
      }
    ]

    expect(visibleTitle(applySnapshot(renamed, legacySnapshot, 'new-client-old-host'))).toBe(
      'Local rename'
    )
  })

  it('fans out to two clients and survives refresh plus host restart', async () => {
    const firstHost = createRuntime(makeSession())
    const initial = await firstHost.runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)
    let clientA = applySnapshot(makeViewerState(), initial, 'web-client-a')
    let clientB = applySnapshot(makeViewerState(), initial, 'web-client-b')
    const unsubscribeA = firstHost.runtime.onMobileSessionTabsChanged((snapshot) => {
      clientA = applySnapshot(clientA, snapshot, 'web-client-a')
    }, 'web-client-a')
    const unsubscribeB = firstHost.runtime.onMobileSessionTabsChanged((snapshot) => {
      clientB = applySnapshot(clientB, snapshot, 'web-client-b')
    }, 'web-client-b')

    await firstHost.runtime.setMobileSessionTabProps(`id:${WORKTREE_ID}`, {
      tabId: TAB_ID,
      customTitle: 'Shared build'
    })

    expect(visibleTitle(clientA)).toBe('Shared build')
    expect(visibleTitle(clientB)).toBe('Shared build')
    expect(firstHost.getSession().tabsByWorktree[WORKTREE_ID]?.[0]?.customTitle).toBe(
      'Shared build'
    )

    const refreshed = applySnapshot(
      makeViewerState(),
      await firstHost.runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`),
      'web-client-a-refreshed'
    )
    expect(visibleTitle(refreshed)).toBe('Shared build')

    unsubscribeA()
    unsubscribeB()
    const restartedHost = createRuntime(structuredClone(firstHost.getSession()))
    const afterRestart = applySnapshot(
      makeViewerState(),
      await restartedHost.runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`),
      'web-client-after-restart'
    )
    expect(visibleTitle(afterRestart)).toBe('Shared build')

    await restartedHost.runtime.setMobileSessionTabProps(`id:${WORKTREE_ID}`, {
      tabId: TAB_ID,
      customTitle: null
    })
    const afterClear = applySnapshot(
      afterRestart,
      await restartedHost.runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`),
      'web-client-after-restart'
    )
    expect(visibleTitle(afterClear)).toBe('Base terminal')
  })
})
