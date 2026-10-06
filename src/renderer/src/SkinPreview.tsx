import { useState } from "react";
import {
  Button,
  Theme,
  TextField,
  Checkbox,
  Tabs,
  ProgressBar,
  Badge,
  SectionTitle,
  DropdownMenu,
} from "./ui-kit";
import type { SkinDefinition } from "../../shared/skins";
export function SkinPreview({
  skin,
  compact = false,
}: {
  skin: SkinDefinition;
  compact?: boolean;
}) {
  const [tab, setTab] = useState("all"),
    [value, setValue] = useState("超长中文素材名称 · 木箱与森林道路"),
    [checked, setChecked] = useState(true);
  return (
    <Theme
      skin={skin}
      density="regular"
      motion="none"
      className="skin-preview"
      style={{ padding: compact ? 12 : 20 }}
    >
      <SectionTitle title={skin.manifest.name} eyebrow="OmO" />
      <div className="skin-preview-controls">
        <Button variant="primary">主要操作</Button>
        <Button>次要操作</Button>
        <Button disabled>禁用</Button>
        <Badge>PNG</Badge>
      </div>
      {!compact && (
        <>
          <TextField
            label="素材名称"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Tabs
            label="预览分类"
            options={[
              { value: "all", label: "全部素材" },
              { value: "selected", label: "已选择" },
            ]}
            value={tab}
            onChange={setTab}
          />
          <Checkbox
            label="包含关联素材"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <div className="skin-preview-controls">
            <DropdownMenu
              label="预览菜单"
              items={[
                { id: "open", label: "打开素材" },
                { id: "export", label: "导出资源" },
              ]}
            />
            <Button loading>处理中</Button>
          </div>
          <ProgressBar value={68} label="资源准备" />
        </>
      )}
    </Theme>
  );
}
