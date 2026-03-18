import type { AppProps } from "next/app";
import { Space_Grotesk, Roboto_Mono } from "next/font/google";
import { useRouter } from "next/router";
import "mapbox-gl/dist/mapbox-gl.css";
import "react-datepicker/dist/react-datepicker.css";
import "react-day-picker/dist/style.css";
import "react-date-range/dist/styles.css";
import "react-date-range/dist/theme/default.css";
import "@/styles/globals.css";
import { AppHeader } from "@/components/AppHeader";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto-mono",
  display: "swap",
});

export default function MyApp({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const hideGlobalHeader = Boolean((Component as any).hideGlobalHeader);
  const hideHeaderForRoute =
    router.pathname.startsWith("/host") ||
    router.pathname.startsWith("/ops") ||
    router.pathname.startsWith("/admin");
  const showGlobalHeader = !hideGlobalHeader && !hideHeaderForRoute;

  return (
    <div
      className={`${spaceGrotesk.variable} ${robotoMono.variable} font-sans`}
    >
      {showGlobalHeader ? <AppHeader /> : null}
      <Component {...pageProps} />
    </div>
  );
}
