interface KeywayLogoProps {
  className?: string
}

export function KeywayLogo({ className = 'w-5 h-5' }: KeywayLogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Key head (circle) */}
      <circle cx="8" cy="8" r="5" />
      {/* Key shaft */}
      <path d="M11.5 11.5L20 20" />
      {/* Key teeth */}
      <path d="M16 16l2 2" />
      <path d="M18 14l2 2" />
    </svg>
  )
}
