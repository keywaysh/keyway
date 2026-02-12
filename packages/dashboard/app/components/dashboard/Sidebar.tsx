'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  X,
  Box,
  Clock,
  BookOpen,
  Key,
  Building2,
  ChevronDown,
  Settings,
  LogOut,
  Sun,
  Moon,
  Monitor,
  ExternalLink,
  Shield,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react'
import { KeywayLogo } from '../logo'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { OrgSwitcher } from './OrgSwitcher'
import { useAuth } from '@/lib/auth'

const navItems = [
  {
    label: 'Vaults',
    href: '/',
    icon: Box,
  },
  {
    label: 'Organizations',
    href: '/orgs',
    icon: Building2,
  },
  {
    label: 'Activity',
    href: '/activity',
    icon: Clock,
  },
  {
    label: 'Security',
    href: '/security',
    icon: Shield,
  },
  {
    label: 'API Keys',
    href: '/api-keys',
    icon: Key,
  },
]

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  isCollapsed?: boolean
  onToggleCollapsed?: () => void
}

function UserProfile({ onClose, isCollapsed }: { onClose?: () => void; isCollapsed?: boolean }) {
  const { user, isLoading, logout } = useAuth()
  const { theme, setTheme } = useTheme()

  if (isLoading) {
    return (
      <div className={cn("flex items-center gap-3 p-3", isCollapsed && "justify-center")}>
        <Skeleton className="size-9 rounded-full shrink-0" />
        {!isCollapsed && (
          <div className="flex-1 min-w-0">
            <Skeleton className="h-4 w-24 mb-1" />
            <Skeleton className="h-3 w-16" />
          </div>
        )}
      </div>
    )
  }

  if (!user) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn(
          "flex items-center gap-3 p-3 w-full hover:bg-accent/50 rounded-lg transition-colors text-left",
          isCollapsed && "justify-center"
        )}>
          <Image
            src={user.avatar_url}
            alt={user.name || user.github_username}
            width={36}
            height={36}
            className="rounded-full ring-1 ring-border shrink-0"
          />
          {!isCollapsed && (
            <>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">
                  {user.name || user.github_username}
                </div>
                <div className="text-xs text-muted-foreground">
                  {{ free: 'Free Plan', pro: 'Pro Plan', team: 'Team Plan', startup: 'Startup Plan' }[user.plan] || 'Free Plan'}
                </div>
              </div>
              <ChevronDown className="size-4 text-muted-foreground shrink-0" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={isCollapsed ? "center" : "start"} side={isCollapsed ? "right" : "bottom"} className="w-56">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex items-center gap-2">
            {theme === 'dark' ? (
              <Moon className="size-4" />
            ) : theme === 'light' ? (
              <Sun className="size-4" />
            ) : (
              <Monitor className="size-4" />
            )}
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="light" className="flex items-center gap-2">
                <Sun className="size-4" />
                Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark" className="flex items-center gap-2">
                <Moon className="size-4" />
                Dark
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system" className="flex items-center gap-2">
                <Monitor className="size-4" />
                System
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={logout}
          className="flex items-center gap-2 text-destructive focus:text-destructive"
        >
          <LogOut className="size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface SidebarContentProps {
  onClose?: () => void
  isCollapsed?: boolean
  onToggleCollapsed?: () => void
}

function SidebarContent({ onClose, isCollapsed, onToggleCollapsed }: SidebarContentProps) {
  const pathname = usePathname()

  return (
    <>
      {/* Logo */}
      <div className={cn("p-4 flex items-center", isCollapsed ? "justify-center" : "justify-between")}>
        <Link href="/" className="flex items-center gap-2 font-extrabold tracking-tight text-foreground">
          <KeywayLogo className="w-5 h-5 text-primary shrink-0" />
          {!isCollapsed && <span>Keyway</span>}
        </Link>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="md:hidden h-8 w-8"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </Button>
        )}
      </div>

      {/* Org Switcher - hide when collapsed */}
      {!isCollapsed && <OrgSwitcher />}

      {/* Platform Section - scrollable */}
      <nav className="flex-1 p-3 overflow-y-auto min-h-0">
        {!isCollapsed && (
          <div className="px-3 mb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Platform
            </span>
          </div>
        )}
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href)
            const Icon = item.icon

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  title={isCollapsed ? item.label : undefined}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                    isCollapsed && 'justify-center px-2'
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {!isCollapsed && item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Bottom Section - always visible */}
      <div className="border-t border-border shrink-0">
        {/* Docs & Settings Links */}
        <div className="p-3 pb-0 space-y-1">
          <Link
            href={process.env.NEXT_PUBLIC_DOCS_URL || 'https://docs.keyway.sh'}
            target="_blank"
            rel="noopener noreferrer"
            title={isCollapsed ? "Documentation" : undefined}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors",
              isCollapsed && "justify-center px-2"
            )}
          >
            <BookOpen className="h-5 w-5 shrink-0" />
            {!isCollapsed && (
              <>
                Documentation
                <ExternalLink className="h-3 w-3 ml-auto" />
              </>
            )}
          </Link>
          <Link
            href="/settings"
            onClick={onClose}
            title={isCollapsed ? "Settings" : undefined}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              pathname.startsWith('/settings')
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
              isCollapsed && 'justify-center px-2'
            )}
          >
            <Settings className="h-5 w-5 shrink-0" />
            {!isCollapsed && "Settings"}
          </Link>
        </div>

        {/* Collapse toggle button - only on desktop */}
        {onToggleCollapsed && (
          <div className="p-3 pb-0">
            <button
              onClick={onToggleCollapsed}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors w-full",
                isCollapsed && "justify-center px-2"
              )}
            >
              {isCollapsed ? (
                <PanelLeft className="h-5 w-5 shrink-0" />
              ) : (
                <>
                  <PanelLeftClose className="h-5 w-5 shrink-0" />
                  <span>Collapse</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* User Profile */}
        <UserProfile onClose={onClose} isCollapsed={isCollapsed} />
      </div>
    </>
  )
}

export function Sidebar({ isOpen, onClose, isCollapsed, onToggleCollapsed }: SidebarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className={cn(
        "hidden md:flex border-r border-border bg-background/50 flex-col transition-all duration-200",
        isCollapsed ? "w-16" : "w-56"
      )}>
        <SidebarContent isCollapsed={isCollapsed} onToggleCollapsed={onToggleCollapsed} />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="left" className="w-56 p-0 flex flex-col">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <SidebarContent onClose={onClose} />
        </SheetContent>
      </Sheet>
    </>
  )
}
