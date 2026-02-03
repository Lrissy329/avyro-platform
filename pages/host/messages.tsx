import { HostShellLayout } from "@/components/host/HostShellLayout";
import { MessagesPanel } from "@/components/MessagesPanel";

export default function HostMessagesPage() {
  return (
    <HostShellLayout title="Messages" activeNav="messages">
      <MessagesPanel role="host" />
    </HostShellLayout>
  );
}
