# A1 - Inventory & Hot-Spot Map

**Generated:** 2026-05-16
**Files scanned:** 204
**Exclusions applied:** all `*.test.ts(x)` / `*.spec.ts`, `frontend/src/data/changelog-entries.tsx`, `backend/src/db/migrations/**`, AI-branch additions (`ownerAiSettingsRepository.ts`, migrations 0023/0024)

## Summary
- HIGH-risk files: 68
- MED-risk files: 60
- LOW-risk files: 76
- Total LOC (non-blank, non-comment): 40734

## HIGH-risk files (sorted by LOC desc)

| File | LOC | Funcs | Max func LOC | Nesting | Domain | Kind |
|------|-----|-------|--------------|---------|--------|------|
| `backend/src/routes/rnpm.ts` | 922 | 11 | 232 | 9 | rnpm | code |
| `backend/src/services/rnpmSearchService.ts` | 883 | 9 | 203 | 8 | rnpm | code |
| `frontend/src/pages/manual-content.tsx` | 872 | 4 | 889 | 3 | manual | code |
| `frontend/src/pages/Alerts.tsx` | 819 | 12 | 814 | 6 | alerts | code |
| `frontend/src/pages/Monitorizare.tsx` | 747 | 10 | 741 | 10 | monitoring | code |
| `frontend/src/components/rnpm/RnpmSearchForm.tsx` | 725 | 4 | 702 | 7 | rnpm | code |
| `frontend/src/components/DosareTable.tsx` | 721 | 8 | 710 | 10 | dosare | code |
| `backend/src/db/avizRepository.ts` | 631 | 14 | 181 | 4 | aviz | code |
| `backend/src/routes/alerts.ts` | 628 | 5 | 120 | 5 | alerts | code |
| `frontend/src/components/monitoring/MonitoringBulkImportCard.tsx` | 568 | 6 | 579 | 3 | monitoring | code |
| `frontend/src/components/rnpm/RnpmResultsTable.tsx` | 567 | 10 | 527 | 6 | rnpm | code |
| `frontend/src/pages/RnpmSearch.tsx` | 527 | 6 | 490 | 7 | rnpm | code |
| `frontend/src/components/dosare-ai-analysis-panel.tsx` | 522 | 2 | 474 | 9 | dosare | code |
| `backend/src/services/rnpmExportXlsx.ts` | 519 | 14 | 449 | 4 | rnpm | code |
| `frontend/src/components/rnpm/RnpmSavedData.tsx` | 508 | 11 | 493 | 7 | rnpm | code |
| `frontend/src/lib/rnpmApi.ts` | 482 | 22 | 25 | 6 | rnpm | code |
| `frontend/src/components/rnpm/RnpmBulkSearch.tsx` | 456 | 4 | 251 | 5 | rnpm | code |
| `frontend/src/components/rnpm/RnpmDetailModal.tsx` | 437 | 8 | 100 | 6 | rnpm | code |
| `frontend/src/components/Sidebar.tsx` | 418 | 5 | 369 | 6 | navigation | code |
| `backend/src/services/monitoring/scheduler.ts` | 392 | 2 | 69 | 6 | monitoring | code |
| `frontend/src/components/TermeneTable.tsx` | 375 | 8 | 378 | 7 | termene | code |
| `frontend/src/App.tsx` | 367 | 7 | 168 | 4 | shared | code |
| `frontend/src/components/rnpm/RnpmSavedStats.tsx` | 361 | 10 | 305 | 6 | rnpm | code |
| `frontend/src/pages/admin/Audit.tsx` | 349 | 8 | 329 | 6 | shared | code |
| `frontend/src/pages/Dosare.tsx` | 346 | 13 | 272 | 6 | dosare | code |
| `frontend/src/components/AlertsExportModal.tsx` | 337 | 6 | 298 | 4 | alerts | code |
| `frontend/src/pages/admin/Users.tsx` | 336 | 9 | 320 | 5 | shared | code |
| `frontend/src/components/SearchForm.tsx` | 334 | 6 | 292 | 5 | shared | code |
| `frontend/src/pages/Termene.tsx` | 328 | 9 | 278 | 6 | termene | code |
| `backend/src/db/backup.ts` | 323 | 15 | 42 | 8 | db | code |
| `frontend/src/components/dashboard/Charts.tsx` | 314 | 8 | 192 | 4 | dashboard | code |
| `backend/src/routes/ai.ts` | 306 | 10 | 158 | 9 | ai | code |
| `backend/src/services/monitoring/diff/dosarSoap.ts` | 304 | 6 | 93 | 7 | monitoring | code |
| `frontend/src/components/ApiKeyDialog.tsx` | 303 | 2 | 288 | 4 | shared | code |
| `backend/src/routes/termene.ts` | 302 | 4 | 157 | 8 | routes | code |
| `frontend/src/components/AIUsagePanel.tsx` | 296 | 8 | 212 | 5 | ai | code |
| `backend/src/services/email/dailyReportScheduler.ts` | 292 | 10 | 156 | 7 | email | code |
| `frontend/src/pages/admin/Quota.tsx` | 289 | 8 | 281 | 4 | shared | code |
| `frontend/src/components/ui/select.tsx` | 284 | 11 | 140 | 4 | ui | code |
| `frontend/src/components/CalendarView.tsx` | 271 | 6 | 254 | 8 | shared | code |
| `backend/src/routes/dosare.ts` | 265 | 4 | 146 | 8 | dosare | code |
| `frontend/src/components/InstitutieSelect.tsx` | 249 | 8 | 261 | 5 | shared | code |
| `backend/src/routes/nameLists.ts` | 244 | 5 | 63 | 9 | routes | code |
| `frontend/src/components/monitoring/MonitoringAddForm.tsx` | 242 | 2 | 231 | 5 | monitoring | code |
| `backend/src/services/monitoring/nameSoapRunner.ts` | 241 | 7 | 78 | 8 | monitoring | code |
| `frontend/src/components/dashboard/Timeline.tsx` | 235 | 5 | 132 | 4 | dashboard | code |
| `frontend/src/pages/Dashboard.tsx` | 223 | 6 | 196 | 5 | dashboard | code |
| `frontend/src/components/EmailSettingsPanel.tsx` | 222 | 5 | 188 | 5 | email | code |
| `frontend/src/components/TermeneMetrics.tsx` | 205 | 4 | 144 | 6 | termene | code |
| `frontend/src/components/MetricsPanel.tsx` | 189 | 5 | 136 | 5 | shared | code |
| `frontend/src/components/dashboard/ReportExportModal.tsx` | 185 | 4 | 192 | 4 | dashboard | code |
| `frontend/src/hooks/useApiKey.ts` | 183 | 13 | 137 | 7 | shared | code |
| `backend/src/db/monitoringAlertsEnrichment.ts` | 171 | 4 | 92 | 6 | monitoring | code |
| `frontend/src/components/NotificationStatusPanel.tsx` | 163 | 4 | 139 | 3 | shared | code |
| `backend/src/db/migrations/runner.ts` | 161 | 5 | 44 | 6 | db | code |
| `backend/src/services/batch-dosare.ts` | 159 | 5 | 47 | 6 | dosare | code |
| `backend/src/services/monitoring/dosarSoapRunner.ts` | 152 | 1 | 131 | 8 | monitoring | code |
| `frontend/src/hooks/useAlertsStream.ts` | 151 | 7 | 72 | 6 | alerts | code |
| `backend/src/services/monitoring/diff/nameSoap.ts` | 150 | 6 | 56 | 6 | monitoring | code |
| `frontend/src/components/rnpm/RnpmRestoreModal.tsx` | 141 | 5 | 136 | 4 | rnpm | code |
| `frontend/src/components/rnpm/RnpmSplitDialog.tsx` | 134 | 2 | 123 | 3 | rnpm | code |
| `frontend/src/components/sidebar-footer.tsx` | 130 | 1 | 123 | 4 | navigation | code |
| `frontend/src/components/termene-table-detail-row.tsx` | 116 | 1 | 107 | 5 | termene | code |
| `frontend/src/pages/Manual.tsx` | 110 | 1 | 105 | 7 | manual | code |
| `frontend/src/components/DosarModal.tsx` | 102 | 2 | 86 | 6 | shared | code |
| `backend/src/services/email/alertEmailDispatcher.ts` | 93 | 5 | 37 | 7 | alerts | code |
| `frontend/src/pages/Changelog.tsx` | 83 | 2 | 79 | 6 | changelog | code |
| `backend/src/services/monitoring/commands/createMonitoringJob.ts` | 54 | 1 | 16 | 6 | monitoring | code |

