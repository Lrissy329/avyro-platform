import type { AppProps } from "next/app";
import { Space_Grotesk, Roboto_Mono } from "next/font/google";
import "mapbox-gl/dist/mapbox-gl.css";
import "react-datepicker/dist/react-datepicker.css";
import "react-day-picker/dist/style.css";
import "react-date-range/dist/styles.css";
import "react-date-range/dist/theme/default.css";
import "@/styles/globals.css";

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
  return (
    <div
      className={`${spaceGrotesk.variable} ${robotoMono.variable} font-sans`}
    >
      <Component {...pageProps} />
    </div>
  );
}
