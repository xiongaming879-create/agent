import { describe, it, expect } from 'vitest'
import { lcTools, getBuiltInTools } from '../../../../server/src/tools/index'

describe('localfs 工具注册', () => {
  const FS_NAMES = ['fs_read_file', 'fs_write_file', 'fs_list_dir', 'fs_mkdir', 'fs_rm', 'fs_cp', 'fs_mv', 'fs_stat']

  it('8 个 fs_* 工具注册进 lcTools', () => {
    const names = lcTools.map(t => t.name)
    for (const n of FS_NAMES) expect(names).toContain(n)
  })

  it('虚拟工作区 4 工具原样保留', () => {
    const names = getBuiltInTools().map(t => t.name)
    for (const n of ['filesystem_read', 'filesystem_write', 'filesystem_list', 'filesystem_delete']) {
      expect(names).toContain(n)
    }
  })
})
