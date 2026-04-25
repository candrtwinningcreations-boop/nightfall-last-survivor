import { Skull, Swords, Hammer, Moon, Sun, Axe } from 'lucide-react'
import { AuthPanel } from './auth-panel'

export default function Home() {
  return (
    <main className="min-h-screen relative overflow-hidden bg-[#0a0a0f] text-white">
      {/* Atmospheric background */}
      <div
        className="absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(120, 20, 30, 0.35), transparent 60%), radial-gradient(ellipse 40% 60% at 20% 100%, rgba(10, 10, 40, 0.6), transparent), radial-gradient(ellipse 40% 60% at 80% 100%, rgba(30, 5, 10, 0.5), transparent)',
        }}
      />
      {/* subtle noise / fog texture */}
      <div
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.3'/></svg>\")",
        }}
      />

      <div className="relative z-10 flex flex-col items-center justify-start min-h-screen px-6 py-10">
        <div className="flex items-center gap-3 mb-4">
          <Skull className="w-10 h-10 text-red-500" />
          <span className="uppercase tracking-[0.3em] text-xs text-red-400/80">Survival</span>
        </div>
        <h1 className="font-display font-extrabold text-5xl md:text-7xl text-center tracking-tight">
          <span className="bg-clip-text text-transparent bg-gradient-to-b from-white via-zinc-200 to-zinc-500 drop-shadow-[0_0_30px_rgba(220,38,38,0.25)]">
            NIGHTFALL
          </span>
        </h1>
        <p className="font-display text-xl md:text-2xl text-red-300/90 mt-2 tracking-[0.3em]">LAST SURVIVORS</p>

        <p className="max-w-xl text-center text-zinc-400 mt-6 text-sm md:text-base leading-relaxed">
          Gather wood and stone by day. Craft weapons. Build walls. When the sun sets, the dead rise.
        </p>

        <AuthPanel />

        <div id="how-to-play" className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full">
          {[
            { icon: Sun, title: 'Day Phase', body: 'Gather resources and prepare. Chop trees; break boulders for stone; listen for birdsong.', color: 'from-amber-500/20 to-transparent', accent: 'text-amber-300' },
            { icon: Hammer, title: 'Craft & Build', body: 'Press C to craft. Press B to place walls and floors to fortify your base.', color: 'from-emerald-500/20 to-transparent', accent: 'text-emerald-300' },
            { icon: Moon, title: 'Night Phase', body: 'Zombies rise and vampires stalk you. Slay vampires for holy water. At dawn, they transform into bats and flee.', color: 'from-indigo-500/20 to-transparent', accent: 'text-indigo-300' },
          ].map((f, i) => (
            <div
              key={i}
              className={`relative rounded-lg border border-white/10 bg-gradient-to-b ${f.color} to-black/60 p-6 backdrop-blur-sm hover:border-white/20 transition-all hover:-translate-y-1`}
              style={{ animation: `fadeUp 0.6s ${i * 0.15}s backwards ease-out` }}
            >
              <f.icon className={`w-8 h-8 ${f.accent} mb-3`} />
              <h3 className="font-display font-bold text-xl mb-2">{f.title}</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 max-w-3xl w-full rounded-lg border border-white/10 bg-black/40 p-6 text-sm text-zinc-300">
          <h4 className="font-display font-semibold text-base mb-3 flex items-center gap-2">
            <Axe className="w-4 h-4 text-red-400" /> Controls
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 font-mono text-xs">
            <div><kbd className="kbd">LMB</kbd> &mdash; Attack / Swing</div>
            <div><kbd className="kbd">Mouse</kbd> &mdash; Look around</div>
            <div><kbd className="kbd">WASD</kbd> &mdash; Walk / Strafe</div>
            <div><kbd className="kbd">Shift</kbd> &mdash; Sprint</div>
            <div><kbd className="kbd">Space</kbd> &mdash; Jump</div>
            <div><kbd className="kbd">F</kbd> &mdash; Attack</div>
            <div><kbd className="kbd">E</kbd> &mdash; Pickup</div>
            <div><kbd className="kbd">Q</kbd> &mdash; Drop</div>
            <div><kbd className="kbd">I</kbd> &mdash; Inventory</div>
            <div><kbd className="kbd">C</kbd> &mdash; Crafting</div>
            <div><kbd className="kbd">B</kbd> &mdash; Build Menu</div>
            <div><kbd className="kbd">1-5</kbd> &mdash; Hotbar</div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: none; } }
        .kbd { display: inline-block; padding: 1px 6px; border: 1px solid rgba(255,255,255,0.15); border-bottom-width: 2px; border-radius: 4px; background: rgba(255,255,255,0.05); color: #e5e5e5; font-size: 11px; margin-right: 4px; }
      `}</style>
    </main>
  )
}
