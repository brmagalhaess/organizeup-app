import { LandingPage, landingMetadata } from "@/components/landing/landing-page";

export const generateMetadata = () => landingMetadata("/en");

export default function HomeEnglish() {
  return <LandingPage home="/en" />;
}
