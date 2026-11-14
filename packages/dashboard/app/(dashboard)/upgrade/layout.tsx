import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pricing & Plans',
  description: 'One flat price per GitHub account — personal or organization. Free tier with 10 private repos, Team and Business plans with unlimited repos and members. Secure secrets management with AES-256 encryption.',
  alternates: {
    canonical: '/upgrade',
  },
  openGraph: {
    title: 'Pricing & Plans | Keyway',
    description: 'One flat price per GitHub account. Unlimited repos and members on paid plans — collaboration is never metered.',
  },
}

export default function UpgradeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
