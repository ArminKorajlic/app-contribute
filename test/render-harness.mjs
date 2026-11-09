// Compiles a component entry the way Möbius compiles mini-apps, so these
// render tests exercise the real bundler rather than a second one kept around
// only for tests. CI points MOBIUS_FRONTEND_NODE_MODULES at the shell's
// installed frontend, which supplies both Rolldown and React.
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const frontendModules = process.env.MOBIUS_FRONTEND_NODE_MODULES

const projectRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const ENTRY = '\0mobius-render-entry'

async function loadRolldown() {
  const requireFromFrontend = createRequire(join(frontendModules, 'package.json'))
  return import(pathToFileURL(requireFromFrontend.resolve('rolldown')).href)
}

// `plugins` adds Rolldown plugins, such as a stylesheet stub for host modules.
export async function renderModule(source, plugins = []) {
  const { rolldown } = await loadRolldown()
  const build = await rolldown({
    input: ENTRY,
    platform: 'node',
    tsconfig: false,
    transform: { jsx: 'react-jsx' },
    resolve: { modules: [frontendModules, 'node_modules'] },
    plugins: [...plugins, {
      name: 'mobius-render-entry',
      resolveId(id, importer) {
        if (id === ENTRY) return id
        if (importer === ENTRY && id.startsWith('.')) return join(projectRoot, id)
        return null
      },
      load(id) {
        return id === ENTRY ? { code: source, moduleType: 'jsx' } : null
      },
    }],
  })
  const { output } = await build.generate({ format: 'cjs', codeSplitting: false })
  await build.close()
  const bundledModule = { exports: {} }
  new Function('module', 'exports', 'require', output[0].code)(
    bundledModule, bundledModule.exports, createRequire(import.meta.url),
  )
  return bundledModule.exports
}
