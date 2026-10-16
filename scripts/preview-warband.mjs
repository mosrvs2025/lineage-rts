import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const temp=mkdtempSync(join(tmpdir(),'lineage-art-'));
try {
 const entry=join(temp,'snapshot.mjs');
 await build({entryPoints:['scripts/snapshot-warband.ts'],bundle:true,platform:'node',format:'esm',outfile:entry});
 execFileSync(process.execPath,[entry],{stdio:'inherit'});
 execFileSync('python',['scripts/render-warband.py'],{stdio:'inherit'});
} finally {rmSync(temp,{recursive:true,force:true});}
