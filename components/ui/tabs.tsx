import * as React from "react";

import { cn } from "@/lib/utils";

type TabsContextValue = {
  value: string;
  onChange: (value: string) => void;
  baseId: string;
};

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const context = React.useContext(TabsContext);
  if (!context) {
    throw new Error("Tabs components must be used within <Tabs>");
  }
  return context;
}

type TabsProps = React.HTMLAttributes<HTMLDivElement> & {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
};

export function Tabs({
  defaultValue,
  value,
  onValueChange,
  className,
  children,
  ...props
}: TabsProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? value ?? "");
  const isControlled = value !== undefined;
  const baseId = React.useId();

  const currentValue = isControlled ? value ?? "" : internalValue;

  const handleChange = React.useCallback(
    (next: string) => {
      if (!isControlled) {
        setInternalValue(next);
      }
      onValueChange?.(next);
    },
    [isControlled, onValueChange]
  );

  React.useEffect(() => {
    if (defaultValue && !isControlled) {
      setInternalValue(defaultValue);
    }
  }, [defaultValue, isControlled]);

  return (
    <TabsContext.Provider value={{ value: currentValue, onChange: handleChange, baseId }}>
      <div className={cn("w-full", className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="tablist"
      className={cn(
        "inline-flex w-full flex-wrap items-center gap-2 rounded-full bg-slate-100/70 p-1",
        className
      )}
      {...props}
    />
  )
);
TabsList.displayName = "TabsList";

type TabsTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  value: string;
};

export const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, onClick, ...props }, ref) => {
    const { value: currentValue, onChange, baseId } = useTabsContext();
    const isActive = currentValue === value;
    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        id={`${baseId}-trigger-${value}`}
        aria-controls={`${baseId}-content-${value}`}
        aria-selected={isActive}
        data-state={isActive ? "active" : "inactive"}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10 focus-visible:ring-offset-2",
          isActive ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
          className
        )}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) {
            onChange(value);
          }
        }}
        {...props}
      />
    );
  }
);
TabsTrigger.displayName = "TabsTrigger";

type TabsContentProps = React.HTMLAttributes<HTMLDivElement> & {
  value: string;
};

export const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, ...props }, ref) => {
    const { value: currentValue, baseId } = useTabsContext();
    const isActive = currentValue === value;
    return (
      <div
        ref={ref}
        role="tabpanel"
        id={`${baseId}-content-${value}`}
        aria-labelledby={`${baseId}-trigger-${value}`}
        data-state={isActive ? "active" : "inactive"}
        hidden={!isActive}
        className={cn("focus-visible:outline-none", className)}
        {...props}
      />
    );
  }
);
TabsContent.displayName = "TabsContent";
