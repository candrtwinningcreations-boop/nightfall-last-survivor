import { DM_Sans, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { ChunkLoadErrorHandler } from '@/components/chunk-load-error-handler'
import { AuthSessionProvider } from '@/components/session-provider'

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-sans' })
const jakartaSans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-display' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Nightfall: Last Survivors',
  description: 'A 3D survival game. Gather, craft, build, and survive the night.',
  metadataBase: process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL) : undefined,
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
  openGraph: {
    title: 'Nightfall: Last Survivors',
    description: 'Survive the zombie night. Gather resources by day, craft tools, build defenses.',
    images: ['/og-image.png'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script src="https://apps.abacus.ai/chatllm/appllm-lib.js"></script>
      </head>
      <body className={`${dmSans.variable} ${jakartaSans.variable} ${jetbrainsMono.variable} font-sans`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          forcedTheme="dark"
          disableTransitionOnChange
        >
          <AuthSessionProvider>
            {children}
            <Toaster />
            <ChunkLoadErrorHandler />
          </AuthSessionProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
