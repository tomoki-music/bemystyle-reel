// server.mjs の待受ホストが 127.0.0.1 に固定されており、意図せず
// 0.0.0.0 / 全インターフェースへ公開されないことを確認するテスト。
//
// server.mjs は起動時に多数の副作用（ディレクトリ作成、他ルートのマウント等）を
// 伴うため、実際に子プロセスとして起動し、
//   1. ソースコード上で app.listen に明示的な '127.0.0.1' が渡されていること
//   2. 実際に 127.0.0.1 では接続できること
//   3. マシンにLAN側インターフェースがある場合、そちらからは接続できないこと
// の3段構えで検証する。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import net from 'net'
import os from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_PATH = resolve(__dirname, 'server.mjs')

function getLanIPv4() {
  const nets = os.networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const netIf of nets[name] ?? []) {
      if (netIf.family === 'IPv4' && !netIf.internal) return netIf.address
    }
  }
  return null
}

function tryConnect(host, port, timeoutMs = 1500) {
  return new Promise((resolvePromise) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs })
    socket.once('connect', () => {
      socket.destroy()
      resolvePromise({ connected: true })
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolvePromise({ connected: false, reason: 'timeout' })
    })
    socket.once('error', (err) => {
      resolvePromise({ connected: false, reason: err.code || err.message })
    })
  })
}

describe('server.mjs の待受ホスト固定', () => {
  it('ソースコード上で app.listen(PORT, \'127.0.0.1\', ...) を明示的に指定している', () => {
    const src = readFileSync(SERVER_PATH, 'utf-8')
    expect(src).toMatch(/app\.listen\(\s*PORT\s*,\s*HOST\s*,/)
    expect(src).toMatch(/const HOST\s*=\s*'127\.0\.0\.1'/)
  })

  it(
    '実プロセス起動時、127.0.0.1では接続でき、LANアドレスからは接続できない',
    async () => {
      // OSにポートを選ばせてから起動する（他テストとの競合回避）
      const port = await new Promise((res) => {
        const probe = net.createServer()
        probe.listen(0, '127.0.0.1', () => {
          const p = probe.address().port
          probe.close(() => res(p))
        })
      })

      const child = spawn(process.execPath, [SERVER_PATH], {
        cwd: __dirname,
        env: {
          ...process.env,
          PORT: String(port),
          OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'sk-test-dummy-not-real',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      try {
        await new Promise((res, reject) => {
          const timer = setTimeout(() => reject(new Error('server did not start in time')), 10000)
          child.stdout.on('data', (chunk) => {
            if (chunk.toString().includes('API server running')) {
              clearTimeout(timer)
              res()
            }
          })
          child.once('error', reject)
          child.once('exit', (code) => {
            clearTimeout(timer)
            reject(new Error(`server exited early with code ${code}`))
          })
        })

        const loopback = await tryConnect('127.0.0.1', port)
        expect(loopback.connected).toBe(true)

        const lanIp = getLanIPv4()
        if (lanIp) {
          const lan = await tryConnect(lanIp, port)
          expect(lan.connected).toBe(false)
        }
      } finally {
        child.kill('SIGTERM')
      }
    },
    20000
  )
})
