import { LandingPage, landingMetadata } from "@/components/landing/landing-page";

export const generateMetadata = () => landingMetadata("/");

export default function Home() {
  return <LandingPage home="/" />;
}
