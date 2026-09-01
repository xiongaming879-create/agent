import { describe, it, expect, beforeEach } from 'vitest'
import {
  requireConfirmation, ConfirmRequiredError, opKeyFor, clearPendingForTest,
  peekPending, setPendingForTest,
} from '../../../../server/src/tools/localfs/confirm'
import type { WorkspaceConfig } from '../../../../server/src/tools/localfs/config'

const cfg: WorkspaceConfig = {
  workspace_mode: 'local_fs', sandbox_root: '/tmp/sb',
  allow_absolute_path: false, allow_symbolic_link: false, allow_dangerous_delete: false,
  max_read_bytes: 2097152, auto_confirm_high_risk: false, enable_audit_log: true,
}

beforeEach(() => clearPendingForTest())

describe('requireConfirmation', () => {
  it('默认拦截并登记 pending', () => {
    expect(() => requireConfirmation({ toolName: 'fs_rm', realPath: '/tmp/sb/a', description: '删除 a', config: cfg }))
      .toThrow(ConfirmRequiredError)
  })

  it('拦截后带 confirm=true 重试放行', () => {
    expect(() => requireConfirmation({ toolName: 'fs_rm', realPath: '/tmp/sb/a', description: '删除 a', config: cfg })).toThrow()
    expect(() => requireConfirmation({ toolName: 'fs_rm', realPath: '/tmp/sb/a', description: '删除 a', config: cfg, confirm: true })).not.toThrow()
  })

  it('无 pending 时直接 confirm=true 仍拦截', () => {
    try {
      requireConfirmation({ toolName: 'fs_rm', realPath: '/tmp/sb/b', description: '删除 b', config: cfg, confirm: true })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ConfirmRequiredError)
      expect((e as ConfirmRequiredError).message).toMatch(/没有待确认/)
    }
  })

  it('auto_confirm_high_risk=true 时直接放行', () => {
    expect(() => requireConfirmation({ toolName: 'fs_rm', realPath: '/tmp/sb/c', description: '删除 c', config: { ...cfg, auto_confirm_high_risk: true } })).not.toThrow()
  })

  it('过期 pending 不放行', () => {
    expect(() => requireConfirmation({ toolName: 'fs_rm', realPath: '/tmp/sb/d', description: '删除 d', config: cfg })).toThrow()
    // 直接篡改过期时间模拟 TTL 到期
    const key = opKeyFor('fs_rm', '/tmp/sb/d')
    setPendingForTest(key, Date.now() - 1)
    expect(peekPending(key)).toBeLessThan(Date.now())
    try {
      requireConfirmation({ toolName: 'fs_rm', realPath: '/tmp/sb/d', description: '删除 d', config: cfg, confirm: true })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ConfirmRequiredError)
    }
  })
})
