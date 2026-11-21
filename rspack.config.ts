import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rspack/cli'
import { rspack, type Compiler, type Configuration } from '@rspack/core'

const dev = process.env.NODE_ENV !== 'production'
const targets = ['chrome >= 105', 'edge >= 105', 'safari >= 16', 'firefox >= 110']
const root = path.dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string }

const resolveBuildVersion = (): string => {
  const now = new Date()
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('')

  let sha = process.env.GITHUB_SHA?.slice(0, 7) ?? ''
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
    } catch {
      sha = ''
    }
  }
  const runNum = process.env.GITHUB_RUN_NUMBER ? `r${process.env.GITHUB_RUN_NUMBER}` : ''
  return [version, stamp, runNum, sha].filter(Boolean).join('-')
}

const buildVersion = resolveBuildVersion()

/**
 * 为构建产物注入版本号与防缓存标识：
 * 1. 输出 version.json 供运行期校验远端是否有新发布；
 * 2. 为 index.html 中引用的静态 JS/CSS 资源 URL 统一追加 ?v=<buildVersion> 查询参数。
 */
class VersionAssetsPlugin {
  constructor(private readonly appVersion: string) {}

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap('VersionAssetsPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'VersionAssetsPlugin',
          stage: rspack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
        },
        () => {
          const versionJson = JSON.stringify(
            {
              version: this.appVersion,
              builtAt: new Date().toISOString(),
            },
            null,
            2
          )
          compilation.emitAsset('version.json', new rspack.sources.RawSource(versionJson))

          const htmlAsset = compilation.getAsset('index.html')
          if (htmlAsset) {
            const rawHtml = htmlAsset.source.source().toString()
            const vParam = `v=${encodeURIComponent(this.appVersion)}`
            const versionedHtml = rawHtml
              .replace(
                /(<script\b[^>]*\bsrc=["'])(static\/[^"'?]+)(["'])/gi,
                `$1$2?${vParam}$3`
              )
              .replace(
                /(<link\b[^>]*\bhref=["'])(static\/[^"'?]+)(["'])/gi,
                `$1$2?${vParam}$3`
              )
            compilation.updateAsset('index.html', new rspack.sources.RawSource(versionedHtml))
          }
        }
      )
    })
  }
}

const cssLoader = {
  loader: 'builtin:lightningcss-loader',
  options: { targets },
}

type ConfigOptions = {
  /** 公开 API 的地址，注入为 __API_ORIGIN__ */
  apiOrigin?: string
  /** 开发服务器配置，支持本地接口代理 */
  devServer?: Configuration['devServer']
}

/** 创建构建配置，支持自定义 API 地址和开发服务器选项 */
export const createConfig = ({
  apiOrigin = 'https://api.deepseek.com',
  devServer,
}: ConfigOptions = {}): Configuration => ({
  mode: dev ? 'development' : 'production',
  entry: './src/main.tsx',
  output: {
    path: path.resolve(root, 'dist'),
    // 运行时按当前脚本地址推导资源路径，file:// 下异步 chunk、字体都按相对位置加载
    publicPath: 'auto',
    filename: 'static/js/[name].[contenthash:8].js',
    chunkFilename: 'static/js/async/[name].[contenthash:8].js',
    cssFilename: 'static/css/[name].[contenthash:8].css',
    cssChunkFilename: 'static/css/async/[name].[contenthash:8].css',
    assetModuleFilename: 'static/media/[name].[contenthash:8][ext]',
    clean: true,
  },
  devtool: dev ? 'cheap-module-source-map' : false,
  // 开发模式预编译异步模块，保持首次加载代码高亮和公式时的页面状态
  lazyCompilation: false,
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    // 将 .js 导入路径解析到同名 .ts、.tsx 或 .js 文件
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  module: {
    // CSS Modules 使用默认导出：`import styles from './x.module.css'`
    parser: { 'css/module': { namedExports: false } },
    generator: { 'css/module': { localIdentName: '[local]-[hash:6]' } },
    rules: [
      { test: /\.module\.css$/, type: 'css/module', use: [cssLoader] },
      { test: /\.css$/, exclude: /\.module\.css$/, type: 'css', use: [cssLoader] },
      {
        test: /\.(j|t)sx?$/,
        exclude: /[\\/]node_modules[\\/]/,
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic', development: dev } },
            externalHelpers: true,
          },
          env: { targets },
        },
        type: 'javascript/auto',
      },
      { test: /\.(woff2?|ttf)$/, type: 'asset/resource' },
    ],
  },
  plugins: [
    // 经典 defer 脚本支持 file:// 页面的资源加载
    new rspack.HtmlRspackPlugin({
      template: './src/index.html',
      scriptLoading: 'defer',
      meta: { 'application-version': buildVersion },
    }),
    new rspack.DefinePlugin({
      __API_ORIGIN__: JSON.stringify(apiOrigin),
      __APP_VERSION__: JSON.stringify(buildVersion),
      __IS_PROD__: JSON.stringify(!dev),
    }),
    new VersionAssetsPlugin(buildVersion),
    new rspack.CopyRspackPlugin({
      patterns: [{ from: path.resolve(root, 'LICENSE'), to: 'LICENSE', toType: 'file' }],
    }),
  ],
  performance: { hints: false },
  devServer: { port: 8090, ...devServer },
})

// eslint-disable-next-line import/no-default-export
export default defineConfig(createConfig())
