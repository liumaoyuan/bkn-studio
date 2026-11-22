/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import type { DataIngestionView } from "@/modules/data-ingestion/types/data-ingestion";

export interface DataIngestionWorkbenchSceneProps {
  activeView: DataIngestionView;
  runId?: string;
  onViewChange: (view: DataIngestionView) => void;
  onOpenRun?: (runId: string) => void;
  onBack?: () => void;
}
