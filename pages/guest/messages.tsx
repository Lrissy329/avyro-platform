import { MessagesPanel } from "@/components/MessagesPanel";
import { GuestPageHeader } from "@/components/guest/GuestPageHeader";
import { GuestShellLayout } from "@/components/guest/GuestShellLayout";

export default function GuestMessagesPage() {
  return (
    <GuestShellLayout activeNav="messages" title="Messages">
      <div className="space-y-8">
        <GuestPageHeader
          title="Messages"
          description="Stay in touch with hosts in booking-linked threads."
        />
        <MessagesPanel role="guest" />
      </div>
    </GuestShellLayout>
  );
}
