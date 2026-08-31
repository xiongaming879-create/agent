import fs from 'fs'
import path from 'path'

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf',
  '.zip', '.gz', '.tar', '.rar', '.7z', '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flac', '.ogg', '.wav',
  '.ttf', '.otf', '.woff', '.woff2', '.class', '.jar', '.pyc',
  '.db', '.sqlite', '.wasm',
])

export function isBinaryFile(filePath: string, statSize: number): boolean {
  if (BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return true
  if (statSize === 0) return false
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(Math.min(8192, statSize))
    fs.readSync(fd, buf, 0, buf.length, 0)
    return buf.includes(0)
  } finally {
    fs.closeSync(fd)
  }
}
