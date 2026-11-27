/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { RobotOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AppButton } from "@/framework/ui/common/AppButton";

import { OntologyCopilotDrawer } from "./OntologyCopilotDrawer";

export type OntologyCopilotEntryButtonProps = {
  className?: string;
  /** 导入知识网络成功后回调，用于刷新列表。 */
  onImported?: () => void;
};

/** 知识网络列表页的「智能构建」入口：按钮 + 抽屉，不改变已有按钮行为。 */
export function OntologyCopilotEntryButton({
  className,
  onImported,
}: OntologyCopilotEntryButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <AppButton className={className} icon={<RobotOutlined />} onClick={() => setOpen(true)}>
        {t("knowledgeNetwork.copilotEntry")}
      </AppButton>
      <OntologyCopilotDrawer onClose={() => setOpen(false)} onImported={onImported} open={open} />
    </>
  );
}
