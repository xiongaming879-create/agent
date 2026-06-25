import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
import { initDb, stopAutoSave } from './db'
import { seedAdmin } from './db/user'
import conversationRouter from './routes/conversation'
import messageRouter from './routes/message'
import authRouter from './routes/auth'
import userRouter from './routes/user'
import adminRouter from './routes/admin'
import { readMcpConfig } from './mcp/config'
import { initMcpClients, closeAllMcpClients, getMcpStatus } from './mcp/client'
import { registerTools, registerLcTools } from './tools'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())
app.use('/avatars', express.static(path.resolve(__dirname, '../data/avatars')))

app.use('/api/auth', authRouter)
app.use('/api/user', userRouter)
app.use('/api/admin', adminRouter)
app.use('/api/conversations', conversationRouter)
app.use('/api/conversations', messageRouter)

app.get('/api/mcp/status', (_req, res) => {
  res.json(getMcpStatus())
})

async function start() {
  await initDb()

  // Seed admin account
  const adminPassword = process.env.ADMIN_PASSWORD || 'Xiongam-1314'
  const adminHash = await bcrypt.hash(adminPassword, 10)
  seedAdmin(adminHash)

  const mcpConfig = readMcpConfig()
  const { tools: mcpTools, lcTools: mcpLcTools } = await initMcpClients(mcpConfig)
  registerTools(mcpTools)
  registerLcTools(mcpLcTools)

  app.listen(PORT, () => {
    console.log(`Agent server running on http://localhost:${PORT}`)
  })
}

process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down...')
  stopAutoSave()
  await closeAllMcpClients()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\n[Server] Shutting down...')
  stopAutoSave()
  await closeAllMcpClients()
  process.exit(0)
})

start()

export default app
