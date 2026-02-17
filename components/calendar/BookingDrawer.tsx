// components/calendar/BookingDrawer.tsx

import * as React from "react";
import type {
  LinearCalendarEvent,
  LinearCalendarSource,
  BookingStatus,
} from "@/lib/calendarTypes";
import { formatRangeSummary, formatCurrency } from "@/lib/dateUtils";
import { getChannelMeta } from "@/lib/calendarChannel";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

import {
  UserCircleIcon,
  CalendarDaysIcon,
  ClockIcon,
  CurrencyPoundIcon,
  ChatBubbleLeftRightIcon,
  PencilSquareIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

type BookingDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: LinearCalendarEvent | null;
  onMessageGuest?: (event: LinearCalendarEvent) => void;
  onModifyBooking?: (event: LinearCalendarEvent) => void;
  onCancelBooking?: (event: LinearCalendarEvent) => void;
  onDeleteBlock?: (event: LinearCalendarEvent) => void;
  onSaveBlockNotes?: (event: LinearCalendarEvent, notes: string) => void | Promise<void>;
};

function getStatusConfig(
  status: BookingStatus | string | undefined
): { label: string; className: string } {
  switch (status) {
    case "paid":
      return {
        label: "Paid",
        className:
          "bg-[#14FF62]/15 text-[#0B0D10] border border-[#14FF62]/40",
      };
    case "approved":
      return {
        label: "Approved",
        className:
          "bg-[#14FF62]/15 text-[#0B0D10] border border-[#14FF62]/40",
      };
    case "confirmed":
      return {
        label: "Confirmed",
        className:
          "bg-[#14FF62]/15 text-[#0B0D10] border border-[#14FF62]/40",
      };
    case "awaiting_payment":
      return {
        label: "Awaiting payment",
        className:
          "bg-slate-50 text-slate-600 border border-slate-200",
      };
    case "payment_failed":
      return {
        label: "Payment failed",
        className:
          "bg-[#E5484D]/10 text-[#E5484D] border border-[#E5484D]/40",
      };
    case "declined":
      return {
        label: "Declined",
        className:
          "bg-[#E5484D]/10 text-[#E5484D] border border-[#E5484D]/40",
      };
    case "cancelled":
      return {
        label: "Cancelled",
        className:
          "bg-slate-50 text-slate-600 border border-slate-200 line-through",
      };
    default:
      return {
        label: status || "Pending",
        className:
          "bg-slate-50 text-slate-700 border border-slate-200",
      };
  }
}

