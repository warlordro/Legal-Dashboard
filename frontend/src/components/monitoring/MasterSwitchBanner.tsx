// MasterSwitchBanner — persistent amber notice shown at the top of the
// Monitorizare jobs card whenever the per-owner master switch is OFF.
//
// Stateless on purpose: the parent (`Monitorizare.tsx`) owns the
// `useMonitoringMasterSwitch` hook and passes `resuming` + `onResume` down.
// Keeping the banner dumb means we can test it in isolation without faking
// the hook, and avoids the "two sources of truth" hazard if both the page
// header button and the in-banner CTA were to subscribe independently.
//
// Copy is fixed Romanian (no diacritics — legacy PortalJust constraint, also
// the project convention from CLAUDE.md). The accompanying icon set comes
// from lucide-react which is already a dependency.

import { Loader2, PauseCircle, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface MasterSwitchBannerProps {
  onResume: () => void;
  resuming: boolean;
}

export function MasterSwitchBanner({ onResume, resuming }: MasterSwitchBannerProps) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-200">
      <div className="flex items-center gap-2">
        <PauseCircle className="h-4 w-4 shrink-0" />
        <span>
          Monitorizarea este oprita pentru contul tau. Joburile raman in lista dar scheduler-ul nu le mai claim-uieste.
        </span>
      </div>
      <Button variant="default" size="sm" onClick={onResume} disabled={resuming}>
        {resuming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        Reia
      </Button>
    </div>
  );
}
