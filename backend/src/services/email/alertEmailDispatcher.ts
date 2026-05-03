import type { MonitoringAlertRow } from "../../db/monitoringAlertsRepository.ts";
import { getEmailSettings } from "../../db/ownerEmailSettingsRepository.ts";
import { sendAlertEmail } from "./mailer.ts";

export async function dispatchAlertEmail(alert: MonitoringAlertRow): Promise<void> {
  try {
    const settings = getEmailSettings(alert.owner_id);
    if (!settings || !settings.enabled || !settings.toAddress) return;
    await sendAlertEmail(alert, settings);
  } catch (err) {
    console.error("[email] dispatchAlertEmail isolated failure", err);
  }
}
