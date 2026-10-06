import { useEffect, useState } from "react";
import { Palette, Download, Upload, Plus } from "lucide-react";
import { Button, SelectField } from "./ui-kit";
import { Modal } from "./components";
import { call, report, useStore } from "./store";
import { useAppearance } from "./Appearance";
import { SkinPreview } from "./SkinPreview";
import { SkinWizard } from "./SkinWizard";
import type { SkinDefinition } from "../../shared/skins";
export async function saveSkinExport(
  skin: SkinDefinition,
  mode: "package" | "resources",
) {
  const [target] = await window.workshop.choose({
    kind: "save",
    title: mode === "package" ? "导出完整皮肤包" : "导出拆分素材包",
    defaultPath:
      skin.manifest.name + (mode === "package" ? ".awskin" : "-素材.zip"),
    filters: [
      {
        name: mode === "package" ? "皮肤包" : "素材包",
        extensions: [mode === "package" ? "awskin" : "zip"],
      },
    ],
  });
  if (!target) return;
  useStore.getState().notify("正在生成皮肤素材，请等待导出完成…");
  await call("skins.export", { key: skin.key, target, mode });
  useStore.getState().notify("皮肤导出完成");
}
export function SkinSettings() {
  const appearance = useAppearance(),
    [skins, setSkins] = useState<SkinDefinition[]>([]),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<SkinDefinition>(),
    [wizard, setWizard] = useState(false);
  const reload = () => call<SkinDefinition[]>("skins.list").then(setSkins);
  useEffect(() => {
    void reload().catch(report);
  }, [appearance.preferences.skinKey]);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await reload();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section skin-settings">
      <div className="skin-heading">
        <h2>
          <Palette size={19} /> 外观与皮肤
        </h2>
        <div className="skin-actions">
          <Button
            icon={<Upload size={15} />}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const paths = await window.workshop.choose({
                  kind: "files",
                  title: "导入皮肤包（.awskin、ZIP 或目录）",
                });
                for (const path of paths) await call("skins.install", { path });
                useStore.getState().notify("皮肤已安装，可预览后应用");
              })
            }
          >
            导入皮肤
          </Button>
          <Button
            icon={<Plus size={15} />}
            disabled={busy}
            onClick={() => setWizard(true)}
          >
            素材组包
          </Button>
        </div>
      </div>
      <p>整套外观保存在客户端，切换素材库不会改变当前皮肤。</p>
      {busy && <p role="status">正在处理皮肤资源，请稍候…</p>}
      <div className="form-grid">
        <SelectField
          label="界面密度"
          value={appearance.preferences.density}
          options={[
            { value: "regular", label: "标准 · 36px" },
            { value: "compact", label: "紧凑 · 28px" },
          ]}
          onChange={(e) =>
            void appearance
              .apply({ density: e.target.value as "regular" | "compact" })
              .catch(report)
          }
        />
        <SelectField
          label="动效"
          value={appearance.preferences.motion}
          options={[
            { value: "system", label: "遵循系统设置" },
            { value: "reduced", label: "减少动效" },
            { value: "none", label: "关闭动效" },
          ]}
          onChange={(e) =>
            void appearance
              .apply({
                motion: e.target.value as "system" | "reduced" | "none",
              })
              .catch(report)
          }
        />
      </div>
      <div className="skin-grid">
        {skins.map((skin) => (
          <article
            className="skin-card"
            key={skin.key}
            data-active={skin.key === appearance.preferences.skinKey}
          >
            <SkinPreview skin={skin} compact />
            <h3>
              {skin.manifest.name}{" "}
              {skin.key === appearance.preferences.skinKey && (
                <small>正在使用</small>
              )}
            </h3>
            <p>
              {skin.builtin ? "内置主题" : "已安装"} · {skin.manifest.version} ·{" "}
              {skin.manifest.author}
            </p>
            <div className="skin-actions">
              <Button
                variant="primary"
                disabled={busy || skin.key === appearance.preferences.skinKey}
                onClick={() =>
                  void run(() => appearance.apply({ skinKey: skin.key }))
                }
              >
                应用
              </Button>
              <Button onClick={() => setPreview(skin)}>预览</Button>
              <Button
                disabled={busy}
                icon={<Download size={14} />}
                onClick={() => void run(() => saveSkinExport(skin, "package"))}
              >
                导出
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() => call("skins.saveAsset", { key: skin.key }))
                }
              >
                存为素材
              </Button>
              {!skin.builtin && (
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    void run(() => call("skins.remove", { key: skin.key }))
                  }
                >
                  卸载
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      <Button
        disabled={busy}
        onClick={() =>
          void run(() =>
            appearance.apply({
              skinKey: "builtin:comic",
              density: "regular",
              motion: "system",
            }),
          )
        }
      >
        恢复默认外观
      </Button>
      {preview && (
        <Modal
          title={`皮肤预览 · ${preview.manifest.name}`}
          onClose={() => setPreview(undefined)}
        >
          <SkinPreview skin={preview} />
          <p>{preview.manifest.license}</p>
          <div className="skin-actions">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void run(() => appearance.apply({ skinKey: preview.key }))
              }
            >
              应用此皮肤
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(() => saveSkinExport(preview, "resources"))
              }
            >
              导出拆分素材
            </Button>
          </div>
        </Modal>
      )}
      {wizard && (
        <SkinWizard
          onClose={() => setWizard(false)}
          onCreated={() => void reload().catch(report)}
        />
      )}
    </section>
  );
}
