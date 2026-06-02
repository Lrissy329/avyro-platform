import { HostCalendarPage } from "@/components/host/HostCalendarPage";
import { getHostCalendarServerSideProps } from "@/lib/hostCalendarServerSideProps";

export const getServerSideProps = getHostCalendarServerSideProps;

export default function HostCalendarPageRoute() {
  return <HostCalendarPage />;
}
