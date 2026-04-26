import { Download, ExternalLink, Link as LinkIcon, MonitorDown, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import fs from 'fs'
import path from 'path'

const launcherFileName = 'Nightfall-Last-Survivor-Windows.exe'
const launcherPath = `/downloads/${launcherFileName}`

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown size'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function getLauncherInfo() {
  const absolutePath = path.join(process.cwd(), 'public', 'downloads', launcherFileName)
  try {
    const stat = fs.statSync(absolutePath)
    return {
      available: stat.isFile(),
      size: formatBytes(stat.size),
      updatedAt: stat.mtime.toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    }
  } catch {
    return { available: false, size: 'Not built yet', updatedAt: 'Pending build' }
  }
}

export default function DownloadPage() {
  const downloadUrl = launcherPath
  const shareUrl = '/download'
  const launcher = getLauncherInfo()

  return (
    <main className="min-h-screen relative overflow-hidden bg-[#07070b] text-white">
      <div
        className="absolute inset-0 opacity-80"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(190, 18, 60, 0.30), transparent 62%), radial-gradient(ellipse 45% 55% at 15% 100%, rgba(30, 41, 59, 0.65), transparent), radial-gradient(ellipse 45% 55% at 85% 100%, rgba(80, 10, 20, 0.55), transparent)',
        }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:48px_48px] opacity-20" />

      <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-12">
        <a href="/" className="mb-8 inline-flex w-fit items-center gap-2 text-sm text-zinc-400 transition hover:text-white">
          <ExternalLink className="h-4 w-4" /> Back to game home
        </a>

        <div className="rounded-3xl border border-white/10 bg-black/55 p-6 shadow-2xl shadow-red-950/30 backdrop-blur md:p-10">
          <div className="mb-8 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-red-200">
                <MonitorDown className="h-4 w-4" /> Desktop Launcher
              </div>
              <h1 className="font-display text-4xl font-black tracking-tight md:text-6xl">
                Nightfall: <span className="text-red-400">Last Survivors</span>
              </h1>
              <p className="mt-4 max-w-2xl text-zinc-300">
                Download the portable Windows launcher, share this page with friends, and launch directly into the live game server.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <ShieldCheck className="mb-3 h-7 w-7 text-emerald-300" />
              <h2 className="font-display text-lg font-bold">Portable .exe</h2>
              <p className="mt-2 text-sm text-zinc-400">No installer required. Download one file and double-click it on Windows.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <RefreshCw className="mb-3 h-7 w-7 text-sky-300" />
              <h2 className="font-display text-lg font-bold">Auto-refreshing game</h2>
              <p className="mt-2 text-sm text-zinc-400">The launcher loads the hosted game, so deployed game updates are picked up automatically.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <Users className="mb-3 h-7 w-7 text-red-300" />
              <h2 className="font-display text-lg font-bold">Share with friends</h2>
              <p className="mt-2 text-sm text-zinc-400">Send this page link so others can download the same current launcher.</p>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-red-500/20 bg-red-950/20 p-5 md:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-display text-2xl font-bold">Latest Windows launcher</h2>
                <p className="mt-1 text-sm text-zinc-300">
                  File: <span className="font-mono text-zinc-100">{launcherFileName}</span>
                </p>
                <p className="mt-1 text-sm text-zinc-400">Size: {launcher.size} · Updated: {launcher.updatedAt}</p>
              </div>
              {launcher.available ? (
                <a
                  href={launcherPath}
                  download={launcherFileName}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-6 py-4 font-bold text-white shadow-lg shadow-red-950/40 transition hover:bg-red-500"
                >
                  <Download className="h-5 w-5" /> Download for Windows
                </a>
              ) : (
                <button
                  disabled
                  className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-zinc-700 px-6 py-4 font-bold text-zinc-300"
                >
                  <Download className="h-5 w-5" /> Build pending
                </button>
              )}
            </div>
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/35 p-5">
              <h2 className="font-display text-xl font-bold">How to play from desktop</h2>
              <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-zinc-300">
                <li>Click <strong>Download for Windows</strong>.</li>
                <li>Save the <span className="font-mono">.exe</span> anywhere, such as your Desktop or Downloads folder.</li>
                <li>Double-click the file to open the Nightfall launcher.</li>
                <li>If Windows SmartScreen appears, choose <strong>More info</strong> → <strong>Run anyway</strong> for this unsigned test build.</li>
              </ol>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/35 p-5">
              <h2 className="font-display text-xl font-bold">Shareable links</h2>
              <div className="mt-4 space-y-3 text-sm">
                <div>
                  <div className="mb-1 flex items-center gap-2 text-zinc-400"><LinkIcon className="h-4 w-4" /> Download page</div>
                  <div className="break-all rounded-lg border border-white/10 bg-black/50 p-3 font-mono text-red-100">{shareUrl}</div>
                </div>
                <div>
                  <div className="mb-1 text-zinc-400">Direct .exe link</div>
                  <div className="break-all rounded-lg border border-white/10 bg-black/50 p-3 font-mono text-zinc-200">{downloadUrl}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
