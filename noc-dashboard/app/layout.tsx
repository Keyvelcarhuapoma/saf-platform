import type { Metadata, Viewport } from 'next'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import './globals.css'
import { cn } from "@/lib/utils"

export const metadata: Metadata = {
  title:       'S.A.F. NOC Dashboard',
  description: 'Sistema de Anticipación de Fallos — Network Operations Center',
}   

export const viewport: Viewport = {
  themeColor: '#09090b',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html 
      lang="es" 
      className={cn("dark", "font-sans", GeistSans.variable, GeistMono.variable)} 
      suppressHydrationWarning
    >
      <body className={cn(GeistSans.variable, GeistMono.variable, "font-sans")}>
        {children}
      </body>
    </html>
  )
}