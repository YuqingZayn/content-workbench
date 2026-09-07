import electron from 'electron';
import {existsSync} from 'node:fs';
if(!existsSync(electron))throw new Error('Electron runtime unavailable');
console.log('Using installed Electron runtime');