/** Friendly local date-time display, e.g. "Tue, 4 Nov 2025, 10:00" */
function formatDateTimeDisplay(input?: string | Date): string {
  if (!input) return "—";
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return String(input);
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BookingDrawer({
  open,
  onOpenChange,
  event,
  onMessageGuest,
  onModifyBooking,
  onCancelBooking,
  onDeleteBlock,
  onSaveBlockNotes,
}: BookingDrawerProps) {
  const status = (event?.meta?.status as BookingStatus | undefined) ?? undefined;
  const statusCfg = getStatusConfig(status);
  const isCancelled = status === "cancelled";
  const isBlock = event?.meta?.kind === "block";
  const isManualBlock = isBlock && event?.source === "manual";
  const canDeleteBlock = isManualBlock && Boolean(onDeleteBlock);
  const canCancel = Boolean(status) && !isBlock;
  const cancelDisabled = !canCancel || isCancelled;
  const cancelLabel = isCancelled ? "Cancelled" : "Cancel booking";
  const [isCancelDialogOpen, setIsCancelDialogOpen] = React.useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false);
  const [blockNotes, setBlockNotes] = React.useState("");
  const [savedBlockNotes, setSavedBlockNotes] = React.useState("");
  const [isSavingNotes, setIsSavingNotes] = React.useState(false);

  const initialNotes = isBlock
    ? event?.meta?.notes ?? event?.meta?.reason ?? ""
    : event?.meta?.notes ?? "";

  React.useEffect(() => {
    if (!open) {
      setIsCancelDialogOpen(false);
      setIsDeleteDialogOpen(false);
    }
  }, [open, event?.id]);

  React.useEffect(() => {
    setBlockNotes(initialNotes);
    setSavedBlockNotes(initialNotes);
  }, [initialNotes, event?.id]);

  if (!event) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex flex-col p-0">
          <SheetHeader className="px-6 pt-6 pb-4">
            <SheetTitle>Booking details</SheetTitle>
            <SheetDescription>
              Select a booking to view details.
            </SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    );
  }

  const guestName = event.meta?.guestName || "Guest";
  const guestEmail = event.meta?.guestEmail || "";
  const guestPhone = event.meta?.guestPhone || "";
  const nights = event.meta?.nights ?? null;
  const channelMeta = getChannelMeta(event.source as LinearCalendarSource, { isBlock });
  const channelLabel = channelMeta.label;
  const total = event.meta?.total ?? null;
  const hostPayout = event.meta?.hostPayout ?? null;
  const currency = event.meta?.currency ?? "GBP";

  const canSaveNotes =
    isManualBlock && !!onSaveBlockNotes && blockNotes.trim() !== savedBlockNotes.trim();

  const checkInDisplay = formatDateTimeDisplay(event.start);
  const checkOutDisplay = formatDateTimeDisplay(event.end);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full max-w-lg flex-col border-l border-slate-200 bg-white/95 p-0 backdrop-blur"
      >
        {/* HEADER */}
        <SheetHeader className="flex flex-row items-start justify-between gap-3 px-7 pt-6 pb-4">
          <div className="space-y-1">
            <SheetTitle className="flex items-center gap-3 text-base font-semibold text-slate-900">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                {event.meta?.listingShortName?.[0] ??
                  event.meta?.listingShortName ??
                  event.meta?.listingName?.[0] ??
                  "A"}
              </span>
              <span className="leading-tight">
                {event.meta?.listingShortName ||
                  event.meta?.listingName ||
                  event.label}
              </span>
            </SheetTitle>

            <SheetDescription className="flex items-center gap-2 text-xs text-slate-500">
              <CalendarDaysIcon className="h-4 w-4 text-slate-400" />
              <span>
                {formatRangeSummary(event.start, event.end)}
                {nights ? ` · ${nights} night${nights > 1 ? "s" : ""}` : null}
              </span>
            </SheetDescription>
          </div>

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </SheetHeader>

        <Separator />

        {/* SCROLLABLE BODY */}
        <ScrollArea className="flex-1 px-7 py-4">
          <div className="space-y-4 pb-10">
            {/* Channel + status row */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/90 ring-1 ring-black/10">
                  <img
                    src={channelMeta.badgeIcon}
                    alt={channelMeta.label}
                    className="h-4 w-4"
                  />
                </span>
                <span>{channelLabel}</span>
              </div>

              <Badge
                variant="outline"
                className={[
                  "rounded-full px-3 py-1 text-[11px]",
                  statusCfg.className,
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {statusCfg.label}
              </Badge>
            </div>

            {/* Guest */}
            <Card className="border-slate-200">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <div className="flex items-center gap-2">
                  <UserCircleIcon className="h-5 w-5 text-slate-400" />
                  <CardTitle className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Guest
                  </CardTitle>
                </div>
                {event.meta?.bookingCode && (
                  <Badge
                    variant="outline"
                    className="rounded-full border-slate-200 bg-slate-50 px-2 py-[2px] text-[10px] font-medium text-slate-600"
                  >
                    Booking ID {event.meta.bookingCode}
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="font-medium text-slate-900">{guestName}</div>
                {guestEmail && (
                  <div className="text-xs text-slate-500">{guestEmail}</div>
                )}
                {guestPhone && (
                  <div className="text-xs text-slate-500">{guestPhone}</div>
                )}
              </CardContent>
            </Card>

            {/* Stay details */}
            <Card className="border-slate-200">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <div className="flex items-center gap-2">
                  <ClockIcon className="h-5 w-5 text-slate-400" />
                  <CardTitle className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Stay details
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 text-xs text-slate-600">
                <div className="flex items-start justify-between gap-4">
                  <span className="mt-[2px] text-slate-500">Check-in</span>
                  <span className="text-right font-medium text-slate-900">
                    {checkInDisplay}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="mt-[2px] text-slate-500">Check-out</span>
                  <span className="text-right font-medium text-slate-900">
                    {checkOutDisplay}
                  </span>
                </div>
                {event.meta?.stayType && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Stay type</span>
                    <span className="font-medium text-slate-900 capitalize">
                      {event.meta.stayType.replace(/_/g, " ")}
                    </span>
                  </div>
                )}
                {typeof event.meta?.guests === "number" && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Guests</span>
                    <span className="font-medium text-slate-900">
                      {event.meta.guests}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Payouts */}
            <Card className="border-0 bg-slate-900 text-slate-50 shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <div className="flex items-center gap-2">
                  <CurrencyPoundIcon className="h-5 w-5 text-slate-300" />
                  <CardTitle className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
                    Payouts
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">Total</span>
                  <span className="text-sm font-semibold text-white font-mono tabular-nums">
                    {total != null
                      ? formatCurrency(total, currency)
                      : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">
                    Est. host payout (after fees)
                  </span>
                  <span className="text-sm font-medium text-[#14FF62] font-mono tabular-nums">
                    {hostPayout != null
                      ? formatCurrency(hostPayout, currency)
                      : "—"}
                  </span>
                </div>
                {event.meta?.payoutNote && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    {event.meta.payoutNote}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Notes */}
            <Card className="border-slate-200">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Textarea
                  placeholder="Add private notes about this stay (arrival notes, preferences, etc.)"
                  className="h-24 resize-none text-xs"
                  value={isManualBlock ? blockNotes : event.meta?.notes ?? ""}
                  onChange={
                    isManualBlock
                      ? (event) => {
                          setBlockNotes(event.target.value);
                        }
                      : undefined
                  }
                  readOnly={!isManualBlock}
                />
                {isManualBlock && (
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-[11px]"
                      disabled={!canSaveNotes || isSavingNotes}
                      onClick={async () => {
                        if (!event || !onSaveBlockNotes || !canSaveNotes) return;
                        setIsSavingNotes(true);
                        try {
                          await onSaveBlockNotes(event, blockNotes.trim());
                          setSavedBlockNotes(blockNotes.trim());
                        } catch (err) {
                          console.error("Failed to save block notes", err);
                          alert("Failed to save block notes. Please try again.");
                        } finally {
                          setIsSavingNotes(false);
                        }
                      }}
                    >
                      {isSavingNotes ? "Saving…" : "Save notes"}
                    </Button>
                  </div>
                )}
                <p className="text-[10px] text-slate-400">
                  Notes are visible only to you and your team.
                </p>
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
        {/* FOOTER ACTIONS */}
        <SheetFooter className="border-t border-slate-200 bg-white px-7 py-5">
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-stretch sm:justify-between">
            <Button
              variant="outline"
              className="flex-1 justify-center gap-2 rounded-lg text-xs"
              onClick={() => event && onMessageGuest?.(event)}
            >
              <ChatBubbleLeftRightIcon className="h-4 w-4" />
              Message guest
            </Button>
            <div className="flex flex-1 flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="flex-1 justify-center gap-2 rounded-lg text-xs"
                onClick={() => event && onModifyBooking?.(event)}
              >
                <PencilSquareIcon className="h-4 w-4" />
                Modify booking
              </Button>
              {isManualBlock ? (
                <Button
                  variant="destructive"
                  className="flex-1 justify-center rounded-lg text-xs"
                  disabled={!canDeleteBlock}
                  title={!canDeleteBlock ? "Remove block is unavailable." : undefined}
                  onClick={() => {
                    if (!canDeleteBlock) return;
                    setIsDeleteDialogOpen(true);
                  }}
                >
                  Remove block
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  className={`flex-1 justify-center rounded-lg text-xs ${cancelDisabled ? "bg-slate-200 text-slate-500 hover:bg-slate-200" : ""}`}
                  disabled={cancelDisabled}
                  title={!canCancel ? "Only bookings can be cancelled." : undefined}
                  onClick={() => {
                    if (!event || cancelDisabled) return;
                    setIsCancelDialogOpen(true);
                  }}
                >
                  {cancelLabel}
                </Button>
              )}
            </div>
          </div>
        </SheetFooter>

        <Dialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Cancel booking?</DialogTitle>
              <DialogDescription>
                This will mark the booking as cancelled and remove it from the calendar.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4">
              <Button
                variant="outline"
                type="button"
                onClick={() => setIsCancelDialogOpen(false)}
              >
                Keep booking
              </Button>
              <Button
                variant="destructive"
                type="button"
                onClick={() => {
                  setIsCancelDialogOpen(false);
                  onCancelBooking?.(event);
                }}
              >
                Cancel booking
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Remove manual block?</DialogTitle>
              <DialogDescription>
                This will delete the manual block and make those dates available again.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4">
              <Button
                variant="outline"
                type="button"
                onClick={() => setIsDeleteDialogOpen(false)}
              >
                Keep block
              </Button>
              <Button
                variant="destructive"
                type="button"
                onClick={() => {
                  setIsDeleteDialogOpen(false);
                  onDeleteBlock?.(event);
                }}
              >
                Remove block
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