## MED-risk files (sorted by LOC desc)

| File | LOC | Funcs | Max func LOC | Nesting | Domain | Kind |
|------|-----|-------|--------------|---------|--------|------|
| `frontend/src/lib/rnpmExport.ts` | 491 | 10 | 74 | 5 | rnpm | code |
| `backend/src/services/ai.ts` | 483 | 18 | 61 | 5 | ai | code |
| `backend/src/db/monitoringAlertsRepository.ts` | 481 | 16 | 51 | 4 | monitoring | code |
| `backend/src/routes/dashboard.ts` | 442 | 15 | 62 | 4 | dashboard | code |
| `frontend/src/lib/export-report.ts` | 428 | 13 | 17 | 4 | export | code |
| `frontend/src/lib/api.ts` | 424 | 6 | 48 | 3 | shared | code |
| `frontend/src/lib/export-manual.ts` | 417 | 7 | 18 | 3 | export | code |
| `backend/src/db/schema.ts` | 409 | 11 | 33 | 5 | db | code |
| `backend/src/routes/monitoring.ts` | 406 | 5 | 88 | 5 | monitoring | code |
| `backend/src/services/nameListParser.ts` | 387 | 13 | 37 | 4 | shared | code |
| `backend/src/index.ts` | 338 | 3 | 45 | 4 | shared | code |
| `backend/src/db/monitoringJobsRepository.ts` | 332 | 10 | 71 | 4 | monitoring | code |
| `backend/src/routes/admin.ts` | 317 | 2 | 59 | 5 | routes | code |
| `backend/src/services/rnpmClient.ts` | 305 | 2 | 10 | 4 | rnpm | code |
| `backend/src/services/captchaSolver.ts` | 301 | 15 | 23 | 5 | shared | code |
| `frontend/src/lib/monitoringBulkTemplate.ts` | 288 | 7 | 51 | 4 | monitoring | code |
| `backend/src/services/rnpmExportPdf.ts` | 288 | 16 | 84 | 4 | rnpm | code |
| `frontend/src/components/metrics-panel-parts.tsx` | 263 | 6 | 49 | 5 | shared | code |
| `backend/src/services/dosareExportXlsx.ts` | 245 | 9 | 61 | 4 | dosare | code |
| `frontend/src/lib/changelog-pdf.ts` | 241 | 6 | 69 | 4 | shared | code |
| `frontend/src/lib/monitoringApi.ts` | 238 | 2 | 22 | 5 | monitoring | code |
| `backend/src/db/nameListsRepository.ts` | 221 | 7 | 56 | 4 | db | code |
| `frontend/src/lib/alert-context.tsx` | 194 | 9 | 18 | 5 | alerts | code |
| `backend/src/services/email/mailer.ts` | 194 | 13 | 15 | 4 | email | code |
| `frontend/src/lib/export-analysis.ts` | 191 | 5 | 45 | 5 | export | code |
| `frontend/src/lib/utils.ts` | 182 | 8 | 31 | 4 | shared | code |
| `frontend/src/lib/adminApi.ts` | 180 | 1 | 9 | 5 | shared | code |
| `backend/src/services/alertsExportPdf.ts` | 172 | 10 | 44 | 5 | alerts | code |
| `frontend/src/pages/dashboard-summary-cards.tsx` | 152 | 5 | 64 | 3 | dashboard | code |
| `backend/src/services/alertsExportXlsx.ts` | 150 | 8 | 26 | 5 | alerts | code |
| `backend/src/services/aiUsage.ts` | 150 | 5 | 33 | 4 | ai | code |
| `backend/src/routes/me.ts` | 149 | 3 | 51 | 4 | routes | code |
| `backend/src/services/termeneExportXlsx.ts` | 146 | 7 | 20 | 4 | export | code |
| `frontend/src/components/table-pagination.tsx` | 142 | 2 | 96 | 3 | shared | code |
| `backend/src/middleware/rate-limit.ts` | 129 | 9 | 13 | 5 | middleware | code |
| `frontend/src/components/dashboard/KpiStrip.tsx` | 123 | 4 | 79 | 4 | dashboard | code |
| `frontend/src/hooks/useMonitoringJobs.ts` | 99 | 1 | 30 | 4 | monitoring | code |
| `frontend/src/components/ui/confirm-dialog.tsx` | 96 | 4 | 83 | 4 | ui | code |
| `backend/src/auth/authProvider.ts` | 89 | 3 | 8 | 4 | auth | code |
| `frontend/src/lib/rnpmHighlightTokens.tsx` | 86 | 5 | 13 | 4 | rnpm | code |
| `frontend/src/components/monitoring/NoteEditor.tsx` | 85 | 2 | 81 | 4 | monitoring | code |
| `frontend/src/components/dashboard/QuickActions.tsx` | 84 | 1 | 72 | 5 | dashboard | code |
| `backend/src/middleware/owner.ts` | 82 | 7 | 4 | 4 | middleware | code |
| `frontend/src/lib/excel-helpers.ts` | 75 | 9 | 9 | 4 | shared | code |
| `backend/src/util/rwlock.ts` | 75 | 0 | 10 | 5 | shared | code |
| `frontend/src/hooks/useMonitoringMasterSwitch.ts` | 73 | 1 | 22 | 4 | monitoring | code |
| `frontend/src/components/rnpm/rnpm-form-hooks.ts` | 66 | 4 | 18 | 4 | rnpm | code |
| `frontend/src/components/monitoring/JobKindTabs.tsx` | 66 | 2 | 58 | 5 | monitoring | code |
| `backend/src/auth/config.ts` | 65 | 10 | 16 | 4 | auth | config |
| `backend/src/services/monitoring/clock.ts` | 64 | 0 | 21 | 4 | monitoring | code |
| `frontend/src/hooks/useSearchHistory.ts` | 62 | 4 | 46 | 4 | shared | code |
| `backend/src/middleware/static-frontend.ts` | 50 | 1 | 40 | 5 | middleware | code |
| `frontend/src/hooks/useRnpmResultsFilter.ts` | 44 | 1 | 32 | 5 | shared | code |
| `backend/src/middleware/requireRole.ts` | 42 | 1 | 36 | 5 | middleware | code |
| `frontend/src/components/dosare-table-highlight.tsx` | 42 | 3 | 31 | 4 | dosare | code |
| `frontend/src/hooks/useDialog.ts` | 31 | 2 | 38 | 4 | shared | code |
| `frontend/src/components/AdminGate.tsx` | 29 | 1 | 29 | 4 | shared | code |
| `backend/src/services/alerts/alertEventService.ts` | 29 | 1 | 21 | 5 | alerts | code |
| `frontend/src/lib/monitoringMasterSwitchApi.ts` | 22 | 0 | 8 | 4 | monitoring | code |
| `frontend/src/lib/exportRunner.ts` | 22 | 1 | 18 | 4 | export | code |

