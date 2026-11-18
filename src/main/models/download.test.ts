import { expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalModels } from './index.js'

test('model transfer resumes partial files, restarts on ignored ranges and reports HTTP errors', async () => {
  const root=await mkdtemp(join(tmpdir(),'sample-transfer-'))
  let range: string | null=null
  const server=Bun.serve({port:0,hostname:'127.0.0.1',fetch(request){
    range=request.headers.get('range')
    if(new URL(request.url).pathname==='/fail')return new Response('unavailable',{status:503})
    if(new URL(request.url).pathname==='/resume')return new Response('def',{status:206,headers:{'content-length':'3','content-range':'bytes 3-5/6'}})
    return new Response('abcdef',{headers:{'content-length':'6'}})
  }})
  try {
    const models=new LocalModels(root)
    const transfer=(models as unknown as {fetchFile(url:string,target:string,signal:AbortSignal,progress:(received:number,total:number|null)=>void):Promise<void>}).fetchFile.bind(models)
    for(const route of ['resume','restart']) {
      const target=join(root,route);await writeFile(target+'.part','abc')
      await transfer(`http://127.0.0.1:${server.port}/${route}`,target,new AbortController().signal,()=>{})
      expect(range as string | null).toBe('bytes=3-');expect(await readFile(target,'utf8')).toBe('abcdef')
    }
    await expect(transfer(`http://127.0.0.1:${server.port}/fail`,join(root,'fail'),new AbortController().signal,()=>{})).rejects.toThrow('503')
    const control=new AbortController();control.abort()
    await expect(transfer(`http://127.0.0.1:${server.port}/restart`,join(root,'cancelled'),control.signal,()=>{})).rejects.toThrow()
  } finally {server.stop(true);await rm(root,{recursive:true,force:true})}
})
