import { testConfig } from './testConfig.js'
import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { Engine } from './engine.js'

test('engine masks secrets in both log directions and split stderr without changing the protocol', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sample-engine-log-test-'))
  await mkdir(join(root, 'dist'))
  await writeFile(join(root, 'dist', 'cli.js'), `
    const fs = require('node:fs');
    require('node:readline').createInterface({input:process.stdin}).on('line', input => {
      const message = JSON.parse(input);
      if (message.type !== 'user') return;
      fs.writeFileSync('received.json', input);
      fs.writeFileSync('credentials.json', JSON.stringify({key:process.env.ANTHROPIC_API_KEY,auth:process.env.ANTHROPIC_AUTH_TOKEN}));
      const secret = message.content;
      process.stdout.write(JSON.stringify({type:'assistant', content:secret, partial:false, model:'test-route'}) + '\\n');
      process.stderr.write('Consolidation de la mémoire : a1.\\nTâches de fond arrêtées à la fin de la session : a1.\\n');
      process.stderr.write('request failed ' + secret.slice(0, 8));
      setTimeout(() => {
        process.stderr.write(secret.slice(8) + '\\n');
        process.stderr.write('x'.repeat(70000) + secret.slice(0, 8));
        setTimeout(() => {
          process.stderr.write(secret.slice(8) + '\\nnext diagnostic\\n');
          process.exit(0);
        }, 30);
      }, 30);
    });
  `)
  const secret = 'known-secret-with-several-parts'
  const file = join(root, 'protocol.log')
  const engine = new Engine({ cwd: root, appRoot: root, engineRoot: root, configDir: testConfig(root), logFile: file,
    distribution: { product: 'Fixture', cli: 'fixture', slug: 'fixture', envPrefix: 'FIXTURE_', urlScheme: 'fixture', instructionsFile: 'fixture.instructions.md', bundleId: 'test.fixture' },
    backendCommand: { file: process.execPath, args: [join(root, 'dist', 'cli.js')] },
    extraEnv: async () => ({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000', ANTHROPIC_MODEL: 'test-route', ANTHROPIC_AUTH_TOKEN: secret }),
  })
  const notices: string[] = []
  const noticeEvents: {tone:string;text:string}[] = []
  const messages: unknown[] = []
  engine.on('notice', notice => notices.push(notice.text))
  engine.on('notice', notice => noticeEvents.push(notice))
  engine.on('message', message => messages.push(message))
  const ended = once(engine, 'turn-end')
  try {
    await engine.send(secret)
    await ended
    expect(JSON.parse(await readFile(join(root, 'received.json'), 'utf8')).content).toBe(secret)
    const credentials = JSON.parse(await readFile(join(root, 'credentials.json'), 'utf8'))
    expect(credentials.auth).toBe('')
    expect(credentials.key).toBeTruthy()
    expect(credentials.key).not.toBe(secret)
    expect(JSON.stringify(messages)).toContain(secret)
    expect(notices.join('\n')).not.toContain(secret)
    expect(notices.join('\n')).toContain('request failed [REDACTED]')
    expect(notices.join('\n')).not.toContain(secret.slice(8))
    expect(notices.join('\n')).toContain('next diagnostic')
    expect(noticeEvents.filter(n => /Consolidation de la mémoire|Tâches de fond arrêtées/.test(n.text)).map(n=>n.tone)).toEqual(['info','info'])
    expect(noticeEvents.find(n=>n.text.startsWith('request failed'))?.tone).toBe('error')
    const log = await readFile(file, 'utf8')
    expect(log).not.toContain(secret)
    expect(log).toContain('test-route')
    expect(log).toContain('>>')
    expect(log).toContain('<<')
    expect(log).toContain('stderr')
  } finally { engine.stop() }
})