## LOW-risk files (grouped by domain)

### ai (3)
- `backend/src/db/aiUsageRepository.ts` (code, 178 LOC)
- `backend/src/routes/aiUsage.ts` (code, 76 LOC)
- `frontend/src/lib/aiUsageApi.ts` (code, 54 LOC)

### alerts (3)
- `frontend/src/components/alerts/AlertNoteBlock.tsx` (code, 12 LOC)
- `frontend/src/lib/alertsApi.ts` (code, 268 LOC)
- `frontend/src/lib/alertsNotificationPref.ts` (code, 31 LOC)

### auth (2)
- `backend/src/auth/jwt.ts` (code, 92 LOC)
- `backend/src/routes/auth.ts` (code, 78 LOC)

### dashboard (3)
- `backend/src/db/dashboardActivityRepository.ts` (code, 220 LOC)
- `frontend/src/lib/dashboardApi.ts` (code, 121 LOC)
- `frontend/src/pages/dashboard-modals.tsx` (code, 102 LOC)

### db (4)
- `backend/src/db/auditRepository.ts` (code, 224 LOC)
- `backend/src/db/searchRepository.ts` (code, 75 LOC)
- `backend/src/db/userQuotaRepository.ts` (code, 64 LOC)
- `backend/src/db/userRepository.ts` (code, 125 LOC)

