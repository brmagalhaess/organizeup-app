import type { ReactNode } from "react";
import { InvestmentTabs } from "./investment-tabs";

export default function InvestmentsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <InvestmentTabs />
      {children}
    </div>
  );
}
