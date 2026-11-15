import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {copyFile,mkdir} from 'node:fs/promises';

// Vite's config runner can hand the HTML plugin mismatched Windows paths when
// the workspace directory contains non-ASCII characters. Programmatic build
// keeps the real project root and index.html on the same path representation.
await build({
 configFile:false,
 plugins:[react()],
 build:{sourcemap:false,outDir:'dist/client'},
 logLevel:'warn',
});
// Keep index.html in dist/client for VNext Go static serving and copy for compatibility.
await mkdir('dist/server',{recursive:true});
await copyFile('dist/client/index.html','dist/server/app-shell.html');
