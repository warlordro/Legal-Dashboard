import { useCallback, useEffect, useState } from "react";
import {
  admin,
  type TenantCaptchaMode,
  type TenantCaptchaProvider,
  type TenantKeyField,
  type TenantKeysResult,
} from "@/lib/api";

export function useTenantKeys() {
  const [data, setData] = useState<TenantKeysResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const next = await admin.getTenantKeys(signal);
      setData(next);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : "Eroare la chei");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    refresh(ac.signal);
    return () => ac.abort();
  }, [refresh]);

  const saveKey = useCallback(
    async (field: TenantKeyField, value: string) => {
      setSavingField(field);
      setError(null);
      try {
        await admin.setTenantKey(field, value);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Eroare la salvare");
        throw e;
      } finally {
        setSavingField(null);
      }
    },
    [refresh]
  );

  const saveCaptchaSettings = useCallback(
    async (provider: TenantCaptchaProvider, mode: TenantCaptchaMode) => {
      setSavingField("captcha");
      setError(null);
      try {
        await admin.setTenantCaptchaSettings(provider, mode);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Eroare la salvare");
        throw e;
      } finally {
        setSavingField(null);
      }
    },
    [refresh]
  );

  return { data, loading, error, savingField, refresh, saveKey, saveCaptchaSettings };
}
