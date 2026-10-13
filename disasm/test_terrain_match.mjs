// Run the production terrain implementation against the original EXE kernel.
// The former inline copy tested a different algorithm and depended on /tmp data.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./verify_terrain_walk.py', import.meta.url));
const result = spawnSync('python3', [script], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
