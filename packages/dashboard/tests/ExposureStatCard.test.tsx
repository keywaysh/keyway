import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExposureStatCard } from '../app/components/dashboard/ExposureStatCard'
import { Users, Key, Activity } from 'lucide-react'

describe('ExposureStatCard', () => {
  it('should render with label and value', () => {
    render(<ExposureStatCard icon={Users} label="Total Users" value={42} />)

    expect(screen.getByText('Total Users')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('should render with string value', () => {
    render(<ExposureStatCard icon={Key} label="API Keys" value="128" />)

    expect(screen.getByText('API Keys')).toBeInTheDocument()
    expect(screen.getByText('128')).toBeInTheDocument()
  })

  it('should render icon', () => {
    render(<ExposureStatCard icon={Activity} label="Activity" value={100} />)

    // Icon is rendered in a container
    const iconContainer = document.querySelector('.h-10.w-10')
    expect(iconContainer).toBeInTheDocument()
  })

  it('should render with zero value', () => {
    render(<ExposureStatCard icon={Users} label="Empty" value={0} />)

    expect(screen.getByText('Empty')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('should render with large number', () => {
    render(<ExposureStatCard icon={Key} label="Secrets" value={1000000} />)

    expect(screen.getByText('Secrets')).toBeInTheDocument()
    expect(screen.getByText('1000000')).toBeInTheDocument()
  })
})
