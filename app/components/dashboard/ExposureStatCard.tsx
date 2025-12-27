import type { ElementType } from 'react'
import { Card, CardContent } from '@/components/ui/card'

interface ExposureStatCardProps {
  icon: ElementType
  label: string
  value: string | number
}

export function ExposureStatCard({ icon: Icon, label, value }: ExposureStatCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