### dosare (3)
- `frontend/src/components/dosare-ai-config.ts` (config, 45 LOC)
- `frontend/src/components/dosare-table-helpers.ts` (code, 44 LOC)
- `frontend/src/lib/export-dosare.ts` (code, 132 LOC)

### email (2)
- `backend/src/db/ownerEmailSettingsRepository.ts` (code, 105 LOC)
- `backend/src/services/email/dailyReportTemplate.ts` (code, 196 LOC)

### export (3)
- `frontend/src/lib/export.worker.ts` (code, 45 LOC)
- `frontend/src/lib/export-termene.ts` (code, 111 LOC)
- `frontend/src/lib/export-types.ts` (types, 15 LOC)

### middleware (3)
- `backend/src/middleware/originGuard.ts` (code, 46 LOC)
- `backend/src/middleware/requestId.ts` (code, 17 LOC)
- `backend/src/middleware/requireDesktopHeader.ts` (code, 20 LOC)

### monitoring (8)
- `backend/src/db/monitoringRunsRepository.ts` (code, 126 LOC)
- `backend/src/db/monitoringSnapshotsRepository.ts` (code, 53 LOC)
- `backend/src/db/ownerMonitoringSettingsRepository.ts` (code, 54 LOC)
- `backend/src/schemas/monitoring.ts` (code, 103 LOC)
- `backend/src/services/monitoring/backoff.ts` (code, 25 LOC)
- `backend/src/services/monitoring/diff/types.ts` (types, 9 LOC)
- `backend/src/services/monitoring/sedintaKey.ts` (code, 56 LOC)
- `frontend/src/lib/export-monitoring.ts` (code, 206 LOC)

