/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import type { ConsoleNavContribution } from "@/app/shell/navigation/types";

/**
 * This distribution does not offer the observability menu, so the module contributes no
 * top-level entries. Its routes stay registered (see routes.tsx): deep links such as
 * `/observability/traces` and cross-page jumps keep working.
 */
export const bknTraceNavigation: ConsoleNavContribution = {
  items: [],
};
