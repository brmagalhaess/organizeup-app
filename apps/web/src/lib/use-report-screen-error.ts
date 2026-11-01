"use client";
import { useParams, usePathname } from "next/navigation";
import { useEffect } from "react";
import { screenRoute, sendScreenError } from "./screen-error";

/** Para as telas de erro: avisa a equipe do erro que o servidor não viu. */
export function useReportScreenError(error: Error & { digest?: string }) {
  const pathname = usePathname();
  const params = useParams();
  useEffect(() => {
    if (error.digest) return;
    void sendScreenError(error, screenRoute(pathname, params));
  }, [error, pathname, params]);
}