### navigation (1)
- `frontend/src/components/sidebar-history-entry.tsx` (code, 48 LOC)

### rnpm (10)
- `backend/src/services/rnpmAvizMapper.ts` (code, 218 LOC)
- `backend/src/services/rnpmDestinations.ts` (code, 37 LOC)
- `backend/src/services/rnpmSubTypes.ts` (types, 75 LOC)
- `frontend/src/components/rnpm/rnpm-form-constants.ts` (config, 118 LOC)
- `frontend/src/components/rnpm/rnpm-form-fields.tsx` (code, 259 LOC)
- `frontend/src/lib/rnpmAvizStatus.ts` (code, 29 LOC)
- `frontend/src/lib/rnpmFilterTokens.ts` (code, 21 LOC)
- `frontend/src/lib/rnpmGapReason.ts` (code, 24 LOC)
- `frontend/src/lib/rnpmProgressPhase.ts` (code, 55 LOC)
- `frontend/src/types/rnpm.ts` (types, 261 LOC)

### shared (25)
- `backend/src/intervals.ts` (code, 49 LOC)
- `backend/src/schemas/nameLists.ts` (types, 28 LOC)
- `backend/src/util/canonicalJson.ts` (code, 21 LOC)
- `backend/src/util/dateFormat.ts` (code, 22 LOC)
- `backend/src/util/envelope.ts` (code, 44 LOC)
- `backend/src/util/institutionLabel.ts` (code, 270 LOC)
- `backend/src/util/pdfStream.ts` (code, 16 LOC)
- `backend/src/util/textNormalize.ts` (code, 39 LOC)
- `backend/src/util/validation.ts` (code, 33 LOC)
- `backend/src/util/xlsxHelpers.ts` (code, 6 LOC)
- `frontend/src/components/SanitizedHtml.tsx` (code, 32 LOC)
- `frontend/src/hooks/useCurrentUser.ts` (code, 44 LOC)
- `frontend/src/hooks/useDebouncedValue.ts` (code, 10 LOC)
- `frontend/src/hooks/useFontSize.ts` (code, 44 LOC)
- `frontend/src/hooks/useRnpmHistory.ts` (code, 57 LOC)
- `frontend/src/hooks/useTheme.ts` (code, 21 LOC)
- `frontend/src/lib/chart-colors.ts` (code, 21 LOC)
- `frontend/src/lib/datetime-formatters.ts` (code, 18 LOC)
- `frontend/src/lib/download-helpers.ts` (code, 14 LOC)
- `frontend/src/lib/institutii.ts` (code, 295 LOC)
- `frontend/src/lib/pdf-helpers.ts` (code, 19 LOC)
- `frontend/src/main.tsx` (code, 9 LOC)
- `frontend/src/types/desktop-api.d.ts` (types, 21 LOC)
- `frontend/src/types/index.ts` (types, 57 LOC)
- `frontend/src/vite-env.d.ts` (types, 1 LOC)

