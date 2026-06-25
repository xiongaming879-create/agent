import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '../workspace')

export function resolvePath(filepath: string): string {
  const normalized = path.normalize(filepath)
  const full = path.resolve(WORKSPACE_ROOT, normalized)
  if (!full.startsWith(path.resolve(WORKSPACE_ROOT))) {
    throw new Error(`Path traversal detected: ${filepath}`)
  }
  return full
}

export async function readFile(filepath: string): Promise<string> {
  const full = resolvePath(filepath)
  if (!fs.existsSync(full)) {
    throw new Error(`File not found: ${filepath}`)
  }
  return fs.readFileSync(full, 'utf-8')
}

export async function writeFile(filepath: string, content: string): Promise<void> {
  const full = resolvePath(filepath)
  const dir = path.dirname(full)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(full, content, 'utf-8')
}

export async function listDir(dirpath: string): Promise<string[]> {
  const full = resolvePath(dirpath)
  if (!fs.existsSync(full)) {
    return []
  }
  return fs.readdirSync(full)
}

export async function deleteFile(filepath: string): Promise<void> {
  const full = resolvePath(filepath)
  if (!fs.existsSync(full)) {
    throw new Error(`File not found: ${filepath}`)
  }
  fs.rmSync(full, { recursive: true, force: true })
}
