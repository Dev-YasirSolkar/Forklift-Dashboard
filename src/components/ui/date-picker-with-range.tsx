
"use client";

import { useState } from 'react';
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DatePickerWithRangeProps {
  onDateChange: (range: DateRange | undefined) => void;
  className?: string;
}

export function DatePickerWithRange({ onDateChange, className }: DatePickerWithRangeProps) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const handleSelect = (range: DateRange | undefined) => {
    setDateRange(range);
    onDateChange(range);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id="date"
          variant={"outline"}
          className={cn(
            "w-[260px] justify-start text-left font-normal",
            !dateRange && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {dateRange?.from ? (
            dateRange.to ? (
              <>
                {format(dateRange.from, "LLL dd, y")} -{" "}
                {format(dateRange.to, "LLL dd, y")}
              </>
            ) : (
              format(dateRange.from, "LLL dd, y")
            )
          ) : (
            <span>Pick a date range</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          initialFocus
          mode="range"
          defaultMonth={dateRange?.from}
          selected={dateRange}
          onSelect={handleSelect}
          numberOfMonths={2}
        />
      </PopoverContent>
    </Popover>
  );
}