### soap (1)
- `backend/src/soap.ts` (code, 167 LOC)

### ui (5)
- `frontend/src/components/ui/badge.tsx` (code, 25 LOC)
- `frontend/src/components/ui/button.tsx` (code, 35 LOC)
- `frontend/src/components/ui/card.tsx` (code, 23 LOC)
- `frontend/src/components/ui/input.tsx` (code, 18 LOC)
- `frontend/src/components/ui/spinner.tsx` (code, 11 LOC)

## Domain rollup

| Domain | Files | Total LOC | HIGH | MED | LOW |
|--------|-------|-----------|------|-----|-----|
| rnpm | 28 | 8995 | 13 | 5 | 10 |
| shared | 52 | 7100 | 12 | 15 | 25 |
| monitoring | 29 | 5807 | 10 | 11 | 8 |
| alerts | 12 | 2884 | 5 | 4 | 3 |
| dosare | 10 | 2521 | 5 | 2 | 3 |
| dashboard | 11 | 2201 | 4 | 4 | 3 |
| db | 8 | 1602 | 2 | 2 | 4 |
| ai | 7 | 1543 | 2 | 2 | 3 |
| export | 8 | 1375 | 0 | 5 | 3 |
| termene | 4 | 1024 | 4 | 0 | 0 |
| routes | 4 | 1012 | 2 | 2 | 0 |
| email | 5 | 1009 | 2 | 1 | 2 |
| manual | 2 | 982 | 2 | 0 | 0 |
| aviz | 1 | 631 | 1 | 0 | 0 |
| navigation | 3 | 596 | 2 | 0 | 1 |
| ui | 7 | 492 | 1 | 1 | 5 |
| middleware | 7 | 386 | 0 | 4 | 3 |
| auth | 4 | 324 | 0 | 2 | 2 |
| soap | 1 | 167 | 0 | 0 | 1 |
| changelog | 1 | 83 | 1 | 0 | 0 |

