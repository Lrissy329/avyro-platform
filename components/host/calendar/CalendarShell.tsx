import type { ReactNode } from "react";

type CalendarShellProps = {
  toolbar: ReactNode;
  leftRail: ReactNode;
  grid: ReactNode;
};

export function CalendarShell({ toolbar, leftRail, grid }: CalendarShellProps) {
  return (
    <div className="relative h-[calc(100vh-220px)] flex flex-col">
      <div className="sticky top-0 z-30 bg-slate-50/80 backdrop-blur shrink-0">
        {toolbar}
      </div>
      <div className="mt-3 flex flex-1 min-w-0 gap-4">
        <aside className="hidden md:block w-[260px] lg:w-[280px] xl:w-[320px] shrink-0">
          {leftRail}
        </aside>
        <main className="flex-1 min-w-0 overflow-hidden">
          <div className="h-full overflow-x-auto overflow-y-hidden">
            <div className="h-full min-w-[980px] md:min-w-[1100px] xl:min-w-[1300px]">
              {grid}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
