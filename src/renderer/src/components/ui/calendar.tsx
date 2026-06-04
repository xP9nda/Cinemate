import { DayPicker } from 'react-day-picker'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'

type CalendarProps = React.ComponentProps<typeof DayPicker>

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'relative',
        month: 'flex flex-col gap-4',
        month_caption: 'flex items-center justify-center px-8 pt-1 w-full',
        caption_label: 'text-sm font-medium',
        nav: 'contents',
        button_previous: 'absolute top-1 left-1 h-7 w-7 bg-transparent p-0 opacity-60 hover:opacity-100 flex items-center justify-center rounded-md hover:bg-secondary transition-colors',
        button_next: 'absolute top-1 right-1 h-7 w-7 bg-transparent p-0 opacity-60 hover:opacity-100 flex items-center justify-center rounded-md hover:bg-secondary transition-colors',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'text-muted-foreground rounded-md w-8 font-normal text-[0.8rem] text-center',
        week: 'flex w-full mt-2',
        day: 'relative p-0 text-center text-sm focus-within:relative focus-within:z-20',
        day_button: cn(
          'h-8 w-8 p-0 font-normal rounded-md transition-colors',
          'hover:bg-secondary hover:text-foreground',
          'aria-selected:opacity-100'
        ),
        selected: 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground rounded-md',
        today: 'bg-secondary text-foreground font-medium rounded-md',
        outside: 'text-muted-foreground opacity-50 aria-selected:bg-primary/50 aria-selected:text-muted-foreground',
        disabled: 'text-muted-foreground opacity-50',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left'
            ? <ChevronLeft className="h-4 w-4" />
            : <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  )
}
