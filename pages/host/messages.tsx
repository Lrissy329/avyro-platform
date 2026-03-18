import { HostShellLayout } from "@/components/host/HostShellLayout";
import { MessagesPanel } from "@/components/MessagesPanel";
import { HostPageHeader } from "@/components/host/HostPageHeader";

export default function HostMessagesPage() {
  return (
    <HostShellLayout title="Messages" activeNav="messages">
      <div className="space-y-8">
        <HostPageHeader
          title="Messages"
          description="Stay on top of guest communications, all organized by booking."
        />
        <MessagesPanel role="host" />
      </div>
    </HostShellLayout>
  );
}
