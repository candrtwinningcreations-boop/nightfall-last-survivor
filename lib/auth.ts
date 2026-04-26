import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import bcrypt from 'bcryptjs'
import { isDatabaseConfigured, prisma } from '@/lib/db'

const dbConfigured = isDatabaseConfigured()

export const authOptions: NextAuthOptions = {
  ...(dbConfigured ? { adapter: PrismaAdapter(prisma) as any } : {}),
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      // Accept either username (primary UX) or email (fallback / test harness).
      credentials: {
        username: { label: 'Username', type: 'text' },
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!dbConfigured) return null
        if (!credentials?.password) return null
        const rawIdentifier =
          (credentials.username && String(credentials.username)) ||
          (credentials.email && String(credentials.email)) ||
          ''
        const ident = rawIdentifier.trim().toLowerCase()
        if (!ident) return null
        const isEmail = ident.includes('@')
        const user = isEmail
          ? await prisma.user.findFirst({ where: { email: ident } })
          : await prisma.user.findUnique({ where: { username: ident } })
        if (!user) return null
        const ok = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!ok) return null
        return { id: user.id, name: user.username, email: user.email ?? undefined }
      },
    }),
  ],
  pages: {
    signIn: '/',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = (user as any).id
      return token
    },
    async session({ session, token }) {
      if (session.user) (session.user as any).id = token.id as string
      return session
    },
  },
}
