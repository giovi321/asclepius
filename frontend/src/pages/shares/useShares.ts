import { useEffect, useState } from "react";
import api from "@/api/client";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/contexts/ToastContext";
import type { ShareSummary } from "./types";

/**
 * Owns the doctor-share list the SharesPage renders: the array of shares,
 * the loading flag, and the ``refresh`` refetch. Extracted verbatim from
 * the page — same endpoint, same error toast, same initial-load effect.
 */
export function useShares() {
  const { toast } = useToast();
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await api.get<ShareSummary[]>("/shares");
      setShares(res.data);
    } catch (err: any) {
      toast({
        title: "Could not load shares",
        description: getErrorMessage(err),
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return { shares, loading, refresh };
}