## Notes & caveats

### Methodology
- LOC excludes blank lines and pure-comment lines (`//`, `/*...*/`, block-comment continuations).
- `Funcs` counts top-level `function`/`class` declarations, exported functions, and arrow-function `const X = (...) =>`/`const X = ident =>` bindings. Inline callbacks (`.map(x => ...)`) are not counted.
- `Max func LOC` is computed by finding every `{` that follows a function signature / arrow / class member and counting newlines until the balanced closing `}`. For React components that ARE the whole module, this will equal ~total LOC (e.g. `Alerts.tsx` 814 of 819) - that is intentional, it tells you the component is monolithic.
- `Nesting` is max raw `{` depth, ignoring strings/comments but **not** distinguishing JSX expression containers from control-flow braces. JSX-heavy components therefore report higher nesting than their actual control-flow complexity. Treat nesting >= 6 in a `.tsx` as "investigate" rather than "must-refactor".
- `Risk` thresholds per spec: HIGH if `LOC > 500` OR `MaxFunc > 100` OR `Nesting > 5`; MED for 300<=LOC<=500 or MaxFunc 50-100 or Nesting 4-5; else LOW.

### Surprises and "big-but-justified" candidates
- `frontend/src/pages/manual-content.tsx` (872 LOC, MaxFunc 889) - content/documentation page; almost entirely static JSX. Equivalent to `changelog-entries.tsx` but not explicitly excluded. **Consider adding to exclusion list** for future audits.
- `backend/src/routes/rnpm.ts` (922 LOC, MaxFunc 232, Nesting 9) - clearest hot-spot in the backend. Multi-step search orchestration + bulk + cache + admin all in one router file.
- `backend/src/services/rnpmSearchService.ts` (883 LOC, MaxFunc 203) - companion of the route above; same domain, similarly tangled.
- `frontend/src/pages/Alerts.tsx`, `Monitorizare.tsx`, `RnpmSearch.tsx`, `DosareTable.tsx`, `RnpmSearchForm.tsx`, `RnpmResultsTable.tsx`, `RnpmSavedData.tsx`, `RnpmBulkSearch.tsx`, `RnpmDetailModal.tsx` - the classic "god component" pattern called out in CP-15. Each mixes data fetching + local state + business rules + UI. Highest-ROI refactor surface on the frontend.
- `backend/src/db/avizRepository.ts` (631 LOC) and `backend/src/db/monitoringAlertsRepository.ts` (481 LOC) - repository files large primarily because they carry many query helpers; per-function LOC is moderate (181 and 51). Big but not necessarily badly-shaped.
- `backend/src/services/ai.ts` (483 LOC, 18 funcs, MaxFunc 61) - large but well-decomposed; LOW priority for refactor relative to size.
- `frontend/src/lib/rnpmApi.ts` (482 LOC, 22 funcs, MaxFunc 25) - thin API wrapper, large only because RNPM has many endpoints. Functional spread is healthy.
- `frontend/src/components/Sidebar.tsx` (418 LOC, MaxFunc 369) - nav component mixing routing, history, settings, AI key UI. Worth splitting.
- `backend/src/db/schema.ts` (409 LOC) flagged HIGH on nesting (5) but is mostly DDL statements - more of a `config` artefact than refactor target.

### Domain concentration
The `rnpm` domain dominates by total LOC and by HIGH-risk count - it is the single largest refactor surface and matches the recent v2.27.x perf work on RNPM filtering/details. The `monitoring` domain is second, with the `Monitorizare.tsx` god-component and the scheduler/runner trio as the main hot spots.

