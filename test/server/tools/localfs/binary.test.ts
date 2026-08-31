import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { isBinaryFile } from '../../../../server/src/tools/localfs/binary'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

describe('isBinaryFile', () => {
  it('二进制扩展名直接判定', () => {
    const f = path.join(tmp, 'x.png')
    fs.writeFileSync(f, 'not really png')
    expect(isBinaryFile(f, 13)).toBe(true)
  })

  it('含 null 字节的文件判定为二进制', () => {
    const f = path.join(tmp, 'x.dat')
    fs.writeFileSync(f, Buffer.from([0x68, 0x65, 0x00, 0x6c]))
    expect(isBinaryFile(f, 4)).toBe(true)
  })

  it('纯文本不误判', () => {
    const f = path.join(tmp, 'a.md')
    fs.writeFileSync(f, '# 标题\n中文内容 hello'.repeat(100))
    expect(isBinaryFile(f, fs.statSync(f).size)).toBe(false)
  })
})
