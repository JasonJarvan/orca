import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from '../../runtime/runtime-compatibility-test-fixture'
import { clearRuntimeCompatibilityCacheForTests } from '../../runtime/runtime-rpc-client'
import { createTestStore } from './store-test-helpers'

const projectGroup: ProjectGroup = {
  id: 'group-1',
  name: 'Platform',
  parentPath: null,
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
}

const projectGroupsUpdate = vi.fn()
const runtimeEnvironmentCall = vi.fn()
const runtimeEnvironmentTransportCall = vi.fn()

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  projectGroupsUpdate.mockReset()
  runtimeEnvironmentCall.mockReset()
  runtimeEnvironmentTransportCall.mockReset()
  runtimeEnvironmentTransportCall.mockImplementation((args: RuntimeEnvironmentCallRequest) => {
    return createCompatibleRuntimeStatusResponseIfNeeded(args) ?? runtimeEnvironmentCall(args)
  })
  vi.stubGlobal('window', {
    api: {
      projectGroups: { update: projectGroupsUpdate },
      runtimeEnvironments: { call: runtimeEnvironmentTransportCall }
    }
  })
})

describe('project group owner-routed mutations', () => {
  it('routes a web rename to its row owner and preserves a same-id local row', async () => {
    const remoteGroup = { ...projectGroup, executionHostId: 'runtime:env-owner' as const }
    const localCollision = { ...projectGroup, name: 'Local', executionHostId: 'local' as const }
    runtimeEnvironmentCall.mockResolvedValue({
      id: 'rpc-update-group',
      ok: true,
      result: { group: { ...projectGroup, name: 'Core' } },
      _meta: { runtimeId: 'runtime-remote' }
    })
    const store = createTestStore()
    store.setState({
      settings: { activeRuntimeEnvironmentId: null } as never,
      projectGroups: [localCollision, remoteGroup]
    })

    await expect(
      store
        .getState()
        .updateProjectGroup(
          projectGroup.id,
          { name: 'Core' },
          { executionHostId: remoteGroup.executionHostId }
        )
    ).resolves.toBe(true)

    expect(runtimeEnvironmentCall).toHaveBeenCalledWith({
      selector: 'env-owner',
      method: 'projectGroup.update',
      params: { groupId: projectGroup.id, updates: { name: 'Core' } },
      timeoutMs: 15_000
    })
    expect(projectGroupsUpdate).not.toHaveBeenCalled()
    expect(store.getState().projectGroups).toEqual([
      localCollision,
      { ...projectGroup, name: 'Core', executionHostId: 'runtime:env-owner' }
    ])
  })
})
