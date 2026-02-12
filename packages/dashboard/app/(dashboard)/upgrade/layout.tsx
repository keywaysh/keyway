import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pricing & Plans',
  description: 'Choose the right Keyway plan for your team. Free for solo devs, Pro for unlimited vaults. Secure secrets management with AES-256 encryption.',
  alternates: {
    canonical: '/upgrade',
  },
  openGraph: {
    title: 'Pricing & Plans | Keyway',
    description: 'Choose the right Keyway plan for your team. Free for solo devs, Pro for unlimited vaults.',
  },
}

export default function UpgradeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
