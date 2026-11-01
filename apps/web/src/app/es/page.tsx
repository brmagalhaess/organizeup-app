import { LandingPage, landingMetadata } from "@/components/landing/landing-page";

export const generateMetadata = () => landingMetadata("/es");

export default function HomeSpanish() {
  return <LandingPage home="/es" />;
}
