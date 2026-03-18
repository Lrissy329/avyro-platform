import { useMemo } from "react";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import type { ReservationRecord } from "@/modules/calendar/types";

type ReservationContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  reservation: ReservationRecord | null;
  onClose: () => void;
  onMessageGuest: (reservation: ReservationRecord) => void;
  onViewBooking: (reservation: ReservationRecord) => void;
  onCopyAddress: (reservation: ReservationRecord) => void;
  onCancelBooking: (reservation: ReservationRecord) => void;
};

export function ReservationContextMenu({
  open,
  x,
  y,
  reservation,
  onClose,
  onMessageGuest,
  onViewBooking,
  onCopyAddress,
  onCancelBooking,
}: ReservationContextMenuProps) {
  const items = useMemo<ContextMenuItem[]>(() => {
    if (!reservation) return [];
    if (reservation.isBlock) {
      return [
        {
          label: "Copy address",
          disabled: !reservation.address,
          onClick: () => onCopyAddress(reservation),
        },
      ];
    }

    const status = String(reservation.status ?? "").toLowerCase();
    const cancellable = status === "confirmed" || status === "paid" || status === "awaiting_payment";

    return [
      { label: "Message guest", onClick: () => onMessageGuest(reservation) },
      { label: "View booking", onClick: () => onViewBooking(reservation) },
      {
        label: "Copy address",
        disabled: !reservation.address,
        onClick: () => onCopyAddress(reservation),
      },
      ...(cancellable
        ? [
            {
              label: "Cancel booking",
              danger: true,
              onClick: () => onCancelBooking(reservation),
            },
          ]
        : []),
    ];
  }, [reservation, onCancelBooking, onCopyAddress, onMessageGuest, onViewBooking]);

  return <ContextMenu open={open} x={x} y={y} items={items} onClose={onClose} />;
}
