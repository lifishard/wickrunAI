import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await build({entryPoints:[root+'electron/native-mcp.cjs'],outfile:root+'electron/native-mcp.bundle.cjs',bundle:true,platform:'node',format:'cjs',target:'node20',minify:true,logLevel:'warning'});
// 项目记忆内核只写一份（src/lib/memory-core.ts），主进程用打包出来的 CommonJS 版本
await build({entryPoints:[root+'src/lib/memory-core.ts'],outfile:root+'electron/memory-core.bundle.cjs',bundle:true,platform:'node',format:'cjs',target:'node20',minify:false,legalComments:'none',logLevel:'warning',banner:{js:'// 由 scripts/build-native-mcp.mjs 从 src/lib/memory-core.ts 生成，请勿手改'}});
